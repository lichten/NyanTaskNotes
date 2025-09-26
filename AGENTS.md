# Repository Guidelines (NyanTaskNotes)

## Project Structure
- Source: `src/` TypeScript entrypoints (`main.ts`, `preload.ts`); renderer TS in `src/renderer/`.
- Outputs: `dist/` (main/preload) and `js/` (renderer via `tsconfig.renderer.json`).
- UI: root `index.html`; SQL schemas in `db/`.

## Build, Run
- `npm install`
- `npm run build` — compile all TypeScript
- `npm start` — build then launch Electron
- `npm run dev` — build then launch with inspector

## Coding Style
- TypeScript strict, ES2020; 2-space indent, semicolons, single quotes.
- Naming: `camelCase` values/functions, `PascalCase` classes.

## Commit & PR Guidelines
- 重要: コミットメッセージは日本語で書くこと。
  - 例: `feat: ファイルDBのIPCを分離` / `fix: タグ削除時の不具合を修正`
  - 必要に応じて Conventional Commits の型（`feat`, `fix`, `chore` など）は使用可。ただし本文・説明は日本語。
- コミットおよびプルリクエストのタイトルは必ず Conventional Commits の接頭辞（例: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `build:` など）で開始すること。
- PRは変更点の概要・確認手順を日本語で記載。スクリーンショットがあると望ましい。
- 変更はスコープを絞り、無関係な修正を混在させない。

## Security & Packaging
- `nodeIntegration: false`, `contextIsolation: true` を維持。
- 配布物には実行時DBファイルを含めない（`db/` にはスキーマのみ）。

## Notes for Agents
- この AGENTS.md の方針を常に参照し、特に「コミットメッセージは日本語」のルールを遵守すること。
- ハウスキーピングやフォーマットのみの変更は `chore:` 前置で明示する。
