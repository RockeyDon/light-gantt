import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { CHANNELS, type Result, type Theme } from '../shared/contracts';
import { TaskError, type TaskService } from './task-service';
import { SettingsError, type SettingsService } from './settings-service';

export function registerIPC(service: TaskService, settings: SettingsService, getWindow: () => BrowserWindow | null, applyTheme: (theme: Theme) => void): void {
  const handle = (channel: string, operation: (...args: unknown[]) => unknown) => {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]): Result<unknown> => {
      const window = getWindow();
      if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
        throw new Error('不允许的接口来源');
      }
      try {
        return { ok: true, data: operation(...args) };
      } catch (error) {
        if (error instanceof TaskError || error instanceof SettingsError) return { ok: false, error: { code: error.code, message: error.message } };
        // Do not log request arguments or database errors that could contain credentials.
        console.error('Storage operation failed:', channel);
        return { ok: false, error: { code: 'STORAGE_ERROR', message: '保存或读取失败，请重试。数据文件可能不可写或已损坏。' } };
      }
    });
  };
  handle(CHANNELS.list, (isDone) => service.list(isDone));
  handle(CHANNELS.create, (input) => service.create(input));
  handle(CHANNELS.update, (id, input) => service.update(id, input));
  handle(CHANNELS.remove, (id) => service.remove(id));
  handle(CHANNELS.setDone, (id, isDone) => service.setDone(id, isDone));
  handle(CHANNELS.getSettings, () => settings.get());
  handle(CHANNELS.getTheme, () => settings.getTheme());
  handle(CHANNELS.saveSettings, (input) => {
    const saved = settings.save(input);
    applyTheme(saved.theme);
    return saved;
  });
}
