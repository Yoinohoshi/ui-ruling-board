// Shared preparation rules: Node CLI and offline authoring HTML.
(function (factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("../board/validate.js"), require("./pixels.js"));
  else globalThis.RulingBoardPrepare = factory(globalThis.RulingBoardValidate, globalThis.RulingBoardPixels);
})(function (V, geometry) {
  "use strict";
  const { validate, viewsOf } = V;
  const { union, intersection, area, validRect } = geometry;
  const paths = value => typeof value === "string" ? [value] : value;
  async function prepare(description, captures, tool, resolveImage) {
    const extension = file => /\.(png|jpe?g|webp|svg)$/i.exec(file)?.[0] || (() => { throw Error("画像形式が不明"); })();
    const targets = new Set();
    const claim = path => {
      const key = path.toLowerCase();
      if (targets.has(key)) throw Error("画像の出力名が衝突: " + path);
      targets.add(key);
    };
  const def = structuredClone(description);
  if (def.images !== undefined)
    throw Error("画像の規則は captures.json に記述してください");
  // Fill mappings first so the same schema validator protects all subsequent loops.
  for (const decision of def.decisions ?? [])
    for (const item of decision.items ?? []) {
      if (
        item.focus !== undefined ||
        item.options?.some(
          (o) => o.images !== undefined || o.focus !== undefined,
        )
      )
        throw Error(
          `${item.id}: images・focus は撮影から生成するため items.mjs には書けません`,
        );
      item.views = viewsOf(def, item).slice();
      for (const option of item.options ?? [])
        if (!option.noImage) {
          option.images = Object.fromEntries(
            item.views.map((v) => [
              v,
              captures?.[item.id]?.[v]?.images?.[option.id],
            ]),
          );
        }
    }
  const invalid = validate(def);
  if (invalid.length)
    throw Error(invalid.map((e) => `${e.path}: ${e.message}`).join("\n"));
  const declared = new Map(
    def.decisions.flatMap((d) => d.items.map((i) => [i.id, i])),
  );
  for (const [id, views] of Object.entries(captures)) {
    if (!declared.has(id)) throw Error(`${id}: 知らない撮影項目`);
    for (const [view, capture] of Object.entries(views)) {
      if (!declared.get(id).views.includes(view))
        throw Error(`${id}/${view}: 知らない撮影の見え方`);
      if (
        Object.keys(capture).some(
          (k) => !["guard", "images", "repeat", "regions"].includes(k),
        )
      )
        throw Error(`${id}/${view}: 知らない撮影キー`);
      for (const field of ["images", "repeat"])
        for (const option of Object.keys(capture[field] ?? {}))
          if (
            !declared.get(id).options.some((o) => o.id === option && !o.noImage)
          )
            throw Error(`${id}/${view}/${option}: 知らない撮影案`);
    }
  }
  const generated = { items: {}, views: [] },
    report = { schema: 1, comparisons: [], repeat: [], zooms: [], small: [] };
  const files = new Map(),
    crops = [];

    for (const decision of def.decisions)
      for (const item of decision.items) {
        const zooms = [];
        const options = item.options.filter((o) => !o.noImage);
        if (options.length < 2)
          throw Error(`${item.id}: 画素を比較できる案が 2 つ必要`);
        const baseline = options.find((o) => o.id === "cur") ?? options[0];
        item.focus ??= {};
        for (const view of item.views) {
          const capture = captures[item.id][view];
          const at = `${item.id} / ${view}`;
          const images = new Map();
          let size;
          for (const option of options) {
            const names = paths(capture.images[option.id]);
            const repeated = paths(capture.repeat?.[option.id]);
            if (!Array.isArray(repeated) || repeated.length !== names.length)
              throw Error(`${at} / ${option.id}: 撮り直し画像が不足`);
            const resolved = [];
            for (let n = 0; n < names.length; n++) {
              const file = resolveImage(names[n]),
                again = resolveImage(repeated[n]);
              if (file === again)
                throw Error(`${at}: 撮り直しは別ファイルが必要`);
              const measured = await tool.compare(file, again, null, 0);
              if (measured.pixels)
                throw Error(
                  `${at} / ${option.id}: 撮り直しで ${measured.pixels}px 違う`,
                );
              report.repeat.push({
                item: item.id,
                view,
                option: option.id,
                segment: n + 1,
                pixels: 0,
              });
              const nextSize = [measured.width, measured.height];
              if (size && (size[0] !== nextSize[0] || size[1] !== nextSize[1]))
                throw Error(`${at}: 画像の寸法が違う`);
              size = nextSize;
              const target = `images/${item.id}/${option.id}-${view}-${n + 1}${extension(file)}`;
              claim(target);
              files.set(target, file);
              resolved.push(file);
            }
            option.images[view] = names.map(
              (_, n) =>
                `images/${item.id}/${option.id}-${view}-${n + 1}${extension(resolved[n])}`,
            );
            images.set(option.id, resolved);
          }
          const [w, h] = size,
            guard = capture.guard;
          if (!validRect(guard, w, h))
            throw Error(`${at}: guard が無い・画像の外`);
          const shows = new Map(),
            firsts = new Map();
          for (let i = 0; i < options.length; i++)
            for (let j = i + 1; j < options.length; j++) {
              const a = options[i],
                b = options[j],
                x = images.get(a.id),
                y = images.get(b.id);
              const parts = [];
              for (let n = 0; n < Math.max(x.length, y.length); n++) {
                const diff = await tool.compare(
                  x[Math.min(n, x.length - 1)],
                  y[Math.min(n, y.length - 1)],
                  guard,
                );
                if (diff.outside)
                  throw Error(
                    `${at} / ${a.id}↔${b.id}: guard の外で ${diff.outside}px 違う`,
                  );
                parts.push(diff);
                report.comparisons.push({
                  item: item.id,
                  view,
                  pair: [a.id, b.id],
                  segment: n + 1,
                  guard,
                  ...diff,
                });
              }
              if (!parts.some((p) => p.show))
                throw Error(`${at} / ${a.id}↔${b.id}: 見える差が無い`);
              const worst = parts.reduce((a, b) =>
                a.pixels > b.pixels ? a : b,
              );
              if (worst.pixels < 2000 || worst.pixels / area(worst.show) < 0.05)
                report.small.push({
                  item: item.id,
                  view,
                  pair: [a.id, b.id],
                  pixels: worst.pixels,
                });
              if (a === baseline || b === baseline) {
                const other = a === baseline ? b : a;
                shows.set(other.id, union(parts.map((p) => p.show)));
                firsts.set(
                  other.id,
                  parts
                    .map((p) => p.first)
                    .filter(Boolean)
                    .sort((a, b) => a[1] - b[1] || a[0] - b[0])[0],
                );
              }
            }
          const show = union([...shows.values()]);
          shows.set(baseline.id, show);
          item.focus[view] = show;
          for (const option of options) {
            option.focus ??= {};
            option.focus[view] = shows.get(option.id);
          }
          const pad = (r) => {
            const x = Math.max(0, r[0] - 16),
              y = Math.max(0, r[1] - 16);
            return [
              x,
              y,
              Math.min(w, r[0] + r[2] + 16) - x,
              Math.min(h, r[1] + r[3] + 16) - y,
            ];
          };
          const regions = [];
          for (const region of capture.regions ?? []) {
            if (
              !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(region.name) ||
              typeof region.label !== "string" ||
              !region.label.trim() ||
              !validRect(region.rect, w, h)
            )
              throw Error(`${at}: 名指しの範囲が不正`);
            const rect = pad(region.rect);
            if (rect[2] > w / 2)
              throw Error(`${at}: 名指しの拡大の幅が元画像の半分を超える`);
            if (!intersection(show, rect))
              throw Error(`${at}: 名指しの拡大に変化が写らない`);
            regions.push({
              id: `${view}.${region.name}.zoom`,
              label: `${view} · ${region.label} · 拡大`,
              rect,
            });
          }
          const auto = pad(show);
          const same = (a, b) =>
            area(intersection(a, b)) /
              (area(a) + area(b) - area(intersection(a, b))) >=
            0.5;
          if (
            area(auto) < w * h * 0.25 &&
            auto[2] <= w / 2 &&
            !regions.some(
              (r) =>
                same(auto, r.rect) ||
                area(intersection(auto, pad(r.rect))) === area(auto),
            )
          )
            regions.push({
              id: `${view}.zoom`,
              label: `${view} · 拡大`,
              rect: auto,
            });
          for (let i = 0; i < regions.length; i++)
            for (let j = i + 1; j < regions.length; j++)
              if (same(regions[i].rect, regions[j].rect))
                throw Error(`${at}: 拡大が同じ範囲を重複して写す`);
          const recommended = options.find(
            (o) => o.recommended && o !== baseline,
          );
          if (regions.length && recommended) {
            const first = firsts.get(recommended.id);
            if (
              !regions.some(
                (r) => area(intersection(r.rect, first)) === area(first),
              )
            )
              throw Error(`${at}: 推奨案の変化の始まりが拡大に写らない`);
          }
          for (const region of regions) {
            if (item.views.includes(region.id) || zooms.includes(region.id))
              throw Error(`${at}: 拡大の id が重複`);
            if (!def.views.some((v) => v.id === region.id)) {
              def.views.push({ id: region.id, label: region.label });
              generated.views.push(region.id);
            }
            zooms.push(region.id);
            const shown = intersection(show, region.rect);
            item.focus[region.id] = [
              (shown[0] - region.rect[0]) * 2,
              (shown[1] - region.rect[1]) * 2,
              shown[2] * 2,
              shown[3] * 2,
            ];
            let visibleDifference = false;
            for (const option of options) {
              const refs = images.get(option.id),
                base = images.get(baseline.id);
              const zoomPaths = [];
              for (let n = 0; n < Math.max(refs.length, base.length); n++) {
                const diff = await tool.compare(
                  base[Math.min(n, base.length - 1)],
                  refs[Math.min(n, refs.length - 1)],
                  null,
                  16,
                  region.rect,
                );
                visibleDifference ||= Boolean(diff.show);
                if (n >= refs.length) continue;
                const target = `images/${item.id}/${option.id}-${region.id}-${n + 1}.png`;
                claim(target);
                crops.push({
                  target,
                  bytes: await tool.crop(refs[n], region.rect),
                });
                zoomPaths.push(target);
              }
              option.images[region.id] = zoomPaths;
              const own = intersection(shows.get(option.id), region.rect);
              if (own)
                option.focus[region.id] = [
                  (own[0] - region.rect[0]) * 2,
                  (own[1] - region.rect[1]) * 2,
                  own[2] * 2,
                  own[3] * 2,
                ];
            }
            if (!visibleDifference)
              throw Error(`${at}: 拡大 ${region.id} に差の画素が無い`);
            report.zooms.push({
              item: item.id,
              view,
              id: region.id,
              guard,
              show,
              crop: region.rect,
            });
          }
        }
        generated.items[item.id] = zooms;
        item.views = [...zooms, ...item.views];
      }
    const finalErrors = validate(def);
    if (finalErrors.length)
      throw Error(finalErrors.map((e) => `${e.path}: ${e.message}`).join("\n"));

    return { def, report, generated, files, crops };
  }
  return { prepare };
});
