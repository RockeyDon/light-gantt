import type { AssistantAPI, SettingsAPI, TaskAPI } from '../shared/contracts';

declare global {
  interface Window {
    tasks: TaskAPI;
    settings: SettingsAPI;
    assistant: AssistantAPI;
  }
}
