/*
 * ui-ruling-board — the round description (schema 1).
 *
 * One file for the board (a classic script in the browser) and for
 * scripts/check-round.mjs (Node): validation, image paths and the digest.
 */
(function (factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else globalThis.RulingBoardValidate = api;
})(function () {
  "use strict";

  const SCHEMA = 1;
  const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
  const IMAGE = /\.(png|jpe?g|webp|svg)$/i;
  const NOT_RELATIVE = /^[a-z][a-z0-9+.-]*:|^[\\/]|\\/i;
  const SLOT = /\{([^}]*)\}/g;
  const SLOTS = ["decision", "item", "option", "view"];
  const KEYS = {
    top: ["schema", "round", "views", "images", "decisions"],
    round: ["id", "title", "answerTo", "source", "created"],
    view: ["id", "label"],
    decision: ["id", "title", "note", "items"],
    item: ["id", "title", "question", "views", "focus", "options"],
    option: ["id", "label", "recommended", "tags", "images", "noImage"],
  };

  const isObject = (v) =>
    typeof v === "object" && v !== null && !Array.isArray(v);
  const isText = (v) => typeof v === "string" && v.trim() !== "";
  const isRect = (r) =>
    Array.isArray(r) &&
    r.length === 4 &&
    r.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0) &&
    r[2] > 0 &&
    r[3] > 0;
  const at = (path, key) => (path ? `${path}.${key}` : key);

  /** Returns every problem as { path, message }. An empty list means the round can be drawn. */
  function validate(def) {
    const errors = [];
    const fail = (path, message) => errors.push({ path, message });

    const record = (value, path, kind) => {
      if (!isObject(value)) {
        fail(path || "(記述)", "オブジェクトではない");
        return false;
      }
      for (const key of Object.keys(value)) {
        if (!KEYS[kind].includes(key)) fail(at(path, key), "知らないキー");
      }
      return true;
    };
    const text = (obj, key, path, required) => {
      if (obj[key] === undefined) {
        if (required) fail(at(path, key), "必須");
      } else if (!isText(obj[key])) {
        fail(at(path, key), "空でない文字列ではない");
      }
    };
    const list = (obj, key, path, min) => {
      const value = obj[key];
      if (!Array.isArray(value)) {
        fail(at(path, key), value === undefined ? "必須" : "配列ではない");
        return [];
      }
      if (value.length < min) fail(at(path, key), `${min} つ以上が必須`);
      return value;
    };
    const ident = (obj, path, taken) => {
      const id = obj.id;
      if (typeof id !== "string" || !ID.test(id)) {
        fail(
          at(path, "id"),
          id === undefined ? "必須" : "英数字と . _ - の id ではない",
        );
      } else if (taken.has(id)) {
        fail(at(path, "id"), `id「${id}」が重複`);
      } else {
        taken.add(id);
      }
    };
    const imagePath = (value, path) => {
      if (typeof value !== "string" || value === "") {
        fail(path, "パスの文字列ではない");
        return;
      }
      if (NOT_RELATIVE.test(value))
        fail(path, "記述のフォルダからの相対パスではない");
      if (!IMAGE.test(value)) fail(path, "png・jpg・webp・svg ではない");
    };

    if (!record(def, "", "top")) return errors;
    if (def.schema !== SCHEMA) {
      fail("schema", `知らない版（器が知るのは ${SCHEMA}）`);
      return errors;
    }

    if (record(def.round, "round", "round")) {
      ident(def.round, "round", new Set());
      text(def.round, "title", "round", true);
      for (const key of ["answerTo", "source", "created"]) {
        text(def.round, key, "round", false);
      }
    }

    const viewIds = new Set();
    list(def, "views", "", 1).forEach((view, i) => {
      const path = `views[${i}]`;
      if (!record(view, path, "view")) return;
      ident(view, path, viewIds);
      text(view, "label", path, true);
    });

    if (def.images !== undefined) {
      if (typeof def.images === "string") {
        for (const [, slot] of def.images.matchAll(SLOT)) {
          if (!SLOTS.includes(slot))
            fail("images", `知らない差し込み「{${slot}}」`);
        }
      }
      imagePath(def.images, "images");
    }

    const decisionIds = new Set();
    const itemIds = new Set();

    const checkItem = (item, path) => {
      if (!record(item, path, "item")) return;
      ident(item, path, itemIds);
      text(item, "title", path, true);
      text(item, "question", path, true);

      let views = [...viewIds];
      if (item.views !== undefined) {
        views = [];
        list(item, "views", path, 1).forEach((view, k) => {
          const vp = `${path}.views[${k}]`;
          if (!viewIds.has(view)) fail(vp, `知らない見え方「${view}」`);
          else if (views.includes(view)) fail(vp, `見え方「${view}」が重複`);
          else views.push(view);
        });
      }
      const inViews = (view, p) => {
        if (!views.includes(view)) fail(p, `この項目に無い見え方「${view}」`);
      };

      if (item.focus !== undefined) {
        if (!isObject(item.focus)) {
          fail(`${path}.focus`, "オブジェクトではない");
        } else {
          for (const [view, rect] of Object.entries(item.focus)) {
            inViews(view, `${path}.focus.${view}`);
            if (!isRect(rect))
              fail(`${path}.focus.${view}`, "[x, y, 幅, 高さ] ではない");
          }
        }
      }

      const optionIds = new Set();
      let recommended = 0;
      const options = list(item, "options", path, 2);
      options.forEach((option, k) => {
        const op = `${path}.options[${k}]`;
        if (!record(option, op, "option")) return;
        ident(option, op, optionIds);
        text(option, "label", op, true);
        if (option.recommended !== undefined) {
          if (typeof option.recommended !== "boolean") {
            fail(`${op}.recommended`, "true か false ではない");
          } else if (option.recommended) {
            recommended += 1;
          }
        }
        if (
          option.tags !== undefined &&
          !(Array.isArray(option.tags) && option.tags.every(isText))
        ) {
          fail(`${op}.tags`, "空でない文字列の配列ではない");
        }
        if (option.noImage !== undefined && option.noImage !== true) {
          fail(`${op}.noImage`, "true だけを書ける");
        }
        if (option.images !== undefined) {
          if (option.noImage === true)
            fail(`${op}.images`, "noImage と同時に書けない");
          if (!isObject(option.images)) {
            fail(`${op}.images`, "オブジェクトではない");
            return;
          }
          for (const [view, value] of Object.entries(option.images)) {
            const ip = `${op}.images.${view}`;
            inViews(view, ip);
            if (typeof value === "string") imagePath(value, ip);
            else if (Array.isArray(value) && value.length > 0) {
              value.forEach((p, n) => imagePath(p, `${ip}[${n}]`));
            } else fail(ip, "パスか、パスの配列ではない");
          }
        }
        if (option.noImage !== true) {
          for (const view of views) {
            const explicit =
              isObject(option.images) && option.images[view] !== undefined;
            if (!explicit && def.images === undefined) {
              fail(op, `見え方「${view}」の画像が無い`);
            }
          }
        }
      });
      if (recommended > 1) {
        fail(
          `${path}.options`,
          `推奨が ${recommended} つ（1 項目に 1 つまで）`,
        );
      }
      if (
        options.length > 0 &&
        options.every((o) => isObject(o) && o.noImage === true)
      ) {
        fail(`${path}.options`, "画像のある案が無い");
      }
    };

    list(def, "decisions", "", 1).forEach((decision, i) => {
      const path = `decisions[${i}]`;
      if (!record(decision, path, "decision")) return;
      ident(decision, path, decisionIds);
      text(decision, "title", path, true);
      if (decision.note !== undefined && typeof decision.note !== "string") {
        fail(`${path}.note`, "文字列ではない");
      }
      list(decision, "items", path, 1).forEach((item, j) =>
        checkItem(item, `${path}.items[${j}]`),
      );
    });

    return errors;
  }

  /* The helpers below assume a description that passed validate(). */

  /** The views of an item, in display order. */
  function viewsOf(def, item) {
    return item.views || def.views.map((v) => v.id);
  }

  /** The image paths (segments, top to bottom) of one option in one view, relative to the round file. */
  function imagesOf(def, decision, item, option, view) {
    if (option.noImage) return [];
    const explicit = option.images && option.images[view];
    if (explicit !== undefined) {
      return typeof explicit === "string" ? [explicit] : explicit.slice();
    }
    const ids = {
      decision: decision.id,
      item: item.id,
      option: option.id,
      view,
    };
    return [def.images.replace(SLOT, (_, slot) => ids[slot])];
  }

  /** Every image the round refers to, with where it is used. */
  function listImages(def) {
    const out = [];
    for (const decision of def.decisions) {
      for (const item of decision.items) {
        for (const option of item.options) {
          for (const view of viewsOf(def, item)) {
            for (const path of imagesOf(def, decision, item, option, view)) {
              out.push({ path, at: `${item.id} / ${option.id} / ${view}` });
            }
          }
        }
      }
    }
    return out;
  }

  const stable = (v) => {
    if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
    if (isObject(v)) {
      return `{${Object.keys(v)
        .filter((k) => v[k] !== undefined)
        .sort()
        .map((k) => `${JSON.stringify(k)}:${stable(v[k])}`)
        .join(",")}}`;
    }
    return JSON.stringify(v) ?? "null";
  };

  /**
   * FNV-1a (32 bit) of the description written with sorted keys.
   * Not tamper-proof: it only keeps a draft from being restored into a different round.
   */
  function digest(def) {
    const s = stable(def);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  }

  return { SCHEMA, validate, viewsOf, imagesOf, listImages, digest };
});
