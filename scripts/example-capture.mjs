#!/usr/bin/env node
// Reproducible synthetic capture adapter. Replace this with your application's
// Playwright state setup/screenshots; the preparation/publication pipeline stays.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
export function exampleCapture(folder) {
  if (existsSync(folder))
    throw Error("撮影先は新しいフォルダを指定してください");
  const description = {
    schema: 1,
    round: {
      id: "workflow-r1",
      title: "配置の比較と発行",
      source: "synthetic · v1",
      answerTo: "https://example.com/reviews/1",
      created: "2026-10-19",
    },
    views: [
      { id: "1280", label: "1280" },
      { id: "390", label: "390" },
    ],
    decisions: [
      {
        id: "D1",
        title: "操作",
        items: [
          {
            id: "D1.1",
            title: "確定のボタン",
            question: "確定のボタンをどこに置くか",
            views: ["1280", "390"],
            options: [
              { id: "cur", label: "現在" },
              { id: "a", label: "右に寄せる", recommended: true },
              { id: "b", label: "左に強調", tags: ["見直し候補"] },
            ],
          },
          {
            id: "D1.2",
            title: "説明の文",
            question: "説明をホバーへ送るか",
            views: ["390"],
            options: [
              { id: "cur", label: "常に表示" },
              { id: "a", label: "ホバーへ", recommended: true },
              { id: "later", label: "別の案", noImage: true },
            ],
          },
        ],
      },
      {
        id: "D2",
        title: "選択",
        note: "選択は回答案。採用の記録は別に残す。",
        items: [
          {
            id: "D2.1",
            title: "選択中の色",
            question: "選択中の色を変えるか",
            views: ["1280"],
            options: [
              { id: "cur", label: "現在" },
              { id: "a", label: "濃い青", recommended: true },
            ],
          },
        ],
      },
    ],
  };
  const captures = {};
  const render = (width, option, segment) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="400"><rect width="100%" height="100%" fill="#f2f5fa"/><text x="24" y="30" font-family="sans-serif" font-size="18">Example ${segment + 1}</text><rect x="${option === "a" ? 110 : 32}" y="64" width="64" height="32" rx="4" fill="${option === "cur" ? "#64748b" : option === "a" ? "#1d4ed8" : "#166534"}"/><rect x="24" y="160" width="260" height="160" rx="8" fill="#fff"/></svg>`;
  mkdirSync(join(folder, "shots"), { recursive: true });
  for (const decision of description.decisions)
    for (const item of decision.items) {
      captures[item.id] = {};
      for (const view of item.views) {
        const shot = {
          guard: [24, 48, 164, 64],
          images: {},
          repeat: {},
          regions: [
            { name: "control", label: "操作部分", rect: [28, 58, 150, 44] },
          ],
        };
        captures[item.id][view] = shot;
        for (const option of item.options.filter((o) => !o.noImage)) {
          shot.images[option.id] = [];
          shot.repeat[option.id] = [];
          const segments = item.id === "D1.2" && option.id === "a" ? 2 : 1;
          for (let n = 0; n < segments; n++) {
            for (const pass of ["images", "repeat"]) {
              const name = `shots/${item.id}-${view}-${option.id}-${n + 1}-${pass}.svg`;
              // Labels outside guard remain identical even in the second segment.
              writeFileSync(
                join(folder, name),
                render(Number(view), option.id, 0),
              );
              shot[pass][option.id].push(name);
            }
          }
        }
      }
    }
  writeFileSync(
    join(folder, "items.mjs"),
    `export const description = ${JSON.stringify(description, null, 2)};\n`,
  );
  writeFileSync(
    join(folder, "captures.json"),
    JSON.stringify(captures, null, 2) + "\n",
  );
  return description;
}
if (import.meta.main) {
  if (process.argv.length !== 3) {
    console.error("使い方: node scripts/example-capture.mjs <新しい撮影先>");
    process.exitCode = 2;
  } else
    try {
      exampleCapture(resolve(process.argv[2]));
      console.log(`ok ${process.argv[2]}`);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
}
