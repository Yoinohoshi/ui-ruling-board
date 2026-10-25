const fs = require("node:fs");
const { test, expect } = require("@playwright/test");

test("show の孤立雑音除去は guard 外と撮り直しの判定を弱めない", async () => {
  const { imageTools } = await import("../scripts/image-tools.mjs");
  const tool = await imageTools();
  try {
    const before = test.info().outputPath("before.svg"),
      after = test.info().outputPath("after.svg");
    fs.mkdirSync(test.info().outputDir, { recursive: true });
    const svg = (extra) =>
      `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="white"/>${extra}</svg>`;
    fs.writeFileSync(before, svg(""));
    fs.writeFileSync(
      after,
      svg(
        '<rect x="10" y="10" width="4" height="4" fill="black"/><rect x="70" y="70" width="1" height="1" fill="black"/>',
      ),
    );
    const diff = await tool.compare(before, after, [0, 0, 20, 20]);
    expect(diff.pixels).toBe(17);
    expect(diff.outside).toBe(1);
    expect(diff.show).toEqual([10, 10, 4, 4]);
    expect(diff.first).toEqual([10, 10, 4, 4]);
    const repeat = await tool.compare(before, after, null, 0);
    expect(repeat.show).toEqual([10, 10, 61, 61]);
    const crop = await tool.compare(before, after, null, 16, [0, 0, 20, 20]);
    expect(crop.pixels).toBe(16);
    const same = await tool.compare(before, before, null, 0);
    expect(same.pixels).toBe(0);
    expect(same.show).toBeNull();
  } finally {
    await tool.close();
  }
});
