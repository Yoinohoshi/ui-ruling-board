// Development-only pixel tools. The published HTML has no dependency on Playwright.
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { chromium } from "playwright";

export const union = (rects) => {
  const all = rects.filter(Boolean);
  if (!all.length) return null;
  const x = Math.min(...all.map((r) => r[0])),
    y = Math.min(...all.map((r) => r[1]));
  return [
    x,
    y,
    Math.max(...all.map((r) => r[0] + r[2])) - x,
    Math.max(...all.map((r) => r[1] + r[3])) - y,
  ];
};
export const intersection = (a, b) => {
  const x = Math.max(a[0], b[0]),
    y = Math.max(a[1], b[1]);
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - x,
    h = Math.min(a[1] + a[3], b[1] + b[3]) - y;
  return w > 0 && h > 0 ? [x, y, w, h] : null;
};
export const area = (r) => (r ? r[2] * r[3] : 0);
export const validRect = (r, w, h) =>
  Array.isArray(r) &&
  r.length === 4 &&
  r.every(Number.isInteger) &&
  r[0] >= 0 &&
  r[1] >= 0 &&
  r[2] > 0 &&
  r[3] > 0 &&
  r[0] + r[2] <= w &&
  r[1] + r[3] <= h;

export async function imageTools() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
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
          ({ a, b, guard, noise, within }) => {
            const left = globalThis.images.get(a),
              right = globalThis.images.get(b);
            const w = left.canvas.width,
              h = left.canvas.height;
            if (w !== right.canvas.width || h !== right.canvas.height)
              throw Error("比較する画像の寸法が違う");
            const mask = new Uint8Array(w * h);
            let pixels = 0,
              outside = 0;
            const contains = (r, x, y) =>
              !r ||
              (x >= r[0] && y >= r[1] && x < r[0] + r[2] && y < r[1] + r[3]);
            for (let p = 0; p < mask.length; p++) {
              const x = p % w,
                y = Math.floor(p / w),
                offset = p * 4;
              if (!contains(within, x, y)) continue;
              if (
                [0, 1, 2, 3].some(
                  (n) => left.data[offset + n] !== right.data[offset + n],
                )
              ) {
                mask[p] = 1;
                pixels++;
                if (!contains(guard, x, y)) outside++;
              }
            }
            // Eight-connected components: isolated differences under 16 pixels do
            // not enlarge show, but still count as outside-guard differences.
            const components = [];
            for (let p = 0; p < mask.length; p++) {
              if (!mask[p]) continue;
              const queue = [p];
              mask[p] = 0;
              let x1 = w,
                y1 = h,
                x2 = 0,
                y2 = 0;
              for (let at = 0; at < queue.length; at++) {
                const pos = queue[at],
                  x = pos % w,
                  y = Math.floor(pos / w);
                x1 = Math.min(x1, x);
                y1 = Math.min(y1, y);
                x2 = Math.max(x2, x);
                y2 = Math.max(y2, y);
                for (let dy = -1; dy <= 1; dy++)
                  for (let dx = -1; dx <= 1; dx++) {
                    const nx = x + dx,
                      ny = y + dy,
                      next = ny * w + nx;
                    if (nx >= 0 && nx < w && ny >= 0 && ny < h && mask[next]) {
                      mask[next] = 0;
                      queue.push(next);
                    }
                  }
              }
              if (queue.length >= noise)
                components.push([x1, y1, x2 - x1 + 1, y2 - y1 + 1]);
            }
            let show = null;
            if (components.length) {
              const x = Math.min(...components.map((r) => r[0])),
                y = Math.min(...components.map((r) => r[1]));
              show = [
                x,
                y,
                Math.max(...components.map((r) => r[0] + r[2])) - x,
                Math.max(...components.map((r) => r[1] + r[3])) - y,
              ];
            }
            components.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
            return {
              pixels,
              outside,
              show,
              first: components[0] ?? null,
              width: w,
              height: h,
            };
          },
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
