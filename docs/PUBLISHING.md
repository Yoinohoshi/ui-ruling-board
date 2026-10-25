# 回の準備と発行（0.3.0）

目次・見出し・選択・回答案を一つの項目定義から作り、変わる所を拡大して先頭に置き、検査を通った回だけを配布フォルダへ出す。
閲覧には Node・サーバー・外部通信が不要。準備・発行を行う側には Node 26 と `npm ci`、`npm run setup` が必要。

## 最初に試す

コミット済みの版を使う。以下の出力先はいずれも新しいフォルダにする。

```sh
npm ci
npm run setup
npm run example:capture -- artifacts/example-source
npm run prepare:round -- artifacts/example-source artifacts/example-round
npm run check:folder -- artifacts/example-round --release
npm run publish:round -- artifacts/example-round artifacts/example-published
```

`artifacts/example-published/index.html` をダブルクリックする。配布フォルダはそのまま別の場所へ移せる。フォルダ全体を ZIP にして渡してもよい。

サンプルは公開用の架空画面。現在案、推奨、見直し候補、画像のない案、複数段、PC／携帯、名指し拡大、項目別のコメントを含む。
実製品の画像や内部の回答先をサンプルへコピーしない。

## 既に作った回を発行する

```sh
npm run check:folder -- path/to/round --release
npm run verify:board -- path/to/round
npm run publish:round -- path/to/round path/to/new-publication
```

旧版の器も、固定した版のまま発行できる。発行処理はその回の `validate.js` を使う。
従来の `install.mjs` と `check-round.mjs` も使える。`check-round` は記述と画像形式の簡易検査、`check:folder` は回全体の検査、`publish:round` は実際の画像読み込みを含む最終検査。

発行は次を順に行う。

1. 器4ファイルの SHA-256、版、変更なしの全桁コミット SHA を確認。
2. 記述、画像の存在と形式、`images/` の余り、配布フォルダの外を指す画像を確認。
3. `items.mjs` があれば、項目・案・問い・札・推奨・順序を生成結果と照合。`generated.json` に明記した生成見え方だけを除いて比較し、宣言済み見え方の偽装を拒否。生成拡大は項目の先頭に置く。
4. Chromium の file:// で1280px・390pxを開く。全見え方の画像とフォールバック、4つの並び、横あふれ、ヘッダー高さ、JavaScriptエラー、外部通信を確認。
5. 器・記述・参照画像・照合資料だけを `.preparing` フォルダへコピー。`items.mjs` は import 依存のない定義へ展開する。撮影スクリプトや無関係な文書は含めない。
6. 配布物のハッシュを `publication.json` に保存し、配布先で再検査。成功後に指定の発行名へ変更する。

既存の出力先と `.preparing` は上書きしない。途中で失敗した `.preparing` は診断用に残る。完成品の名前にはならない。発行後も `check:folder --release` で画像・記述の変更を検知できる。

`-dirty` の器はプレビュー用。発行は拒否する。コミット後、新しい回を生成するか、まだ未発行の作業用コピーへ `node scripts/install.mjs <回> --force` で器を入れ直す。
錠を手で書き換えて発行を通してはならない。

## 撮影元の契約

アプリの状態を作る部分はアプリ側の撮影台本が担う。比較元のコミット、入力状態、幅、スクロール位置、フォーカス、ホバーなどを固定し、同じ状態を**別々に2回撮影**する。
このツールは、アプリ固有の操作や試作 CSS を推測しない。既存の撮影台本は次の2ファイルと画像を出せば使える。

```
source/
  items.mjs       export const description = { schema: 1, round, views, decisions }
  captures.json   項目 → 見え方 → 撮影情報
  shots/          初回と撮り直しの画像
```

`description` は README の schema 1。ただし `images` と `focus` は生成処理が所有するので書かない。
`round.source` に比較元、`question` に判断点、`views` に幅・状態、必要なら `note` に維持条件を書く。
画像を持つ案は項目ごとに2つ以上。比較元は `cur`、なければ最初の画像付き案。画像のない選択肢には `noImage: true` を付ける。

`captures.json` の例：

```json
{
  "D1.1": {
    "1280": {
      "guard": [24, 48, 164, 64],
      "images": { "cur": "shots/current.png", "a": "shots/proposal.png" },
      "repeat": {
        "cur": "shots/current-again.png",
        "a": "shots/proposal-again.png"
      },
      "regions": [
        { "name": "control", "label": "操作部分", "rect": [28, 58, 150, 44] }
      ]
    }
  }
}
```

- パスは撮影元からの相対パス。png・jpg・webp・svg。画像と撮り直しは別のファイルにする。
- 配列にすれば縦長画面の段。比較する画像の寸法は同じにし、段数が違う案は短い方の最後の段を使って比較する。
- `guard` は変更を許す範囲。整数の `[x,y,幅,高さ]`、画像の外は不可。すべての案・段の差がこの範囲に収まる必要がある。
- `regions` は任意。名指した部分を拡大する。IDは `<view>.<name>.zoom`、表示名は「見え方 · 部分名 · 拡大」。
- 正本にない項目・見え方・案、撮影キーの誤記を拒否する。

## 画素検査と拡大

`prepare:round` は撮影済み画像を読み込み、次を検査・生成する。

- 撮り直しの寸法と全RGBA画素が一致すること。ファイルの圧縮差は判定に含めない。
- 各見え方の全案の組を比較し、guard の外の差を1画素でも拒否する。全段を通じて見える差のない組も拒否する。
- `show` は実際の差の外接矩形。8近傍の連結成分が16画素未満の孤立した差は、show の拡大を避けるためだけに除く。範囲外の差や撮り直しの差は除かない。
- 案ごとの show を `options[].focus` に、全案の和を項目と現在案の focus にする。guard は画面に描かない。
- 全案の show の和に16pxの余白を付け、画像の25%未満かつ幅が半分以下なら自動拡大を付ける。名指し拡大にも幅の条件を適用する。
- 同じ範囲を写す拡大を除外・拒否する。名指し拡大内に実際の差があること、推奨案の変化の始まりがいずれかの拡大に収まることを確認する。
- 全案を同じ矩形から2倍で切り出す。拡大は元の見え方の順に項目の先頭へ置き、全画面も後ろに残す。
- 最大の段の差が2000画素未満、または差／show面積が5%未満の組は `evidence.json` の `small` に記録する（失敗にはしない）。

出力は器、`round.js`、`images/`、独立した `items.mjs`、生成分を列挙した `generated.json`、画素測定の `evidence.json`。
これらの生成物を手で編集せず、撮影元を直して新しいフォルダに生成する。

既にある回を `publish:round` だけで発行する場合、撮り直し画像を持たないため画素の再現性を後付けで証明はしない。
`prepare:round` から作る回では撮り直し・guard・show・拡大の検査を必須で通す。

## r6 の機能対応と回帰確認

| 機能                                               | 実装・確認                                       |
| -------------------------------------------------- | ------------------------------------------------ |
| 項目単位の一択・保留・コメント、推奨・札           | `board.js`、`tests/board.spec.js`                |
| 目次の印・進捗・狭幅の引き出し                     | 同上                                             |
| 項目ごとの先頭見え方、全体選択の局所フォールバック | 同上、`verify-board.mjs` で全見え方              |
| 切替・横並び・複数段・原寸・キーボード・焦点復帰   | `tests/board.spec.js`                            |
| 案別focus・名指し拡大を最初に表示                  | `prepare-round.mjs`、`tests/publication.spec.js` |
| 下書き保存・記述の変更時は復元しない               | `tests/board.spec.js`                            |
| Markdownのコピー・保存・比較元・回答先・閲覧記録   | 同上                                             |
| guard/show分離・全案比較・撮り直し・拡大内の差     | `image-tools.mjs`、`prepare-round.mjs`、故障対照 |
| 正本と生成物の順序一致・余分／不足画像・器の錠     | `check-folder.mjs`、故障対照                     |
| 移動可能な配布物・発行後ハッシュ・上書き拒否       | `publish-round.mjs`、移動後のfile://試験         |

ローカルに保存された実製品の参考回は `npm run check:folder -- <参考回> --release` と `npm run verify:board -- <参考回>` で検査できる。
参考回そのものは公開リポジトリへ入れない。新しい器で同じ記述を確認する場合も、参考回の別コピーを作ってから行う。

## 版を配布可能にする確認

```sh
npm ci
npm run check
npm test
```

版番号は `board/board.js`、`package.json`、`package-lock.json` を揃える。画面のschema互換性を保つ。
コミットしてから上のサンプルの準備と発行を通す。公開するソースにはローカルの参考画面・内部のIssue URL・生成した配布物を入れない。
