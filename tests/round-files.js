// Reads the example round, writes variants of it, and builds file:// URLs of the board.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const BOARD = path.join(ROOT, "board", "index.html");
const EXAMPLE = path.join(ROOT, "examples", "basic", "round.js");

const posix = (p) => p.split(path.sep).join("/");

/** What a round file passes to RulingBoard.define, as plain data. */
function readRound(file = EXAMPLE) {
  const calls = [];
  vm.runInNewContext(fs.readFileSync(file, "utf8"), {
    RulingBoard: { define: (def) => calls.push(def) },
  });
  return JSON.parse(JSON.stringify(calls[0]));
}

/** The board opened on a round file. */
function boardUrl(roundFile = EXAMPLE) {
  const rel = posix(path.relative(path.dirname(BOARD), roundFile));
  return `${pathToFileURL(BOARD).href}?round=${encodeURIComponent(rel)}`;
}

/** Writes def into the test's output folder; image paths keep pointing at the example's images. */
function writeRound(testInfo, def, name = "round.js") {
  const file = testInfo.outputPath(name);
  const prefix = posix(
    path.relative(path.dirname(file), path.dirname(EXAMPLE)),
  );
  const rebase = (p) => (typeof p === "string" ? `${prefix}/${p}` : p);
  const moved = structuredClone(def);
  if (moved.images) moved.images = rebase(moved.images);
  for (const decision of moved.decisions || []) {
    for (const item of decision.items || []) {
      for (const option of item.options || []) {
        for (const view of Object.keys(option.images || {})) {
          const value = option.images[view];
          option.images[view] = Array.isArray(value)
            ? value.map(rebase)
            : rebase(value);
        }
      }
    }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    `RulingBoard.define(${JSON.stringify(moved, null, 2)});\n`,
  );
  return file;
}

/** The item ids of a description, in description order. */
const itemIds = (def) => def.decisions.flatMap((d) => d.items.map((i) => i.id));

module.exports = {
  ROOT,
  BOARD,
  EXAMPLE,
  readRound,
  boardUrl,
  writeRound,
  itemIds,
};
