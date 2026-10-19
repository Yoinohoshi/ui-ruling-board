// The actual publication, opened offline. Also usable against a local reference.
import { chromium } from "playwright";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { checkFolder } from "./check-folder.mjs";

export async function verifyBoard(dir) {
  const { errors, def } = await checkFolder(dir);
  if (errors.length) throw Error(errors.join("\n"));
  const browser = await chromium.launch({ headless: true });
  const items = def.decisions.flatMap((d) => d.items),
    expected = items.map((i) => i.id);
  try {
    for (const width of [1280, 390]) {
      const context = await browser.newContext({
        viewport: { width, height: 844 },
        reducedMotion: "reduce",
      });
      try {
        const page = await context.newPage(),
          failures = [];
        page.on("pageerror", (error) => failures.push(error.message));
        await page.route(/^https?:/, (route) => {
          failures.push(`外部通信: ${route.request().url()}`);
          return route.abort();
        });
        await page.goto(pathToFileURL(join(resolve(dir), "index.html")).href);
        await page.waitForFunction(
          () =>
            document.body.classList.contains("is-ready") ||
            document.body.classList.contains("is-broken"),
        );
        if (await page.locator(".error-list").count())
          throw Error(await page.locator(".error-list").innerText());
        const actual = await page.evaluate(() => ({
          heading: [...document.querySelectorAll("section.item")].map(
            (n) => n.dataset.item,
          ),
          toc: [...document.querySelectorAll("#toc .toc-item")].map(
            (n) => n.dataset.item,
          ),
          choice: [...document.querySelectorAll("fieldset.choose")].map(
            (n) => n.dataset.item,
          ),
          answer: document
            .querySelector("#answer-text")
            .value.split("\n")
            .filter((l) => l.startsWith("- "))
            .map((l) => l.slice(2).split(" ")[0]),
        }));
        for (const [kind, ids] of Object.entries(actual))
          if (JSON.stringify(ids) !== JSON.stringify(expected))
            throw Error(`${kind}: 並びが違う`);
        const pick = page.locator('.top select[aria-label="見え方"]');
        if ((await pick.inputValue()) !== "")
          throw Error("項目ごとの見え方で開かない");
        // Every global view, including generated crops, must fall back locally.
        for (const view of ["", ...def.views.map((v) => v.id)]) {
          await pick.selectOption(view);
          await page.waitForFunction(() =>
            [...document.querySelectorAll(".stage img")].every(
              (i) => i.complete && i.naturalWidth > 0,
            ),
          );
          const mismatch = await page.evaluate(
            ({ items, views, view }) =>
              items.flatMap((item) => {
                const own = item.views ?? views.map((v) => v.id),
                  chosen = own.includes(view) ? view : own[0];
                const label = views.find((v) => v.id === chosen).label;
                const section = [
                  ...document.querySelectorAll("section.item"),
                ].find((s) => s.dataset.item === item.id);
                const images = [...section.querySelectorAll(".stage img")];
                if (item.options[0].noImage) return [];
                return !images.length ||
                  images.some(
                    (i) =>
                      !i.complete ||
                      !i.naturalWidth ||
                      !i.alt
                        .replace(/ · \d+\/\d+$/, "")
                        .endsWith(` · ${label}`),
                  )
                  ? [item.id]
                  : [];
              }),
            { items, views: def.views, view },
          );
          if (mismatch.length)
            throw Error(
              `${view || "項目ごと"}: 画像・見え方の不一致 ${mismatch.join(", ")}`,
            );
        }
        for (const layout of ["並べる", "切り替え"]) {
          await page.getByRole("button", { name: layout, exact: true }).click();
          const metrics = await page.evaluate(() => ({
            overflow:
              document.documentElement.scrollWidth -
              document.documentElement.clientWidth,
            header: document.querySelector("#top").getBoundingClientRect()
              .height,
          }));
          if (metrics.overflow > 0 || metrics.header > 844 / 4)
            throw Error(`${width}px ${layout}: 横あふれ・頭の帯が高い`);
        }
        if (failures.length) throw Error(failures.join("\n"));
      } finally {
        await context.close();
      }
    }
    return { items: items.length, views: def.views.length };
  } finally {
    await browser.close();
  }
}

if (import.meta.main) {
  if (process.argv.length !== 3) {
    console.error("使い方: node scripts/verify-board.mjs <回のフォルダ>");
    process.exitCode = 2;
  } else
    try {
      console.log("ok file://", await verifyBoard(process.argv[2]));
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
}
