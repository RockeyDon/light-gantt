import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../../src/main/database';
import { SettingsError, SettingsService, type SecretStorage } from '../../src/main/settings-service';

const defaults = { LLM_BASE_URL: '', LLM_API_KEY: '', LLM_MODEL_ID: '', theme: 'light' } as const;
const configured = { LLM_BASE_URL: 'https://api.example.com/v1', LLM_API_KEY: 'test-secret', LLM_MODEL_ID: 'example-model', theme: 'dark' } as const;
let db: Database.Database;
let secrets: SecretStorage;
let service: SettingsService;

beforeEach(() => {
  db = openDatabase(':memory:');
  const key = randomBytes(32);
  secrets = {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString(value) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
    },
    decryptString(value) {
      const decipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
      decipher.setAuthTag(value.subarray(12, 28));
      return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8');
    },
  };
  service = new SettingsService(db, secrets);
});

afterEach(() => db.close());

describe('SettingsService', () => {
  it('starts empty with a light theme and no requirement for encryption until a key is saved', () => {
    vi.mocked(secrets.isEncryptionAvailable).mockReturnValue(false);
    expect(service.get()).toEqual(defaults);
    expect(service.save({ ...defaults, theme: 'dark' })).toEqual({ ...defaults, theme: 'dark' });
    expect(service.getTheme()).toBe('dark');
  });

  it('persists encrypted credentials and the theme across database close and reopen', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'light-gantt-settings-'));
    const filename = path.join(directory, 'gantt.sqlite');
    let disk = openDatabase(filename);
    try {
      expect(new SettingsService(disk, secrets).save(configured)).toEqual(configured);
      const row = disk.prepare('SELECT llm_api_key FROM settings WHERE id = 1').get() as { llm_api_key: Buffer };
      expect(Buffer.isBuffer(row.llm_api_key)).toBe(true);
      expect(row.llm_api_key.includes(Buffer.from(configured.LLM_API_KEY))).toBe(false);
      disk.close();
      disk = openDatabase(filename);
      expect(new SettingsService(disk, secrets).get()).toEqual(configured);
      new SettingsService(disk, secrets).save(defaults);
      expect(new SettingsService(disk, secrets).get()).toEqual(defaults);
      expect(disk.prepare('SELECT llm_api_key FROM settings').get()).toEqual({ llm_api_key: null });
    } finally {
      if (disk.open) disk.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each([
    { ...configured, LLM_BASE_URL: 'not-a-url' },
    { ...configured, LLM_BASE_URL: 'file:///tmp/model' },
    { ...configured, LLM_API_KEY: null },
    { ...configured, LLM_MODEL_ID: 123 },
    { ...configured, theme: 'system' },
    { ...configured, extra: true },
    { theme: 'dark' },
  ])('rejects invalid configuration without partial writes', (invalid) => {
    expect(() => service.save(invalid)).toThrow(SettingsError);
    expect(service.get()).toEqual(defaults);
  });

  it('trims text fields and supports local HTTP model endpoints', () => {
    const input = { ...configured, LLM_BASE_URL: ' http://localhost:11434/v1 ', LLM_API_KEY: ' test-secret ', LLM_MODEL_ID: ' example-model ' };
    expect(service.save(input)).toEqual({ ...configured, LLM_BASE_URL: 'http://localhost:11434/v1' });
  });

  it('fails explicitly when encryption is unavailable or fails, leaving the entire configuration unchanged', () => {
    vi.mocked(secrets.isEncryptionAvailable).mockReturnValue(false);
    expect(() => service.save(configured)).toThrow('系统密钥加密不可用');
    vi.mocked(secrets.isEncryptionAvailable).mockReturnValue(true);
    vi.spyOn(secrets, 'encryptString').mockImplementation(() => {
      throw new Error('injected encryption failure');
    });
    expect(() => service.save(configured)).toThrow('API 密钥加密失败');
    expect(service.get()).toEqual(defaults);
  });

  it('reports corrupted secrets while still allowing the saved startup theme to be read', () => {
    service.save(configured);
    db.prepare('UPDATE settings SET llm_api_key = ?').run(Buffer.from('corrupt'));
    expect(service.getTheme()).toBe('dark');
    expect(() => service.get()).toThrow('API 密钥解密失败');
  });

  it('retains all prior configuration when a database write fails', () => {
    service.save(configured);
    db.exec("CREATE TRIGGER reject_settings BEFORE UPDATE ON settings BEGIN SELECT RAISE(FAIL, 'injected failure'); END");
    expect(() => service.save(defaults)).toThrow();
    expect(service.get()).toEqual(configured);
  });

  it('reports missing configuration records instead of inventing defaults', () => {
    db.exec('DELETE FROM settings');
    expect(() => service.get()).toThrow('配置记录不存在');
    expect(() => service.save(defaults)).toThrow('配置记录不存在');
  });

  it('requires an explicit development database reset instead of migrating or deleting old tasks', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'light-gantt-old-'));
    const filename = path.join(directory, 'gantt.sqlite');
    const old = new Database(filename);
    old.exec("CREATE TABLE old_data (name TEXT); INSERT INTO old_data VALUES ('dev'); PRAGMA user_version = 1");
    old.close();
    try {
      expect(() => openDatabase(filename)).toThrow('开发数据库结构已更新');
      const unchanged = new Database(filename);
      expect(unchanged.prepare('SELECT * FROM old_data').all()).toEqual([{ name: 'dev' }]);
      unchanged.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
