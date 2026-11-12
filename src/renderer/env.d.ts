import type { TaskAPI } from '../shared/contracts';

declare global {
  interface Window {
    tasks: TaskAPI;
  }
}
