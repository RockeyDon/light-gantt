import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type ServerResponse } from 'node:http';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { addDays, today } from '../../src/shared/dates';

const draft = (name: string) => ({ name, assign: '自己', start_time: today(), end_time: null });
const completion = (value: unknown) => JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) }, finish_reason: 'stop' }] });

async function mockModel() {
  const requests: { url: string; authorization: string | undefined; body: Record<string, unknown> }[] = [];
  let respond = (response: ServerResponse) => {
    response.end(completion({ kind: 'create_tasks', tasks: [draft('默认任务')] }));
  };
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      requests.push({ url: request.url!, authorization: request.headers.authorization, body: JSON.parse(body) });
      response.setHeader('Content-Type', 'application/json');
      respond(response);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Mock server did not start');
  return {
    requests,
    url: `http://127.0.0.1:${address.port}/v1`,
    reply: (callback: typeof respond) => {
      respond = callback;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}

async function launch(directory: string) {
  const folder = path.resolve('out', `轻甘特-darwin-${process.arch}`);
  const bundle = readdirSync(folder).find((file) => file.endsWith('.app'))!;
  const application = await electron.launch({ executablePath: path.join(folder, bundle, 'Contents/MacOS/LightGantt'), env: { ...process.env, LIGHT_GANTT_DATA_DIR: directory } });
  const page = await application.firstWindow();
  await expect(page.getByRole('button', { name: '新建任务', exact: true }).first()).toBeEnabled();
  return { application, page };
}

async function configure(page: Page, url: string) {
  await page.getByRole('button', { name: '配置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '配置', exact: true });
  await settings.getByLabel('接口地址').fill(url);
  await settings.getByLabel('API 密钥').fill('test-api-secret');
  await settings.getByLabel('模型名称').fill('mock-model');
  await settings.getByRole('button', { name: '保存', exact: true }).click();
  await expect(settings).toHaveCount(0);
}

async function send(page: Page) {
  await page.getByRole('textbox', { name: '输入你想安排的事' }).dispatchEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing: false });
}

async function list(page: Page) {
  return page.evaluate(async () => {
    const result = await window.tasks.list();
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  });
}

function rejectCreates(directory: string, enabled: boolean) {
  execFileSync('python3', [
    '-c',
    'import sqlite3,sys; db=sqlite3.connect(sys.argv[1]); db.execute(sys.argv[2]); db.commit(); db.close()',
    path.join(directory, 'gantt.sqlite'),
    enabled ? "CREATE TRIGGER reject_create BEFORE INSERT ON gantt BEGIN SELECT RAISE(FAIL, 'injected failure'); END" : 'DROP TRIGGER reject_create',
  ]);
}

test('natural-language drafts require sequential confirmation, support editing, skipping and save retries', async () => {
  const model = await mockModel();
  const directory = mkdtempSync(path.join(tmpdir(), 'light-gantt-assistant-'));
  let application: ElectronApplication | undefined;
  try {
    const running = await launch(directory);
    application = running.application;
    const page = running.page;
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const input = page.getByRole('textbox', { name: '输入你想安排的事' });
    await input.fill('安排三件事');
    await send(page);
    await expect(page.getByRole('alert')).toContainText('接口地址、API 密钥、模型名称');
    expect(model.requests).toHaveLength(0);
    await expect(input).toHaveValue('安排三件事');
    await page.getByRole('button', { name: '打开配置' }).click();
    await expect(page.getByRole('dialog', { name: '配置', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await configure(page, model.url);
    model.reply((response) => response.end(completion({ kind: 'create_tasks', tasks: [draft('设计'), draft('跳过的任务'), draft('开发')] })));
    await send(page);
    const editor = page.getByRole('dialog', { name: '确认新任务', exact: true });
    await expect(editor.getByText('第 1 / 3 项')).toBeVisible();
    expect(await list(page)).toEqual([]);
    await expect(editor.getByLabel('负责人')).toHaveValue('自己');
    await expect(editor.locator('input[name=start_time]')).toHaveValue(today());
    await expect(editor.locator('input[name=end_time]')).toHaveValue('');
    await editor.locator('input[name=name]').fill('确认设计');
    await editor.getByLabel('负责人').fill('小林');
    await editor.locator('input[name=end_time]').fill(addDays(today(), 2));
    await editor.getByRole('button', { name: '创建任务' }).click();
    await expect(editor.getByText('第 2 / 3 项')).toBeVisible();
    expect(await list(page)).toHaveLength(1);
    await page.keyboard.press('Escape');
    await expect(editor.getByText('第 3 / 3 项')).toBeVisible();
    await expect(editor.locator('input[name=name]')).toHaveValue('开发');
    rejectCreates(directory, true);
    await editor.locator('input[name=name]').fill('保留编辑的开发');
    await editor.getByRole('button', { name: '创建任务' }).click();
    await expect(editor.getByRole('alert')).toContainText('保存或读取失败');
    expect(await list(page)).toHaveLength(1);
    rejectCreates(directory, false);
    await editor.getByRole('button', { name: '创建任务' }).click();
    await expect(editor).toHaveCount(0);
    expect((await list(page)).map((task) => task.name).sort()).toEqual(['保留编辑的开发', '确认设计'].sort());
    await expect(input).toBeFocused();
    await expect(page.getByRole('status')).toContainText('已创建 2 项任务，跳过 1 项');
    expect(model.requests).toHaveLength(1);
    expect(model.requests[0]).toMatchObject({
      url: '/v1/chat/completions',
      authorization: 'Bearer test-api-secret',
      body: { model: 'mock-model', stream: false, enable_thinking: false },
    });

    // Ending a later batch preserves the tasks already confirmed in that batch.
    await input.fill('再安排三件事');
    await send(page);
    await expect(editor.getByText('第 1 / 3 项')).toBeVisible();
    await editor.getByRole('button', { name: '创建任务' }).click();
    await expect(editor.getByText('第 2 / 3 项')).toBeVisible();
    await editor.getByRole('button', { name: '结束本次' }).click();
    await expect(editor).toHaveCount(0);
    expect(await list(page)).toHaveLength(3);
    await expect(page.getByRole('status')).toContainText('已创建 1 项任务，跳过 2 项');
    expect(errors).toEqual([]);
  } finally {
    await application?.close();
    await model.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('model failures preserve input, unsupported operations do not write, and concurrent submit and IME are handled', async () => {
  const model = await mockModel();
  const directory = mkdtempSync(path.join(tmpdir(), 'light-gantt-assistant-errors-'));
  let application: ElectronApplication | undefined;
  try {
    const running = await launch(directory);
    application = running.application;
    const page = running.page;
    await configure(page, model.url);
    const input = page.getByRole('textbox', { name: '输入你想安排的事' });
    await input.fill('安排任务');
    await input.evaluate((element) => element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })));
    await expect(input).toHaveValue('安排任务');
    const allowNewline = await input.evaluate((element) => element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true })));
    expect(allowNewline).toBe(true);
    // Keep keyboard handler checks independent of the host macOS input method.
    await input.fill('安排任务\n');
    expect(model.requests).toHaveLength(0);
    for (const [status, message] of [
      [401, '鉴权失败'],
      [429, '过于频繁'],
      [503, '暂时不可用'],
      [400, '关闭思考参数'],
    ] as const) {
      model.reply((response) => {
        response.statusCode = status;
        response.end('sensitive test-api-secret');
      });
      await send(page);
      await expect(page.getByRole('alert')).toContainText(message);
      await expect(page.getByRole('alert')).not.toContainText('test-api-secret');
      await expect(input).toHaveValue('安排任务\n');
    }
    model.reply((response) => response.end(completion({ kind: 'create_tasks', tasks: [draft('有效'), { ...draft('错误'), start_time: '2026-02-30' }] })));
    await send(page);
    await expect(page.getByRole('alert')).toContainText('任务字段或日期有误');
    expect(await list(page)).toEqual([]);
    model.reply((response) => response.end(completion({ kind: 'unsupported', message: '目前仅支持新建任务' })));
    await input.fill('删除所有任务');
    await send(page);
    await expect(page.getByRole('alert')).toContainText('目前仅支持新建任务');
    expect(await list(page)).toEqual([]);

    let pending: ServerResponse | undefined;
    model.reply((response) => {
      pending = response;
    });
    const before = model.requests.length;
    await input.fill('明天安排设计');
    await input.evaluate((element) => {
      const form = (element as HTMLTextAreaElement).form!;
      form.requestSubmit();
      form.requestSubmit();
    });
    await expect(page.getByRole('status')).toContainText('正在理解');
    await expect.poll(() => model.requests.length).toBe(before + 1);
    await expect(input).toBeDisabled();
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled();
    // Other UI remains usable during parsing; drafts wait until the existing dialog closes.
    await page.getByRole('button', { name: '新建任务', exact: true }).first().click();
    pending!.end(completion({ kind: 'create_tasks', tasks: [draft('延迟任务')] }));
    const manual = page.getByRole('dialog', { name: '安排一个新任务' });
    await expect(manual).toBeVisible();
    await expect(page.getByText('正在理解…', { exact: true })).toHaveCount(0);
    await manual.getByRole('button', { name: '取消', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '确认新任务' });
    await expect(editor).toBeVisible();
    await editor.getByRole('button', { name: '跳过', exact: true }).click();
    expect(await list(page)).toEqual([]);
    expect(model.requests.length).toBe(before + 1);
  } finally {
    await application?.close();
    await model.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('compact global input and review work in both themes at minimum window size', async () => {
  const model = await mockModel();
  const directory = mkdtempSync(path.join(tmpdir(), 'light-gantt-assistant-layout-'));
  let application: ElectronApplication | undefined;
  try {
    const running = await launch(directory);
    application = running.application;
    const page = running.page;
    await configure(page, model.url);
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(860, 600));
    for (const theme of ['light', 'dark'] as const) {
      await page.getByRole('button', { name: '配置', exact: true }).click();
      const settings = page.getByRole('dialog', { name: '配置', exact: true });
      await settings.getByRole('radio', { name: theme === 'light' ? '浅色' : '深色', exact: true }).check();
      await settings.getByRole('button', { name: '保存', exact: true }).click();
      const input = page.getByRole('textbox', { name: '输入你想安排的事' });
      const composer = await page.locator('.assistant-composer').boundingBox();
      const cards = await page.getByRole('region', { name: '已完成任务', exact: true }).boundingBox();
      expect(cards!.y + cards!.height).toBeLessThan(composer!.y);
      expect(composer!.height).toBeLessThanOrEqual(44);
      await expect(input).toBeInViewport();
      await page.screenshot({ path: `test-results/assistant-${theme}.png` });
      await input.fill('安排一个任务');
      await send(page);
      const editor = page.getByRole('dialog', { name: '确认新任务' });
      await expect(editor).toBeVisible();
      await expect(editor.getByRole('button', { name: '创建任务' })).toBeInViewport();
      await page.screenshot({ path: `test-results/assistant-review-${theme}.png` });
      await editor.getByRole('button', { name: '关闭编辑' }).click();
      await expect(input).toBeFocused();
    }
  } finally {
    await application?.close();
    await model.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
