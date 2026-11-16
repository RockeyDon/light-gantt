import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS, type ProgressAPI, type AssistantAPI, type SettingsAPI, type TaskAPI } from '../shared/contracts';

const progress: ProgressAPI = {
  list: (id) => ipcRenderer.invoke(CHANNELS.listProgress, id),
  save: (input) => ipcRenderer.invoke(CHANNELS.saveProgress, input),
  remove: (input) => ipcRenderer.invoke(CHANNELS.removeProgress, input),
};
contextBridge.exposeInMainWorld('progress', progress);

const assistant: AssistantAPI = { parse: (text) => ipcRenderer.invoke(CHANNELS.parseAssistant, text) };
contextBridge.exposeInMainWorld('assistant', assistant);

const tasks: TaskAPI = {
  list: (isDone) => ipcRenderer.invoke(CHANNELS.list, isDone),
  create: (input) => ipcRenderer.invoke(CHANNELS.create, input),
  update: (id, input) => ipcRenderer.invoke(CHANNELS.update, id, input),
  remove: (id) => ipcRenderer.invoke(CHANNELS.remove, id),
  setDone: (id, isDone) => ipcRenderer.invoke(CHANNELS.setDone, id, isDone),
};

contextBridge.exposeInMainWorld('tasks', tasks);

const themeArgument = process.argv.find((argument) => argument.startsWith('--light-gantt-theme='));
const openListeners = new Set<() => void>();
let pendingOpen = false;
ipcRenderer.on(CHANNELS.openSettings, () => {
  if (openListeners.size === 0) pendingOpen = true;
  else for (const listener of openListeners) listener();
});
const settings: SettingsAPI = {
  initialTheme: themeArgument === '--light-gantt-theme=dark' ? 'dark' : 'light',
  getTheme: () => ipcRenderer.invoke(CHANNELS.getTheme),
  get: () => ipcRenderer.invoke(CHANNELS.getSettings),
  save: (input) => ipcRenderer.invoke(CHANNELS.saveSettings, input),
  onOpen: (listener) => {
    openListeners.add(listener);
    if (pendingOpen) {
      queueMicrotask(() => {
        if (!pendingOpen || openListeners.size === 0) return;
        pendingOpen = false;
        for (const callback of openListeners) callback();
      });
    }
    return () => {
      openListeners.delete(listener);
    };
  },
};
contextBridge.exposeInMainWorld('settings', settings);
