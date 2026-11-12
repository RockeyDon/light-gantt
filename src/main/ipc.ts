import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { CHANNELS, type Result } from '../shared/contracts';
import { TaskError, type TaskService } from './task-service';

export function registerTaskIPC(service: TaskService, getWindow: () => BrowserWindow | null): void {
  const handle = (channel: string, operation: (...args: unknown[]) => unknown) => {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]): Result<unknown> => {
      const window = getWindow();
      if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
        throw new Error('不允许的接口来源');
      }
      try {
        return { ok: true, data: operation(...args) };
      } catch (error) {
        if (error instanceof TaskError) return { ok: false, error: { code: error.code, message: error.message } };
        console.error('Task storage error', error);
        return { ok: false, error: { code: 'STORAGE_ERROR', message: '保存或读取失败，请重试。数据文件可能不可写或已损坏。' } };
      }
    });
  };
  handle(CHANNELS.list, (isDone) => service.list(isDone));
  handle(CHANNELS.create, (input) => service.create(input));
  handle(CHANNELS.update, (id, input) => service.update(id, input));
  handle(CHANNELS.remove, (id) => service.remove(id));
  handle(CHANNELS.setDone, (id, isDone) => service.setDone(id, isDone));
}
