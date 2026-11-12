# 轻甘特 · Light Gantt

一个面向 Mac 的本地甘特图应用。亮色界面，按天管理任务，数据保存在本机 SQLite 中。

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
- 点击任务名称或条形编辑；拖动条形改期，拖动左右边缘调整日期。整体改期保留已有持续天数。
- 结束日期留空时，条形延伸到今天；未来任务显示起始标记。整体拖动只修改开始日期，拖动右边缘会设置明确的结束日期。
- 右侧绿色“✓”用于完成任务。已完成卡片默认只露标题边；拖动标题边向上展开，最多可让进行中卡片仅露标题边。也可用上下方向键调整、Home 收起、End 展开；已完成任务可以恢复、编辑或删除。
- 点击右上角日历图标打开时间设置，切换日／周刻度、前后翻月或回到今天。点击任务信息中的开始日期可定位较远的任务。
- 时间轴每次呈现一个有限日期窗口（日刻度 120 天，周刻度 365 天），避免远期任务导致过大的页面；窗口外的任务仍保留在左侧列表中。

## 数据与后端接口

标准数据位置：`~/Library/Application Support/轻甘特/gantt.sqlite`，实际位置遵循 Electron 的 `app.getPath('userData')`。
数据库启用 WAL，通过 `user_version` 管理迁移；升级应用不会清空任务。备份时先退出应用，再复制整个数据目录。

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
错误码为 `INVALID_INPUT`、`NOT_FOUND` 和 `STORAGE_ERROR`。修改结束日期时，传 `null` 表示清空，不传表示保留原值；不接受未知字段和显式 `undefined` 更新。

例如，在未来集成的文字输入组件中，将用户意图解析为指令后直接调用：

```ts
const result = await window.tasks.update(taskId, {
  start_time: '2026-11-16',
  end_time: '2026-11-20',
});
if (!result.ok) throw new Error(result.error.message);
```

应用主进程内的新输入适配器可以直接依赖 `TaskService`，同样经过校验再写入数据。接口不依赖拖拽或其他界面动作，不启动 HTTP 服务。

目前只包含本地单用户任务列表，不包含多项目、任务依赖或云同步。
