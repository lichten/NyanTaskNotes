/*
  非GUI動作確認: 日次の生成ウィンドウ（HORIZON_DAYS）が反映されるかを検証
  手順:
    - 一時DBを作成
    - 毎日タスク(horizon=3)を作成し、オカレンスの件数を確認
    - horizon=7に更新し、追加生成されることを確認
*/

const path = require('path');
const fs = require('fs');
const { TaskDatabase } = require('../dist/taskDatabase');

function todayStr(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
}

(async () => {
  const tmpDb = path.resolve(__dirname, '..', '.tmp', `test_tasks_${Date.now()}.sqlite`);
  fs.mkdirSync(path.dirname(tmpDb), { recursive: true });

  const db = new TaskDatabase(tmpDb);
  await db.init();

  const payload = {
    title: '毎日テスト',
    description: 'horizon 動作確認',
    isRecurring: true,
    startDate: todayStr(0),
    startTime: '00:00',
    recurrence: { freq: 'daily', count: 0, horizonDays: 3 }
  };
  const id = await db.createTask(payload);

  // 3日分生成されるか
  const occ1 = await db.listOccurrences({ from: todayStr(0), to: todayStr(30) });
  const occTask1 = occ1.filter(o => o.TASK_ID === id);
  console.log('[Step1] horizon=3 -> occurrences:', occTask1.length);
  if (occTask1.length !== 3) {
    console.error('期待件数(3)と不一致:', occTask1.length);
    process.exit(1);
  }

  // 7に更新
  await db.updateTask(id, {
    title: '毎日テスト',
    description: 'horizon 7',
    isRecurring: true,
    startDate: todayStr(0),
    startTime: '00:00',
    recurrence: { freq: 'daily', count: 0, horizonDays: 7 }
  });

  const occ2 = await db.listOccurrences({ from: todayStr(0), to: todayStr(30) });
  const occTask2 = occ2.filter(o => o.TASK_ID === id);
  console.log('[Step2] horizon=7 -> occurrences:', occTask2.length);
  if (occTask2.length !== 7) {
    console.error('期待件数(7)と不一致:', occTask2.length);
    process.exit(1);
  }

  console.log('OK: 日次HORIZON_DAYSの生成ロジックは期待通りに動作しました');
  await db.close();
  process.exit(0);
})().catch(async (e) => {
  console.error('テスト実行エラー:', e);
  process.exit(2);
});

