# NyanTaskNotes

オフライン動作のタスク管理アプリ（Electron + TypeScript）。

- タスクDB（アプリ固有）: 既定は `app.getPath('userData')/tasks.sqlite3`（トップ画面から任意のSQLiteファイルを指定可能）
- ファイルDB（外部ファイル管理）: 既存スキーマ（`db/file_schema.sql`）で任意のSQLiteファイルを指定

## セットアップ手順

1) 依存関係のインストール

```
cd NyanTaskNotes
npm install
```

2) （必要に応じて）ネイティブモジュールのリビルド

環境によっては `sqlite3` を Electron 用にリビルドする必要があります。

```
npm run rebuild
```

- 失敗する場合は Python / C++ ビルド環境（Windows: Build Tools, macOS: Xcode Command Line Tools）を用意してください。

3) ビルド＆起動

```
npm start
```

## 使い方（初回）
- 起動後、画面上部の「ファイルDB設定」で SQLite ファイルを参照 → 保存
  - 以後、再起動で `FILE_INFOS/TAG_INFOS/TAG_MAPS` が自動作成されます
- 「ファイル登録」でタグ（カンマ区切り）を入力し、[ファイルを追加] で取り込み

## データベース
- タスクDBスキーマ: `db/task_schema.sql`（起動時に自動適用）
- ファイルDBスキーマ: `db/file_schema.sql`（指定したファイルに適用）

## スクリプト
- `npm run build` — TypeScriptをコンパイル
- `npm start` — ビルド後にElectron起動
- `npm run dev` — DevTools付きで起動
- `npm run rebuild` — sqlite3のElectron向けリビルド

## 注意
- オフライン運用を前提にしていますが、`npm install` や `electron-rebuild` はインターネット接続が必要です。
- 実行時に生成されるDBファイルは `.gitignore` 済みです。
