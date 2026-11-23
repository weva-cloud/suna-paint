# 砂ペイント（Suna Paint）

砂や水を置いて絵を描き、素材が落ちたり混ざったりする様子を楽しめるブラウザアプリです。
このリポジトリには、Wevaの砂ペイントをもとにした、単体で動かせる版のソースコードが入っています。

[Wevaの砂ペイントで遊ぶ](https://weva.cloud/app/suna-paint)

## ローカル開発

開発時の動作確認には Node.js 24 を使っています。
リポジトリのフォルダーで、次のコマンドを実行します。

```bash
npm ci
npm run dev
```

ターミナルに表示されたURLをブラウザで開くと、砂ペイントが動きます。

## コマンド

| コマンド | 内容 |
| --- | --- |
| `npm run dev` | 開発サーバーを起動する |
| `npm run build` | 配布用ファイルを `dist/` に作る |
| `npm run preview` | `dist/` に作ったアプリを手元で確認する |
| `npm run typecheck` | TypeScriptの型を確認する |

## 主なファイル

ReactとTypeScriptで実装し、画面の描画には Canvas 2D、開発とビルドには Vite を使っています。

- [src/main.tsx](./src/main.tsx) はアプリの起点です。
- [src/SunaPaintPage.tsx](./src/SunaPaintPage.tsx) に操作画面、描画、素材の動きがあります。
- [src/suna-paint.module.css](./src/suna-paint.module.css) に画面のスタイルがあります。
- [src/entity/entityTypes.ts](./src/entity/entityTypes.ts) に素材と生き物の種類があります。
- [src/entity/creatures/](./src/entity/creatures/) に生き物ごとの形や動きがあります。[src/entity/entityRegistry.ts](./src/entity/entityRegistry.ts) が各生き物の定義をまとめています。

## ライセンス

[MITライセンス](./LICENSE)で公開しています。
