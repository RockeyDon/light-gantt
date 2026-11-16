import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { addDays, today } from '../../src/shared/dates';

async function launch(directory: string) {
  const executablePath = path.resolve('out', `轻甘特-darwin-${process.arch}`, '轻甘特.app/Contents/MacOS/LightGantt');
  const application = await electron.launch({ executablePath, env: { ...process.env, LIGHT_GANTT_DATA_DIR: directory } });
  const page = await application.firstWindow();
  await expect(page.getByRole('button', { name: '新建任务', exact: true }).first()).toBeEnabled();
  return { application, page };
}

async function records(page: Page) {
  return page.evaluate(async () => {
    const result = await window.progress.list();
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  });
}

async function create(page: Page) {
  await page.getByRole('button', { name: '新建任务', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: '安排一个新任务' });
  await dialog.locator('input[name=name]').fill('进展设计');
  await dialog.getByRole('button', { name: '创建任务' }).click();
  await expect(dialog).toHaveCount(0);
  return page.evaluate(async () => {
    const result = await window.tasks.list();
    if (!result.ok) throw new Error(result.error.message);
    return result.data[0];
  });
}

test('daily progress supports context menus, fixed-date markers, history, edits, deletion and restart', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'light-gantt-progress-e2e-'));
  let application: ElectronApplication | undefined;
  try {
    let running = await launch(directory);
    application = running.application;
    let page = running.page;
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const task = await create(page);
    const row = page.getByTestId(`task-${task.id}`);
    await row.click({ button: 'right' });
    await page.getByRole('menuitem', { name: '记录今日进展' }).click();
    const dialog = page.getByRole('dialog', { name: '每日进展', exact: true });
    await expect(dialog.getByLabel('日期', { exact: true })).toHaveValue(today());
    await dialog.getByLabel('进展内容').fill('完成时间轴标记');
    await dialog.getByRole('button', { name: '记录进展', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const marker = page.getByTestId(`progress-${task.id}-${today()}`);
    await expect(marker).toBeVisible();
    await expect(marker).toHaveAttribute('title', /完成时间轴标记/);
    const initialMarker = (await marker.boundingBox())!;
    await page.getByTestId('timeline-scroll').evaluate((element) => {
      element.scrollLeft = 88;
    });
    await expect.poll(async () => (await marker.boundingBox())!.x).toBe(initialMarker.x - 88);
    await page.getByTestId('timeline-scroll').evaluate((element) => {
      element.scrollLeft = 0;
    });
    await expect.poll(async () => (await marker.boundingBox())!.x).toBe(initialMarker.x);
    await page.getByRole('button', { name: '时间设置', exact: true }).click();
    await page.getByRole('button', { name: '周', exact: true }).click();
    await expect(marker).toBeVisible();
    await marker.click();
    await expect(dialog.getByLabel('进展内容')).toHaveValue('完成时间轴标记');
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '时间设置', exact: true }).click();
    await page.getByRole('button', { name: '日', exact: true }).click();
    expect((await row.boundingBox())!.height).toBe(48);
    await marker.click();
    await expect(dialog.getByLabel('进展内容')).toHaveValue('完成时间轴标记');
    await dialog.getByLabel('进展内容').fill('完成标记和弹窗');
    await dialog.getByRole('button', { name: '保存进展', exact: true }).click();
    expect(await records(page)).toHaveLength(1);
    await row.click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: '编辑今日进展' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    // Moving the plan leaves the history marker at the original calendar date.
    const bar = (await page.getByTestId(`bar-${task.id}`).boundingBox())!;
    await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2);
    await page.mouse.down();
    await page.mouse.move(bar.x + bar.width / 2 + 88, bar.y + bar.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const value = await window.tasks.list();
          return value.ok ? value.data[0].start_time : '';
        }),
      )
      .toBe(addDays(today(), 2));
    expect((await marker.boundingBox())!.x).toBe(initialMarker.x);
    await expect(marker).toBeVisible();
    // A marker outside the task bar can still be edited.
    await marker.click();
    await expect(dialog.getByLabel('进展内容')).toHaveValue('完成标记和弹窗');
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '进展设计', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '编辑任务' });
    await editor.locator('input[name=name]').fill('任务字段尚未保存');
    await editor.getByRole('tab', { name: '每日进展', exact: true }).click();
    await expect(editor.getByText('完成标记和弹窗', { exact: true })).toBeVisible();
    await editor.getByRole('button', { name: '补记其他日期' }).click();
    const date = editor.getByLabel('日期', { exact: true });
    await date.fill(addDays(today(), 1));
    await editor.getByLabel('进展内容').fill('不能保存未来');
    await editor.getByRole('button', { name: '记录进展', exact: true }).click();
    expect(await records(page)).toHaveLength(1);
    // Reject discarding edits when changing target dates.
    page.once('dialog', (alert) => alert.dismiss());
    await date.fill(addDays(today(), -1));
    await expect(date).toHaveValue(addDays(today(), 1));
    page.once('dialog', (alert) => alert.accept());
    await date.fill(addDays(today(), -1));
    await editor.getByLabel('进展内容').fill('昨天完成初稿');
    await editor.getByRole('button', { name: '记录进展', exact: true }).click();
    await expect(editor.getByText('昨天完成初稿', { exact: true })).toBeVisible();
    await editor.getByRole('tab', { name: '任务信息', exact: true }).click();
    await expect(editor.locator('input[name=name]')).toHaveValue('任务字段尚未保存');
    await editor.getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.getByRole('button', { name: '进展设计', exact: true })).toBeVisible();
    // Existing dates load their records; a stale confirmation must not overwrite newer content.
    await marker.click();
    await dialog.getByLabel('日期', { exact: true }).fill(addDays(today(), -1));
    await expect(dialog.getByLabel('进展内容')).toHaveValue('昨天完成初稿');
    await dialog.getByLabel('进展内容').fill('过期窗口的修改');
    await page.evaluate(
      async ({ id, day }) => {
        const result = await window.progress.save({ task_id: id, date: day, content: '另一处已更新', expected_content: '昨天完成初稿' });
        if (!result.ok) throw new Error(result.error.message);
      },
      { id: task.id, day: addDays(today(), -1) },
    );
    await dialog.getByRole('button', { name: '保存进展', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('已发生变化');
    page.once('dialog', (alert) => alert.accept());
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await application.close();
    application = undefined;
    running = await launch(directory);
    application = running.application;
    page = running.page;
    expect(await records(page)).toHaveLength(2);
    await page.getByTestId(`progress-${task.id}-${addDays(today(), -1)}`).click();
    const reopened = page.getByRole('dialog', { name: '每日进展', exact: true });
    await expect(reopened.getByLabel('进展内容')).toHaveValue('另一处已更新');
    await reopened.getByRole('button', { name: '删除进展', exact: true }).click();
    await reopened.getByRole('button', { name: '确认删除进展', exact: true }).click();
    await expect(reopened).toHaveCount(0);
    expect(await records(page)).toHaveLength(1);
    expect(errors).toEqual([]);
  } finally {
    await application?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('progress management fits both themes at minimum size and completed tasks keep their history', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'light-gantt-progress-layout-'));
  let application: ElectronApplication | undefined;
  try {
    const running = await launch(directory);
    application = running.application;
    const page = running.page;
    const task = await create(page);
    await page.getByTestId(`task-${task.id}`).click({ button: 'right' });
    await page.getByRole('menuitem', { name: '记录今日进展' }).click();
    const dialog = page.getByRole('dialog', { name: '每日进展', exact: true });
    await dialog.getByLabel('进展内容').fill('今天的记录');
    await dialog.getByRole('button', { name: '记录进展', exact: true }).click();
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(860, 600));
    for (const theme of ['light', 'dark'] as const) {
      await page.getByRole('button', { name: '配置', exact: true }).click();
      const settings = page.getByRole('dialog', { name: '配置', exact: true });
      await settings.getByRole('radio', { name: theme === 'light' ? '浅色' : '深色', exact: true }).check();
      await settings.getByRole('button', { name: '保存', exact: true }).click();
      await page.getByTestId(`progress-${task.id}-${today()}`).click();
      await expect(dialog.getByRole('button', { name: '保存进展', exact: true })).toBeInViewport();
      await page.screenshot({ path: `test-results/progress-${theme}.png` });
      await dialog.getByRole('button', { name: '取消', exact: true }).click();
      await page.screenshot({ path: `test-results/progress-marker-${theme}.png` });
    }
    await page.getByRole('button', { name: '完成任务：进展设计' }).click();
    await page.getByRole('separator', { name: '调整已完成区域高度' }).press('End');
    const completed = page.getByRole('region', { name: '已完成任务', exact: true });
    await completed.getByRole('button', { name: '进展设计', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: '编辑今日进展' }).click();
    await expect(dialog.getByLabel('进展内容')).toHaveValue('今天的记录');
    await dialog.getByLabel('日期', { exact: true }).fill(addDays(today(), -1));
    await dialog.getByLabel('进展内容').fill('完成后补记');
    await dialog.getByRole('button', { name: '记录进展', exact: true }).click();
    expect(await records(page)).toHaveLength(2);
    await completed.getByRole('button', { name: '进展设计', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '编辑任务' });
    await editor.getByRole('tab', { name: '每日进展', exact: true }).click();
    await expect(editor.getByText('完成后补记', { exact: true })).toBeVisible();
    await editor.getByRole('tab', { name: '任务信息', exact: true }).click();
    await editor.getByRole('button', { name: '删除任务', exact: true }).click();
    await page.getByRole('button', { name: '确认删除', exact: true }).click();
    expect(await records(page)).toEqual([]);
  } finally {
    await application?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
