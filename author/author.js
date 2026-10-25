(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const template = JSON.parse($("board-template").textContent);
  const V = globalThis.RulingBoardValidate;
  let project, revision = 0, ready = null, busy = false, detailDirty = false;
  const empty = () => ({ schema: 1, description: { schema: 1, round: { id: "review-r1", title: "新しい比較", output: { formats: ["markdown", "json", "text", "csv"], default: "markdown" } }, views: [{ id: "main", label: "全体" }], decisions: [{ id: "D1", title: "比較する項目", items: [] }] }, captures: {}, assets: {} });
  const json = value => JSON.stringify(value, null, 2);
  const safeJson = value => JSON.stringify(value).replaceAll("<", "\\u003c");
  const sha = async value => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), n => n.toString(16).padStart(2, "0")).join("");
  function status(text, error = false) { $("status").textContent = text; $("status").classList.toggle("error", error); }
  function invalidate() {
    revision++; ready = null;
    $("publish").disabled = true; $("save-evidence").disabled = true;
    $("preview-frame").removeAttribute("src");
    $("preview-frame").removeAttribute("srcdoc");
    status("設定を変更しました。検査してプレビューしてください。");
  }
  function syncJson() {
    detailDirty = false;
    $("description-json").value = json(project.description);
    $("captures-json").value = json(project.captures);
  }
  function changed() { invalidate(); syncJson(); }
  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else if (key === "text") node.textContent = value;
      else if (value !== false && value != null) node.setAttribute(key, value === true ? "" : value);
    }
    node.append(...children.filter(Boolean)); return node;
  }
  const field = (label, value, apply, type = "text") => el("label", {}, label, el("input", { type, value: value ?? "", oninput: e => { apply(e.target.value); changed(); } }));
  function allItems() { return project.description.decisions.flatMap(d => d.items); }
  function newItem() {
    const taken = new Set(allItems().map(i => i.id)); let n = 1;
    while (taken.has(`I${n}`)) n++;
    const item = { id: `I${n}`, title: `比較項目 ${n}`, question: "どちらの案を選びますか", views: [project.description.views[0].id], options: [{ id: "cur", label: "現在" }, { id: "a", label: "変更案", recommended: true }] };
    project.description.decisions[0].items.push(item); project.captures[item.id] = {};
    for (const view of item.views) project.captures[item.id][view] = { guard: [0, 0, 480, 300], images: {}, repeat: {} };
    changed(); renderItems();
  }
  async function readImage(file) {
    if (!/\.(png|jpe?g|webp|svg)$/i.test(file.name)) throw Error(`画像の形式が不正: ${file.name}`);
    if (file.size > 40000000) throw Error(`画像が40MBを超えています: ${file.name}`);
    const type = /\.svg$/i.test(file.name) ? "svg+xml" : /\.jpe?g$/i.test(file.name) ? "jpeg" : file.name.split(".").pop().toLowerCase();
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = ""; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const data = `data:image/${type};base64,${btoa(binary)}`;
    return data;
  }
  function inputImages(item, option, view, capture, kind) {
    const names = typeof capture[kind]?.[option.id] === "string" ? [capture[kind][option.id]] : capture[kind]?.[option.id] ?? [];
    const input = el("input", { type: "file", accept: ".png,.jpg,.jpeg,.webp,.svg", multiple: true, "aria-label": `${item.id} ${option.id} ${view} ${kind === "images" ? "元画像" : "撮り直し"}` });
    input.addEventListener("change", async () => {
      if (!input.files.length) return;
      const pendingRevision = revision;
      try {
        const entries = [];
        for (const file of input.files) {
          const data = await readImage(file);
          const name = `uploads/${await sha(file.name + data)}/${file.name.replace(/[^A-Za-z0-9._-]/g, "_")}`;
          entries.push([name, data]);
        }
        if (revision !== pendingRevision) throw Error("画像の読込み中に設定が変わりました。もう一度選択してください。");
        for (const [name, data] of entries) project.assets[name] = data;
        capture[kind] ??= {}; capture[kind][option.id] = entries.map(([name]) => name);
        changed(); renderItems();
      } catch (error) { status(error.message, true); }
    });
    return el("div", {}, el("label", { class: "file-button" }, kind === "images" ? "元画像を選ぶ" : "撮り直しを選ぶ", input), el("div", { class: "filenames" }, names.length ? `${names.length} 段 · ${names.map(n => n.split("/").at(-1)).join(", ")}` : "未設定"));
  }
  function renderItems() {
    const target = $("items"); target.replaceChildren();
    for (const decision of project.description.decisions) {
      for (const item of decision.items) {
        const card = el("article", { class: "item" }, el("div", { class: "section-heading" }, el("h3", {}, `${decision.id} / ${item.id}`), el("button", { class: "quiet", onclick: () => { decision.items.splice(decision.items.indexOf(item), 1); delete project.captures[item.id]; changed(); renderItems(); } }, "項目を削除")), el("div", { class: "fields" }, field("項目の名前", item.title, v => item.title = v), field("判断してほしいこと", item.question, v => item.question = v)));
        project.captures[item.id] ??= {};
        for (const view of V.viewsOf(project.description, item)) {
          const capture = project.captures[item.id][view] ??= { guard: [0, 0, 480, 300], images: {}, repeat: {} };
          const viewSection = el("div", { class: "view" }, el("h4", {}, project.description.views.find(v => v.id === view)?.label ?? view));
          const guard = field("変更を許す範囲（x, y, 幅, 高さ）", capture.guard?.join(", "), v => { capture.guard = v.split(",").map(s => s.trim() === "" ? null : Number(s.trim())); }); guard.className = "guard"; viewSection.append(guard);
          const options = el("div", { class: "options" });
          for (const option of item.options) {
            const opt = el("div", { class: "option" }, field(`案 ${option.id}`, option.label, v => { option.label = v; }));
            if (project.description.round.pricing) {
              const price = field("金額（円・空欄は未設定）", option.price, v => { if (v === "") delete option.price; else option.price = Number(v); }, "number");
              price.querySelector("input").min = "0"; price.querySelector("input").step = "1"; opt.append(price);
            }
            if (option.noImage) opt.append(el("p", { class: "hint" }, "画像のない案"));
            else {
              const first = typeof capture.images?.[option.id] === "string" ? capture.images[option.id] : capture.images?.[option.id]?.[0];
              if (first && project.assets[first]) opt.append(el("img", { src: project.assets[first], alt: `${option.label} の元画像` }));
              opt.append(inputImages(item, option, view, capture, "images"), inputImages(item, option, view, capture, "repeat"));
            }
            options.append(opt);
          }
          viewSection.append(options); card.append(viewSection);
        }
        card.append(el("button", { onclick: () => { let n = item.options.length + 1; while (item.options.some(o => o.id === `a${n}`)) n++; item.options.push({ id: `a${n}`, label: `案 ${n}` }); changed(); renderItems(); } }, "案を追加"));
        target.append(card);
      }
    }
  }
  function render() {
    const r = project.description.round;
    $("round-title").value = r.title; $("round-id").value = r.id; $("round-source").value = r.source ?? ""; $("round-answer-to").value = r.answerTo ?? "";
    const output = r.output ?? { formats: ["markdown"], default: "markdown" };
    for (const box of $("formats").querySelectorAll("input")) box.checked = output.formats.includes(box.value);
    $("default-format").value = output.default; $("pricing").checked = !!r.pricing;
    renderItems(); syncJson();
  }
  function checkProject(value) {
    if (value?.schema !== 1 || !value.description || !value.captures || !value.assets || typeof value.assets !== "object" || Array.isArray(value.assets)) throw Error("発行設定のJSONではありません");
    if (Object.keys(value).some(k => !["schema", "description", "captures", "assets"].includes(k))) throw Error("発行設定に知らないキーがあります");
    const def = structuredClone(value.description);
    if (def.images !== undefined) throw Error("画像は撮影条件へ設定してください");
    if (!Array.isArray(def.decisions) || !Array.isArray(def.views)) throw Error("項目・見え方がありません");
    for (const d of def.decisions) for (const item of d.items ?? []) {
      if (item.focus !== undefined) throw Error("focusは検査から生成します");
      for (const o of item.options ?? []) {
        if (o.images !== undefined || o.focus !== undefined) throw Error("images/focusは検査から生成します");
        if (!o.noImage) o.images = Object.fromEntries(V.viewsOf(def, item).map(v => [v, "placeholder.png"]));
      }
    }
    const errors = V.validate(def);
    if (errors.length) throw Error(errors.map(e => `${e.path}: ${e.message}`).join("\n"));
    for (const [name, data] of Object.entries(value.assets)) if (!globalThis.RulingBoardBrowserImages.DATA.test(data)) throw Error(`画像データが不正: ${name}`);
    return structuredClone(value);
  }
  function load(value) { const next = checkProject(value); invalidate(); project = next; render(); status("設定を読み込みました。検査してプレビューしてください。"); }
  function download(name, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = el("a", { href: url, download: name }); document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  function packageHtml(envelope) {
    const script = value => `<script>${value.replace(/<\/script/gi, "<\\/script")}<` + "/script>";
    return template.html.replace('<link rel="stylesheet" href="board.css" />', () => `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; base-uri 'none'; form-action 'none'"><style>${template.css}</style>`)
      .replace('<script src="validate.js"></script>', () => `<script id="ruling-board-package" type="application/json">${safeJson(envelope)}<` + "/script>" + script(template.validate))
      .replace('<script src="board.js"></script>', () => script(template.seal) + script(template.board));
  }
  // The previewed plain envelope is sealed whole, then opened again before saving.
  async function sealedHtml(envelope, password) {
    const plain = JSON.stringify(envelope);
    const sealed = await globalThis.RulingBoardSeal.seal(plain, password);
    if (await globalThis.RulingBoardSeal.open(sealed, password) !== plain) throw Error("暗号化の確認に失敗しました");
    return packageHtml({ schema: 1, sealed });
  }
  async function verifyPreview(html) {
    const frame = $("preview-frame");
    const loaded = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { frame.onload = null; reject(Error("プレビューの読込みが時間切れになりました")); }, 60000);
      frame.onload = () => { clearTimeout(timer); frame.onload = null; resolve(); };
    });
    frame.srcdoc = html; await loaded;
    const start = Date.now();
    while (!frame.contentDocument?.body.classList.contains("is-ready")) {
      if (frame.contentDocument?.body.classList.contains("is-broken")) throw Error(frame.contentDocument.querySelector(".error-list")?.textContent ?? "プレビューを開けません");
      if (Date.now() - start > 60000) throw Error("画像の読込みが時間切れになりました");
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  $("preview").onclick = async () => {
    if (detailDirty) { status("詳細設定を適用してから検査してください。", true); return; }
    if (busy) return; busy = true; $("preview").disabled = true; invalidate();
    const currentRevision = revision;
    try {
      const input = checkProject(project); status("画像を比較し、撮り直しと拡大を検査しています…");
      const resolveImage = name => {
        if (typeof name !== "string" || /^(?:[a-z][a-z0-9+.-]*:|[\\/])/i.test(name) || name.split("/").some(p => p === ".." || p === "." || !p) || !Object.hasOwn(input.assets, name)) throw Error(`画像が見つかりません: ${name}`);
        return name;
      };
      const tool = globalThis.RulingBoardBrowserImages.imageTools(input.assets);
      const result = await globalThis.RulingBoardPrepare.prepare(input.description, input.captures, tool, resolveImage);
      const assets = Object.fromEntries([...result.files].map(([target, original]) => [target, input.assets[original]]));
      for (const crop of result.crops) assets[crop.target] = crop.bytes;
      const payload = { def: result.def, assets, evidence: result.report, generated: result.generated, description: input.description, source: template.source };
      const envelope = { schema: 1, payload, sha256: await sha(JSON.stringify(payload)) };
      const html = packageHtml(envelope);
      if (currentRevision !== revision) throw Error("検査中に設定が変わりました。もう一度検査してください。");
      await verifyPreview(html);
      if (currentRevision !== revision) throw Error("検査中に設定が変わりました。もう一度検査してください。");
      ready = { html, envelope, revision };
      $("publish").disabled = template.source.dirty || !template.source.commit;
      $("save-evidence").disabled = false;
      status(`検査完了 · 項目 ${allItems().length} · 比較 ${result.report.comparisons.length} · 撮り直し ${result.report.repeat.length} · 拡大 ${result.report.zooms.length}\n${template.source.dirty || !template.source.commit ? "この発行画面は未確定の開発版です。プレビューのみ利用できます。" : "プレビューを確認して、回答用HTMLを保存してください。"}`);
    } catch (error) { ready = null; $("publish").disabled = true; status(error.message, true); }
    finally { busy = false; $("preview").disabled = false; }
  };
  $("publish").onclick = async () => {
    if (busy || !ready || ready.revision !== revision || template.source.dirty || !template.source.commit) return;
    const password = $("seal-password").value;
    if (password !== $("seal-confirm").value) { status("パスワードと確認が一致しません。", true); return; }
    const current = ready;
    let html = current.html;
    if (password) {
      busy = true; $("publish").disabled = true; status("暗号化しています…");
      try { html = await sealedHtml(current.envelope, password); }
      catch (error) { status(error.message, true); return; }
      finally { busy = false; $("publish").disabled = ready !== current; }
      if (ready !== current) { status("暗号化中に設定が変わりました。もう一度検査してください。", true); return; }
    }
    download(`${project.description.round.id}.html`, html, "text/html;charset=utf-8");
    status(`${password ? "パスワードで暗号化した" : ""}HTMLの保存をブラウザへ渡しました。保存先・完了・取消はブラウザで確認してください。`);
  };
  $("save-evidence").onclick = () => { if (ready) download(`${project.description.round.id}-evidence.json`, json({ sha256: ready.envelope.sha256, evidence: ready.envelope.payload.evidence, source: template.source }), "application/json"); };
  $("save-project").onclick = () => download(`${/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(project.description.round.id) ? project.description.round.id : "review"}-project.json`, json(project), "application/json");
  $("open-project").onchange = async e => { try { if (e.target.files[0]) load(JSON.parse(await e.target.files[0].text())); } catch (error) { status(error.message, true); } e.target.value = ""; };
  $("open-folder").onchange = async e => {
    const currentRevision = revision;
    try {
      const files = [...e.target.files]; if (!files.length) return;
      const byPath = new Map(files.map(file => [file.webkitRelativePath.split("/").slice(1).join("/"), file]));
      let description;
      if (byPath.has("items.json")) description = JSON.parse(await byPath.get("items.json").text());
      else {
        const source = await byPath.get("items.mjs")?.text();
        const match = /^\s*export\s+const\s+description\s*=\s*([\s\S]*?)\s*;?\s*$/.exec(source ?? "");
        if (!match) throw Error("items.json、またはJSONだけをexportするitems.mjsが必要です");
        description = JSON.parse(match[1]);
      }
      if (!byPath.has("captures.json")) throw Error("captures.jsonがありません");
      const captures = JSON.parse(await byPath.get("captures.json").text()), assets = {};
      for (const views of Object.values(captures)) for (const capture of Object.values(views)) for (const kind of ["images", "repeat"]) for (const names of Object.values(capture[kind] ?? {})) for (const name of typeof names === "string" ? [names] : names) {
        if (!byPath.has(name)) throw Error(`画像がありません: ${name}`);
        if (!Object.hasOwn(assets, name)) assets[name] = await readImage(byPath.get(name));
      }
      if (currentRevision !== revision) throw Error("読込み中に設定が変わりました。もう一度開いてください。");
      load({ schema: 1, description, captures, assets });
    } catch (error) { status(error.message, true); }
    e.target.value = "";
  };
  $("apply-json").onclick = () => { try { load({ ...project, description: JSON.parse($("description-json").value), captures: JSON.parse($("captures-json").value) }); } catch (error) { status(error.message, true); } };
  for (const id of ["description-json", "captures-json"]) $(id).addEventListener("input", () => { detailDirty = true; invalidate(); status("詳細設定を編集しました。「詳細設定を適用」を押してください。"); });
  $("add-item").onclick = newItem;
  for (const [id, key] of [["round-title", "title"], ["round-id", "id"], ["round-source", "source"], ["round-answer-to", "answerTo"]]) $(id).oninput = e => { if (e.target.value || ["title", "id"].includes(key)) project.description.round[key] = e.target.value; else delete project.description.round[key]; changed(); };
  $("formats").onchange = () => { project.description.round.output ??= {}; project.description.round.output.formats = [...$("formats").querySelectorAll("input:checked")].map(i => i.value); project.description.round.output.default = $("default-format").value; changed(); };
  $("default-format").onchange = e => { project.description.round.output ??= { formats: ["markdown"] }; project.description.round.output.default = e.target.value; changed(); };
  $("pricing").onchange = e => { if (e.target.checked) project.description.round.pricing = { currency: "JPY" }; else { delete project.description.round.pricing; for (const item of allItems()) for (const o of item.options) delete o.price; } changed(); renderItems(); };
  $("preview-width").onchange = e => $("preview-frame").style.width = e.target.value;
  $("new-project").onclick = () => { if (confirm("設定を保存していない場合は失われます。新しく作りますか？")) { invalidate(); project = empty(); newItem(); render(); } };
  $("sample").onclick = () => {
    invalidate(); project = empty(); project.description.round.title = "操作ボタンの位置"; project.description.round.source = "公開用サンプル"; project.description.round.pricing = { currency: "JPY" }; newItem();
    const item = allItems()[0]; item.title = "保存ボタン"; item.options[0].price = 0; item.options[1].price = 1000;
    const capture = project.captures[item.id].main; capture.guard = [20, 45, 420, 65];
    for (const [n, o] of item.options.entries()) {
      const canvas = document.createElement("canvas"); canvas.width = 480; canvas.height = 300;
      const ctx = canvas.getContext("2d"); ctx.fillStyle = "#f1f5f3"; ctx.fillRect(0, 0, 480, 300); ctx.fillStyle = "#283d40"; ctx.fillRect(0, 0, 480, 34);
      ctx.fillStyle = n ? "#12695c" : "#657977"; ctx.fillRect(n ? 220 : 40, 60, 100, 32);
      ctx.fillStyle = "#dde7e1"; for (let y = 130; y < 280; y += 42) ctx.fillRect(30, y, 420, 24);
      for (const kind of ["images", "repeat"]) { const path = `sample/${o.id}-${kind}.png`; project.assets[path] = canvas.toDataURL(); capture[kind][o.id] = [path]; }
    }
    changed(); render(); status("架空画面のサンプルを開きました。検査してプレビューできます。");
  };
  $("version").textContent = template.version;
  $("build-status").textContent = `器 ${template.version} · ${template.source.dirty ? "開発中" : template.source.commit?.slice(0, 12) ?? "出所不明"}`;
  project = empty(); newItem(); render();
})();
