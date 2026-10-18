// A small synthetic round: 2 decisions, 5 items, 3 views.
// D1.1 draws the changed area of the item, and option b its own.
// Open it with board/index.html?round=../examples/basic/round.js
RulingBoard.define({
  schema: 1,
  round: {
    id: "basic-r1",
    title: "設定画面の配置",
    answerTo: "https://example.com/rounds/basic-r1",
    source: "example · v1",
    created: "2026-10-18",
  },
  views: [
    { id: "1280", label: "1280" },
    { id: "390", label: "390" },
    { id: "390-menu", label: "390 · メニュー" },
  ],
  images: "images/{item}/{option}-{view}.svg",
  decisions: [
    {
      id: "D1",
      title: "一覧と詳細",
      note: "",
      items: [
        {
          id: "D1.1",
          title: "詳細の置き場",
          question: "詳細をどこに置くか",
          views: ["1280", "390"],
          focus: { 1280: [392, 64, 880, 728] },
          options: [
            { id: "cur", label: "現状" },
            { id: "a", label: "右の列", recommended: true },
            {
              id: "b",
              label: "下へ続ける",
              tags: ["見直し候補"],
              images: {
                390: ["images/D1.1/b-390-1.svg", "images/D1.1/b-390-2.svg"],
              },
              focus: { 1280: [24, 392, 1232, 392] },
            },
          ],
        },
        {
          id: "D1.2",
          title: "保存の釦",
          question: "保存の釦をどこに置くか",
          options: [
            { id: "cur", label: "現状" },
            { id: "a", label: "頭" },
            { id: "b", label: "末尾に固定", recommended: true },
          ],
        },
        {
          id: "D1.3",
          title: "空の一覧",
          question: "一覧が空のときに何を出すか",
          views: ["1280"],
          options: [
            { id: "cur", label: "何も出さない" },
            { id: "a", label: "追加の釦" },
          ],
        },
      ],
    },
    {
      id: "D2",
      title: "メニュー",
      note: "メニューの中身は D2.2 で決める。",
      items: [
        {
          id: "D2.1",
          title: "メニューの開き方",
          question: "メニューをどう開くか",
          views: ["390-menu"],
          options: [
            { id: "cur", label: "左の引き出し" },
            { id: "a", label: "全面" },
            { id: "b", label: "下から", tags: ["見直し候補"] },
          ],
        },
        {
          id: "D2.2",
          title: "メニューの項目の並び",
          question: "メニューの項目をどう並べるか",
          views: ["1280", "390-menu"],
          options: [
            { id: "cur", label: "現状" },
            { id: "a", label: "まとまりで分ける" },
          ],
        },
      ],
    },
  ],
});
