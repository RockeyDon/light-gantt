import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Task } from '../../src/shared/contracts';
import { addDays, today } from '../../src/shared/dates';

function executable(): string {
  const folder = path.join('out', `轻甘特-darwin-${process.arch}`);
  const bundle = readdirSync(folder).find((file) => file.endsWith('.app'));
  if (!bundle) throw new Error('请先运行 pnpm package');
  return path.resolve(folder, bundle, 'Contents/MacOS/LightGantt');
}

async function launch(directory: string) {
  const application = await electron.launch({
    executablePath: executable(),
    env: { ...process.env, LIGHT_GANTT_DATA_DIR: directory },
  });
  const page = await application.firstWindow();
  await expect(page.getByRole('heading', { name: '任务计划' })).toBeVisible();
  await expect(page.getByRole('button', { name: '新建任务', exact: true }).first()).toBeEnabled();
  return { application, page };
}

async function tasks(page: Page): Promise<Task[]> {
  return page.evaluate(async () => {
    const result = await window.tasks.list();
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  });
}

async function dragBar(page: Page, id: string, delta: number, edge?: 'start' | 'end') {
  const bar = page.getByTestId(`bar-${id}`);
  await bar.scrollIntoViewIfNeeded();
  const target = edge ? bar.locator(`[data-edge=${edge}]`) : bar;
  const box = await target.boundingBox();
  if (!box) throw new Error('找不到任务条形');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + delta * 44, y, { steps: 8 });
  await page.mouse.up();
}

test('desktop lifecycle, drag dates, pane sizing, persistence and deletion', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'light-gantt-e2e-'));
  let application: ElectronApplication | undefined;
  try {
    let running = await launch(directory);
    application = running.application;
    let page = running.page;
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await expect(page.getByText('给下一件事，留一点时间')).toBeVisible();
    await page.screenshot({ path: 'test-results/empty.png' });
    await page.getByRole('button', { name: '新建任务', exact: true }).first().click();
    const editor = page.getByRole('dialog', { name: '安排一个新任务' });
    await editor.locator('input[name=name]').fill('产品方案设计');
    await editor.locator('input[name=assign]').fill('小林');
    await editor.locator('input[name=start_time]').fill(today());
    await editor.locator('input[name=end_time]').fill(addDays(today(), 4));
    await editor.getByRole('button', { name: '创建任务' }).click();
    await expect(editor).not.toBeVisible();
    const id = (await tasks(page))[0].id;
    await expect(page.getByRole('button', { name: '产品方案设计', exact: true })).toBeVisible();

    await dragBar(page, id, 2);
    await expect.poll(async () => (await tasks(page))[0].start_time).toBe(addDays(today(), 2));
    await expect.poll(async () => (await tasks(page))[0].end_time).toBe(addDays(today(), 6));
    await dragBar(page, id, 2, 'end');
    await expect.poll(async () => (await tasks(page))[0].end_time).toBe(addDays(today(), 8));

    // Fixed columns remain visible while the central timeline scrolls horizontally.
    await page.getByTestId('timeline-scroll').evaluate((element) => {
      element.scrollLeft = 1200;
    });
    const info = await page.getByRole('button', { name: '产品方案设计', exact: true }).boundingBox();
    const done = await page.getByRole('button', { name: '完成任务：产品方案设计' }).boundingBox();
    expect(info?.x).toBeGreaterThanOrEqual(0);
    expect(done && done.x + done.width).toBeLessThanOrEqual(page.viewportSize()?.width ?? 1320);
    await page.getByRole('button', { name: '时间设置', exact: true }).click();
    await page.getByRole('button', { name: '今天', exact: true }).click();

    await page.getByRole('button', { name: '产品方案设计', exact: true }).click();
    await page.getByRole('dialog').locator('input[name=name]').fill('产品方案确认');
    await page.getByRole('button', { name: '保存修改' }).click();
    await expect(page.getByRole('button', { name: '完成任务：产品方案确认' })).toBeVisible();
    await page.getByRole('button', { name: '完成任务：产品方案确认' }).click();
    const completed = page.getByRole('region', { name: '已完成任务', exact: true });
    const separator = page.getByRole('separator', { name: '调整已完成区域高度' });
    await expect(separator).toHaveAttribute('aria-valuenow', '36');
    await separator.focus();
    for (let index = 0; index < 6; index++) await page.keyboard.press('ArrowUp');
    await expect(separator).toHaveAttribute('aria-valuenow', '180');
    await expect(completed.getByRole('button', { name: '产品方案确认', exact: true })).toBeVisible();
    await completed.getByRole('button', { name: '恢复任务：产品方案确认' }).click();
    await expect(page.getByRole('button', { name: '完成任务：产品方案确认' })).toBeVisible();

    // Populate only the disposable test database for visual and scroll verification.
    await page.evaluate(
      async ({ start }) => {
        for (const [index, assign] of ['小林', '陈晨', '林语', '周一', '小林', '陈晨', '林语', '周一'].entries()) {
          const date = new Date(`${start}T00:00:00Z`);
          date.setUTCDate(date.getUTCDate() + index * 2 - 3);
          const end = new Date(date);
          end.setUTCDate(end.getUTCDate() + 6 + index);
          const result = await window.tasks.create({
            name: ['界面视觉设计', '核心功能开发', '接口联调', '测试与验收'][index % 4],
            assign,
            start_time: date.toISOString().slice(0, 10),
            end_time: index === 1 ? null : end.toISOString().slice(0, 10),
          });
          if (!result.ok) throw new Error(result.error.message);
        }
      },
      { start: today() },
    );
    await application.close();
    application = undefined;
    running = await launch(directory);
    application = running.application;
    page = running.page;
    expect(await tasks(page)).toHaveLength(9);
    await expect(page.getByRole('button', { name: '完成任务：产品方案确认' })).toBeVisible();
    await page.screenshot({ path: 'test-results/timeline.png' });
    await page.getByRole('button', { name: '时间设置', exact: true }).click();
    await page.getByRole('button', { name: '周', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '时间设置' })).toHaveCount(0);
    await page.getByRole('button', { name: '时间设置', exact: true }).click();
    await expect(page.getByRole('button', { name: '周', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await page.screenshot({ path: 'test-results/week.png' });
    await page.getByRole('button', { name: '产品方案确认', exact: true }).click();
    await page.getByRole('button', { name: '删除任务', exact: true }).click();
    await page.getByRole('dialog', { name: '删除这个任务？' }).getByRole('button', { name: '保留任务' }).click();
    await expect(page.getByRole('dialog', { name: '编辑任务' })).toBeVisible();
    await page.getByRole('button', { name: '删除任务', exact: true }).click();
    await page.getByRole('button', { name: '确认删除' }).click();
    await expect.poll(async () => (await tasks(page)).some((task) => task.id === id)).toBe(false);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await application?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('IPC validates input, isolates Node, and rolls back failed drag saves', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'light-gantt-errors-'));
  let application: ElectronApplication | undefined;
  try {
    const running = await launch(directory);
    application = running.application;
    const page = running.page;
    const security = await page.evaluate(async () => ({
      node: typeof (window as unknown as { require?: unknown }).require,
      invalid: await window.tasks.create({ name: '', assign: '', start_time: '2026-02-30', end_time: null }),
    }));
    expect(security.node).toBe('undefined');
    expect(security.invalid).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    await page.getByRole('button', { name: '新建任务', exact: true }).first().click();
    await page.getByRole('dialog').locator('input[name=name]').fill('持续任务');
    await page.getByRole('dialog').locator('input[name=start_time]').fill(addDays(today(), -4));
    await page.getByRole('button', { name: '创建任务' }).click();
    const original = (await tasks(page))[0];
    await dragBar(page, original.id, 1);
    await expect.poll(async () => (await tasks(page))[0].start_time).toBe(addDays(today(), -3));
    expect((await tasks(page))[0].end_time).toBeNull();
    const before = (await tasks(page))[0];

    execFileSync('python3', [
      '-c',
      [
        'import sqlite3,sys',
        'db=sqlite3.connect(sys.argv[1])',
        'db.execute("CREATE TRIGGER reject_updates BEFORE UPDATE ON gantt BEGIN SELECT RAISE(FAIL, \'injected write failure\'); END")',
        'db.commit()',
        'db.close()',
      ].join('; '),
      path.join(directory, 'gantt.sqlite'),
    ]);
    await dragBar(page, original.id, 2);
    await expect(page.getByRole('alert')).toContainText('保存或读取失败');
    expect((await tasks(page))[0]).toEqual(before);
    await page.getByRole('button', { name: '持续任务', exact: true }).click();
    const editor = page.getByRole('dialog');
    await editor.locator('input[name=name]').fill('保留未保存的输入');
    await editor.getByRole('button', { name: '保存修改' }).click();
    await expect(editor.getByRole('alert')).toContainText('保存或读取失败');
    await expect(editor.locator('input[name=name]')).toHaveValue('保留未保存的输入');
    await page.screenshot({ path: 'test-results/save-error.png' });
  } finally {
    await application?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('compact cards expose all tasks, resize to both edges, and keep dates clear of actions', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'light-gantt-cards-'));
  let application: ElectronApplication | undefined;
  try {
    const running = await launch(directory);
    application = running.application;
    const page = running.page;
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.evaluate(
      async ({ start, end }) => {
        for (let index = 0; index < 36; index++) {
          const result = await window.tasks.create({ name: `任务 ${String(index).padStart(2, '0')}`, assign: '小林', start_time: start, end_time: end });
          if (!result.ok) throw new Error(result.error.message);
          if (index >= 18) {
            const completed = await window.tasks.setDone(result.data.id, true);
            if (!completed.ok) throw new Error(completed.error.message);
          }
        }
      },
      { start: today(), end: addDays(today(), 5) },
    );
    await page.reload();
    const active = page.getByRole('region', { name: '未完成任务甘特图' });
    const completed = page.getByRole('region', { name: '已完成任务', exact: true });
    const separator = page.getByRole('separator', { name: '调整已完成区域高度' });
    await expect(active.locator('.gantt-row')).toHaveCount(18);
    await expect(separator).toHaveAttribute('aria-valuenow', '36');
    await expect(page.getByText('我的工作空间')).toHaveCount(0);
    await expect(page.getByText('操作', { exact: true })).toHaveCount(0);
    await expect(active.locator('.complete-button').first()).toHaveText('');

    async function visibleRows() {
      return active.locator('.gantt-row').evaluateAll((rows) => {
        const viewport = document.querySelector('.gantt-scroll')!.getBoundingClientRect();
        const header = document.querySelector('.gantt-header')!.getBoundingClientRect();
        return rows.filter((row) => {
          const box = row.getBoundingClientRect();
          return box.top >= header.bottom && box.bottom <= viewport.bottom;
        }).length;
      });
    }
    expect(await visibleRows()).toBeGreaterThanOrEqual(10);
    await page.screenshot({ path: 'test-results/cards-default.png' });

    // The header and each row scroll together, while the 40px action column stays outside the date viewport.
    await page.getByTestId('timeline-scroll').evaluate((element) => {
      element.scrollLeft = 1200;
    });
    await expect.poll(() => active.locator('.date-heading').evaluate((element) => element.scrollLeft)).toBe(1200);
    await expect.poll(() => active.locator('.gantt-row .timeline-window').evaluateAll((elements) => elements.every((element) => element.scrollLeft === 1200))).toBe(true);
    const geometry = await active.evaluate((element) => {
      const date = element.querySelector('.date-heading')!.getBoundingClientRect();
      const action = element.querySelector('.action-heading')!.getBoundingClientRect();
      const rowAction = element.querySelector('.task-action')!.getBoundingClientRect();
      return { dateRight: date.right, actionLeft: action.left, actionWidth: action.width, rowActionLeft: rowAction.left };
    });
    expect(geometry.dateRight).toBeLessThanOrEqual(geometry.actionLeft);
    expect(geometry.actionWidth).toBe(40);
    expect(geometry.rowActionLeft).toBe(geometry.actionLeft);
    await active.locator('.date-heading').dispatchEvent('wheel', { deltaX: 88, deltaY: 0 });
    await expect.poll(() => page.getByTestId('timeline-scroll').evaluate((element) => element.scrollLeft)).toBe(1288);
    await page.getByTestId('gantt-scroll').evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    const lastActive = active.locator('.gantt-row').last();
    const lastBox = await lastActive.boundingBox();
    const viewportBox = await page.getByTestId('gantt-scroll').boundingBox();
    expect(lastBox!.y + lastBox!.height).toBeLessThanOrEqual(viewportBox!.y + viewportBox!.height);

    // Both keyboard and pointer resizing reach the same limits.
    await separator.focus();
    await page.keyboard.press('End');
    await expect.poll(async () => Number(await separator.getAttribute('aria-valuenow'))).toBe(Number(await separator.getAttribute('aria-valuemax')));
    const activeBox = await active.boundingBox();
    const completedBox = await completed.boundingBox();
    expect(completedBox!.y - activeBox!.y).toBe(36);
    await completed.locator('.completed-scroll').evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(completed.locator('.completed-name').last()).toBeInViewport();
    await page.screenshot({ path: 'test-results/cards-expanded.png' });

    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(860, 600));
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(860);
    await expect.poll(async () => Number(await separator.getAttribute('aria-valuenow'))).toBe(Number(await separator.getAttribute('aria-valuemax')));
    await separator.focus();
    await page.keyboard.press('Home');
    await page.getByTestId('gantt-scroll').evaluate((element) => {
      element.scrollTop = 0;
    });
    expect(await visibleRows()).toBeGreaterThanOrEqual(7);
    await expect
      .poll(() =>
        active.locator('.month-scale b').evaluateAll((labels) =>
          labels.some((label) => {
            const box = label.getBoundingClientRect();
            const viewport = label.closest('.date-heading')!.getBoundingClientRect();
            return box.width > 0 && box.left >= viewport.left && box.right <= viewport.right;
          }),
        ),
      )
      .toBe(true);
    await page.screenshot({ path: 'test-results/cards-small.png' });
    const handle = await separator.boundingBox();
    await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle!.x + handle!.width / 2, 0, { steps: 10 });
    await page.mouse.up();
    await expect.poll(async () => Number(await separator.getAttribute('aria-valuenow'))).toBe(Number(await separator.getAttribute('aria-valuemax')));
    const expandedHandle = await separator.boundingBox();
    await page.mouse.move(expandedHandle!.x + expandedHandle!.width / 2, expandedHandle!.y + expandedHandle!.height / 2);
    await page.mouse.down();
    await page.mouse.move(expandedHandle!.x + expandedHandle!.width / 2, 590, { steps: 10 });
    await page.mouse.up();
    await expect(separator).toHaveAttribute('aria-valuenow', '36');

    const timeButton = page.getByRole('button', { name: '时间设置', exact: true });
    await timeButton.click();
    await page.keyboard.press('Escape');
    await expect(timeButton).toBeFocused();
    await expect(page.getByRole('dialog', { name: '时间设置' })).toHaveCount(0);
    await timeButton.click();
    await page.getByRole('heading', { name: '任务计划' }).click();
    await expect(page.getByRole('dialog', { name: '时间设置' })).toHaveCount(0);
    await timeButton.click();
    await page.getByRole('button', { name: '向后一个月' }).click();
    await expect(page.getByRole('dialog', { name: '时间设置' })).toBeVisible();
    await page.getByRole('button', { name: '今天', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '时间设置' })).toHaveCount(0);
    await expect.poll(() => page.getByTestId('timeline-scroll').evaluate((element) => element.scrollLeft)).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await application?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('settings gear, native menu and shortcut persist encrypted model credentials and both themes', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'light-gantt-preferences-'));
  let application: ElectronApplication | undefined;
  try {
    let running = await launch(directory);
    application = running.application;
    let page = running.page;
    const gear = page.getByRole('button', { name: '配置', exact: true });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await gear.click();
    const settings = page.getByRole('dialog', { name: '配置', exact: true });
    await expect(settings.getByLabel('接口地址')).toHaveValue('');
    await expect(settings.getByRole('radio', { name: '浅色', exact: true })).toBeChecked();
    await settings.getByRole('radio', { name: '深色', exact: true }).check();
    await settings.getByLabel('模型名称').fill('discarded');
    await settings.getByRole('button', { name: '取消', exact: true }).click();
    await expect(gear).toBeFocused();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    await page.keyboard.press('Meta+,');
    await expect(settings).toBeVisible();
    await expect(settings.getByLabel('模型名称')).toHaveValue('');
    await page.keyboard.press('Meta+,');
    await expect(settings).toHaveCount(1);
    await settings.getByLabel('接口地址').fill('https://api.example.com/v1');
    await settings.getByLabel('API 密钥').fill('e2e-test-secret');
    await expect(settings.getByLabel('API 密钥')).toHaveAttribute('type', 'password');
    await settings.getByLabel('模型名称').fill('example-model');
    await settings.getByRole('radio', { name: '深色', exact: true }).check();
    await settings.getByRole('button', { name: '保存', exact: true }).click();
    await expect(settings).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await application.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('dark');
    expect(await page.evaluate(() => window.settings.get())).toEqual({
      ok: true,
      data: { LLM_BASE_URL: 'https://api.example.com/v1', LLM_API_KEY: 'e2e-test-secret', LLM_MODEL_ID: 'example-model', theme: 'dark' },
    });
    const encrypted = execFileSync(
      'python3',
      [
        '-c',
        [
          'import sqlite3,sys',
          'db=sqlite3.connect(sys.argv[1])',
          'key=db.execute("SELECT llm_api_key FROM settings").fetchone()[0]',
          'print(isinstance(key,bytes) and b"e2e-test-secret" not in key)',
        ].join('; '),
        path.join(directory, 'gantt.sqlite'),
      ],
      { encoding: 'utf8' },
    ).trim();
    expect(encrypted).toBe('True');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByRole('heading', { name: '任务计划' })).toBeVisible();

    await page.evaluate(
      async ({ date }) => {
        for (const assign of ['', '小林', '陈晨', '林语', '周一', '设计']) {
          const created = await window.tasks.create({ name: `主题任务 ${assign || '未分配'}`, assign, start_time: date, end_time: null });
          if (!created.ok) throw new Error(created.error.message);
        }
      },
      { date: today() },
    );
    await page.reload();
    await expect(page.locator('.gantt-row')).toHaveCount(6);
    await page.screenshot({ path: 'test-results/theme-dark.png' });
    await page.getByRole('button', { name: '时间设置', exact: true }).click();
    await page.screenshot({ path: 'test-results/theme-dark-time.png' });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '主题任务 小林', exact: true }).click();
    await page.screenshot({ path: 'test-results/theme-dark-editor.png' });
    await page.keyboard.press('Escape');

    await application.close();
    application = undefined;
    running = await launch(directory);
    application = running.application;
    page = running.page;
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await application.evaluate(({ Menu }) => {
      const item = Menu.getApplicationMenu()!.items[0].submenu!.items.find((item) => item.label === '配置…')!;
      if (item.accelerator !== 'CmdOrCtrl+,') throw new Error('Missing settings accelerator');
      item.click();
    });
    const reopened = page.getByRole('dialog', { name: '配置', exact: true });
    await expect(reopened.getByLabel('API 密钥')).toHaveValue('e2e-test-secret');
    await expect(reopened.getByLabel('模型名称')).toHaveValue('example-model');
    await expect(reopened.getByRole('radio', { name: '深色', exact: true })).toBeChecked();
    await page.screenshot({ path: 'test-results/settings-dark.png' });
    await page.keyboard.press('Escape');
    await page.keyboard.press('Meta+,');
    await reopened.getByRole('radio', { name: '浅色', exact: true }).check();
    await reopened.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.screenshot({ path: 'test-results/theme-light.png' });
    await application.close();
    application = undefined;
    running = await launch(directory);
    application = running.application;
    page = running.page;
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(await tasks(page)).toHaveLength(6);
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    const nextWindow = application.waitForEvent('window');
    await application.evaluate(({ Menu }) => {
      Menu.getApplicationMenu()!
        .items[0].submenu!.items.find((item) => item.label === '配置…')!
        .click();
    });
    page = await nextWindow;
    await expect(page.getByRole('dialog', { name: '配置', exact: true }).getByLabel('模型名称')).toHaveValue('example-model');
  } finally {
    await application?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('settings reject invalid IPC input and retain unsaved fields and theme on storage failure', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'light-gantt-settings-errors-'));
  let application: ElectronApplication | undefined;
  try {
    const running = await launch(directory);
    application = running.application;
    const page = running.page;
    const invalid = await page.evaluate(() =>
      window.settings.save({
        LLM_BASE_URL: 'file:///tmp/model',
        LLM_API_KEY: '',
        LLM_MODEL_ID: '',
        theme: 'dark',
      }),
    );
    expect(invalid).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    execFileSync('python3', [
      '-c',
      [
        'import sqlite3,sys',
        'db=sqlite3.connect(sys.argv[1])',
        'db.execute("CREATE TRIGGER reject_settings BEFORE UPDATE ON settings BEGIN SELECT RAISE(FAIL, \'injected failure\'); END")',
        'db.commit()',
        'db.close()',
      ].join('; '),
      path.join(directory, 'gantt.sqlite'),
    ]);
    await page.getByRole('button', { name: '配置', exact: true }).click();
    const settings = page.getByRole('dialog', { name: '配置', exact: true });
    await settings.getByLabel('模型名称').fill('保留未保存的模型');
    await settings.getByRole('radio', { name: '深色', exact: true }).check();
    await settings.getByRole('button', { name: '保存', exact: true }).click();
    await expect(settings.getByRole('alert')).toContainText('保存或读取失败');
    await expect(settings.getByLabel('模型名称')).toHaveValue('保留未保存的模型');
    await expect(settings.getByRole('radio', { name: '深色', exact: true })).toBeChecked();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(await application.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('light');
    expect(await page.evaluate(() => window.settings.get())).toMatchObject({ ok: true, data: { theme: 'light', LLM_MODEL_ID: '' } });
    await page.keyboard.press('Escape');
    await expect(settings).toHaveCount(0);
    await expect(page.getByRole('button', { name: '配置', exact: true })).toBeFocused();
  } finally {
    await application?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
