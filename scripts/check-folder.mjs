#!/usr/bin/env node
// The publication contract: locked board, complete images, authored order and
// explicit generated views. Works with schema-1 rounds, including older boards.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import { FILES } from "./install.mjs";
import { readRound, looksLikeImage } from "./check-round.mjs";

export const hash = (file) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");
export const json = (file) => JSON.parse(readFileSync(file, "utf8"));
export const walk = (dir) =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? walk(join(dir, entry.name))
          : [join(dir, entry.name)],
      )
    : [];

/** Publication assets must stay in the round, including after resolving symlinks. */
export function localFile(dir, name) {
  if (typeof name !== "string" || /[\\?#%]|^[a-z][a-z0-9+.-]*:|^\//i.test(name))
    throw Error(`配布内の相対パスではない: ${name}`);
  const file = resolve(dir, name);
  const inside = (root, target) => {
    const rel = relative(root, target);
    return (
      rel !== ".." && !rel.startsWith(`..${sep}`) && !/^[A-Za-z]:/.test(rel)
    );
  };
  if (
    !inside(resolve(dir), file) ||
    !inside(realpathSync(dir), realpathSync(file))
  )
    throw Error(`配布フォルダの外を指す: ${name}`);
  return file;
}

export function lockProblems(dir, release = false) {
  const errors = [];
  let lock;
  try {
    lock = json(join(dir, "board.lock.json"));
  } catch {
    return ["board.lock.json を読めない"];
  }
  if (lock?.name !== "ui-ruling-board")
    errors.push("錠の name が ui-ruling-board ではない");
  if (!/^\d+\.\d+\.\d+$/.test(lock?.version))
    errors.push("錠の version が不正");
  if (release && !/^[a-f0-9]{40}$/.test(lock?.commit ?? ""))
    errors.push("発行する器の commit は変更なしの全桁 SHA が必須");
  for (const name of new Set([...FILES, ...Object.keys(lock?.files ?? {})])) {
    if (!FILES.includes(name)) errors.push(`${name}: 器のファイルではない`);
    else if (!/^[a-f0-9]{64}$/.test(lock?.files?.[name] ?? ""))
      errors.push(`${name}: 錠のハッシュが無い・不正`);
    else {
      try {
        if (hash(localFile(dir, name)) !== lock.files[name])
          errors.push(`${name}: 錠と違う`);
      } catch (error) {
        errors.push(`${name}: ${error.message}`);
      }
    }
  }
  if (!errors.length) {
    const version = /const VERSION = "([^"]+)";/.exec(
      readFileSync(join(dir, "board.js"), "utf8"),
    )?.[1];
    if (version !== lock.version) errors.push("board.js と錠の version が違う");
  }
  return errors;
}

/** Remove only declared generated fields; authored option focus stays authoritative. */
export function sourceProblems(
  def,
  source,
  generated = { items: {}, views: [] },
) {
  const errors = [];
  if (
    !generated ||
    !Array.isArray(generated.views) ||
    !generated.items ||
    typeof generated.items !== "object"
  )
    return ["generated.json の形が不正"];
  const actual = structuredClone(def);
  const expected = structuredClone(source);
  const sourceItems = new Map(
    expected.decisions.flatMap((d) => d.items.map((i) => [i.id, i])),
  );
  const actualItems = new Map(
    actual.decisions.flatMap((d) => d.items.map((i) => [i.id, i])),
  );
  const checkAdded = (added, original, result, where) => {
    if (!Array.isArray(added) || new Set(added).size !== added.length) {
      errors.push(`${where}: 生成の一覧が不正`);
      return [];
    }
    for (const id of added) {
      if (original.includes(id))
        errors.push(`${where}: ${id} は正本に宣言済み`);
      if (!result.includes(id))
        errors.push(`${where}: ${id} が round.js に無い`);
    }
    return added;
  };
  const added = checkAdded(
    generated.views,
    expected.views.map((v) => v.id),
    actual.views.map((v) => v.id),
    "views",
  );
  actual.views = actual.views.filter((v) => !added.includes(v.id));
  for (const [id, views] of Object.entries(generated.items)) {
    const item = actualItems.get(id),
      src = sourceItems.get(id);
    if (!item || !src) {
      errors.push(`${id}: 知らない生成項目`);
      continue;
    }
    const removed = checkAdded(
      views,
      src.views ?? expected.views.map((v) => v.id),
      item.views ?? [],
      id,
    );
    if (
      removed.length &&
      !isDeepStrictEqual(item.views?.slice(0, removed.length), removed)
    )
      errors.push(`${id}: 生成した拡大が項目の先頭に無い・並びが違う`);
    if (item.views) item.views = item.views.filter((v) => !removed.includes(v));
    if (
      !src.views &&
      isDeepStrictEqual(
        item.views,
        expected.views.map((v) => v.id),
      )
    )
      delete item.views;
  }
  // Image mappings/focus are generated unless explicitly authored in items.mjs.
  if (expected.images === undefined) delete actual.images;
  for (const [id, item] of actualItems) {
    const src = sourceItems.get(id);
    if (!src) continue;
    if (src.focus === undefined) delete item.focus;
    for (const opt of item.options) {
      const original = src.options.find((o) => o.id === opt.id);
      if (original?.images === undefined) delete opt.images;
      if (original?.focus === undefined) delete opt.focus;
    }
  }
  const compare = (a, b, where) => {
    if (isDeepStrictEqual(a, b)) return;
    if (
      a &&
      b &&
      typeof a === "object" &&
      typeof b === "object" &&
      Array.isArray(a) === Array.isArray(b)
    ) {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)]))
        compare(a[key], b[key], `${where}.${key}`);
    } else errors.push(`${where}: items.mjs と round.js が違う`);
  };
  compare(expected, actual, "記述");
  return errors;
}

export async function checkFolder(dir, { release = false } = {}) {
  dir = resolve(dir);
  const errors = lockProblems(dir, release);
  if (errors.length) return { errors };
  try {
    const sandbox = { module: { exports: {} } };
    runInNewContext(readFileSync(join(dir, "validate.js"), "utf8"), sandbox, {
      timeout: 5000,
    });
    const validator = sandbox.module.exports;
    const def = readRound(join(dir, "round.js"));
    errors.push(
      ...validator.validate(def).map((e) => `${e.path}: ${e.message}`),
    );
    if (errors.length) return { errors };
    const images = [...new Set(validator.listImages(def).map((i) => i.path))];
    for (const name of images) {
      try {
        if (!looksLikeImage(localFile(dir, name)))
          errors.push(`画像として読めない: ${name}`);
      } catch (error) {
        errors.push(`${name}: ${error.message}`);
      }
    }
    const referenced = new Set(images.map((name) => resolve(dir, name)));
    for (const file of walk(join(dir, "images")))
      if (!referenced.has(resolve(file)))
        errors.push(
          `記述が指さない画像: ${relative(dir, file).split(sep).join("/")}`,
        );
    if (existsSync(join(dir, "items.mjs"))) {
      const { description } = await import(
        pathToFileURL(join(dir, "items.mjs")).href + `?check=${Date.now()}`
      );
      const generated = existsSync(join(dir, "generated.json"))
        ? json(join(dir, "generated.json"))
        : undefined;
      errors.push(
        ...sourceProblems(
          JSON.parse(JSON.stringify(def)),
          description,
          generated,
        ),
      );
    } else if (existsSync(join(dir, "generated.json")))
      errors.push("generated.json があるが items.mjs が無い");
    if (existsSync(join(dir, "publication.json"))) {
      const manifest = json(join(dir, "publication.json"));
      if (
        manifest?.schema !== 1 ||
        manifest.round !== def.round.id ||
        manifest.board !== json(join(dir, "board.lock.json")).version
      )
        errors.push("publication.json の schema・round・board が不一致");
      const required = [...FILES, "board.lock.json", "round.js", ...images];
      for (const name of new Set([
        ...required,
        ...Object.keys(manifest.files ?? {}),
      ])) {
        if (!manifest.files?.[name])
          errors.push(`publication.json に無い: ${name}`);
        else if (hash(localFile(dir, name)) !== manifest.files[name])
          errors.push(`発行後に変更された: ${name}`);
      }
    }
    return { errors, def, images };
  } catch (error) {
    return { errors: [...errors, error.message] };
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2),
    dirs = args.filter((a) => !a.startsWith("--"));
  if (
    dirs.length !== 1 ||
    args.some((a) => a.startsWith("--") && a !== "--release")
  ) {
    console.error(
      "使い方: node scripts/check-folder.mjs <回のフォルダ> [--release]",
    );
    process.exitCode = 2;
  } else {
    const { errors, def, images } = await checkFolder(dirs[0], {
      release: args.includes("--release"),
    });
    if (errors.length) {
      console.error(errors.join("\n"));
      process.exitCode = 1;
    } else
      console.log(
        `ok ${def.round.id} · 裁定点 ${def.decisions.length} · 項目 ${def.decisions.reduce((n, d) => n + d.items.length, 0)} · 画像 ${images.length}`,
      );
  }
}
