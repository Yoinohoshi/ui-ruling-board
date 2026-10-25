const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawnSync } = require("node:child_process");
const { test, expect } = require("@playwright/test");
const { ROOT, readRound } = require("./round-files");

const run = (name, ...args) =>
  spawnSync(process.execPath, [path.join(ROOT, "scripts", name), ...args], {
    encoding: "utf8",
    timeout: 120000,
    env: { ...process.env, FORCE_COLOR: undefined },
  });
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const writeJson = (file, value) =>
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
const source = () => {
  const dir = test.info().outputPath("source");
  expect(run("example-capture.mjs", dir).status).toBe(0);
  return dir;
};
const prepared = () => {
  const src = source(),
    dir = test.info().outputPath("round");
  const result = run("prepare-round.mjs", src, dir);
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  return { src, dir };
};
// Synthetic fixture provenance, used only to exercise the release gate while
// the working board is dirty. The CLI itself must never launder dirty provenance.
const fixtureRelease = (dir) => {
  const file = path.join(dir, "board.lock.json"),
    lock = readJson(file);
  lock.commit = "1".repeat(40);
  writeJson(file, lock);
};

test.describe("r6 の生成と発行", () => {
  test.setTimeout(120000);

  test("guard と show を分け、名指し拡大を先頭に置き、案別の focus・段・画像なしを保つ", async ({
    page,
  }) => {
    const { dir } = prepared(),
      def = readRound(path.join(dir, "round.js"));
    const report = readJson(path.join(dir, "evidence.json"));
    expect(report.repeat).toHaveLength(11);
    expect(report.comparisons).toHaveLength(9);
    expect(report.zooms).toHaveLength(4);
    expect(report.comparisons.every((c) => c.outside === 0)).toBe(true);
    expect(
      report.comparisons.some(
        (c) => JSON.stringify(c.guard) !== JSON.stringify(c.show),
      ),
    ).toBe(true);
    const first = def.decisions[0].items[0];
    expect(first.views).toEqual([
      "1280.control.zoom",
      "390.control.zoom",
      "1280",
      "390",
    ]);
    expect(first.options[2].focus[1280]).toEqual([32, 64, 64, 32]);
    expect(first.options[1].focus[1280]).toEqual([32, 64, 142, 32]);
    expect(def.decisions[0].items[1].options[1].images[390]).toHaveLength(2);
    expect(def.decisions[0].items[1].options[2].noImage).toBe(true);
    await page.goto(pathToFileURL(path.join(dir, "index.html")).href);
    await expect(page.locator("body")).toHaveClass(/is-ready/);
    await expect(
      page.locator('section.item[data-item="D1.1"] .stage img'),
    ).toHaveAttribute("alt", /操作部分 · 拡大$/);
    const initial = await page.locator("#answer-text").inputValue();
    expect(initial).toContain("未選択");
    await page
      .locator('fieldset[data-item="D1.1"] input[value="option:a"]')
      .check();
    await page.locator('section[data-item="D1.1"] .comment').fill("余白を維持");
    await expect(page.locator("#answer-text")).toHaveValue(
      /右に寄せる[\s\S]*余白を維持/,
    );
    const saved = page.waitForEvent("download");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    expect((await saved).suggestedFilename()).toBe("workflow-r1-answer.md");
  });

  for (const [name, mutate, message] of [
    [
      "撮り直しが違う",
      (c, dir) =>
        fs.appendFileSync(
          path.join(dir, c["D1.1"][1280].repeat.cur[0]),
          "broken",
        ),
      /decode|decoded|source image|画像/i,
    ],
    [
      "同じファイルを撮り直しと呼ぶ",
      (c) => {
        c["D1.1"][1280].repeat.cur = c["D1.1"][1280].images.cur;
      },
      /別ファイル/,
    ],
    [
      "範囲外の変更",
      (c) => {
        c["D1.1"][1280].guard = [0, 0, 10, 10];
      },
      /guard の外/,
    ],
    [
      "案が同じ",
      (c) => {
        c["D1.1"][1280].images.a = c["D1.1"][1280].images.cur;
        c["D1.1"][1280].repeat.a = c["D1.1"][1280].repeat.cur;
      },
      /見える差が無い/,
    ],
    [
      "拡大が無関係",
      (c) => {
        c["D1.1"][1280].regions[0].rect = [400, 200, 60, 60];
      },
      /変化が写らない/,
    ],
    [
      "拡大を重複",
      (c) => {
        c["D1.1"][1280].regions.push({
          ...c["D1.1"][1280].regions[0],
          name: "duplicate",
        });
      },
      /重複して写す/,
    ],
    [
      "撮影計画の誤記",
      (c) => {
        c["D1.1"][1280].gaurd = c["D1.1"][1280].guard;
      },
      /知らない撮影キー/,
    ],
    [
      "推奨の変化の始まりが隠れる",
      (c, dir) => {
        const shot = c["D1.1"][1280];
        shot.guard = [24, 48, 1100, 64];
        shot.regions[0].rect = [1000, 58, 64, 44];
        for (const name of [...shot.images.a, ...shot.repeat.a]) {
          const file = path.join(dir, name);
          fs.writeFileSync(
            file,
            fs.readFileSync(file, "utf8").replace('x="110"', 'x="1000"'),
          );
        }
      },
      /変化の始まり/,
    ],
  ])
    test(`対照：${name}なら出力を作らない`, () => {
      const dir = source(),
        file = path.join(dir, "captures.json"),
        captures = readJson(file);
      mutate(captures, dir);
      writeJson(file, captures);
      const output = test.info().outputPath("invalid");
      const result = run("prepare-round.mjs", dir, output);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(message);
      expect(fs.existsSync(output)).toBe(false);
    });

  test("対照：画素の変わった撮り直しを検出する（有効な画像）", () => {
    const dir = source(),
      captures = readJson(path.join(dir, "captures.json"));
    const file = path.join(dir, captures["D1.1"][1280].repeat.cur[0]);
    fs.writeFileSync(
      file,
      fs.readFileSync(file, "utf8").replace("#64748b", "#ff0000"),
    );
    const result = run(
      "prepare-round.mjs",
      dir,
      test.info().outputPath("invalid"),
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/撮り直しで \d+px 違う/);
  });

  test("名指し指定が無くても小さな差の拡大を生成する", () => {
    const dir = source(),
      file = path.join(dir, "captures.json"),
      captures = readJson(file);
    for (const views of Object.values(captures))
      for (const capture of Object.values(views)) delete capture.regions;
    writeJson(file, captures);
    const output = test.info().outputPath("round"),
      result = run("prepare-round.mjs", dir, output);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(
      readRound(
        path.join(output, "round.js"),
      ).decisions[0].items[0].views.slice(0, 2),
    ).toEqual(["1280.zoom", "390.zoom"]);
  });

  test("発行先は移動しても file:// で使え、元のフォルダ・撮影台本に依存しない", async ({
    page,
  }) => {
    const { dir } = prepared();
    fixtureRelease(dir);
    fs.writeFileSync(path.join(dir, "private-notes.txt"), "do not distribute");
    const output = test.info().outputPath("published");
    const result = run("publish-round.mjs", dir, output);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(output, "private-notes.txt"))).toBe(false);
    expect(fs.existsSync(path.join(output, "captures.json"))).toBe(false);
    const moved = test.info().outputPath("moved");
    fs.renameSync(output, moved);
    fs.renameSync(dir, `${dir}-unavailable`);
    expect(run("check-folder.mjs", moved, "--release").status).toBe(0);
    await page.goto(pathToFileURL(path.join(moved, "index.html")).href);
    await expect(page.locator("body")).toHaveClass(/is-ready/);
    await expect(page.locator("section.item")).toHaveCount(3);
    const manifest = readJson(path.join(moved, "publication.json"));
    expect(Object.keys(manifest.files)).toContain("round.js");
    fs.appendFileSync(path.join(moved, "round.js"), "\n");
    const changed = run("check-folder.mjs", moved, "--release");
    expect(changed.status).toBe(1);
    expect(changed.stderr).toContain("発行後に変更された: round.js");
  });

  test("再生成の画素と記述が一致し、既存の回には書き込まない", () => {
    const { src, dir } = prepared(),
      second = test.info().outputPath("second");
    const result = run("prepare-round.mjs", src, second);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(fs.readFileSync(path.join(second, "round.js"), "utf8")).toBe(
      fs.readFileSync(path.join(dir, "round.js"), "utf8"),
    );
    const generated = readJson(path.join(dir, "evidence.json"));
    for (const zoom of generated.zooms) {
      const image = `images/${zoom.item}/cur-${zoom.id}-1.png`;
      expect(
        fs
          .readFileSync(path.join(dir, image))
          .equals(fs.readFileSync(path.join(second, image))),
      ).toBe(true);
    }
    expect(run("prepare-round.mjs", src, dir).status).toBe(1);
    expect(run("publish-round.mjs", dir, second).status).toBe(1);
  });

  for (const [name, mutate, message] of [
    [
      "dirty な錠",
      (dir) => {
        const file = path.join(dir, "board.lock.json"),
          v = readJson(file);
        v.commit = "1".repeat(40) + "-dirty";
        writeJson(file, v);
      },
      /全桁 SHA/,
    ],
    [
      "版の詐称",
      (dir) => {
        const file = path.join(dir, "board.lock.json"),
          v = readJson(file);
        v.version = "9.9.9";
        writeJson(file, v);
      },
      /version が違う/,
    ],
    [
      "余分な画像",
      (dir) =>
        fs.writeFileSync(path.join(dir, "images", "unused.svg"), "unused"),
      /記述が指さない画像/,
    ],
    [
      "生成一覧の詐称",
      (dir) => {
        const file = path.join(dir, "generated.json"),
          v = readJson(file);
        v.items["D1.1"].push("1280");
        writeJson(file, v);
      },
      /正本に宣言済み/,
    ],
    [
      "生成拡大が後ろ",
      (dir) => {
        const file = path.join(dir, "round.js"),
          v = readRound(file);
        v.decisions[0].items[0].views.reverse();
        fs.writeFileSync(file, `RulingBoard.define(${JSON.stringify(v)});`);
      },
      /生成した拡大が項目の先頭に無い/,
    ],
    [
      "項目順の食い違い",
      (dir) => {
        const file = path.join(dir, "round.js"),
          v = readRound(file);
        v.decisions[0].items.reverse();
        fs.writeFileSync(file, `RulingBoard.define(${JSON.stringify(v)});`);
      },
      /items.mjs と round.js が違う/,
    ],
    [
      "不足した画像",
      (dir) => fs.unlinkSync(path.join(dir, "images/D1.1/cur-1280-1.svg")),
      /ENOENT/,
    ],
  ])
    test(`対照：${name}を発行しない`, () => {
      const { dir } = prepared();
      fixtureRelease(dir);
      mutate(dir);
      const output = test.info().outputPath("invalid"),
        result = run("publish-round.mjs", dir, output);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(message);
      expect(fs.existsSync(output)).toBe(false);
    });

  test("画像がフォルダの外を指すと発行しない", () => {
    const { dir } = prepared();
    fixtureRelease(dir);
    const def = readRound(path.join(dir, "round.js"));
    fs.copyFileSync(
      path.join(dir, "images/D1.1/cur-1280-1.svg"),
      path.join(dir, "../outside.svg"),
    );
    def.decisions[0].items[0].options[0].images[1280] = "../outside.svg";
    fs.writeFileSync(
      path.join(dir, "round.js"),
      `RulingBoard.define(${JSON.stringify(def)});`,
    );
    const result = run("check-folder.mjs", dir, "--release");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("配布フォルダの外を指す");
  });

  test("形式の簡易検査を通っても、実際に描けない画像は発行しない", () => {
    const { dir } = prepared();
    fixtureRelease(dir);
    fs.writeFileSync(
      path.join(dir, "images/D1.1/cur-1280-1.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><g></svg>',
    );
    expect(run("check-folder.mjs", dir, "--release").status).toBe(0);
    const output = test.info().outputPath("invalid");
    const result = run("publish-round.mjs", dir, output);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("画像を読めない");
    expect(fs.existsSync(output)).toBe(false);
  });
});
