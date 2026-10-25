const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawnSync } = require("node:child_process");
const { test, expect } = require("@playwright/test");
const { ROOT } = require("./round-files");

const run = (name, ...args) =>
  spawnSync(process.execPath, [path.join(ROOT, "scripts", name), ...args], { encoding: "utf8", timeout: 120000 });
function round() {
  const src = test.info().outputPath("source"), dir = test.info().outputPath("round");
  expect(run("example-capture.mjs", src).status).toBe(0);
  const prepared = run("prepare-round.mjs", src, dir);
  expect(prepared.stderr).toBe("");
  return dir;
}

test.describe("回のフォルダを 1 枚の HTML に束ねる", () => {
  test.setTimeout(120000);

  test("回の器で束ね、移した先で外部を読まずに開く", async ({ page, context }) => {
    const dir = round(), output = test.info().outputPath("moved", "packed.html");
    const result = run("pack-round.mjs", dir, output);
    expect(result.stderr).toBe(""); expect(result.status).toBe(0);
    fs.rmSync(dir, { recursive: true });
    const requests = [], errors = [];
    context.on("request", (r) => { if (!r.url().startsWith("data:") && r.url() !== pathToFileURL(output).href) requests.push(r.url()); });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(pathToFileURL(output).href);
    await expect(page.locator("body")).toHaveClass(/is-ready/);
    const sources = await page.locator("img").evaluateAll((imgs) => imgs.map((i) => i.src));
    expect(sources.length).toBeGreaterThan(0);
    for (const src of sources) expect(src).toMatch(/^data:image\//);
    expect(requests).toEqual([]); expect(errors).toEqual([]);
  });

  test("0.4.0 より前の器の回は束ねない", () => {
    const dir = round();
    // A real 0.2.0 board: the last release before the board could read a package.
    for (const name of ["index.html", "board.js", "board.css", "validate.js"]) {
      const old = spawnSync("git", ["show", `54b9f0d:board/${name}`], { cwd: ROOT, encoding: "utf8" });
      expect(old.status, old.stderr).toBe(0);
      fs.writeFileSync(path.join(dir, name), old.stdout);
    }
    const lockFile = path.join(dir, "board.lock.json"), lock = JSON.parse(fs.readFileSync(lockFile, "utf8"));
    lock.version = "0.2.0";
    fs.writeFileSync(lockFile, JSON.stringify(lock));
    const output = test.info().outputPath("old.html");
    const result = run("pack-round.mjs", dir, output);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("0.4.0 以降の器");
    expect(fs.existsSync(output)).toBe(false);
  });

  test("錠と違う器・回のフォルダの中への出力は束ねない", () => {
    const dir = round();
    const inside = run("pack-round.mjs", dir, path.join(dir, "packed.html"));
    expect(inside.status).toBe(1); expect(inside.stderr).toContain("フォルダの外");
    fs.appendFileSync(path.join(dir, "board.js"), "\n");
    const changed = run("pack-round.mjs", dir, test.info().outputPath("changed.html"));
    expect(changed.status).toBe(1); expect(changed.stderr).toContain("錠と違う");
  });

  test("data-theme は端末の設定より優先して明暗を決める", async ({ page }) => {
    const dir = round(), output = test.info().outputPath("theme.html");
    expect(run("pack-round.mjs", dir, output).status).toBe(0);
    const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await page.goto(pathToFileURL(output).href);
    await expect(page.locator("body")).toHaveClass(/is-ready/);
    for (const [scheme, theme, expected] of [
      ["light", null, "rgb(247, 246, 242)"],
      ["dark", null, "rgb(27, 28, 30)"],
      ["dark", "light", "rgb(247, 246, 242)"],
      ["light", "dark", "rgb(27, 28, 30)"],
    ]) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.evaluate((t) => (t ? document.documentElement.setAttribute("data-theme", t) : document.documentElement.removeAttribute("data-theme")), theme);
      expect(await background(), `${scheme} / ${theme}`).toBe(expected);
    }
  });
});
