(function (factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else globalThis.RulingBoardPixels = api;
})(function () {
"use strict";
const union = (rects) => {
  const all = rects.filter(Boolean);
  if (!all.length) return null;
  const x = Math.min(...all.map((r) => r[0])),
    y = Math.min(...all.map((r) => r[1]));
  return [
    x,
    y,
    Math.max(...all.map((r) => r[0] + r[2])) - x,
    Math.max(...all.map((r) => r[1] + r[3])) - y,
  ];
};
const intersection = (a, b) => {
  const x = Math.max(a[0], b[0]),
    y = Math.max(a[1], b[1]);
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - x,
    h = Math.min(a[1] + a[3], b[1] + b[3]) - y;
  return w > 0 && h > 0 ? [x, y, w, h] : null;
};
const area = (r) => (r ? r[2] * r[3] : 0);
const validRect = (r, w, h) =>
  Array.isArray(r) &&
  r.length === 4 &&
  r.every(Number.isInteger) &&
  r[0] >= 0 &&
  r[1] >= 0 &&
  r[2] > 0 &&
  r[3] > 0 &&
  r[0] + r[2] <= w &&
  r[1] + r[3] <= h;


function compare(left, right, guard, noise = 16, within = null) {
            const w = left.canvas.width,
              h = left.canvas.height;
            if (w !== right.canvas.width || h !== right.canvas.height)
              throw Error("比較する画像の寸法が違う");
            const mask = new Uint8Array(w * h);
            let pixels = 0,
              outside = 0;
            const contains = (r, x, y) =>
              !r ||
              (x >= r[0] && y >= r[1] && x < r[0] + r[2] && y < r[1] + r[3]);
            for (let p = 0; p < mask.length; p++) {
              const x = p % w,
                y = Math.floor(p / w),
                offset = p * 4;
              if (!contains(within, x, y)) continue;
              if (
                [0, 1, 2, 3].some(
                  (n) => left.data[offset + n] !== right.data[offset + n],
                )
              ) {
                mask[p] = 1;
                pixels++;
                if (!contains(guard, x, y)) outside++;
              }
            }
            // Eight-connected components: isolated differences under 16 pixels do
            // not enlarge show, but still count as outside-guard differences.
            const components = [];
            for (let p = 0; p < mask.length; p++) {
              if (!mask[p]) continue;
              const queue = [p];
              mask[p] = 0;
              let x1 = w,
                y1 = h,
                x2 = 0,
                y2 = 0;
              for (let at = 0; at < queue.length; at++) {
                const pos = queue[at],
                  x = pos % w,
                  y = Math.floor(pos / w);
                x1 = Math.min(x1, x);
                y1 = Math.min(y1, y);
                x2 = Math.max(x2, x);
                y2 = Math.max(y2, y);
                for (let dy = -1; dy <= 1; dy++)
                  for (let dx = -1; dx <= 1; dx++) {
                    const nx = x + dx,
                      ny = y + dy,
                      next = ny * w + nx;
                    if (nx >= 0 && nx < w && ny >= 0 && ny < h && mask[next]) {
                      mask[next] = 0;
                      queue.push(next);
                    }
                  }
              }
              if (queue.length >= noise)
                components.push([x1, y1, x2 - x1 + 1, y2 - y1 + 1]);
            }
            let show = null;
            if (components.length) {
              const x = Math.min(...components.map((r) => r[0])),
                y = Math.min(...components.map((r) => r[1]));
              show = [
                x,
                y,
                Math.max(...components.map((r) => r[0] + r[2])) - x,
                Math.max(...components.map((r) => r[1] + r[3])) - y,
              ];
            }
            components.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
            return {
              pixels,
              outside,
              show,
              first: components[0] ?? null,
              width: w,
              height: h,
            };
}
return { union, intersection, area, validRect, compare };
});
