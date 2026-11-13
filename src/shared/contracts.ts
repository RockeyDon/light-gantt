export interface Task {
  id: string;
  name: string;
  start_time: string;
  end_time: string | null;
  assign: string;
  is_done: boolean;
}

export type CreateTask = Pick<Task, 'name' | 'start_time' | 'end_time' | 'assign'>;
export type UpdateTask = Partial<CreateTask>;
export type ErrorCode = 'INVALID_INPUT' | 'NOT_FOUND' | 'STORAGE_ERROR';
export type Result<T> = { ok: true; data: T } | { ok: false; error: { code: ErrorCode; message: string } };

export type Theme = 'light' | 'dark';
export interface Settings {
  LLM_BASE_URL: string;
  LLM_API_KEY: string;
  LLM_MODEL_ID: string;
  theme: Theme;
}
export interface SettingsAPI {
  readonly initialTheme: Theme;
  getTheme(): Promise<Result<Theme>>;
  get(): Promise<Result<Settings>>;
  save(input: Settings): Promise<Result<Settings>>;
  onOpen(listener: () => void): () => void;
}

/** All input adapters use these operations. No renderer action is required by the task service. */
export interface TaskAPI {
  list(isDone?: boolean): Promise<Result<Task[]>>;
  create(input: CreateTask): Promise<Result<Task>>;
  update(id: string, input: UpdateTask): Promise<Result<Task>>;
  remove(id: string): Promise<Result<void>>;
  setDone(id: string, isDone: boolean): Promise<Result<Task>>;
}

export const CHANNELS = {
  list: 'tasks:list',
  create: 'tasks:create',
  update: 'tasks:update',
  remove: 'tasks:remove',
  setDone: 'tasks:set-done',
  getSettings: 'settings:get',
  getTheme: 'settings:theme',
  saveSettings: 'settings:save',
  openSettings: 'settings:open',
} as const;
