// The board, opened from file:// on the example round (or on variants of it).
const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  BOARD,
  EXAMPLE,
  readRound,
  boardUrl,
  writeRound,
  itemIds,
} = require("./round-files");
const { digest } = require("../board/validate.js");
const { pathToFileURL } = require("node:url");

const CIRCLED = "①②③④⑤⑥⑦⑧⑨";

async function openBoard(page, url = boardUrl()) {
  await page.goto(url);
  await expect(page.locator("body")).toHaveClass(/is-ready/);
}

const item = (page, id) => page.locator(`section.item[data-item="${id}"]`);
const tocItem = (page, id) => page.locator(`#toc .toc-item[data-item="${id}"]`);
const radio = (page, id, value) =>
  page.locator(`fieldset.choose[data-item="${id}"] input[value="${value}"]`);
const optionButton = (scope, k) =>
  scope.locator(`.options button[data-value="${k}"]`);
const viewPick = (page) => page.locator('.top select[aria-label="見え方"]');
/** Chooses a view in the header by its label (「項目ごと」 hands every item back its own first view). */
const pickView = (page, label) => viewPick(page).selectOption({ label });
const shownAlt = (page, id) => item(page, id).locator(".stage img").first();
const answerLines = (page) =>
  page
    .locator("#answer-text")
    .inputValue()
    .then((v) => v.split("\n"));

/** The four lists that must follow the description: headings, contents, choices and answer. */
async function orders(page) {
  return {
    headings: await page
      .locator("main section.item")
      .evaluateAll((els) => els.map((e) => e.dataset.item)),
    toc: await page
      .locator("#toc .toc-item")
      .evaluateAll((els) => els.map((e) => e.dataset.item)),
    choices: await page
      .locator("fieldset.choose")
      .evaluateAll((els) => els.map((e) => e.dataset.item)),
    answer: (await answerLines(page))
      .filter((l) => l.startsWith("- "))
      .map((l) => l.slice(2).split(" ")[0]),
  };
}

test.describe("S7: 並びの正本は記述の配列だけ", () => {
  test("見出し・目次・選択欄・回答案・数えが記述の並びと一致する", async ({
    page,
  }) => {
    const def = readRound();
    const ids = itemIds(def);
    await openBoard(page);

    expect(await orders(page)).toEqual({
      headings: ids,
      toc: ids,
      choices: ids,
      answer: ids,
    });

    const all = def.decisions.flatMap((d) => d.items);
    await expect(page.locator("main section.item h3")).toHaveText(
      all.map((it, n) => `${n + 1} ${it.id} ${it.title}`),
    );
    await expect(page.locator("#toc .toc-item .name")).toHaveText(
      all.map((it) => `${it.id} ${it.title}`),
    );
    await expect(page.locator("fieldset.choose legend")).toHaveText(
      all.map((it, n) => `${n + 1}. ${it.id} ${it.title}`),
    );
    await expect(page.locator("#toc .toc-count")).toHaveText(
      def.decisions.map((d) => `0/${d.items.length}`),
    );
    await expect(page.locator(".progress-count")).toHaveText(`0/${all.length}`);

    for (const it of all) {
      const label = (o, k) =>
        `${CIRCLED[k]} ${o.label}${o.recommended ? "推奨" : ""}${(o.tags || []).join("")}`;
      const expected = it.options.map(label);
      await expect(item(page, it.id).locator(".options button")).toHaveText(
        expected,
      );
      await expect(
        page.locator(`fieldset.choose[data-item="${it.id}"] .choice`),
      ).toHaveText([...expected, "保留"]);
    }
  });

  test("対照：2 項目を入れ替えた記述では、入れ替えた並びに一致し、元の並びとは違う", async ({
    page,
  }, testInfo) => {
    const def = readRound();
    const original = itemIds(def);
    const [first, second] = def.decisions[0].items;
    def.decisions[0].items[0] = second;
    def.decisions[0].items[1] = first;
    const swapped = itemIds(def);
    await openBoard(page, boardUrl(writeRound(testInfo, def)));

    const got = await orders(page);
    expect(got).toEqual({
      headings: swapped,
      toc: swapped,
      choices: swapped,
      answer: swapped,
    });
    expect(got.headings).not.toEqual(original);
  });
});

test.describe("S3: どの見え方を選んでも各項目の画像に届く", () => {
  for (const layout of ["切り替え", "並べる"]) {
    test(`頭の見え方のどれでも、全項目が読み込めた画像を 1 枚以上出す（${layout}）`, async ({
      page,
    }) => {
      const def = readRound();
      const labels = new Map(def.views.map((v) => [v.id, v.label]));
      /** preferred = null: nothing chosen in the header, so each item shows its own first view. */
      const everyItemShows = async (preferred) => {
        for (const it of def.decisions.flatMap((d) => d.items)) {
          const views = it.views || def.views.map((v) => v.id);
          const shown = views.includes(preferred) ? preferred : views[0];
          const imgs = item(page, it.id).locator(".stage img");
          await expect
            .poll(() =>
              imgs.evaluateAll(
                (els) =>
                  els.filter((i) => i.complete && i.naturalWidth > 0).length,
              ),
            )
            .toBeGreaterThan(0);
          for (const alt of await imgs.evaluateAll((els) =>
            els.map((i) => i.alt),
          )) {
            const plain = alt.replace(/ · \d+\/\d+$/, "");
            expect(plain.startsWith(`${it.title} · `), alt).toBe(true);
            expect(plain.endsWith(` · ${labels.get(shown)}`), alt).toBe(true);
          }
        }
      };

      await openBoard(page);
      // As opened, before anything is chosen in the header: each item's own first view.
      await expect(viewPick(page)).toHaveValue("");
      await everyItemShows(null);
      await page
        .locator('.top [aria-label="表示"] button', { hasText: layout })
        .click();
      for (const view of def.views) {
        await pickView(page, view.label);
        await everyItemShows(view.id);
      }
      await pickView(page, "項目ごと");
      await everyItemShows(null);
    });
  }

  test("回答案の「見た」は実際に表示した見え方だけ", async ({ page }) => {
    await openBoard(page);
    const line = async () =>
      (await answerLines(page)).find((l) => l.startsWith("- D2.2 "));
    expect(await line()).toBe(
      "- D2.2 メニューの項目の並び: 未選択 · 見た: なし",
    );
    await item(page, "D2.2").locator(".stage").scrollIntoViewIfNeeded();
    await expect
      .poll(line)
      .toBe("- D2.2 メニューの項目の並び: 未選択 · 見た: 1280");
    await item(page, "D2.2")
      .getByRole("button", { name: "390 · メニュー", exact: true })
      .click();
    await expect
      .poll(line)
      .toBe("- D2.2 メニューの項目の並び: 未選択 · 見た: 1280, 390-menu");
  });

  test("「見た」は比較の枠の半分以上が画面に入ったときだけ（端がかかるだけでは数えない）", async ({
    page,
  }) => {
    await openBoard(page);
    const it = item(page, "D2.2");
    const stage = it.locator(".stage");
    const line = async () =>
      (await answerLines(page)).find((l) => l.startsWith("- D2.2 "));
    /** Leaves only the top 40px of the frame at the bottom of the screen, and waits two frames. */
    const toEdge = async () => {
      await stage.evaluate(
        (el) =>
          new Promise((done) => {
            window.scrollBy(
              0,
              el.getBoundingClientRect().top - (window.innerHeight - 40),
            );
            window.requestAnimationFrame(() =>
              window.requestAnimationFrame(done),
            );
          }),
      );
      const top = await stage.evaluate((el) => el.getBoundingClientRect().top);
      expect(top).toBeGreaterThan((await page.viewportSize()).height - 60);
      return top;
    };

    // Only the top 40px of the frame (well under half) at the bottom of the screen, shown at 1280.
    const top = await toEdge();
    // While still only an edge is on screen, switch the item to 390-menu.
    await it
      .getByRole("button", { name: "390 · メニュー", exact: true })
      .click();
    expect(await stage.evaluate((el) => el.getBoundingClientRect().top)).toBe(
      top,
    );
    expect(await line()).toBe(
      "- D2.2 メニューの項目の並び: 未選択 · 見た: なし",
    );

    // Bring the whole frame on screen: only the view shown then is seen, not the 1280 edge.
    await stage.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await expect
      .poll(line)
      .toBe("- D2.2 メニューの項目の並び: 未選択 · 見た: 390-menu");

    // From fully on screen back to only an edge: switching to 1280 there is not seen either.
    const edge = await toEdge();
    await it.getByRole("button", { name: "1280", exact: true }).click();
    expect(await stage.evaluate((el) => el.getBoundingClientRect().top)).toBe(
      edge,
    );
    expect(await line()).toBe(
      "- D2.2 メニューの項目の並び: 未選択 · 見た: 390-menu",
    );
  });
});

test.describe("見え方の初期値：各項目は記述の項目の views の先頭で開く", () => {
  /** D1.1 and D2.2 list a view first that is not the round's first. */
  const reordered = (testInfo) => {
    const def = readRound();
    def.decisions[0].items[0].views = ["390", "1280"];
    def.decisions[1].items[1].views = ["390-menu", "1280"];
    return boardUrl(writeRound(testInfo, def));
  };
  const shows = async (page, expected) => {
    for (const [id, alt] of Object.entries(expected)) {
      await expect(shownAlt(page, id), id).toHaveAttribute("alt", alt);
    }
  };

  test("開いた直後は項目の先頭。頭で選ぶと持つ項目だけが替わり、「項目ごと」で先頭へ戻る", async ({
    page,
  }, testInfo) => {
    await openBoard(page, reordered(testInfo));
    await expect(viewPick(page)).toHaveValue("");
    const own = {
      "D1.1": "詳細の置き場 · 現状 · 390",
      "D1.2": "保存の釦 · 現状 · 1280",
      "D2.2": "メニューの項目の並び · 現状 · 390 · メニュー",
    };
    await shows(page, own);
    await expect(
      item(page, "D1.1").getByRole("button", { name: "390", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");

    // What is seen first is the item's own first view too.
    await item(page, "D1.1").locator(".stage").scrollIntoViewIfNeeded();
    await expect
      .poll(async () =>
        (await answerLines(page)).find((l) => l.startsWith("- D1.1 ")),
      )
      .toBe("- D1.1 詳細の置き場: 未選択（推奨 ②） · 見た: 390");

    await pickView(page, "1280");
    await shows(page, {
      "D1.1": "詳細の置き場 · 現状 · 1280",
      "D1.2": "保存の釦 · 現状 · 1280",
      "D2.2": "メニューの項目の並び · 現状 · 1280",
    });

    // D2.2 has no 390: it shows its own first view, not the round's first.
    await pickView(page, "390");
    await shows(page, {
      "D1.1": "詳細の置き場 · 現状 · 390",
      "D1.2": "保存の釦 · 現状 · 390",
      "D2.2": "メニューの項目の並び · 現状 · 390 · メニュー",
    });

    await pickView(page, "1280");
    await pickView(page, "項目ごと");
    await shows(page, own);
  });
});

test.describe("頭の帯：見え方の多い回でも画面を覆わない", () => {
  const COUNT = 68;
  const WIDTHS = [1440, 1280, 1024, 768, 600, 390, 360];
  /** The example with 68 views; D1.2 has every one of them (its extra views reuse its 1280 images). */
  const manyViews = (testInfo) => {
    const def = readRound();
    const extra = [];
    for (let n = def.views.length; n < COUNT; n += 1) {
      const width = WIDTHS[n % WIDTHS.length];
      extra.push({ id: `${width}-s${n}`, label: `${width} · 状態 ${n}` });
    }
    def.views.push(...extra);
    for (const option of def.decisions[0].items[1].options) {
      option.images = Object.fromEntries(
        extra.map((v) => [v.id, `images/D1.2/${option.id}-1280.svg`]),
      );
    }
    return boardUrl(writeRound(testInfo, def));
  };
  const headerHeight = (page) =>
    page.locator("#top").evaluate((el) => el.getBoundingClientRect().height);

  test.describe("390px", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("頭の帯の高さは画面の 1/4 以下で、頭から全部の見え方を選べる", async ({
      page,
    }, testInfo) => {
      await openBoard(page, manyViews(testInfo));
      await expect(viewPick(page).locator("option")).toHaveCount(COUNT + 1);
      expect(await headerHeight(page)).toBeLessThanOrEqual(844 / 4);

      await pickView(page, "768 · 状態 10");
      await expect(shownAlt(page, "D1.2")).toHaveAttribute(
        "alt",
        "保存の釦 · 現状 · 768 · 状態 10",
      );
      await expect(shownAlt(page, "D1.1")).toHaveAttribute(
        "alt",
        "詳細の置き場 · 現状 · 1280",
      );
      expect(await headerHeight(page)).toBeLessThanOrEqual(844 / 4);
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  });

  test.describe("1440px", () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test("頭の帯は 1 行に収まり、見え方が 3 つの例より高くならない", async ({
      page,
    }, testInfo) => {
      await openBoard(page);
      const few = await headerHeight(page);
      await openBoard(page, manyViews(testInfo));
      expect(await headerHeight(page)).toBeLessThanOrEqual(few);
      const boxes = await page
        .locator("#top > *")
        .evaluateAll((els) =>
          els
            .map((e) => e.getBoundingClientRect().toJSON())
            .filter((b) => b.width > 0),
        );
      const title = await page
        .locator("#top .round-title")
        .evaluate((el) => el.getBoundingClientRect().toJSON());
      expect(boxes.length).toBe(4);
      for (const b of boxes) {
        expect(b.top, JSON.stringify(b)).toBeLessThan(title.bottom);
        expect(b.bottom, JSON.stringify(b)).toBeGreaterThan(title.top);
      }
    });
  });
});

test("外部への通信が 0 件", async ({ page }) => {
  const external = [];
  page.on("request", (r) => {
    if (!/^(file|data|blob):/.test(r.url())) external.push(r.url());
  });
  await openBoard(page);
  for (const label of ["390", "390 · メニュー", "1280"]) {
    await pickView(page, label);
  }
  await page
    .locator('.top [aria-label="表示"] button', { hasText: "並べる" })
    .click();
  await page
    .locator('.top [aria-label="表示"] button', { hasText: "切り替え" })
    .click();
  await item(page, "D1.1").locator(".stage .zoom").click();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Escape");
  await radio(page, "D1.1", "option:a").check();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await download;
  expect(external).toEqual([]);
});

test("?round= に外のアドレスは読まない", async ({ page }) => {
  const external = [];
  page.on("request", (r) => {
    if (!/^(file|data|blob):/.test(r.url())) external.push(r.url());
  });
  await page.goto(
    `${pathToFileURL(BOARD).href}?round=${encodeURIComponent("https://example.invalid/round.js")}`,
  );
  await expect(page.locator(".error-list li")).toHaveText([
    "https://example.invalid/round.js 相対パスではない",
  ]);
  expect(external).toEqual([]);
});

test.describe("390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("並べる：狭い幅では案を縦に積み、横送りが出ない", async ({ page }) => {
    await openBoard(page);
    await page
      .locator('.top [aria-label="表示"] button', { hasText: "並べる" })
      .click();
    const cols = item(page, "D1.1").locator(".stage figure.col");
    await expect(cols).toHaveCount(3);
    const boxes = await cols.evaluateAll((els) =>
      els.map((e) => e.getBoundingClientRect().toJSON()),
    );
    for (let n = 1; n < boxes.length; n += 1) {
      expect(boxes[n].left, `案 ${n + 1} の左端`).toBe(boxes[0].left);
      expect(boxes[n].top, `案 ${n + 1} の上端`).toBeGreaterThanOrEqual(
        boxes[n - 1].bottom,
      );
    }
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("どの見え方・表示でも横送りが出ない", async ({ page }) => {
    await openBoard(page);
    for (const layout of ["切り替え", "並べる"]) {
      await page
        .locator('.top [aria-label="表示"] button', { hasText: layout })
        .click();
      for (const label of ["1280", "390", "390 · メニュー"]) {
        await pickView(page, label);
        const overflow = await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        );
        expect(overflow, `${layout} · ${label}`).toBeLessThanOrEqual(0);
      }
    }
  });

  test("目次は引き出し：項目を押すと閉じて移り、Esc で閉じてボタンへ戻る", async ({
    page,
  }) => {
    await openBoard(page);
    await expect(page.locator("#side")).toBeHidden();
    const open = page.locator(".toc-open");
    await expect(open).toHaveText("目次 0/5");

    await open.click();
    await expect(page.locator("#toc-drawer")).toHaveAttribute("open", "");
    await page.locator('#toc-drawer .toc-item[data-item="D2.1"]').click();
    await expect(page.locator("#toc-drawer")).not.toHaveAttribute("open", "");
    await expect(page.locator("#ih-D2\\.1")).toBeFocused();
    await expect(page.locator("#ih-D2\\.1")).toBeInViewport();

    await open.click();
    await expect(page.locator("#toc-drawer #toc")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(page.locator("#toc-drawer")).not.toHaveAttribute("open", "");
    await expect(open).toBeFocused();
  });
});

test("目次の印と読み上げの字・数え・移動", async ({ page }) => {
  await openBoard(page);
  const link = tocItem(page, "D1.2");
  const decisionCount = page.locator(
    '#toc .toc-decision[data-decision="D1"] .toc-count',
  );

  /** The whole text of the link, and that it holds nothing but elements (no stray text). */
  const linkIs = async (text) => {
    await expect(link).toHaveText(text, { useInnerText: false });
    expect(
      await link.evaluate((el) =>
        [...el.childNodes].every((n) => n.nodeType === 1),
      ),
    ).toBe(true);
  };

  await expect(link.locator(".mark")).toHaveText("○");
  await expect(link.locator(".mark + .sr-only")).toHaveText("未選択");
  await linkIs("○未選択2D1.2 保存の釦");

  await radio(page, "D1.2", "option:a").check();
  await expect(link.locator(".mark")).toHaveText("●");
  await expect(link.locator(".mark + .sr-only")).toHaveText("選択済 頭");
  await expect(link.locator(".pick")).toHaveText("②");
  await linkIs("●選択済 頭2D1.2 保存の釦②");
  await expect(decisionCount).toHaveText("1/3");
  await expect(page.locator(".progress-count")).toHaveText("1/5");

  await radio(page, "D1.2", "hold").check();
  await expect(link.locator(".mark")).toHaveText("◐");
  await expect(link.locator(".mark + .sr-only")).toHaveText("保留");
  await expect(link.locator(".pick")).toHaveText("保留");
  await linkIs("◐保留2D1.2 保存の釦保留");
  await expect(decisionCount).toHaveText("1/3");

  const comment = item(page, "D1.2").locator("textarea.comment");
  await expect(link.locator(".has-comment")).toHaveCount(0);
  await comment.fill("条件つき");
  await expect(link.locator(".has-comment")).toHaveText("コメントあり");
  await linkIs("◐保留2D1.2 保存の釦保留コメントあり");
  // The comment mark sits on the same row as the name.
  const name = await link.locator(".name").boundingBox();
  const mark = await link.locator(".has-comment").boundingBox();
  expect(mark.y).toBeLessThan(name.y + name.height);
  expect(mark.y + mark.height).toBeGreaterThan(name.y);
  await comment.fill("  ");
  await expect(link.locator(".has-comment")).toHaveCount(0);
  await linkIs("◐保留2D1.2 保存の釦保留");

  await tocItem(page, "D2.2").click();
  await expect(page.locator("#ih-D2\\.2")).toBeFocused();
  await expect(tocItem(page, "D2.2")).toHaveAttribute(
    "aria-current",
    "location",
  );
  await expect(page.locator("#toc [aria-current]")).toHaveCount(1);
});

test("未選択の目次の項目はどれも、印・読み上げの字・番号・名前だけ", async ({
  page,
}) => {
  const def = readRound();
  await openBoard(page);
  const all = def.decisions.flatMap((d) => d.items);
  await expect(page.locator("#toc .toc-item")).toHaveText(
    all.map((it, n) => `○未選択${n + 1}${it.id} ${it.title}`),
    { useInnerText: false },
  );
});

test.describe("切り替え", () => {
  test("←→ と数字で案を替える：見え方と送り位置を保ち、端で回る", async ({
    page,
  }) => {
    await openBoard(page);
    const it = item(page, "D1.2");
    const stage = it.locator(".stage");
    await it.getByRole("button", { name: "390", exact: true }).click();
    await stage.evaluate((el) => (el.scrollTop = 120));
    await stage.focus();

    const shows = async (k, label) => {
      await expect(optionButton(it, k)).toHaveAttribute("aria-pressed", "true");
      await expect(stage.locator("img")).toHaveAttribute(
        "alt",
        `保存の釦 · ${label} · 390`,
      );
      await expect(
        it.getByRole("button", { name: "390", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      expect(await stage.evaluate((el) => el.scrollTop)).toBe(120);
    };
    await shows(0, "現状");
    await page.keyboard.press("ArrowRight");
    await shows(1, "頭");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await shows(0, "現状");
    await page.keyboard.press("ArrowLeft");
    await shows(2, "末尾に固定");
    await page.keyboard.press("2");
    await shows(1, "頭");
    await page.keyboard.press("9");
    await shows(1, "頭");
  });

  test("段のある案は続きを縦に並べる", async ({ page }) => {
    await openBoard(page);
    const it = item(page, "D1.1");
    await it.getByRole("button", { name: "390", exact: true }).click();
    await optionButton(it, 2).click();
    await expect(it.locator(".stage img")).toHaveCount(2);
    await expect(it.locator(".stage img").nth(1)).toHaveAttribute(
      "alt",
      "詳細の置き場 · 下へ続ける · 390 · 2/2",
    );
    await optionButton(it, 1).click();
    await expect(it.locator(".stage img")).toHaveCount(1);
  });

  test("コメントの中では ←→・数字で案を替えない", async ({ page }) => {
    await openBoard(page);
    const it = item(page, "D1.1");
    const comment = it.locator("textarea.comment");
    await comment.focus();
    await page.keyboard.type("2");
    await page.keyboard.press("ArrowRight");
    await expect(comment).toHaveValue("2");
    await expect(optionButton(it, 0)).toHaveAttribute("aria-pressed", "true");
  });

  test("並べる：案を記述の順に並べ、開き直しても覚えている", async ({
    page,
  }) => {
    await openBoard(page);
    await page
      .locator('.top [aria-label="表示"] button', { hasText: "並べる" })
      .click();
    const cols = item(page, "D1.1").locator(".stage figure.col");
    await expect(cols).toHaveCount(3);
    expect(
      await cols.evaluateAll((els) => els.map((e) => e.dataset.option)),
    ).toEqual(["cur", "a", "b"]);
    await page.reload();
    await expect(page.locator("body")).toHaveClass(/is-ready/);
    await expect(
      page.locator('.top [aria-label="表示"] button', { hasText: "並べる" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(item(page, "D1.1").locator(".stage figure.col")).toHaveCount(
      3,
    );
  });

  test("並べる：広い幅では案を同じ行に横へ並べ、切り替えへ戻すと 1 枠", async ({
    page,
  }) => {
    await openBoard(page);
    await page
      .locator('.top [aria-label="表示"] button', { hasText: "並べる" })
      .click();
    const cols = item(page, "D1.1").locator(".stage figure.col");
    await expect(cols).toHaveCount(3);
    const boxes = await cols.evaluateAll((els) =>
      els.map((e) => e.getBoundingClientRect().toJSON()),
    );
    for (let n = 1; n < boxes.length; n += 1) {
      expect(boxes[n].top, `案 ${n + 1} の上端`).toBe(boxes[0].top);
      expect(boxes[n].left, `案 ${n + 1} の左端`).toBeGreaterThanOrEqual(
        boxes[n - 1].right,
      );
    }

    await page
      .locator('.top [aria-label="表示"] button', { hasText: "切り替え" })
      .click();
    await expect(item(page, "D1.1").locator(".stage figure.col")).toHaveCount(
      0,
    );
    await expect(item(page, "D1.1").locator(".stage > .zoom")).toHaveCount(1);
    expect(
      await item(page, "D1.1")
        .locator(".stage")
        .evaluate((el) => window.getComputedStyle(el).display),
    ).toBe("block");
  });

  test("変わる範囲の縁取りを、記述の位置に重ねる", async ({ page }) => {
    await openBoard(page);
    const box = item(page, "D1.1").locator(".stage .focus-box");
    await expect(box).toHaveCount(1);
    await expect(box).toHaveAttribute(
      "style",
      /left:30\.625%;top:8%;width:68\.75%;height:91%/,
    );
    await item(page, "D1.1")
      .getByRole("button", { name: "390", exact: true })
      .click();
    await expect(box).toHaveCount(0);
  });

  test("案ごとの変わる範囲：表示中の案の範囲を描き、案に無ければ項目の範囲（切り替え・並べる・拡大）", async ({
    page,
  }) => {
    const ITEM = /left:30\.625%;top:8%;width:68\.75%;height:91%/;
    const OPTION_B = /left:1\.875%;top:49%;width:96\.25%;height:49%/;
    await openBoard(page);
    const it = item(page, "D1.1");
    const box = it.locator(".stage .focus-box");

    await optionButton(it, 2).click();
    await expect(box).toHaveCount(1);
    await expect(box).toHaveAttribute("style", OPTION_B);
    await optionButton(it, 1).click();
    await expect(box).toHaveAttribute("style", ITEM);
    await optionButton(it, 2).click();
    await expect(box).toHaveAttribute("style", OPTION_B);

    // Neither the option nor the item has an area at 390.
    await it.getByRole("button", { name: "390", exact: true }).click();
    await expect(box).toHaveCount(0);
    await it.getByRole("button", { name: "1280", exact: true }).click();

    await it.locator(".stage .zoom").click();
    const zoomBox = page.locator("#zoom .zoom-body .focus-box");
    await expect(zoomBox).toHaveCount(1);
    await expect(zoomBox).toHaveAttribute("style", OPTION_B);
    await page.keyboard.press("1");
    await expect(zoomBox).toHaveAttribute("style", ITEM);
    await page.keyboard.press("Escape");

    await page
      .locator('.top [aria-label="表示"] button', { hasText: "並べる" })
      .click();
    const cols = it.locator(".stage figure.col");
    await expect(cols).toHaveCount(3);
    for (const [k, style] of [ITEM, ITEM, OPTION_B].entries()) {
      await expect(cols.nth(k).locator(".focus-box")).toHaveAttribute(
        "style",
        style,
      );
    }
  });
});

test("拡大：中でも案を替え、送り位置を保ち、Esc で押した画像へ焦点が戻る", async ({
  page,
}) => {
  await openBoard(page);
  const it = item(page, "D1.2");
  await it.getByRole("button", { name: "390", exact: true }).click();
  const opener = it.locator(".stage .zoom");
  await opener.click();

  const dialog = page.locator("#zoom");
  const body = dialog.locator(".zoom-body");
  await expect(dialog).toHaveAttribute("open", "");
  await expect(dialog.locator(".zoom-title")).toHaveText(
    "2. D1.2 保存の釦 · 390",
  );
  await expect(body.locator("img")).toHaveAttribute(
    "alt",
    "保存の釦 · 現状 · 390",
  );
  await body.evaluate((el) => (el.scrollTop = 60));

  await page.keyboard.press("ArrowRight");
  await expect(body.locator("img")).toHaveAttribute(
    "alt",
    "保存の釦 · 頭 · 390",
  );
  await expect(optionButton(dialog, 1)).toHaveAttribute("aria-pressed", "true");
  expect(await body.evaluate((el) => el.scrollTop)).toBe(60);
  await expect(optionButton(it, 1)).toHaveAttribute("aria-pressed", "true");

  await page.keyboard.press("3");
  await expect(body.locator("img")).toHaveAttribute(
    "alt",
    "保存の釦 · 末尾に固定 · 390",
  );

  await page.keyboard.press("Escape");
  await expect(dialog).not.toHaveAttribute("open", "");
  await expect(opener).toBeFocused();
  await expect(it.locator(".stage img")).toHaveAttribute(
    "alt",
    "保存の釦 · 末尾に固定 · 390",
  );
});

test("選ぶと表示もその案へ替わり、表示を替えても選択は変わらない", async ({
  page,
}) => {
  await openBoard(page);
  const it = item(page, "D1.1");
  await radio(page, "D1.1", "option:b").check();
  await expect(optionButton(it, 2)).toHaveAttribute("aria-pressed", "true");
  await expect(it.locator(".stage img")).toHaveAttribute(
    "alt",
    "詳細の置き場 · 下へ続ける · 1280",
  );

  await optionButton(it, 0).click();
  await expect(it.locator(".stage img")).toHaveAttribute(
    "alt",
    "詳細の置き場 · 現状 · 1280",
  );
  await expect(radio(page, "D1.1", "option:b")).toBeChecked();
  await expect(
    page.locator('fieldset.choose[data-item="D1.1"] input:checked'),
  ).toHaveCount(1);
});

test("選択欄は未回答で始まり、保留は末尾", async ({ page }) => {
  await openBoard(page);
  await expect(page.locator("fieldset.choose input:checked")).toHaveCount(0);
  const values = await page
    .locator('fieldset.choose[data-item="D1.1"] input')
    .evaluateAll((els) => els.map((e) => e.value));
  expect(values).toEqual(["option:cur", "option:a", "option:b", "hold"]);
});

test("回答案の中身と保存", async ({ page }) => {
  const def = readRound();
  await openBoard(page);
  await radio(page, "D1.1", "option:a").check();
  await item(page, "D1.1")
    .locator("textarea.comment")
    .fill("送りは今のまま\n狭い幅は別に見る");
  await item(page, "D1.2").locator(".stage").scrollIntoViewIfNeeded();
  await radio(page, "D1.2", "hold").check();

  await expect
    .poll(async () => (await answerLines(page)).slice(4, 11))
    .toEqual([
      "",
      "## D1 一覧と詳細",
      "- D1.1 詳細の置き場: ② 右の列（推奨 ②） · 見た: 1280",
      "  - コメント: 送りは今のまま",
      "    狭い幅は別に見る",
      "- D1.2 保存の釦: 保留（推奨 ③） · 見た: 1280",
      expect.stringMatching(/^- D1\.3 空の一覧: 未選択 · 見た: /),
    ]);
  const lines = await answerLines(page);
  expect(lines.slice(0, 4)).toEqual([
    "# 回答：設定画面の配置（basic-r1）",
    "回答先: https://example.com/rounds/basic-r1",
    `比較元: example · v1 / 記述: ${digest(def)} / 器: ui-ruling-board 0.2.0`,
    expect.stringMatching(/^回答日: \d{4}-\d{2}-\d{2} · 選択 2\/5（保留 1）$/),
  ]);
  expect(lines).toContain("## D2 メニュー");
  expect(lines).toContain("注記: メニューの中身は D2.2 で決める。");

  // Go to the answer in one jump, so no comparison frame is passed over on the way;
  // less than half of D2.2's frame can be on screen there, so D2.2 stays unseen.
  await page.locator('#toc a[href="#answer"]').click();
  await expect(page.locator("#answer-title")).toBeFocused();
  const atSave = await page.locator("#answer-text").inputValue();
  expect(atSave.split("\n")).toContain(
    "- D2.2 メニューの項目の並び: 未選択 · 見た: なし",
  );

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("basic-r1-answer.md");
  expect(fs.readFileSync(await file.path(), "utf8")).toBe(atSave);
  expect(await page.locator("#answer-text").inputValue()).toBe(atSave);
});

test.describe("下書き", () => {
  test("開き直すと戻る", async ({ page }) => {
    await openBoard(page);
    await radio(page, "D1.2", "option:b").check();
    await item(page, "D1.3").locator("textarea.comment").fill("空のとき");
    await page.reload();
    await expect(page.locator("body")).toHaveClass(/is-ready/);
    await expect(radio(page, "D1.2", "option:b")).toBeChecked();
    await expect(item(page, "D1.2").locator(".stage img")).toHaveAttribute(
      "alt",
      "保存の釦 · 末尾に固定 · 1280",
    );
    await expect(item(page, "D1.3").locator("textarea.comment")).toHaveValue(
      "空のとき",
    );
    await expect(tocItem(page, "D1.2").locator(".mark")).toHaveText("●");
  });

  test("記述が 1 字でも変われば戻さない", async ({ page }, testInfo) => {
    const def = readRound();
    const before = writeRound(testInfo, def, "before.js");
    def.round.title += "。";
    const after = writeRound(testInfo, def, "after.js");

    await openBoard(page, boardUrl(before));
    await radio(page, "D1.2", "option:b").check();
    await page.reload();
    await expect(page.locator("body")).toHaveClass(/is-ready/);
    await expect(radio(page, "D1.2", "option:b")).toBeChecked();

    await openBoard(page, boardUrl(after));
    await expect(page.locator("fieldset.choose input:checked")).toHaveCount(0);
    await expect(tocItem(page, "D1.2").locator(".mark")).toHaveText("○");
  });

  test("下書きを消すと戻らない", async ({ page }) => {
    await openBoard(page);
    await radio(page, "D1.2", "option:b").check();
    // The draft is really stored first: it comes back on reload.
    await page.reload();
    await expect(page.locator("body")).toHaveClass(/is-ready/);
    await expect(radio(page, "D1.2", "option:b")).toBeChecked();

    page.once("dialog", (d) => d.accept());
    const reloaded = page.waitForEvent("load");
    await page.getByRole("button", { name: "下書きを消す" }).click();
    await reloaded;
    await expect(page.locator("body")).toHaveClass(/is-ready/);
    await expect(page.locator("fieldset.choose input:checked")).toHaveCount(0);
  });

  test("localStorage が投げる環境でも描けて選べる", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new Error("blocked");
        },
      });
    });
    await openBoard(page);
    await radio(page, "D1.2", "option:a").check();
    await expect(tocItem(page, "D1.2").locator(".mark")).toHaveText("●");
    await page
      .locator('.top [aria-label="表示"] button', { hasText: "並べる" })
      .click();
    await expect(item(page, "D1.2").locator(".stage figure.col")).toHaveCount(
      3,
    );
  });
});

test.describe("記述の欠けでは本文を描かず、誤りの一覧を出す", () => {
  const cases = [
    [
      "項目の id の重複",
      (d) => (d.decisions[0].items[1].id = "D1.1"),
      "decisions[0].items[1].id id「D1.1」が重複",
    ],
    [
      "画像の欠け",
      (d) => delete d.images,
      "decisions[0].items[1].options[0] 見え方「1280」の画像が無い",
    ],
    [
      "推奨の誤り",
      (d) => (d.decisions[0].items[0].options[0].recommended = true),
      "decisions[0].items[0].options 推奨が 2 つ（1 項目に 1 つまで）",
    ],
    [
      "知らないキー",
      (d) => (d.decisions[1].items[0].options[0].recomended = true),
      "decisions[1].items[0].options[0].recomended 知らないキー",
    ],
    [
      "知らない版",
      (d) => (d.schema = 2),
      "schema 知らない版（器が知るのは 1）",
    ],
    [
      "知らない見え方",
      (d) => (d.decisions[0].items[2].views = ["1440"]),
      "decisions[0].items[2].views[0] 知らない見え方「1440」",
    ],
    [
      "案が 1 つ",
      (d) => d.decisions[0].items[2].options.pop(),
      "decisions[0].items[2].options 2 つ以上が必須",
    ],
    [
      "案の変わる範囲に、項目に無い見え方",
      (d) =>
        (d.decisions[0].items[0].options[1].focus = {
          "390-menu": [0, 0, 1, 1],
        }),
      "decisions[0].items[0].options[1].focus.390-menu この項目に無い見え方「390-menu」",
    ],
    [
      "案の変わる範囲の形",
      (d) =>
        (d.decisions[0].items[0].options[1].focus = { 1280: [0, 0, 0, 1] }),
      "decisions[0].items[0].options[1].focus.1280 [x, y, 幅, 高さ] ではない",
    ],
    [
      "画像の無い案の変わる範囲",
      (d) =>
        Object.assign(d.decisions[0].items[2].options[0], {
          noImage: true,
          focus: { 1280: [0, 0, 1, 1] },
        }),
      "decisions[0].items[2].options[0].focus noImage と同時に書けない",
    ],
    [
      "画像のファイルが無い",
      (d) =>
        (d.decisions[0].items[2].options[1].images = {
          1280: "images/D1.3/none.svg",
        }),
      "D1.3 / a / 1280 画像を読めない：",
    ],
  ];
  for (const [name, breakIt, expected] of cases) {
    test(name, async ({ page }, testInfo) => {
      const def = readRound();
      breakIt(def);
      await page.goto(boardUrl(writeRound(testInfo, def)));
      await expect(
        page.locator(".error-list li", { hasText: expected }),
      ).toHaveCount(1);
      await expect(page.locator("section.item")).toHaveCount(0);
      await expect(page.locator("#toc")).toHaveCount(0);
      await expect(page.locator(".top")).toBeHidden();
    });
  }

  test("閉じていない SVG", async ({ page }, testInfo) => {
    const svg = testInfo.outputPath("cut.svg");
    fs.mkdirSync(path.dirname(svg), { recursive: true });
    fs.writeFileSync(
      svg,
      '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8"/>',
    );
    const def = readRound();
    def.decisions[0].items[2].options[1].images = {
      1280: path.relative(path.dirname(EXAMPLE), svg).split(path.sep).join("/"),
    };
    await page.goto(boardUrl(writeRound(testInfo, def)));
    await expect(
      page.locator(".error-list li", {
        hasText: "D1.3 / a / 1280 画像を読めない：",
      }),
    ).toHaveCount(1);
    await expect(page.locator("section.item")).toHaveCount(0);
  });

  test("対照：手を入れない記述では一覧を出さない", async ({
    page,
  }, testInfo) => {
    await openBoard(page, boardUrl(writeRound(testInfo, readRound())));
    await expect(page.locator(".error-list")).toHaveCount(0);
    await expect(page.locator("section.item")).toHaveCount(5);
  });
});
