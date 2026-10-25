// Password sealing of the single-HTML package. The author page seals, the board
// opens; both use this file so the parameters cannot drift. Strength is bounded
// by the password: a distributed file can be guessed offline without limit.
(function () {
  "use strict";
  const KDF = "PBKDF2-SHA-256", CIPHER = "AES-256-GCM", ITERATIONS = 600000;
  const AAD = new TextEncoder().encode("ui-ruling-board:sealed:1");
  const toBase64 = bytes => { let binary = ""; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(binary); };
  const fromBase64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
  async function key(password, salt, iterations, usage) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, base, { name: "AES-GCM", length: 256 }, false, [usage]);
  }
  async function seal(text, password) {
    if (!password) throw Error("パスワードが空です");
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: AAD }, await key(password, salt, ITERATIONS, "encrypt"), new TextEncoder().encode(text)));
    return { kdf: KDF, cipher: CIPHER, iterations: ITERATIONS, salt: toBase64(salt), iv: toBase64(iv), data: toBase64(data) };
  }
  // Rejects a wrong password and any altered byte alike (GCM cannot tell them apart).
  async function open(sealed, password) {
    if (sealed?.kdf !== KDF || sealed.cipher !== CIPHER || !Number.isInteger(sealed.iterations) || sealed.iterations < ITERATIONS) throw Error("暗号の形式が不正");
    let plain;
    try { plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(sealed.iv), additionalData: AAD }, await key(password, fromBase64(sealed.salt), sealed.iterations, "decrypt"), fromBase64(sealed.data)); }
    catch { throw Error("パスワードが違うか、データが壊れています"); }
    return new TextDecoder().decode(plain);
  }
  globalThis.RulingBoardSeal = Object.freeze({ seal, open });
})();
