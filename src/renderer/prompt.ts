const params = new URLSearchParams(window.location.search);

function $(id: string) { return document.getElementById(id)!; }

window.addEventListener('DOMContentLoaded', () => {
  const title = params.get('title') || '入力';
  const label = params.get('label') || '入力';
  const placeholder = params.get('placeholder') || '';
  const ok = params.get('ok') || 'OK';
  const cancel = params.get('cancel') || 'キャンセル';
  const requestId = params.get('requestId') || '';

  ($('title') as HTMLElement).textContent = title;
  ($('label') as HTMLLabelElement).textContent = label;
  const input = $('value') as HTMLInputElement;
  input.placeholder = placeholder;
  ( $('okBtn') as HTMLButtonElement ).textContent = ok;
  ( $('cancelBtn') as HTMLButtonElement ).textContent = cancel;

  const submit = (value: string | null) => {
    try {
      (window as any).electronAPI.submitPrompt({ requestId, value });
      // ウィンドウのクローズはメイン側(onSubmit)で行う（レース回避）
    } catch {}
  };

  $('okBtn').addEventListener('click', () => submit((($('value')) as HTMLInputElement).value));
  $('cancelBtn').addEventListener('click', () => submit(null));
  input.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') submit(input.value); });
  setTimeout(() => input.focus(), 0);
});
