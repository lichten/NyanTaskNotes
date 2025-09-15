# 繰り返し設定とDBフィールドの対応

目的: 画面上の文言や項目名が将来変更されても、内部のデータベース設計（カラム名）との対応関係を一意に参照できるようにするためのドキュメント。

参考ファイル:
- UI 実装: `task-editor2.html`, `src/renderer/taskEditor2.ts`, `src/renderer/sharedTaskEditor.ts`
- DB スキーマ: `db/task_schema.sql`
- 発生回生成ロジック: `src/taskDatabase.ts`

## 基本モデル

- `TASKS` テーブル
  - `TITLE`, `DESCRIPTION`, `TAGS`（タグは中間テーブル）
  - 単発タスク向け: `DUE_AT`（日時）
  - 繰り返しタスク共通: `START_DATE`（開始日/基準日）, `START_TIME`（開始時刻・任意）, `IS_RECURRING`（0/1）

- `RECURRENCE_RULES` テーブル（1タスク:1レコード）
  - `FREQ`: `'daily' | 'weekly' | 'monthly' | 'yearly'`
  - `INTERVAL`: 繰り返し間隔（1以上）
  - `INTERVAL_ANCHOR`: `'scheduled' | 'completed'`（日次の「前回発生基準/前回完了基準」）
  - `COUNT`: 繰り返し回数（0=無限）
  - `HORIZON_DAYS`: 日次の生成ウィンドウ（日数、既定14。`INTERVAL_ANCHOR='scheduled'` のみ有効）
  - `WEEKLY_DOWS`: 週次の曜日ビットマスク（bit0=日〜bit6=土）
  - `MONTHLY_DAY`: 月次（日付指定） 1..31
  - `MONTHLY_NTH`, `MONTHLY_NTH_DOW`: 月次（第N曜日指定） N=1..5 / -1=最終, 曜日=0..6
  - `YEARLY_MONTH`: 年次の対象月(1..12)。日付は `MONTHLY_DAY` を使用

## UI → DB 対応（モード別）

- 1回のみ（`once`）
  - `TASKS.IS_RECURRING = 0`
  - `TASKS.DUE_AT` に「期日（単発）」の値を格納
  - `START_DATE`, `START_TIME`, `RECURRENCE_RULES` は未使用

- 毎日（`daily`）
  - `TASKS.IS_RECURRING = 1`
  - `TASKS.START_DATE`, `TASKS.START_TIME`
  - `RECURRENCE_RULES`: `FREQ='daily'`, `INTERVAL=1`, `INTERVAL_ANCHOR='scheduled'`, `HORIZON_DAYS`=「生成日数（日次・発生基準）」, `COUNT`=「繰り返し回数」

- 指定日数ごと（前回発生した日付から）（`everyNScheduled`）
  - `TASKS.IS_RECURRING = 1`
  - `TASKS.START_DATE`, `TASKS.START_TIME`
  - `RECURRENCE_RULES`: `FREQ='daily'`, `INTERVAL`=「間隔（日）」, `INTERVAL_ANCHOR='scheduled'`, `HORIZON_DAYS`=「生成日数（日次・発生基準）」, `COUNT`

- 指定日数ごと（前回完了した日付から）（`everyNCompleted`）
  - `TASKS.IS_RECURRING = 1`
  - `TASKS.START_DATE`, `TASKS.START_TIME`
  - `RECURRENCE_RULES`: `FREQ='daily'`, `INTERVAL`=「間隔（日）」, `INTERVAL_ANCHOR='completed'`, `COUNT`
  - 備考: `HORIZON_DAYS` は無視（完了基準は先出し生成を行わない）

- 毎週（曜日）（`weekly`）
  - `TASKS.IS_RECURRING = 1`
  - `TASKS.START_DATE`, `TASKS.START_TIME`
  - `RECURRENCE_RULES`: `FREQ='weekly'`, `WEEKLY_DOWS`=チェックした曜日のビットマスク, `INTERVAL=1`, `COUNT`

- 毎月（日付）（`monthly`）
  - `TASKS.IS_RECURRING = 1`
  - `TASKS.START_DATE`, `TASKS.START_TIME`
  - `RECURRENCE_RULES`: `FREQ='monthly'`, `MONTHLY_DAY`=「毎月の日」, `COUNT`

- 第n週m曜日（`monthlyNth`）
  - `TASKS.IS_RECURRING = 1`
  - `TASKS.START_DATE`, `TASKS.START_TIME`
  - `RECURRENCE_RULES`: `FREQ='monthly'`, `MONTHLY_NTH`, `MONTHLY_NTH_DOW`, `COUNT`

- 毎年（月日）（`yearly`）
  - `TASKS.IS_RECURRING = 1`
  - `TASKS.START_DATE`, `TASKS.START_TIME`
  - `RECURRENCE_RULES`: `FREQ='yearly'`, `YEARLY_MONTH`=「毎年の月」, `MONTHLY_DAY`=「毎年の日」, `COUNT`

## 共通ルール

- `COUNT=0` は「無限」（プレビュー/生成はウィンドウベース）。`COUNT>=1` は有限回数。
- `START_DATE` は全ての繰り返しの基準。`START_TIME` は任意で各発生回の `SCHEDULED_TIME` に反映。
- 単発タスクは `DUE_AT`（または `START_DATE`）に基づいて1回の `TASK_OCCURRENCES` が保証されます。

## 関連ロジック（参照）

- UI入力→ルール構築: `src/renderer/taskEditor2.ts` の `buildRecurrenceFromUI()`
- プレビュー生成: `computeTargetDates(...)`（同ファイル内）
- DBへの実発生回生成:
  - 日次: `ensureRecurringDailyOccurrences()`
  - 週次: `ensureRecurringWeeklyOccurrences()`
  - 月次: `ensureRecurringMonthlyOccurrences()`
  - 年次: `ensureRecurringYearlyOccurrences()`
  - 単発: `ensureSingleOccurrences()`

## 用語の整合性と将来の文言変更

- UI文言が変更されても、DBカラムは上記の固定スキーマを維持します。
- UI変更に伴いラベル名が変わる場合でも、ここに記載の「モード→カラム対応」を絶対参照としてください。
- UIからDBへの最終的なマッピングは `buildRecurrenceFromUI()` に集約されています。文言変更時はこの関数と本ドキュメントの両方を見直してください。

