// Development-only pixel tools. The published HTML has no dependency on Playwright.
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { chromium } from "playwright";

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const geometry = createRequire(import.meta.url)("../shared/pixels.js");
export const { union, intersection, area, validRect } = geometry;

export async function imageTools() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.addScriptTag({ path: fileURLToPath(new URL("../shared/pixels.js", import.meta.url)) });
    const loaded = new Set();
    await page.evaluate(() => {
      globalThis.images = new Map();
    });
    const load = async (file) => {
      if (loaded.has(file)) return;
      const type = {
        ".svg": "svg+xml",
        ".png": "png",
        ".jpg": "jpeg",
        ".jpeg": "jpeg",
        ".webp": "webp",
      }[extname(file).toLowerCase()];
      if (!type) throw Error(`画像の形式が不明: ${file}`);
      await page.evaluate(
        async ({ file, src }) => {
          const img = new Image();
          img.src = src;
          await img.decode();
          const canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          ctx.drawImage(img, 0, 0);
          globalThis.images.set(file, {
            canvas,
            data: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
          });
        },
        {
          file,
          src: `data:image/${type};base64,${readFileSync(file).toString("base64")}`,
        },
      );
      loaded.add(file);
    };
    return {
      close: () => browser.close(),
      async compare(a, b, guard, noise = 16, within = null) {
        await load(a);
        await load(b);
        return page.evaluate(
          ({ a, b, guard, noise, within }) => globalThis.RulingBoardPixels.compare(globalThis.images.get(a), globalThis.images.get(b), guard, noise, within),
          { a, b, guard, noise, within },
        );
      },
      async crop(file, rect) {
        await load(file);
        const base64 = await page.evaluate(
          ({ file, rect }) => {
            const canvas = document.createElement("canvas");
            canvas.width = rect[2] * 2;
            canvas.height = rect[3] * 2;
            const ctx = canvas.getContext("2d");
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(
              globalThis.images.get(file).canvas,
              ...rect,
              0,
              0,
              canvas.width,
              canvas.height,
            );
            return canvas.toDataURL("image/png").split(",")[1];
          },
          { file, rect },
        );
        return Buffer.from(base64, "base64");
      },
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}
