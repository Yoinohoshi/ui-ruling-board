#!/usr/bin/env node
// Packs a checked round folder into one HTML file (e.g. for a page host that
// takes a single file). The round's own locked board does the work, so the
// round keeps its board; boards before 0.4.0 cannot read a package and are refused.
//
//   node scripts/pack-round.mjs <回のフォルダ> <出力HTML>
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { checkFolder, json, localFile } from "./check-folder.mjs";

const require = createRequire(import.meta.url);
const { packageHtml } = require("../shared/package.js");
const TYPES = { ".png": "png", ".jpg": "jpeg", ".jpeg": "jpeg", ".webp": "webp", ".svg": "svg+xml" };

export async function pack(sourceDir, outputFile) {
  const dir = resolve(sourceDir),
    output = resolve(outputFile);
  const rel = relative(dir, output);
  if (!isAbsolute(rel) && rel.split(sep)[0] !== "..")
    throw Error("出力先は回のフォルダの外を指定してください");
  const lock = json(resolve(dir, "board.lock.json"));
  const [major, minor] = String(lock.version).split(".").map(Number);
  if (major === 0 && minor < 4)
    throw Error(`回の器 ${lock.version} は 1 枚の HTML を読めない（0.4.0 以降の器で作った回だけ束ねられる）`);
  const { errors, def, images } = await checkFolder(dir);
  if (errors.length) throw Error(errors.join("\n"));
  const assets = Object.fromEntries(
    images.map((name) => [name, `data:image/${TYPES[extname(name).toLowerCase()]};base64,${readFileSync(localFile(dir, name)).toString("base64")}`]),
  );
  const payload = { def, assets, lock };
  const envelope = { schema: 1, payload, sha256: createHash("sha256").update(JSON.stringify(payload)).digest("hex") };
  const read = (name) => readFileSync(localFile(dir, name), "utf8");
  const html = packageHtml({ html: read("index.html"), css: read("board.css"), validate: read("validate.js"), board: read("board.js") }, envelope);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, html);
  return { round: def.round.id, board: lock.version, images: images.length, bytes: Buffer.byteLength(html) };
}

if (import.meta.main) {
  if (process.argv.length !== 4) {
    console.error("使い方: node scripts/pack-round.mjs <回のフォルダ> <出力HTML>");
    process.exitCode = 2;
  } else
    try {
      const r = await pack(...process.argv.slice(2));
      console.log(`ok ${process.argv[3]} · ${r.round} · 器 ${r.board} · 画像 ${r.images} · ${(r.bytes / 1e6).toFixed(1)} MB`);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
}
