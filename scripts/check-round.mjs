#!/usr/bin/env node
// Checks a round description before it is opened: the same validation as the
// board, plus that every image file exists and looks like its format. No dependencies.
//
//   node scripts/check-round.mjs <round.js>
//
// Exit 0 and one summary line when the round is sound; exit 1 and one line per problem otherwise.

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { runInNewContext } from "node:vm";

const require = createRequire(import.meta.url);
const { validate, listImages, digest } = require("../board/validate.js");

/** Runs a round file and returns what it passed to RulingBoard.define (or throws). */
export function readRound(file) {
  const calls = [];
  runInNewContext(
    readFileSync(file, "utf8"),
    { RulingBoard: { define: (def) => calls.push(def) } },
    { filename: file, timeout: 5000 },
  );
  if (calls.length !== 1)
    throw new Error(`RulingBoard.define が ${calls.length} 回呼ばれた`);
  return calls[0];
}

const SIGNATURES = {
  png: [[0, "89504e470d0a1a0a"]],
  jpg: [[0, "ffd8ff"]],
  jpeg: [[0, "ffd8ff"]],
  webp: [
    [0, "52494646"], // RIFF
    [8, "57454250"], // WEBP
  ],
};
const SVG_HEAD =
  /^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*|<!DOCTYPE[^>]*>\s*)*<svg[\s>]/;
const SVG_TAIL = /<\/svg>\s*$/;

/**
 * Not a parser: catches files that are not of their format, and SVGs cut short
 * (an <svg> root that is never closed), which a browser refuses to draw.
 */
export function looksLikeImage(file) {
  const bytes = readFileSync(file);
  const ext = file.slice(file.lastIndexOf(".") + 1).toLowerCase();
  if (ext === "svg") {
    const text = bytes.toString("utf8");
    return SVG_HEAD.test(text) && SVG_TAIL.test(text);
  }
  return SIGNATURES[ext].every(
    ([at, hex]) =>
      bytes.subarray(at, at + hex.length / 2).toString("hex") === hex,
  );
}

/** Returns every problem of a round file as { path, message }. */
export function checkRound(file) {
  let def;
  try {
    def = readRound(file);
  } catch (error) {
    return { errors: [{ path: file, message: error.message }] };
  }
  const errors = validate(def);
  if (errors.length > 0) return { errors };
  const base = dirname(file);
  const seen = new Set();
  for (const { path, at } of listImages(def)) {
    if (seen.has(path)) continue;
    seen.add(path);
    const target = resolve(base, path);
    if (!existsSync(target)) {
      errors.push({ path: at, message: `画像のファイルが無い：${path}` });
    } else if (!looksLikeImage(target)) {
      errors.push({ path: at, message: `画像として読めない：${path}` });
    }
  }
  return { errors, def };
}

function main(argv) {
  if (argv.length !== 1) {
    console.error("使い方: node scripts/check-round.mjs <round.js>");
    return 2;
  }
  const file = resolve(argv[0]);
  const { errors, def } = checkRound(file);
  if (errors.length > 0) {
    for (const e of errors) console.error(`${e.path}: ${e.message}`);
    return 1;
  }
  const items = def.decisions.reduce((n, d) => n + d.items.length, 0);
  const images = new Set(listImages(def).map((i) => i.path)).size;
  console.log(
    `ok ${def.round.id} · 記述 ${digest(def)} · 裁定点 ${def.decisions.length} · 項目 ${items} · 画像 ${images}`,
  );
  return 0;
}

if (import.meta.main) {
  process.exitCode = main(process.argv.slice(2));
}
