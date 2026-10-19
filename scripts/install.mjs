#!/usr/bin/env node
// Copies the board into a round folder and writes board.lock.json, or checks
// that the copies in a round folder still match their lock. No dependencies.
//
//   node scripts/install.mjs <round folder>           copy the board and write the lock
//   node scripts/install.mjs <round folder> --force   the same over an existing lock
//   node scripts/install.mjs --check <round folder>   exit 1 when a copy differs from the lock

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BOARD = join(ROOT, "board");
export const FILES = ["index.html", "board.js", "board.css", "validate.js"];
const LOCK = "board.lock.json";

const sha256 = (file) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

function version() {
  const match = /const VERSION = "([^"]+)";/.exec(
    readFileSync(join(BOARD, "board.js"), "utf8"),
  );
  if (!match) throw new Error("board.js に VERSION が無い");
  return match[1];
}

function commit() {
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  try {
    const sha = git("rev-parse", "HEAD");
    return git("status", "--porcelain", "--", "board") ? `${sha}-dirty` : sha;
  } catch {
    return null;
  }
}

export function install(dir, force = false) {
  const lockFile = join(dir, LOCK);
  if (dir === BOARD) {
    console.error("器のフォルダそのものには入れない");
    return 1;
  }
  if (existsSync(lockFile) && !force) {
    console.error(`${lockFile} がある（入れ直すときは --force）`);
    return 1;
  }
  mkdirSync(dir, { recursive: true });
  const files = {};
  for (const name of FILES) {
    copyFileSync(join(BOARD, name), join(dir, name));
    files[name] = sha256(join(dir, name));
  }
  const lock = {
    name: "ui-ruling-board",
    version: version(),
    commit: commit(),
    files,
  };
  writeFileSync(lockFile, `${JSON.stringify(lock, null, 2)}\n`);
  console.log(`ok ${dir} · ${lock.version} · ${lock.commit ?? "commit 不明"}`);
  return 0;
}

function check(dir) {
  const lockFile = join(dir, LOCK);
  let lock;
  try {
    lock = JSON.parse(readFileSync(lockFile, "utf8"));
  } catch {
    console.error(`${lockFile} を読めない`);
    return 1;
  }
  const problems = [];
  const listed = Object.keys(lock.files || {});
  for (const name of FILES) {
    if (!listed.includes(name)) problems.push(`${name}: 錠に無い`);
  }
  for (const name of listed) {
    if (!FILES.includes(name)) problems.push(`${name}: 器のファイルではない`);
    else if (!existsSync(join(dir, name)))
      problems.push(`${name}: ファイルが無い`);
    else if (sha256(join(dir, name)) !== lock.files[name])
      problems.push(`${name}: 錠と違う`);
  }
  if (problems.length > 0) {
    for (const p of problems) console.error(p);
    return 1;
  }
  console.log(`ok ${dir} · ${lock.version}`);
  return 0;
}

function main(argv) {
  const flags = argv.filter((a) => a.startsWith("--"));
  const dirs = argv.filter((a) => !a.startsWith("--"));
  const unknown = flags.filter((f) => f !== "--check" && f !== "--force");
  if (
    dirs.length !== 1 ||
    unknown.length > 0 ||
    (flags.includes("--check") && flags.includes("--force"))
  ) {
    console.error(
      "使い方: node scripts/install.mjs <回のフォルダ> [--force] | --check <回のフォルダ>",
    );
    return 2;
  }
  const dir = resolve(dirs[0]);
  return flags.includes("--check")
    ? check(dir)
    : install(dir, flags.includes("--force"));
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
