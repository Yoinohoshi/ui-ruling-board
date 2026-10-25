// Password sealing of the single-HTML package. The author page seals, the board
// opens; both use this file so the parameters cannot drift. Strength is bounded
// by the password: a distributed file can be guessed offline without limit.
(function () {
  "use strict";
  const KDF = "PBKDF2-SHA-256", CIPHER = "AES-256-GCM", ITERATIONS = 600000, COMPRESSION = "gzip";
  // The compression is bound into the authenticated data, so it cannot be switched off unnoticed.
  // Packages sealed before compression carry no field and keep the original data.
  const aad = compression => new TextEncoder().encode(`ui-ruling-board:sealed:1${compression ? `:${compression}` : ""}`);
  // Native base64 is ~60x faster than the char-code fallback on a 40 MB package.
  const toBase64 = bytes => {
    if (bytes.toBase64) return bytes.toBase64();
    let binary = ""; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(binary);
  };
  const fromBase64 = text => {
    if (Uint8Array.fromBase64) return Uint8Array.fromBase64(text);
    const binary = atob(text), bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  };
  const pipe = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
  async function key(password, salt, iterations, usage) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, base, { name: "AES-GCM", length: 256 }, false, [usage]);
  }
  async function seal(text, password) {
    if (!password) throw Error("パスワードが空です");
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const packed = await pipe(new TextEncoder().encode(text), new CompressionStream(COMPRESSION));
    const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(COMPRESSION) }, await key(password, salt, ITERATIONS, "encrypt"), packed));
    return { kdf: KDF, cipher: CIPHER, compression: COMPRESSION, iterations: ITERATIONS, salt: toBase64(salt), iv: toBase64(iv), data: toBase64(data) };
  }
  // Rejects a wrong password and any altered byte alike (GCM cannot tell them apart).
  async function open(sealed, password) {
    if (sealed?.kdf !== KDF || sealed.cipher !== CIPHER || ![undefined, COMPRESSION].includes(sealed.compression) || !Number.isInteger(sealed.iterations) || sealed.iterations < ITERATIONS) throw Error("暗号の形式が不正");
    let plain;
    try { plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(sealed.iv), additionalData: aad(sealed.compression) }, await key(password, fromBase64(sealed.salt), sealed.iterations, "decrypt"), fromBase64(sealed.data))); }
    catch { throw Error("パスワードが違うか、データが壊れています"); }
    if (sealed.compression) plain = await pipe(plain, new DecompressionStream(sealed.compression));
    return new TextDecoder().decode(plain);
  }
  globalThis.RulingBoardSeal = Object.freeze({ seal, open });
})();
