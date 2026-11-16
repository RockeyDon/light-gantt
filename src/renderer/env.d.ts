import type { ProgressAPI, AssistantAPI, SettingsAPI, TaskAPI } from '../shared/contracts';

declare global {
  interface Window {
    progress: ProgressAPI;
    tasks: TaskAPI;
    settings: SettingsAPI;
    assistant: AssistantAPI;
  }
}
