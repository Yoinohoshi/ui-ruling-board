// Builds the single-HTML package from a board's files and an envelope. The author
// page (browser) and scripts/pack-round.mjs (Node) both use it, so there is one form.
(function (factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else globalThis.RulingBoardPackage = api;
})(function () {
  "use strict";
  const CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; base-uri 'none'; form-action 'none'";
  const script = value => `<script>${value.replace(/<\/script/gi, "<\\/script")}<` + "/script>";
  const once = (html, from, to) => {
    if (html.split(from).length !== 2) throw Error(`器の index.html に「${from}」が 1 つではない`);
    return html.replace(from, () => to);
  };
  /** board: { html, css, validate, board, seal? } — seal only when the envelope is sealed. */
  function packageHtml(board, envelope) {
    let html = once(board.html, '<link rel="stylesheet" href="board.css" />', `<meta http-equiv="Content-Security-Policy" content="${CSP}"><style>${board.css}</style>`);
    html = once(html, '<script src="validate.js"></script>', `<script id="ruling-board-package" type="application/json">${JSON.stringify(envelope).replaceAll("<", "\\u003c")}<` + "/script>" + script(board.validate));
    return once(html, '<script src="board.js"></script>', (board.seal ? script(board.seal) : "") + script(board.board));
  }
  return { packageHtml };
});
