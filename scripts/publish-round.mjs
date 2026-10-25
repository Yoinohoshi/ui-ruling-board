#!/usr/bin/env node
// Produces a self-contained, verified folder for sharing; no network publication.
// Only a strict allowlist is copied, never the author's capture scripts or secrets.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { FILES } from "./install.mjs";
import { checkFolder, hash, json, localFile, walk } from "./check-folder.mjs";
import { verifyBoard } from "./verify-board.mjs";

export async function publish(sourceDir, outputDir) {
  const source = resolve(sourceDir),
    output = resolve(outputDir),
    staging = `${output}.preparing`;
  if (existsSync(output) || existsSync(staging))
    throw Error("出力先・.preparing は新しいフォルダを指定してください");
  const { errors, def, images } = await checkFolder(source, { release: true });
  if (errors.length) throw Error(errors.join("\n"));
  // Check the source in its final browser environment before writing anything.
  await verifyBoard(source);
  const names = [
    ...new Set([...FILES, "board.lock.json", "round.js", ...images]),
  ];
  const reserved = new Set([
    ...FILES,
    "board.lock.json",
    "round.js",
    "items.mjs",
    "generated.json",
    "evidence.json",
    "publication.json",
  ]);
  for (const name of images)
    if (reserved.has(name))
      throw Error(`画像が予約ファイル名を使っている: ${name}`);
  const contents = new Map(
    names.map((name) => [name, hash(localFile(source, name))]),
  );
  for (const name of ["generated.json", "evidence.json"])
    if (existsSync(join(source, name))) names.push(name);
  mkdirSync(staging, { recursive: true });
  for (const name of names) {
    const from = localFile(source, name),
      to = resolve(staging, name);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
    if (contents.has(name) && hash(to) !== contents.get(name))
      throw Error(`検査中に変更された: ${name}`);
  }
  if (existsSync(join(source, "items.mjs"))) {
    const { description } = await import(
      pathToFileURL(join(source, "items.mjs")).href
    );
    // Flatten imports so the publication is independent of the author's tree.
    writeFileSync(
      join(staging, "items.mjs"),
      `export const description = ${JSON.stringify(description, null, 2)};\n`,
    );
  }
  const manifest = {
    schema: 1,
    round: def.round.id,
    board: json(join(staging, "board.lock.json")).version,
    files: Object.fromEntries(
      walk(staging)
        .sort()
        .map((file) => [
          file.slice(staging.length + 1).replaceAll("\\", "/"),
          hash(file),
        ]),
    ),
  };
  writeFileSync(
    join(staging, "publication.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  const checked = await checkFolder(staging, { release: true });
  if (checked.errors.length) throw Error(checked.errors.join("\n"));
  await verifyBoard(staging);
  // No partially checked folder gets the requested publication name. Failed
  // staging is retained for diagnosis; a subsequent run never overwrites it.
  renameSync(staging, output);
  return manifest;
}

if (import.meta.main) {
  if (process.argv.length !== 4) {
    console.error(
      "使い方: node scripts/publish-round.mjs <回のフォルダ> <新しい配布先>",
    );
    process.exitCode = 2;
  } else
    try {
      const manifest = await publish(...process.argv.slice(2));
      console.log(
        `ok ${process.argv[3]} · ${manifest.round} · ${Object.keys(manifest.files).length} ファイル`,
      );
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
}
