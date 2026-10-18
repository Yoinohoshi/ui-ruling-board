// scripts/check-round.mjs and scripts/install.mjs, run as the user would run them.
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { Buffer } = require("node:buffer");
const { spawnSync } = require("node:child_process");
const { test, expect } = require("@playwright/test");
const { ROOT, EXAMPLE, readRound, writeRound } = require("./round-files");
const { digest } = require("../board/validate.js");

const BOARD_FILES = ["index.html", "board.js", "board.css", "validate.js"];

const run = (script, ...args) =>
  spawnSync(process.execPath, [path.join(ROOT, "scripts", script), ...args], {
    encoding: "utf8",
  });
const sha256 = (file) =>
  createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const boardVersion = () =>
  /const VERSION = "([^"]+)";/.exec(
    fs.readFileSync(path.join(ROOT, "board", "board.js"), "utf8"),
  )[1];

test.describe("check-round", () => {
  test("例の記述は通り、記述のハッシュと数を出す", () => {
    const r = run("check-round.mjs", EXAMPLE);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(
      `ok basic-r1 · 記述 ${digest(readRound())} · 裁定点 2 · 項目 5 · 画像 25`,
    );
  });

  test("記述の誤りを場所付きで出して止まる", () => {
    const def = readRound();
    def.decisions[0].items[1].id = "D1.1";
    def.decisions[0].items[0].options[0].recommended = true;
    def.decisions[1].items[0].options[0].recomended = true;
    const r = run("check-round.mjs", writeRound(test.info(), def));
    expect(r.status).toBe(1);
    expect(r.stderr.trim().split("\n")).toEqual([
      "decisions[0].items[0].options: 推奨が 2 つ（1 項目に 1 つまで）",
      "decisions[0].items[1].id: id「D1.1」が重複",
      "decisions[1].items[0].options[0].recomended: 知らないキー",
    ]);
  });

  test("画像のファイルが無ければ止まる", () => {
    const def = readRound();
    def.decisions[0].items[2].options[1].images = {
      1280: "images/D1.3/none.svg",
    };
    const r = run("check-round.mjs", writeRound(test.info(), def));
    expect(r.status).toBe(1);
    expect(r.stderr.trim()).toBe(
      "D1.3 / a / 1280: 画像のファイルが無い：../../examples/basic/images/D1.3/none.svg",
    );
  });

  /** Puts `bytes` into the test's output folder and points D1.3 / a / 1280 at it. */
  const roundWithImage = (name, bytes) => {
    const file = test.info().outputPath(name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
    const def = readRound();
    def.decisions[0].items[2].options[1].images = {
      1280: path
        .relative(path.dirname(EXAMPLE), file)
        .split(path.sep)
        .join("/"),
    };
    return writeRound(test.info(), def);
  };
  const SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8"/>';

  for (const [name, file, bytes] of [
    ["閉じていない SVG", "cut.svg", SVG],
    ["SVG でない .svg", "text.svg", "<html></html>"],
    ["PNG でない .png", "fake.png", "not a png"],
    ["JPEG でない .jpg", "fake.jpg", Buffer.from("89504e470d0a1a0a", "hex")],
    [
      "WebP でない .webp",
      "fake.webp",
      Buffer.from("52494646000000004156", "hex"),
    ],
  ]) {
    test(`画像として読めなければ止まる：${name}`, () => {
      const r = run("check-round.mjs", roundWithImage(file, bytes));
      expect(r.status).toBe(1);
      expect(r.stderr.trim()).toMatch(
        new RegExp(
          `^D1\\.3 / a / 1280: 画像として読めない：\\S+/${file.replace(".", "\\.")}$`,
        ),
      );
    });
  }

  test("対照：形式どおりの画像は通る（XML 宣言・注釈つきの SVG、PNG・JPEG・WebP の頭）", () => {
    for (const [file, bytes] of [
      [
        "ok.svg",
        `${String.fromCharCode(0xfeff)}<?xml version="1.0"?>\n<!-- c -->\n${SVG}</svg>\n`,
      ],
      ["ok.png", Buffer.from("89504e470d0a1a0a0000", "hex")],
      ["ok.jpg", Buffer.from("ffd8ffe000", "hex")],
      ["ok.webp", Buffer.from("524946460000000057454250", "hex")],
    ]) {
      const r = run("check-round.mjs", roundWithImage(file, bytes));
      expect(r.stderr, file).toBe("");
      expect(r.status, file).toBe(0);
    }
  });
});

test.describe("install", () => {
  test("器を写して錠を書き、--check が通る", () => {
    const dir = test.info().outputPath("round");
    const r = run("install.mjs", dir);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    const lock = JSON.parse(
      fs.readFileSync(path.join(dir, "board.lock.json"), "utf8"),
    );
    expect(lock.name).toBe("ui-ruling-board");
    expect(lock.version).toBe(boardVersion());
    expect(
      lock.commit === null || /^[0-9a-f]{40}(-dirty)?$/.test(lock.commit),
    ).toBe(true);
    expect(Object.keys(lock.files)).toEqual(BOARD_FILES);
    for (const name of BOARD_FILES) {
      expect(fs.readFileSync(path.join(dir, name), "utf8")).toBe(
        fs.readFileSync(path.join(ROOT, "board", name), "utf8"),
      );
      expect(lock.files[name]).toBe(sha256(path.join(ROOT, "board", name)));
    }
    expect(run("install.mjs", "--check", dir).status).toBe(0);
  });

  test("--check：写しを書き換える・消すと赤", () => {
    const dir = test.info().outputPath("round");
    expect(run("install.mjs", dir).status).toBe(0);
    fs.appendFileSync(path.join(dir, "board.js"), "\n");
    fs.rmSync(path.join(dir, "validate.js"));
    const r = run("install.mjs", "--check", dir);
    expect(r.status).toBe(1);
    expect(r.stderr.trim().split("\n")).toEqual([
      "board.js: 錠と違う",
      "validate.js: ファイルが無い",
    ]);
  });

  test("錠のある所へは --force なしで入れない", () => {
    const dir = test.info().outputPath("round");
    expect(run("install.mjs", dir).status).toBe(0);
    const again = run("install.mjs", dir);
    expect(again.status).toBe(1);
    expect(again.stderr).toContain("--force");
    expect(run("install.mjs", dir, "--force").status).toBe(0);
  });
});

test("版は board.js の 1 か所で、package.json と一致する", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
  );
  expect(pkg.version).toBe(boardVersion());
});
