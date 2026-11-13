import type Database from 'better-sqlite3';
import { z } from 'zod';
import type { ErrorCode, Settings, Theme } from '../shared/contracts';

export class SettingsError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface SecretStorage {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

const settingsSchema = z
  .object({
    LLM_BASE_URL: z
      .string()
      .trim()
      .refine((value) => {
        if (!value) return true;
        try {
          return ['http:', 'https:'].includes(new URL(value).protocol);
        } catch {
          return false;
        }
      }, '接口地址须为 HTTP 或 HTTPS 地址'),
    LLM_API_KEY: z.string().trim(),
    LLM_MODEL_ID: z.string().trim(),
    theme: z.enum(['light', 'dark']),
  })
  .strict();

interface SettingsRow {
  llm_base_url: string;
  llm_api_key: Buffer | null;
  llm_model_id: string;
  theme: Theme;
}

export class SettingsService {
  constructor(
    private readonly db: Database.Database,
    private readonly secrets: SecretStorage,
  ) {}

  private row(): SettingsRow {
    const row = this.db.prepare('SELECT llm_base_url, llm_api_key, llm_model_id, theme FROM settings WHERE id = 1').get() as SettingsRow | undefined;
    if (!row) throw new SettingsError('STORAGE_ERROR', '配置记录不存在');
    if (row.theme !== 'light' && row.theme !== 'dark') throw new SettingsError('STORAGE_ERROR', '主题配置无效');
    return row;
  }

  getTheme(): Theme {
    return this.row().theme;
  }

  get(): Settings {
    const row = this.row();
    let key = '';
    if (row.llm_api_key !== null) {
      this.requireEncryption();
      try {
        key = this.secrets.decryptString(row.llm_api_key);
      } catch {
        throw new SettingsError('STORAGE_ERROR', 'API 密钥解密失败，请检查系统钥匙串是否可用');
      }
    }
    return { LLM_BASE_URL: row.llm_base_url, LLM_API_KEY: key, LLM_MODEL_ID: row.llm_model_id, theme: row.theme };
  }

  save(input: unknown): Settings {
    const parsed = settingsSchema.safeParse(input);
    if (!parsed.success) throw new SettingsError('INVALID_INPUT', parsed.error.issues.map((issue) => issue.message).join('；'));
    const data = parsed.data;
    let encrypted: Buffer | null = null;
    if (data.LLM_API_KEY) {
      this.requireEncryption();
      try {
        encrypted = this.secrets.encryptString(data.LLM_API_KEY);
      } catch {
        throw new SettingsError('STORAGE_ERROR', 'API 密钥加密失败，配置未保存');
      }
    }
    this.db.transaction(() => {
      const result = this.db
        .prepare('UPDATE settings SET llm_base_url = ?, llm_api_key = ?, llm_model_id = ?, theme = ? WHERE id = 1')
        .run(data.LLM_BASE_URL, encrypted, data.LLM_MODEL_ID, data.theme);
      if (result.changes !== 1) throw new SettingsError('STORAGE_ERROR', '配置记录不存在');
    })();
    return data;
  }

  private requireEncryption(): void {
    if (!this.secrets.isEncryptionAvailable()) throw new SettingsError('STORAGE_ERROR', '系统密钥加密不可用，请检查系统钥匙串后重试');
  }
}
