import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Settings } from '../shared/contracts';
import { Icon } from './icons';

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const saveLock = useRef(false);

  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current!;
    element.showModal();
    return () => {
      element.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void window.settings
      .get()
      .then((result) => {
        if (!active) return;
        if (!result.ok) throw new Error(result.error.message);
        setDraft(result.data);
      })
      .catch((error: unknown) => {
        if (active) setError(error instanceof Error ? error.message : '读取配置失败，请重试');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft || saveLock.current) return;
    saveLock.current = true;
    setSaving(true);
    setError('');
    try {
      const result = await window.settings.save(draft);
      if (!result.ok) throw new Error(result.error.message);
      document.documentElement.dataset.theme = result.data.theme;
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : '保存配置失败，请重试');
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="modal settings-modal"
      aria-labelledby="settings-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!saveLock.current) onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <div className="modal-heading">
          <h2 id="settings-title">配置</h2>
          <button type="button" className="icon-button" aria-label="关闭配置" disabled={saving} onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        {loading && (
          <p role="status" className="muted">
            正在读取配置…
          </p>
        )}
        {draft && (
          <>
            <fieldset className="settings-group" disabled={loading || saving}>
              <legend>大模型</legend>
              <label className="field">
                接口地址
                <input
                  name="LLM_BASE_URL"
                  type="url"
                  value={draft.LLM_BASE_URL}
                  placeholder="https://api.example.com/v1"
                  onChange={(event) => setDraft({ ...draft, LLM_BASE_URL: event.target.value })}
                  spellCheck={false}
                  autoComplete="off"
                />
              </label>
              <label className="field">
                API 密钥
                <input
                  name="LLM_API_KEY"
                  type="password"
                  value={draft.LLM_API_KEY}
                  placeholder="填写 API 密钥，可留空"
                  onChange={(event) => setDraft({ ...draft, LLM_API_KEY: event.target.value })}
                  autoComplete="off"
                />
              </label>
              <label className="field">
                模型名称
                <input
                  name="LLM_MODEL_ID"
                  value={draft.LLM_MODEL_ID}
                  placeholder="填写模型名称，可留空"
                  onChange={(event) => setDraft({ ...draft, LLM_MODEL_ID: event.target.value })}
                  spellCheck={false}
                  autoComplete="off"
                />
              </label>
            </fieldset>
            <fieldset className="settings-group" disabled={loading || saving}>
              <legend>外观</legend>
              <div className="theme-options" role="radiogroup" aria-label="主题">
                <label>
                  <input type="radio" name="theme" value="light" checked={draft.theme === 'light'} onChange={() => setDraft({ ...draft, theme: 'light' })} />
                  浅色
                </label>
                <label>
                  <input type="radio" name="theme" value="dark" checked={draft.theme === 'dark'} onChange={() => setDraft({ ...draft, theme: 'dark' })} />
                  深色
                </label>
              </div>
            </fieldset>
          </>
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {!loading && !draft && (
          <button type="button" className="button secondary" onClick={() => setAttempt((value) => value + 1)}>
            重新读取
          </button>
        )}
        <div className="modal-footer">
          <div className="modal-actions">
            <button type="button" className="button secondary" disabled={saving} onClick={onClose}>
              取消
            </button>
            <button type="submit" className="button primary" disabled={loading || saving || !draft}>
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      </form>
    </dialog>
  );
}
