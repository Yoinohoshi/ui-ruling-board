#!/usr/bin/env node
// Creates a portable offline authoring HTML. Runtime templates are embedded as
// inert JSON, and no user project/capture is part of the build input.
import { readFileSync, writeFileSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const root = fileURLToPath(new URL("../", import.meta.url));
const read = name => readFileSync(resolve(root, name), "utf8").replaceAll("\r\n", "\n");
const hash = value => createHash("sha256").update(value).digest("hex");
const inputs = ["author/index.html", "author/author.css", "author/author.js", "board/index.html", "board/board.css", "board/board.js", "board/validate.js", "shared/pixels.js", "shared/prepare.js", "shared/browser-images.js", "shared/seal.js", "scripts/build-author.mjs"];
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
export function buildAuthor(output) {
  let commit = null, dirty = true;
  try {
    if (realpathSync(git("rev-parse", "--show-toplevel")).toLowerCase() !== realpathSync(root).toLowerCase()) throw Error("not the repository root");
    git("ls-files", "--error-unmatch", "--", ...inputs);
    commit = git("rev-parse", "HEAD");
    dirty = Boolean(git("status", "--porcelain", "--", ...inputs));
  } catch { /* Unknown/untracked templates may preview but may not publish. */ }
  const source = { commit, dirty, files: Object.fromEntries(inputs.map(name => [name, hash(read(name))])) };
  const board = read("board/board.js");
  const template = { version: /const VERSION = "([^"]+)"/.exec(board)[1], html: read("board/index.html"), css: read("board/board.css"), board, validate: read("board/validate.js"), seal: read("shared/seal.js"), source };
  const scripts = ["board/validate.js", "shared/pixels.js", "shared/prepare.js", "shared/browser-images.js", "shared/seal.js", "author/author.js"].map(name => `<script>${read(name).replace(/<\/script/gi, "<\\/script")}</script>`).join("\n");
  const html = read("author/index.html").replace("/*AUTHOR_CSS*/", () => read("author/author.css")).replace("/*BOARD_TEMPLATE*/", () => JSON.stringify(template).replaceAll("<", "\\u003c")).replace("<!--AUTHOR_SCRIPTS-->", () => scripts);
  const target = resolve(output);
  if (inputs.some(name => target.toLowerCase() === resolve(root, name).toLowerCase())) throw Error("生成元を上書きできません");
  mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, html);
  return { output: target, ...source, bytes: Buffer.byteLength(html) };
}
if (import.meta.main) {
  if (process.argv.length > 3) throw Error("使い方: node scripts/build-author.mjs [出力HTML]");
  const result = buildAuthor(process.argv[2] ?? resolve(root, "artifacts/author.html"));
  console.log(`${result.output} · ${result.bytes} bytes · ${result.dirty ? "開発版（プレビューのみ）" : result.commit}`);
}
