const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const zlib = require("node:zlib");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const ROOT = path.resolve(__dirname, "..");
const url = file => pathToFileURL(file).href;
let author;
test.beforeAll(() => {
  // Commit the actual runtime sources into an isolated synthetic repository.
  // This exercises the clean-source gate without falsifying provenance.
  const fixture = test.info().outputPath("release-source");
  fs.mkdirSync(path.join(fixture, "scripts"), { recursive: true });
  for (const dir of ["board", "shared", "author"]) fs.cpSync(path.join(ROOT, dir), path.join(fixture, dir), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "scripts/build-author.mjs"), path.join(fixture, "scripts/build-author.mjs"));
  const git = (...args) => {
    const r = spawnSync("git", args, { cwd: fixture, encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
  };
  git("init");
  git("add", "board", "shared", "author", "scripts/build-author.mjs");
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "試験用の発行元");
  author = test.info().outputPath("author.html");
  const result = spawnSync(process.execPath, [path.join(fixture, "scripts/build-author.mjs"), author], { encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).not.toContain("開発版");
});
async function sample(page) {
  await page.goto(url(author));
  await page.getByRole("button", { name: "サンプルで試す" }).click();
}
async function preview(page) {
  await page.getByRole("button", { name: "検査してプレビュー" }).click();
  await expect(page.locator("#status")).toContainText("検査完了");
  await expect(page.locator("#publish")).toBeEnabled();
}
async function save(page, button, file) {
  const waiting = page.waitForEvent("download");
  await page.locator(button).click();
  const download = await waiting;
  await download.saveAs(file);
  return download;
}

test("発行画面から単一HTMLを保存し、移動先で回答・形式切替・金額合計が動く", async ({ page, context }) => {
  const errors = [], requests = [];
  page.on("pageerror", e => errors.push(e.message));
  context.on("request", request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  await sample(page);
  const title = '日本語 </script><script>window.injection=1</script> "比較"';
  await page.locator("#round-title").fill(title);
  await preview(page);
  const output = test.info().outputPath("isolated", "answer-page.html");
  await save(page, "#publish", output);
  await page.goto(url(output));
  await expect(page.locator("body")).toHaveClass(/is-ready/);
  expect(await page.evaluate(() => window.injection)).toBeUndefined();
  await expect(page.locator("#price-total")).toHaveText("0 円（未確定 1 項目）");
  await page.locator('input[value="option:a"]').check();
  await expect(page.locator("#price-total")).toHaveText("1,000 円（全項目確定）");
  await page.locator("textarea.comment").fill('改行\n"引用",日本語');
  await page.locator("#answer-format").selectOption("json");
  const data = JSON.parse(await page.locator("#answer-text").inputValue());
  expect(data.round.title).toBe(title);
  expect(data.pricing).toEqual({ currency: "JPY", total: 1000, pending: 0, complete: true });
  expect(data.decisions[0].items[0].comment).toBe('改行\n"引用",日本語');
  const result = await save(page, '#answer button:has-text("保存")', test.info().outputPath("answer.json"));
  expect(result.suggestedFilename()).toBe("review-r1-answer.json");
  await page.locator("#answer-format").selectOption("csv");
  expect(await page.locator("#answer-text").inputValue()).toContain('"改行\n""引用"",日本語"');
  await page.locator('input[value="hold"]').check();
  await expect(page.locator("#price-total")).toHaveText("0 円（未確定 1 項目）");
  await page.locator('input[value="option:cur"]').check();
  await expect(page.locator("#price-total")).toHaveText("0 円（全項目確定）");
  expect(errors).toEqual([]); expect(requests).toEqual([]);
});

test("設定JSONを再読込みでき、変更や未適用のJSONで古い結果を発行しない", async ({ page }) => {
  await sample(page);
  const saved = test.info().outputPath("project.json");
  await save(page, "#save-project", saved);
  await page.goto(url(author));
  await page.locator("#open-project").setInputFiles(saved);
  await expect(page.locator("#round-title")).toHaveValue("操作ボタンの位置");
  await preview(page);
  await page.locator("#round-title").fill("変更したタイトル");
  await expect(page.locator("#publish")).toBeDisabled();
  await page.locator("summary").click();
  await page.locator("#description-json").fill("{broken");
  await page.locator("#preview").click();
  await expect(page.locator("#status")).toContainText("詳細設定を適用");
  await expect(page.locator("#publish")).toBeDisabled();
});

for (const [name, mutate, error] of [
  ["撮り直しが元画像と同じファイル", c => { c.I1.main.repeat.cur = c.I1.main.images.cur; }, "別ファイル"],
  ["guard外の変更", c => { c.I1.main.guard = [0, 0, 1, 1]; }, "guard の外"],
  ["案の差がない", c => { c.I1.main.images.a = c.I1.main.images.cur; c.I1.main.repeat.a = c.I1.main.repeat.cur; }, "見える差が無い"],
]) test(`${name}を発行しない`, async ({ page }) => {
  await sample(page); await page.locator("summary").click();
  const captures = JSON.parse(await page.locator("#captures-json").inputValue());
  mutate(captures); await page.locator("#captures-json").fill(JSON.stringify(captures));
  await page.locator("#apply-json").click();
  await page.locator("#preview").click();
  await expect(page.locator("#status")).toContainText(error);
  await expect(page.locator("#publish")).toBeDisabled();
});

test("単一HTML内の画像差替えを起動時に検出する", async ({ page }) => {
  await sample(page); await preview(page);
  const output = test.info().outputPath("valid.html"); await save(page, "#publish", output);
  let html = fs.readFileSync(output, "utf8");
  const pattern = /(<script id="ruling-board-package" type="application\/json">)([\s\S]*?)(<\/script>)/;
  const envelope = JSON.parse(pattern.exec(html)[2]);
  const [cur, a] = envelope.payload.def.decisions[0].items[0].options;
  envelope.payload.assets[a.images.main[0]] = envelope.payload.assets[cur.images.main[0]];
  html = html.replace(pattern, (_, start, body, end) => start + JSON.stringify(envelope).replaceAll("<", "\\u003c") + end);
  const corrupt = test.info().outputPath("corrupt.html"); fs.writeFileSync(corrupt, html);
  await page.goto(url(corrupt));
  await expect(page.locator("body")).toHaveClass(/is-broken/);
  await expect(page.locator(".error-list")).toContainText("発行後に変更");
});

const PACKAGE = /<script id="ruling-board-package" type="application\/json">([\s\S]*?)<\/script>/;
// Exactly the 15 code points the seal requires, so the boundary itself is what passes.
const PASSWORD = "正しい合言葉は十五字ちょうど。";

test("パスワードを付けた単一HTMLは、記述も画像も平文で持たず、正しいパスワードでだけ開く", async ({ page, context }) => {
  const errors = [], requests = [];
  page.on("pageerror", e => errors.push(e.message));
  context.on("request", request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  await sample(page);
  const title = "封をした回の題";
  await page.locator("#round-title").fill(title);
  await preview(page);
  const plain = test.info().outputPath("plain.html"); await save(page, "#publish", plain);
  const plainHtml = fs.readFileSync(plain, "utf8");
  const assets = Object.values(JSON.parse(PACKAGE.exec(plainHtml)[1]).payload.assets);
  const secrets = [title, "保存ボタン", "どちらの案を選びますか", ...assets.map(data => data.slice(-200))];
  // Control: the unsealed output carries every probe, so their absence below means something.
  for (const secret of secrets) expect(plainHtml).toContain(secret);
  await page.locator("#seal-password").fill(PASSWORD);
  await page.locator("#seal-confirm").fill(PASSWORD);
  const sealed = test.info().outputPath("isolated", "sealed.html"); await save(page, "#publish", sealed);
  await expect(page.locator("#status")).toContainText("パスワードで暗号化した");
  const sealedHtml = fs.readFileSync(sealed, "utf8");
  for (const secret of secrets) expect(sealedHtml).not.toContain(secret);
  expect(Object.keys(JSON.parse(PACKAGE.exec(sealedHtml)[1]))).toEqual(["schema", "sealed"]);
  await page.goto(url(sealed));
  await expect(page.locator("body")).toHaveClass(/is-locked/);
  await expect(page.locator("#unlock-password")).toBeFocused();
  await page.locator("#unlock-password").fill("違う");
  await page.getByRole("button", { name: "開く" }).click();
  await expect(page.locator(".unlock-error")).toHaveText("パスワードが違うか、データが壊れています");
  await expect(page.locator("body")).not.toHaveClass(/is-ready/);
  await page.locator("#unlock-password").fill(PASSWORD);
  await page.getByRole("button", { name: "開く" }).click();
  await expect(page.locator("body")).toHaveClass(/is-ready/);
  await expect(page.locator("body")).not.toHaveClass(/is-locked/);
  await expect(page.locator(".round-title")).toContainText(title);
  await page.locator('input[value="option:a"]').check();
  await expect(page.locator("#price-total")).toHaveText("1,000 円（全項目確定）");
  expect(errors).toEqual([]); expect(requests).toEqual([]);
});

test("パスワードと確認が違えば保存しない", async ({ page }) => {
  await sample(page); await preview(page);
  let downloads = 0; page.on("download", () => downloads++);
  await page.locator("#seal-password").fill("one");
  await page.locator("#seal-confirm").fill("two");
  await page.locator("#publish").click();
  await expect(page.locator("#status")).toContainText("一致しません");
  expect(downloads).toBe(0);
});

test("15 字に満たないパスワードでは封をしない（字数はコード位置で数える）", async ({ page }) => {
  await sample(page); await preview(page);
  let downloads = 0; page.on("download", () => downloads++);
  // 14 code points but 28 UTF-16 units: a length check on the string would let it through.
  const short = "😀".repeat(14);
  await page.locator("#seal-password").fill(short); await page.locator("#seal-confirm").fill(short);
  await page.locator("#publish").click();
  await expect(page.locator("#status")).toHaveText("パスワードは 15 字以上にしてください");
  expect(downloads).toBe(0);
});

async function sealedSample(page) {
  await sample(page); await preview(page);
  await page.locator("#seal-password").fill(PASSWORD); await page.locator("#seal-confirm").fill(PASSWORD);
  const output = test.info().outputPath("sealed.html"); await save(page, "#publish", output);
  return fs.readFileSync(output, "utf8");
}
async function openWith(page, html, name, password = PASSWORD) {
  const file = test.info().outputPath(name); fs.writeFileSync(file, html);
  await page.goto(url(file));
  await page.locator("#unlock-password").fill(password);
  await page.getByRole("button", { name: "開く" }).click();
}
const withSealed = (html, sealed) => html.replace(PACKAGE, () => `<script id="ruling-board-package" type="application/json">${JSON.stringify({ schema: 1, sealed })}</script>`);

for (const [name, mutate] of [
  ["暗号文の 1 字の改変", s => { const at = s.data.length >> 1; s.data = s.data.slice(0, at) + (s.data[at] === "A" ? "B" : "A") + s.data.slice(at + 1); }],
  ["圧縮の欄を消す改変", s => { delete s.compression; }],
]) test(`封をした${name}は、正しいパスワードでも開かない`, async ({ page }) => {
  const html = await sealedSample(page);
  const { sealed } = JSON.parse(PACKAGE.exec(html)[1]);
  expect(sealed.compression).toBe("gzip");
  mutate(sealed);
  await openWith(page, withSealed(html, sealed), "sealed-corrupt.html");
  await expect(page.locator(".unlock-error")).toHaveText("パスワードが違うか、データが壊れています");
  await expect(page.locator("body")).not.toHaveClass(/is-ready/);
});

test("標準の base64 の関数が無いブラウザでは、開けないと告げる", async ({ page }) => {
  const html = await sealedSample(page);
  await page.addInitScript(() => { delete Uint8Array.fromBase64; });
  await openWith(page, html, "sealed-old-browser.html");
  await expect(page.locator(".unlock-error")).toHaveText("このブラウザでは開けません（Chromium 140 以降が必要）");
  await expect(page.locator("body")).not.toHaveClass(/is-ready/);
});

test("圧縮の欄が無い旧形式（0.4.0 の最初の封）も開く", async ({ page }) => {
  const html = await sealedSample(page);
  const { sealed } = JSON.parse(PACKAGE.exec(html)[1]);
  const subtle = globalThis.crypto.subtle, enc = new TextEncoder();
  const keyOf = async (salt, usage) => subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: sealed.iterations }, await subtle.importKey("raw", enc.encode(PASSWORD), "PBKDF2", false, ["deriveKey"]), { name: "AES-GCM", length: 256 }, false, [usage]);
  const salt = Buffer.from(sealed.salt, "base64"), iv = Buffer.from(sealed.iv, "base64");
  const packed = await subtle.decrypt({ name: "AES-GCM", iv, additionalData: enc.encode("ui-ruling-board:sealed:1:gzip") }, await keyOf(salt, "decrypt"), Buffer.from(sealed.data, "base64"));
  const plain = zlib.gunzipSync(Buffer.from(packed));
  const data = await subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode("ui-ruling-board:sealed:1") }, await keyOf(salt, "encrypt"), plain);
  const legacy = { kdf: sealed.kdf, cipher: sealed.cipher, iterations: sealed.iterations, salt: sealed.salt, iv: sealed.iv, data: Buffer.from(data).toString("base64") };
  await openWith(page, withSealed(html, legacy), "sealed-legacy.html");
  await expect(page.locator("body")).toHaveClass(/is-ready/);
});

test("狭幅とキーボードで発行画面を操作できる", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await sample(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator("#preview").focus(); await page.keyboard.press("Enter");
  await expect(page.locator("#publish")).toBeEnabled();
  await page.screenshot({ path: test.info().outputPath("author-mobile.png"), fullPage: true });
});

test("Gitを持たない入れ子のコピーは出所を偽らず発行を止める", async ({ page }) => {
  const fixture = test.info().outputPath("archive"); fs.mkdirSync(path.join(fixture, "scripts"), { recursive: true });
  for (const dir of ["board", "shared", "author"]) fs.cpSync(path.join(ROOT, dir), path.join(fixture, dir), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "scripts/build-author.mjs"), path.join(fixture, "scripts/build-author.mjs"));
  const output = test.info().outputPath("archive-author.html");
  const r = spawnSync(process.execPath, [path.join(fixture, "scripts/build-author.mjs"), output], { encoding: "utf8" });
  expect(r.status).toBe(0); expect(r.stdout).toContain("開発版");
  await page.goto(url(output)); await page.locator("#sample").click(); await page.locator("#preview").click();
  await expect(page.locator("#status")).toContainText("プレビューのみ");
  await expect(page.locator("#publish")).toBeDisabled();
});

test("共用の準備処理は衝突を拒否し、基準側の長い段も拡大比較する", async ({ page }) => {
  await page.goto(url(author));
  const results = await page.evaluate(async () => {
    const make = (options, views, long) => {
      const description = { schema: 1, round: { id: "test", title: "Test" }, views: views.map(id => ({ id, label: id })), decisions: [{ id: "D", title: "D", items: [{ id: "I", title: "I", question: "Q", views, options: options.map(id => ({ id, label: id })) }] }] };
      const assets = {}, captures = { I: {} };
      for (const view of views) {
        const c = captures.I[view] = { guard: [0, 0, 400, 240], images: {}, repeat: {} };
        for (const [i, o] of options.entries()) for (const kind of ["images", "repeat"]) {
          c[kind][o] = [];
          const count = long && o === "cur" ? 2 : 1;
          for (let n = 0; n < count; n++) {
            const canvas = document.createElement("canvas"); canvas.width = 400; canvas.height = 240;
            const ctx = canvas.getContext("2d"); ctx.fillStyle = "white"; ctx.fillRect(0, 0, 400, 240);
            if (!long || n === 1) { ctx.fillStyle = ["gray", "blue", "green"][i]; ctx.fillRect(40, 60, 30, 30); }
            const name = `${view}/${o}/${kind}/${n}.png`; assets[name] = canvas.toDataURL(); c[kind][o].push(name);
          }
        }
      }
      return { description, captures, assets };
    };
    const run = input => RulingBoardPrepare.prepare(input.description, input.captures, RulingBoardBrowserImages.imageTools(input.assets), name => name);
    let collision; try { await run(make(["cur", "a", "a-b"], ["x", "b-x"], false)); } catch (e) { collision = e.message; }
    const good = await run(make(["cur", "a", "ab"], ["x", "b-x"], false));
    const unequal = await run(make(["cur", "a"], ["v"], true));
    return { collision, good: good.report.comparisons.map(c => c.pixels), unequal: unequal.report.comparisons.map(c => c.pixels), zooms: unequal.report.zooms.length };
  });
  expect(results.collision).toContain("衝突");
  expect(results.good.every(n => n === 900)).toBe(true);
  expect(results.unequal).toEqual([0, 900]); expect(results.zooms).toBe(1);
});

test("撮影元フォルダを取り込み、全見え方と生成拡大を内包する", async ({ page }) => {
  const source = test.info().outputPath("capture-source");
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts/example-capture.mjs"), source], { encoding: "utf8" });
  expect(r.status, r.stderr).toBe(0);
  await page.goto(url(author));
  await page.locator("#open-folder").setInputFiles(source);
  await expect(page.locator("#round-id")).toHaveValue("workflow-r1");
  await preview(page);
  await expect(page.locator("#status")).toContainText("拡大 4");
  const frame = page.frameLocator("#preview-frame");
  await expect(frame.locator("section.item")).toHaveCount(3);
  await expect(frame.locator('section.item[data-item="D1.1"] .stage img')).toHaveAttribute("alt", /操作部分 · 拡大$/);
  expect(await frame.locator("img").evaluateAll(images => images.every(i => i.src.startsWith("data:image/")))).toBe(true);
});

test("合計は複数項目を加算し、画像切替では変えず下書きから復元する", async ({ page }) => {
  await sample(page); await page.locator("summary").click();
  const d = JSON.parse(await page.locator("#description-json").inputValue());
  const c = JSON.parse(await page.locator("#captures-json").inputValue());
  const second = structuredClone(d.decisions[0].items[0]); second.id = "I2"; second.title = "追加項目"; second.options[1].price = 2500;
  d.decisions[0].items.push(second); c.I2 = structuredClone(c.I1);
  await page.locator("#description-json").fill(JSON.stringify(d)); await page.locator("#captures-json").fill(JSON.stringify(c)); await page.locator("#apply-json").click();
  await preview(page);
  const output = test.info().outputPath("prices.html"); await save(page, "#publish", output); await page.goto(url(output));
  await page.locator('fieldset[data-item="I1"] input[value="option:a"]').check();
  await page.locator('fieldset[data-item="I2"] input[value="option:a"]').check();
  await expect(page.locator("#price-total")).toHaveText("3,500 円（全項目確定）");
  await page.locator('section.item[data-item="I2"] .stage').focus(); await page.keyboard.press("ArrowLeft");
  await expect(page.locator('section.item[data-item="I2"] .stage img')).toHaveAttribute("alt", /現在/);
  await expect(page.locator("#price-total")).toHaveText("3,500 円（全項目確定）");
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("ui-ruling-board:review-r1"))?.items.I2.choice)).toBe("a");
  await page.reload(); await expect(page.locator("#price-total")).toHaveText("3,500 円（全項目確定）");
  await page.locator('fieldset[data-item="I2"] input[value="hold"]').check(); await expect(page.locator("#price-total")).toHaveText("1,000 円（未確定 1 項目）");
});

test("画像の選択と不正な金額・出力形式を検査する", async ({ page }) => {
  await sample(page);
  const source = test.info().outputPath("replacement.png");
  const data = await page.locator(".option img").first().getAttribute("src");
  fs.writeFileSync(source, Buffer.from(data.split(",")[1], "base64"));
  await page.getByLabel("I1 cur main 元画像", { exact: true }).setInputFiles(source);
  await expect(page.locator(".filenames").first()).toContainText("replacement.png");
  const badPrice = page.getByLabel("金額（円・空欄は未設定）").first(); await badPrice.fill("-1");
  await page.locator("#preview").click(); await expect(page.locator("#status")).toContainText("金額ではない"); await expect(page.locator("#publish")).toBeDisabled();
  await badPrice.fill("0"); await page.locator('#formats input[value="markdown"]').uncheck();
  await page.locator("#preview").click(); await expect(page.locator("#status")).toContainText("選択した形式に含まれていない");
  await page.locator("#default-format").selectOption("json"); await preview(page);
});
