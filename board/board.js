/*
 * ui-ruling-board — the board.
 *
 * A classic script (no modules, no fetch) so that the page works from file://.
 * It loads the round description (?round=<relative path>, default round.js),
 * validates it, loads every image, and only then draws the board.
 */
(function () {
  "use strict";

  const VERSION = "0.4.1";
  const NAME = "ui-ruling-board";
  const PREFS = `${NAME}:prefs`;
  const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";
  const MARK = { none: "○", chosen: "●", hold: "◐" };
  /** A view counts as seen when this share of its comparison frame is on screen (or it is zoomed). */
  const SEEN_RATIO = 0.5;
  const V = globalThis.RulingBoardValidate;

  const numbered = (n) => (n <= CIRCLED.length ? CIRCLED[n - 1] : `(${n})`);

  const store = {
    get(key) {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    },
    remove(key) {
      try {
        localStorage.removeItem(key);
      } catch {
        /* storage unavailable: nothing to remove */
      }
    },
  };

  /** Creates an element. props are attributes (true → empty attribute) or on* listeners. */
  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value === undefined || value === null || value === false) continue;
      if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
      else el.setAttribute(key, value === true ? "" : String(value));
    }
    el.append(
      ...children
        .flat(Infinity)
        .filter((c) => c !== null && c !== false && c !== undefined),
    );
    return el;
  }

  const $ = (id) => document.getElementById(id);

  /* ---------- loading ---------- */

  const roundSrc =
    new URLSearchParams(location.search).get("round") || "round.js";
  const roundUrl = document.getElementById("ruling-board-package") ? null : new URL(roundSrc, location.href);
  let embedded = null;
  let defined = false;

  function define(def) {
    if (defined) {
      showErrors([
        { path: roundSrc, message: "RulingBoard.define が 2 回呼ばれた" },
      ]);
      return;
    }
    defined = true;
    const errors = V.validate(def);
    if (errors.length > 0) {
      showErrors(errors);
      return;
    }
    preload(def).then((failed) =>
      failed.length > 0 ? showErrors(failed) : render(def),
    );
  }

  globalThis.RulingBoard = Object.freeze({ VERSION, define });

  const imageUrl = (path) => embedded ? embedded.assets[path] : new URL(path, roundUrl).href;
  const sizes = new Map();

  function preload(def) {
    const unique = new Map();
    for (const entry of V.listImages(def)) {
      if (!unique.has(entry.path)) unique.set(entry.path, entry);
    }
    const one = (entry) =>
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          sizes.set(entry.path, [img.naturalWidth, img.naturalHeight]);
          resolve(null);
        };
        img.onerror = () =>
          resolve({ path: entry.at, message: `画像を読めない：${entry.path}` });
        img.src = imageUrl(entry.path);
      });
    return Promise.all([...unique.values()].map(one)).then((r) =>
      r.filter(Boolean),
    );
  }

  function showErrors(errors) {
    document.body.classList.add("is-broken");
    $("main").removeAttribute("aria-busy");
    document.title = `記述の誤り · ${NAME}`;
    $("main").replaceChildren(
      h(
        "section",
        { class: "errors", "aria-labelledby": "errors-title" },
        h("h1", { id: "errors-title" }, "記述の誤り"),
        h(
          "ol",
          { class: "error-list" },
          errors.map((e) => h("li", {}, h("code", {}, e.path), " ", e.message)),
        ),
      ),
    );
  }

  async function start() {
    const inline = document.getElementById("ruling-board-package");
    if (inline) {
      try {
        const envelope = JSON.parse(inline.textContent);
        if (envelope.sealed) unlock(envelope.sealed);
        else await openPackage(envelope);
      } catch (error) { showErrors([{ path: "発行データ", message: error.message }]); }
      return;
    }
    if (/^[a-z][a-z0-9+.-]*:|^[\\/]/i.test(roundSrc)) {
      showErrors([{ path: roundSrc, message: "相対パスではない" }]);
      return;
    }
    const script = document.createElement("script");
    script.src = roundUrl.href;
    script.onload = () => {
      if (!defined)
        showErrors([
          { path: roundSrc, message: "RulingBoard.define が呼ばれていない" },
        ]);
    };
    script.onerror = () =>
      showErrors([{ path: roundSrc, message: "記述ファイルを読めない" }]);
    document.body.append(script);
  }

  async function openPackage(envelope) {
    const bytes = new TextEncoder().encode(JSON.stringify(envelope.payload));
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), n => n.toString(16).padStart(2, "0")).join("");
    if (hash !== envelope.sha256) throw Error("内包データが発行後に変更されています");
    const errors = V.validate(envelope.payload.def);
    if (errors.length) throw Error(errors.map(e => `${e.path}: ${e.message}`).join("\n"));
    for (const image of V.listImages(envelope.payload.def)) {
      if (!Object.hasOwn(envelope.payload.assets, image.path) || !/^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(envelope.payload.assets[image.path])) throw Error(`内包画像が不正: ${image.path}`);
    }
    embedded = envelope.payload;
    define(embedded.def);
  }

  // A sealed package holds the whole plain envelope, so nothing of the round is
  // readable before the password opens it. A wrong password may be retried.
  function unlock(sealed) {
    const input = h("input", { type: "password", id: "unlock-password", autocomplete: "current-password", required: true });
    const message = h("p", { class: "unlock-error", role: "alert" });
    const button = h("button", { type: "submit" }, "開く");
    const form = h(
      "form",
      { class: "unlock", "aria-labelledby": "unlock-title" },
      h("h1", { id: "unlock-title" }, "パスワード"),
      h("label", { for: "unlock-password", class: "sr-only" }, "パスワード"),
      input,
      button,
      message,
    );
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      button.disabled = true;
      message.textContent = "";
      let plain;
      try {
        plain = await globalThis.RulingBoardSeal.open(sealed, input.value);
      } catch (error) {
        message.textContent = error.message;
        button.disabled = false;
        input.select();
        return;
      }
      document.body.classList.remove("is-locked");
      try { await openPackage(JSON.parse(plain)); } catch (error) { showErrors([{ path: "発行データ", message: error.message }]); }
    });
    document.body.classList.add("is-locked");
    $("main").removeAttribute("aria-busy");
    $("main").replaceChildren(form);
    input.focus();
  }

  /* ---------- the board ---------- */

  function render(def) {
    const round = def.round;
    const formats = round.output?.formats ?? ["markdown"];
    let answerFormat = round.output?.default ?? "markdown";
    const formatInfo = {
      markdown: ["Markdown", "md", "text/markdown"], json: ["JSON", "json", "application/json"],
      text: ["テキスト", "txt", "text/plain"], csv: ["CSV", "csv", "text/csv"],
    };
    const money = value => `${value.toLocaleString("ja-JP")} 円`;
    const totalBox = h("p", { id: "price-total", "aria-live": "polite" });
    const digest = V.digest(def);
    const draftKey = `${NAME}:${round.id}`;
    const viewLabel = new Map(def.views.map((v) => [v.id, v.label]));
    const narrow = matchMedia("(max-width: 899.98px)");

    let layout = store.get(PREFS)?.layout === "grid" ? "grid" : "switch";
    let cleared = false;
    let saveTimer = 0;
    let announce = false;
    const zoomState = { item: null };
    const visible = new Set();
    const status = h("p", {
      class: "sr-only",
      "aria-live": "polite",
      id: "status",
    });

    /* One flat list, in description order, is the source of every list on the page. */
    const decisions = def.decisions.map((d) => ({ def: d, items: [] }));
    const items = [];
    for (const decision of decisions) {
      for (const it of decision.def.items) {
        const number = items.length + 1;
        const views = V.viewsOf(def, it);
        const item = {
          def: it,
          decision,
          number,
          views,
          legend: `${number}. ${it.id} ${it.title}`,
          recommended: it.options.findIndex((o) => o.recommended === true),
          answer: { choice: null, hold: false, comment: "", seen: [] },
          // Each item opens on its own first view; the header applies only when chosen.
          ui: { option: 0, view: views[0] },
          el: {},
        };
        decision.items.push(item);
        items.push(item);
      }
    }

    const isDone = (item) => item.answer.hold || item.answer.choice !== null;
    const choiceIndex = (item) =>
      item.def.options.findIndex((o) => o.id === item.answer.choice);
    const paths = (item, k, view = item.ui.view) =>
      V.imagesOf(def, item.decision.def, item.def, item.def.options[k], view);

    restoreDraft();

    function restoreDraft() {
      const draft = store.get(draftKey);
      if (
        !draft ||
        draft.digest !== digest ||
        !draft.items ||
        typeof draft.items !== "object"
      )
        return;
      for (const item of items) {
        const saved = draft.items[item.def.id];
        if (!saved) continue;
        const a = item.answer;
        if (item.def.options.some((o) => o.id === saved.choice))
          a.choice = saved.choice;
        a.hold = saved.hold === true && a.choice === null;
        if (typeof saved.comment === "string") a.comment = saved.comment;
        if (Array.isArray(saved.seen))
          a.seen = item.views.filter((v) => saved.seen.includes(v));
        const k = choiceIndex(item);
        if (k >= 0) item.ui.option = k;
      }
    }

    function save() {
      clearTimeout(saveTimer);
      saveTimer = 0;
      if (cleared) return;
      const answers = Object.fromEntries(
        items.map((i) => [i.def.id, i.answer]),
      );
      if (store.set(draftKey, { digest, items: answers }) && announce) {
        status.textContent = "下書きを保存";
      }
      announce = false;
    }
    const scheduleSave = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(save, 400);
    };
    addEventListener("pagehide", () => saveTimer && save());

    /* ----- shared pieces ----- */

    const optionText = (option, k) => [
      h("span", { class: "opt-num" }, numbered(k + 1)),
      " ",
      option.label,
      option.recommended ? h("span", { class: "badge rec" }, "推奨") : null,
      (option.tags || []).map((t) => h("span", { class: "badge tag" }, t)),
    ];

    function segments(item, k, view = item.ui.view) {
      const option = item.def.options[k];
      const list = paths(item, k, view);
      if (list.length === 0)
        return [h("span", { class: "no-image" }, "画像なし")];
      const rect = option.focus?.[view] ?? item.def.focus?.[view];
      return list.map((path, n) => {
        const [w, hgt] = sizes.get(path) || [0, 0];
        const suffix = list.length > 1 ? ` · ${n + 1}/${list.length}` : "";
        const img = h("img", {
          src: imageUrl(path),
          alt: `${item.def.title} · ${option.label} · ${viewLabel.get(view)}${suffix}`,
          width: w || null,
          height: hgt || null,
          decoding: "async",
        });
        const seg = h("span", { class: "seg" }, img);
        if (n === 0 && rect && w && hgt) {
          seg.append(
            h("span", {
              class: "focus-box",
              "aria-hidden": "true",
              style: `left:${(rect[0] * 100) / w}%;top:${(rect[1] * 100) / hgt}%;width:${(rect[2] * 100) / w}%;height:${(rect[3] * 100) / hgt}%`,
            }),
          );
        }
        return seg;
      });
    }

    /** Swaps the content of a scroll box without moving its scroll position. */
    function keepScroll(box, swap) {
      const top = box.scrollTop;
      const left = box.scrollLeft;
      swap();
      box.scrollTop = top;
      box.scrollLeft = left;
    }

    const optionKey = (e, count, current) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return null;
      if (e.key === "ArrowRight") return (current + 1) % count;
      if (e.key === "ArrowLeft") return (current - 1 + count) % count;
      if (/^[1-9]$/.test(e.key) && Number(e.key) <= count)
        return Number(e.key) - 1;
      return null;
    };

    function pressed(group, value) {
      for (const b of group.querySelectorAll("button[data-value]")) {
        b.setAttribute(
          "aria-pressed",
          String(b.dataset.value === String(value)),
        );
      }
    }

    /* ----- header ----- */

    const progress = h("span", { class: "progress-count" });
    const tocCount = h("span", { class: "toc-open-count" });
    const tocOpen = h(
      "button",
      {
        type: "button",
        class: "toc-open",
        "aria-haspopup": "dialog",
        onclick: openDrawer,
      },
      "目次 ",
      tocCount,
    );
    // One select for any number of views: the header keeps its height however many the round has.
    const viewPick = h(
      "select",
      {
        class: "view-pick",
        "aria-label": "見え方",
        onchange: (e) => setPreferred(e.target.value),
      },
      h("option", { value: "" }, "項目ごと"),
      def.views.map((v) => h("option", { value: v.id }, v.label)),
    );
    const layoutGroup = h(
      "div",
      { class: "seg-group", role: "group", "aria-label": "表示" },
      h(
        "button",
        {
          type: "button",
          "data-value": "switch",
          onclick: () => setLayout("switch"),
        },
        "切り替え",
      ),
      h(
        "button",
        {
          type: "button",
          "data-value": "grid",
          onclick: () => setLayout("grid"),
        },
        "並べる",
      ),
    );
    $("top").replaceChildren(
      tocOpen,
      h("h1", { class: "round-title" }, round.title),
      h("p", { class: "progress", "aria-live": "polite" }, "進み ", progress),
      viewPick,
      layoutGroup,
    );
    pressed(layoutGroup, layout);

    /* ----- table of contents ----- */

    const tocList = h("ol", { class: "toc" });
    const nav = h(
      "nav",
      { id: "toc", "aria-label": "目次" },
      tocList,
      h("p", { class: "toc-answer" }, h("a", { href: "#answer" }, "回答案")),
    );

    /* ----- body ----- */

    const body = [];
    for (const decision of decisions) {
      const d = decision.def;
      decision.count = h("span", { class: "toc-count" });
      const sub = h("ol", { class: "toc-items" });
      tocList.append(
        h(
          "li",
          { class: "toc-decision", "data-decision": d.id },
          h(
            "a",
            { href: `#dec-${d.id}`, class: "toc-decision-link" },
            `${d.id} ${d.title}`,
            " ",
            decision.count,
          ),
          sub,
        ),
      );
      const section = h(
        "section",
        {
          class: "decision",
          id: `dec-${d.id}`,
          "data-decision": d.id,
          "aria-labelledby": `dh-${d.id}`,
        },
        h("h2", { id: `dh-${d.id}`, tabindex: "-1" }, `${d.id} ${d.title}`),
      );
      for (const item of decision.items) {
        item.el.toc = h("a", {
          class: "toc-item",
          href: `#item-${item.def.id}`,
          "data-item": item.def.id,
        });
        sub.append(h("li", {}, item.el.toc));
        section.append(itemSection(item));
      }
      body.push(section);
    }

    const answerBox = h("textarea", {
      id: "answer-text",
      class: "answer-text",
      readonly: true,
      rows: "16",
      spellcheck: "false",
      "aria-labelledby": "answer-title",
    });
    body.push(
      h(
        "section",
        { class: "answer", id: "answer", "aria-labelledby": "answer-title" },
        h("h2", { id: "answer-title", tabindex: "-1" }, "回答案"),
        formats.length > 1 && h("label", {}, "出力形式 ", h("select", { id: "answer-format", onchange: e => { answerFormat = e.target.value; answerBox.value = answerText(); } }, formats.map(f => h("option", { value: f, selected: f === answerFormat }, formatInfo[f][0])))),
        answerBox,
        h(
          "div",
          { class: "actions" },
          h("button", { type: "button", onclick: copyAnswer }, "コピー"),
          h("button", { type: "button", onclick: saveAnswer }, "保存"),
          h(
            "button",
            { type: "button", class: "quiet", onclick: clearDraft },
            "下書きを消す",
          ),
        ),
        status,
      ),
    );

    if (round.pricing) body.push(h("section", { class: "answer", "aria-labelledby": "total-title" }, h("h2", { id: "total-title" }, "選択した金額の合計"), totalBox));

    $("side").replaceChildren(nav);
    $("main").replaceChildren(...body);
    document.title = `${round.title} · ${NAME}`;

    function itemSection(item) {
      const it = item.def;
      const el = item.el;

      el.options = h(
        "div",
        { class: "seg-group options", role: "group", "aria-label": "案" },
        it.options.map((o, k) =>
          h(
            "button",
            {
              type: "button",
              "data-value": k,
              onclick: () => showOption(item, k),
            },
            optionText(o, k),
          ),
        ),
      );
      el.views =
        item.views.length > 1
          ? h(
              "div",
              {
                class: "seg-group views",
                role: "group",
                "aria-label": "見え方",
              },
              item.views.map((v) =>
                h(
                  "button",
                  {
                    type: "button",
                    "data-value": v,
                    onclick: () => showView(item, v),
                  },
                  viewLabel.get(v),
                ),
              ),
            )
          : null;
      el.stage = h("div", {
        class: "stage",
        tabindex: "0",
        role: "group",
        "aria-label": `${item.legend} · 比較`,
        onkeydown: (e) => {
          const k = optionKey(e, it.options.length, item.ui.option);
          if (k === null) return;
          e.preventDefault();
          showOption(item, k);
        },
      });
      el.zoom = h("button", {
        type: "button",
        class: "zoom",
        onclick: () => openZoom(item),
      });

      const name = `pick-${it.id}`;
      const radio = (value, label, onchange) =>
        h(
          "label",
          { class: "choice" },
          h("input", { type: "radio", name, value, onchange }),
          h("span", {}, label),
        );
      el.comment = h("textarea", {
        class: "comment",
        rows: "2",
        "aria-label": `${item.legend} · コメント`,
        oninput: (e) => {
          item.answer.comment = e.target.value;
          changed(item, true);
        },
      });
      el.comment.value = item.answer.comment;

      el.fieldset = h(
        "fieldset",
        { class: "choose", "data-item": it.id },
        h("legend", {}, item.legend),
        h(
          "div",
          { class: "choices" },
          it.options.map((o, k) =>
            radio(`option:${o.id}`, [optionText(o, k), round.pricing ? ` · ${o.price === undefined ? "金額未設定" : money(o.price)}` : ""], () => {
              item.answer.choice = o.id;
              item.answer.hold = false;
              showOption(item, k);
              changed(item, true);
            }),
          ),
          radio("hold", "保留", () => {
            item.answer.choice = null;
            item.answer.hold = true;
            changed(item, true);
          }),
        ),
        h(
          "label",
          { class: "comment-label" },
          h("span", { "aria-hidden": "true" }, "コメント"),
          el.comment,
        ),
      );
      const checked = item.answer.hold
        ? "hold"
        : item.answer.choice
          ? `option:${item.answer.choice}`
          : null;
      for (const input of el.fieldset.querySelectorAll("input[type=radio]")) {
        input.checked = input.value === checked;
      }

      el.section = h(
        "section",
        {
          class: "item",
          id: `item-${it.id}`,
          "data-item": it.id,
          "aria-labelledby": `ih-${it.id}`,
        },
        h(
          "h3",
          { id: `ih-${it.id}`, tabindex: "-1" },
          h("span", { class: "num" }, item.number),
          " ",
          `${it.id} ${it.title}`,
        ),
        h("p", { class: "question" }, it.question),
        h("div", { class: "bar" }, el.options, el.views),
        el.stage,
        el.fieldset,
      );
      drawStage(item);
      return el.section;
    }

    /* ----- comparing ----- */

    function drawStage(item) {
      const { stage, zoom } = item.el;
      pressed(item.el.options, item.ui.option);
      if (item.el.views) pressed(item.el.views, item.ui.view);
      stage.classList.toggle("grid", layout === "grid");
      keepScroll(stage, () => {
        if (layout === "grid") {
          stage.replaceChildren(
            ...item.def.options.map((o, k) =>
              h(
                "figure",
                {
                  class: k === item.ui.option ? "col is-current" : "col",
                  "data-option": o.id,
                },
                h("figcaption", {}, optionText(o, k)),
                h(
                  "button",
                  {
                    type: "button",
                    class: "zoom",
                    onclick: () => openZoom(item, k),
                  },
                  segments(item, k),
                ),
              ),
            ),
          );
        } else {
          zoom.dataset.option = item.def.options[item.ui.option].id;
          zoom.replaceChildren(...segments(item, item.ui.option));
          if (zoom.parentNode !== stage) stage.replaceChildren(zoom);
        }
      });
    }

    function showOption(item, k) {
      item.ui.option = k;
      if (layout === "grid") {
        pressed(item.el.options, k);
        item.el.stage
          .querySelectorAll(".col")
          .forEach((col, n) => col.classList.toggle("is-current", n === k));
        if (item.el.stage.contains(document.activeElement)) {
          item.el.stage.querySelectorAll(".col .zoom")[k].focus();
        }
      } else {
        drawStage(item);
      }
      if (zoomState.item === item) drawZoom();
    }

    function showView(item, view) {
      item.ui.view = view;
      drawStage(item);
      if (visible.has(item)) markSeen(item);
    }

    /** "" (項目ごと) or a view the item lacks: the item shows its own first view. */
    function setPreferred(view) {
      for (const item of items)
        showView(item, item.views.includes(view) ? view : item.views[0]);
    }

    function setLayout(next) {
      layout = next;
      pressed(layoutGroup, layout);
      store.set(PREFS, { layout });
      for (const item of items) drawStage(item);
    }

    /* ----- zoom ----- */

    const zoomDialog = /** @type {HTMLDialogElement} */ ($("zoom"));
    const zoomTitle = h("h2", { id: "zoom-title", class: "zoom-title" });
    const zoomOptions = h("div", {
      class: "seg-group options",
      role: "group",
      "aria-label": "案",
    });
    const zoomBody = h("div", { class: "zoom-body", tabindex: "-1" });
    zoomDialog.setAttribute("aria-labelledby", "zoom-title");
    zoomDialog.replaceChildren(
      h(
        "div",
        { class: "zoom-head" },
        zoomTitle,
        zoomOptions,
        h(
          "button",
          { type: "button", class: "close", onclick: () => zoomDialog.close() },
          "閉じる",
        ),
      ),
      zoomBody,
    );
    zoomDialog.addEventListener("keydown", (e) => {
      const item = zoomState.item;
      if (!item) return;
      const k = optionKey(e, item.def.options.length, item.ui.option);
      if (k === null) return;
      e.preventDefault();
      showOption(item, k);
    });
    // Closing returns focus to the pressed image by itself: showModal() remembers it.
    zoomDialog.addEventListener("close", () => {
      zoomState.item = null;
    });

    function openZoom(item, k = item.ui.option) {
      zoomState.item = item;
      if (k !== item.ui.option) showOption(item, k);
      zoomTitle.textContent = `${item.legend} · ${viewLabel.get(item.ui.view)}`;
      zoomOptions.replaceChildren(
        ...item.def.options.map((o, n) =>
          h(
            "button",
            {
              type: "button",
              "data-value": n,
              onclick: () => showOption(item, n),
            },
            optionText(o, n),
          ),
        ),
      );
      zoomBody.replaceChildren();
      drawZoom();
      zoomDialog.showModal();
      zoomBody.scrollTop = 0;
      zoomBody.focus();
      markSeen(item);
    }

    function drawZoom() {
      const item = zoomState.item;
      pressed(zoomOptions, item.ui.option);
      keepScroll(zoomBody, () => {
        zoomBody.dataset.option = item.def.options[item.ui.option].id;
        zoomBody.replaceChildren(...segments(item, item.ui.option));
      });
    }

    /* ----- drawer (narrow screens) ----- */

    const drawer = /** @type {HTMLDialogElement} */ ($("toc-drawer"));
    function openDrawer() {
      drawer.append(nav);
      drawer.showModal();
    }
    drawer.addEventListener("close", () => $("side").append(nav));
    narrow.addEventListener("change", () => {
      if (!narrow.matches && drawer.open) drawer.close();
    });

    nav.addEventListener("click", (e) => {
      const link = e.target.closest("a[href^='#']");
      if (!link) return;
      const target = $(decodeURIComponent(link.hash.slice(1)));
      if (!target) return;
      e.preventDefault();
      if (drawer.open) drawer.close();
      target.scrollIntoView({ block: "start" });
      const heading = /** @type {HTMLElement} */ (
        target.querySelector("h2, h3")
      );
      heading.focus({ preventScroll: true });
      history.replaceState(null, "", link.hash);
    });

    /* ----- what is on screen ----- */

    const byStage = new Map(items.map((i) => [i.el.stage, i]));
    const stageWatch = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const item = byStage.get(entry.target);
          if (entry.intersectionRatio >= SEEN_RATIO) {
            visible.add(item);
            markSeen(item);
          } else {
            visible.delete(item);
          }
        }
      },
      { threshold: SEEN_RATIO },
    );
    byStage.forEach((_, stage) => stageWatch.observe(stage));

    function markSeen(item) {
      const seen = item.answer.seen;
      if (seen.includes(item.ui.view)) return;
      seen.push(item.ui.view);
      item.answer.seen = item.views.filter((v) => seen.includes(v));
      changed(item, false);
    }

    const bySection = new Map(items.map((i) => [i.el.section, i]));
    const here = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          for (const i of items) i.el.toc.removeAttribute("aria-current");
          bySection
            .get(entry.target)
            .el.toc.setAttribute("aria-current", "location");
        }
      },
      { rootMargin: "-30% 0px -60% 0px" },
    );
    bySection.forEach((_, section) => here.observe(section));

    const top = $("top");
    new ResizeObserver(() => {
      document.documentElement.style.setProperty(
        "--top-h",
        `${top.offsetHeight}px`,
      );
    }).observe(top);

    /* ----- state → page ----- */

    function drawToc(item) {
      const a = item.answer;
      const k = choiceIndex(item);
      const state = a.hold ? "hold" : k >= 0 ? "chosen" : "none";
      const spoken = {
        none: "未選択",
        chosen: `選択済 ${k >= 0 ? item.def.options[k].label : ""}`,
        hold: "保留",
      }[state];
      const pick = { none: null, chosen: numbered(k + 1), hold: "保留" }[state];
      item.el.toc.dataset.state = state;
      // replaceChildren() would write null as the text "null": leave absent parts out.
      item.el.toc.replaceChildren(
        ...[
          h("span", { class: "mark", "aria-hidden": "true" }, MARK[state]),
          h("span", { class: "sr-only" }, spoken),
          h("span", { class: "num" }, item.number),
          h("span", { class: "name" }, `${item.def.id} ${item.def.title}`),
          pick && h("span", { class: "pick", "aria-hidden": "true" }, pick),
          a.comment.trim() &&
            h(
              "span",
              { class: "has-comment" },
              h("span", { class: "sr-only" }, "コメントあり"),
            ),
        ].filter(Boolean),
      );
    }

    function drawCounts() {
      for (const decision of decisions) {
        decision.count.textContent = `${decision.items.filter(isDone).length}/${decision.items.length}`;
      }
      const text = `${items.filter(isDone).length}/${items.length}`;
      progress.textContent = text;
      tocCount.textContent = text;
    }

    function totals() {
      let total = 0, pending = 0;
      for (const item of items) {
        const selected = item.def.options.find(o => o.id === item.answer.choice);
        if (item.answer.hold || !selected || selected.price === undefined) pending++;
        else total += selected.price;
      }
      return { currency: "JPY", total, pending, complete: pending === 0 };
    }

    function answerData() {
      return {
        schema: 1, round: { ...round }, descriptionDigest: digest, boardVersion: VERSION, date: today(),
        decisions: decisions.map(d => ({ id: d.def.id, title: d.def.title, note: d.def.note ?? "", items: d.items.map(item => {
          const selected = item.def.options.find(o => o.id === item.answer.choice);
          return { id: item.def.id, title: item.def.title, question: item.def.question, state: item.answer.hold ? "held" : selected ? "selected" : "unselected", choice: selected ? { id: selected.id, label: selected.label, ...(round.pricing ? { price: selected.price ?? null } : {}) } : null, recommended: item.def.options.find(o => o.recommended)?.id ?? null, comment: item.answer.comment, seen: [...item.answer.seen] };
        }) })),
        ...(round.pricing ? { pricing: totals() } : {}),
      };
    }

    function answerText() {
      if (round.pricing) {
        const t = totals();
        totalBox.textContent = `${money(t.total)}${t.pending ? `（未確定 ${t.pending} 項目）` : "（全項目確定）"}`;
      }
      if (answerFormat === "json") return JSON.stringify(answerData(), null, 2) + "\n";
      if (answerFormat === "csv") {
        const data = answerData();
        const rows = [["回ID", "回", "比較元", "回答先", "記述", "器", "回答日", "裁定点ID", "裁定点", "注記", "項目ID", "項目", "問い", "状態", "選択ID", "選択", "推奨ID", "コメント", "閲覧", "金額", "通貨", "合計", "未確定数"]];
        for (const d of data.decisions) for (const item of d.items) rows.push([round.id, round.title, round.source ?? "", round.answerTo ?? "", digest, VERSION, data.date, d.id, d.title, d.note, item.id, item.title, item.question, item.state, item.choice?.id ?? "", item.choice?.label ?? "", item.recommended ?? "", item.comment, item.seen.join(";"), item.choice?.price ?? "", data.pricing?.currency ?? "", data.pricing?.total ?? "", data.pricing?.pending ?? ""]);
        const cell = value => { let s = String(value); if (/^[\s]*[=+@-]/.test(s)) s = "'" + s; return '"' + s.replaceAll('"', '""') + '"'; };
        return rows.map(row => row.map(cell).join(",")).join("\r\n") + "\r\n";
      }
      const markdown = markdownAnswer();
      return answerFormat === "text" ? markdown.replace(/^#{1,2} /gm, "").replace(/^- /gm, "").replace(/^  - /gm, "  ") : markdown;
    }

    function markdownAnswer() {
      const done = items.filter(isDone).length;
      const held = items.filter((i) => i.answer.hold).length;
      const lines = [`# 回答：${round.title}（${round.id}）`];
      if (round.answerTo) lines.push(`回答先: ${round.answerTo}`);
      lines.push(
        [
          round.source && `比較元: ${round.source}`,
          `記述: ${digest}`,
          `器: ${NAME} ${VERSION}`,
        ]
          .filter(Boolean)
          .join(" / "),
      );
      lines.push(
        `回答日: ${today()} · 選択 ${done}/${items.length}（保留 ${held}）`,
      );
      for (const decision of decisions) {
        lines.push("", `## ${decision.def.id} ${decision.def.title}`);
        if (decision.def.note) lines.push(`注記: ${decision.def.note}`);
        for (const item of decision.items) {
          const a = item.answer;
          const k = choiceIndex(item);
          const pick = a.hold
            ? "保留"
            : k >= 0
              ? `${numbered(k + 1)} ${item.def.options[k].label}`
              : "未選択";
          const rec =
            item.recommended >= 0
              ? `（推奨 ${numbered(item.recommended + 1)}）`
              : "";
          const seen = a.seen.length > 0 ? a.seen.join(", ") : "なし";
          lines.push(
            `- ${item.def.id} ${item.def.title}: ${pick}${rec} · 見た: ${seen}`,
          );
          if (round.pricing && k >= 0) lines.push(`  - 金額: ${item.def.options[k].price === undefined ? "未設定" : money(item.def.options[k].price)}`);
          const comment = a.comment.trim();
          if (comment)
            lines.push(
              `  - コメント: ${comment.split(/\r?\n/).join("\n    ")}`,
            );
        }
      }
      if (round.pricing) {
        const t = totals();
        lines.push("", `合計: ${money(t.total)}（${t.currency}・未確定 ${t.pending} 項目）`);
      }
      return `${lines.join("\n")}\n`;
    }

    function today() {
      const d = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    function changed(item, byHand) {
      drawToc(item);
      drawCounts();
      answerBox.value = answerText();
      announce ||= byHand;
      scheduleSave();
    }

    /* ----- answer ----- */

    async function copyAnswer() {
      try {
        await navigator.clipboard.writeText(answerBox.value);
      } catch {
        answerBox.focus();
        answerBox.select();
        if (!document.execCommand("copy")) {
          status.textContent = "コピーできない";
          return;
        }
      }
      status.textContent = "コピーした";
    }

    function saveAnswer() {
      const url = URL.createObjectURL(
        new Blob([answerBox.value], { type: `${formatInfo[answerFormat][2]};charset=utf-8` }),
      );
      const link = h("a", {
        href: url,
        download: `${round.id}-answer.${formatInfo[answerFormat][1]}`,
        hidden: true,
      });
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function clearDraft() {
      if (!confirm("下書きを消す")) return;
      cleared = true;
      clearTimeout(saveTimer);
      store.remove(draftKey);
      location.reload();
    }

    for (const item of items) drawToc(item);
    drawCounts();
    answerBox.value = answerText();
    $("main").removeAttribute("aria-busy");
    document.body.classList.add("is-ready");
  }

  start();
})();
