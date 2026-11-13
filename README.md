# 轻甘特 · Light Gantt

一个面向 Mac 的本地甘特图应用。支持浅色和深色主题，按天管理任务，数据保存在本机 SQLite 中。

## 开发与验证

需要 Node.js 22.12+、pnpm 10，以及 Mac 上的 Xcode Command Line Tools（SQLite 原生模块编译时使用）。

```sh
pnpm install
pnpm start

pnpm check
pnpm test
pnpm test:e2e
```

打包后，`better-sqlite3` 会使用 Electron 的原生模块版本。如果本机 Node 运行 `pnpm test` 提示 `NODE_MODULE_VERSION` 不匹配，可直接用 Electron 的 Node 环境执行单元测试：

```sh
ELECTRON_RUN_AS_NODE=1 pnpm exec electron node_modules/vitest/vitest.mjs run
```

`test:e2e` 先打包，再使用 Playwright 启动真实 Electron 应用。每次测试使用独立的临时数据库，不接触个人任务；截图保存在 `test-results/`。

如果当前网络不能下载 GitHub 上的 Electron 运行包，可以在安装和打包命令前设置镜像：

```sh
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ pnpm install
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ pnpm make
```

镜像只改变下载来源，仍校验 Electron 自带的校验和。

## Mac 打包

```sh
pnpm package  # 生成当前 Mac 架构的 .app
pnpm make     # 生成 .dmg 与 .zip
```

应用包位于 `out/轻甘特-darwin-arm64/`（Intel Mac 为 `x64`）；安装包位于 `out/make/`。安装时将“轻甘特”拖入“应用程序”。

当前版本未做 Apple 开发者签名和公证，适合本地交付。如果系统拦截首次启动，可在系统设置的“隐私与安全性”中允许打开。

## 使用

- 新建任务，填写名称、负责人、开始日期及可选的结束日期。显示日期采用中文格式。
- 也可在窗口底部输入自然语言，例如“明天小林做设计，持续三天，后天安排开发”。Enter 发送，Shift+Enter 换行；解析后逐条弹窗确认，修改后创建、跳过当前条或结束本次均可。未提及的开始日期默认今天、结束日期留空、负责人默认“自己”。
- 点击任务名称或条形编辑；拖动条形改期，拖动左右边缘调整日期。整体改期保留已有持续天数。
- 结束日期留空时，条形延伸到今天；未来任务显示起始标记。整体拖动只修改开始日期，拖动右边缘会设置明确的结束日期。
- 右侧绿色“✓”用于完成任务。已完成卡片默认只露标题边；拖动标题边向上展开，最多可让进行中卡片仅露标题边。也可用上下方向键调整、Home 收起、End 展开；已完成任务可以恢复、编辑或删除。
- 点击右上角日历图标打开时间设置，切换日／周刻度、前后翻月或回到今天。点击任务信息中的开始日期可定位较远的任务。
- 点击右上角齿轮或按 `Cmd+,` 打开配置，填写模型接口地址、API 密钥、模型名称，并选择浅色或深色主题。点击保存后生效，重启后沿用。自然语言解析使用最新保存的模型配置。
- 时间轴每次呈现一个有限日期窗口（日刻度 120 天，周刻度 365 天），避免远期任务导致过大的页面；窗口外的任务仍保留在左侧列表中。

## 数据与后端接口

标准数据位置：`~/Library/Application Support/轻甘特/gantt.sqlite`，实际位置遵循 Electron 的 `app.getPath('userData')`。
数据库启用 WAL，当前结构版本为 2。开发阶段不迁移旧版数据库：升级旧开发版本时，先退出应用，删除上述数据库及同目录的 `gantt.sqlite-wal`、`gantt.sqlite-shm`，再启动重建。正常启动不会清空数据。备份时先退出应用，再复制整个数据目录。

`LIGHT_GANTT_DATA_DIR` 可为开发和测试指定隔离的数据目录。所有日期均使用 `YYYY-MM-DD` 字符串，结束日期包含当天；`null` 表示持续到今天。

后端分层为 IPC 适配层、`TaskService` 和 SQLite。渲染进程不能访问 Node 或数据库，只能通过 preload 暴露的 `window.tasks` 调用以下接口：

| 方法 | 参数 | 成功结果 |
| --- | --- | --- |
| `list` | 可选 `isDone: boolean` | 按开始日期、ID 排序的任务数组 |
| `create` | `{ name, assign, start_time, end_time }` | 新任务，默认未完成 |
| `update` | `id, patch` | 修改后的任务；patch 可包含上述部分字段 |
| `remove` | `id` | 无数据 |
| `setDone` | `id, isDone` | 状态更新后的任务 |

所有调用返回 `Promise<Result<T>>`：成功为 `{ ok: true, data }`，失败为 `{ ok: false, error: { code, message } }`。
任务及配置错误码为 `INVALID_INPUT`、`NOT_FOUND` 和 `STORAGE_ERROR`。修改结束日期时，传 `null` 表示清空，不传表示保留原值；不接受未知字段和显式 `undefined` 更新。

其他输入适配器同样可以通过已有接口修改任务：

```ts
const result = await window.tasks.update(taskId, {
  start_time: '2026-11-16',
  end_time: '2026-11-20',
});
if (!result.ok) throw new Error(result.error.message);
```

应用主进程内的新输入适配器可以直接依赖 `TaskService`，同样经过校验再写入数据。接口不依赖拖拽或其他界面动作，不启动 HTTP 服务。

目前只包含本地单用户任务列表，不包含多项目、任务依赖或云同步。

配置通过同一数据库的 `settings` 表保存，`SettingsService.get()` 在主进程返回 `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL_ID` 和 `theme`，模型引擎每次调用时读取。API 密钥使用 Electron `safeStorage` 加密后入库，依赖当前系统钥匙串，不可用时明确报错，不会降级为明文。

渲染进程通过 `window.settings.get()` 和 `window.settings.save(settings)` 读取、保存完整配置，返回格式同任务接口。模型参数允许为空，非空接口地址必须是 HTTP/HTTPS URL；主题仅支持 `light`、`dark`，新数据库默认 `light`。配置不会写入进程环境变量。

## 自然语言输入

`window.assistant.parse(text)` 返回 `Promise<Result<AssistantResult>>`：`{ kind: 'create_tasks', tasks: CreateTask[] }` 表示待确认草稿，`{ kind: 'unsupported', message }` 表示本轮不支持的意图。解析不写入数据库，只有用户逐条确认后才调用 `tasks.create`。草稿不持久化，关闭应用即丢弃；本轮不支持自然语言修改、删除或完成已有任务。

主进程通过内置提示词调用 `POST {LLM_BASE_URL}/chat/completions`。接口地址填写到基础路径，例如 `https://api.example.com/v1`；请求携带 Bearer 密钥、模型名称、`stream: false` 和 `enable_thinking: false`，模型及接口需支持关闭思考参数。请求超时为 60 秒，不自动重试，不上传已有任务，不记录密钥、输入原文或原始模型响应。

提示词包含本机日期、星期和时区，由模型理解相对日期；后端对返回的 JSON、字段和日期范围进行校验，确认弹窗允许进一步修正。新增错误码为 `LLM_CONFIG_MISSING`、`LLM_REQUEST_FAILED`、`LLM_RESPONSE_INVALID`；缺配置时可直接从提示打开配置。
