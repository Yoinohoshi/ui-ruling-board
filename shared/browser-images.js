// Input assets are explicitly selected files/data, never fetched URLs.
(function () {
  "use strict";
  const DATA = /^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/;
  function imageTools(assets) {
    const loaded = new Map();
    const load = async name => {
      if (loaded.has(name)) return loaded.get(name);
      if (!Object.hasOwn(assets, name) || !DATA.test(assets[name])) throw Error(`画像が無い・形式が不正: ${name}`);
      const image = new Image();
      image.src = assets[name];
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      if (!canvas.width || !canvas.height || canvas.width * canvas.height > 40000000) throw Error(`画像が大きすぎる: ${name}`);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(image, 0, 0);
      const result = { canvas, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data };
      loaded.set(name, result);
      return result;
    };
    return {
      async compare(a, b, guard, noise = 16, within = null) {
        return globalThis.RulingBoardPixels.compare(await load(a), await load(b), guard, noise, within);
      },
      async crop(name, rect) {
        const source = await load(name), canvas = document.createElement("canvas");
        canvas.width = rect[2] * 2; canvas.height = rect[3] * 2;
        const ctx = canvas.getContext("2d");
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(source.canvas, ...rect, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL("image/png");
      },
    };
  }
  globalThis.RulingBoardBrowserImages = { imageTools, DATA };
})();
