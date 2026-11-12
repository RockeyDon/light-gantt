import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS, type TaskAPI } from '../shared/contracts';

const tasks: TaskAPI = {
  list: (isDone) => ipcRenderer.invoke(CHANNELS.list, isDone),
  create: (input) => ipcRenderer.invoke(CHANNELS.create, input),
  update: (id, input) => ipcRenderer.invoke(CHANNELS.update, id, input),
  remove: (id) => ipcRenderer.invoke(CHANNELS.remove, id),
  setDone: (id, isDone) => ipcRenderer.invoke(CHANNELS.setDone, id, isDone),
};

contextBridge.exposeInMainWorld('tasks', tasks);
