import { test, expect } from '@playwright/test';
import path from 'node:path';
import { CLIPS, mainServer, importFile, resetLibrary } from '../helpers.js';

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  await resetLibrary();
  await importFile(mainServer.url, path.join(CLIPS, 'screen clip.mp4'));
});

test('queue an Archive version and see the result with size, saving and VMAF', async ({ page }) => {
  await page.goto('/#/v/screen%20clip');
  await expect(page.getByRole('heading', { name: 'screen clip' })).toBeVisible();
  await expect(page.locator('.chip', { hasText: 'Screen recording' })).toBeVisible();

  await page.getByRole('group', { name: 'Profile' }).getByRole('button', { name: /Archive/ }).click();
  await page.getByRole('group', { name: 'Quality (VMAF)' }).getByRole('button', { name: '93' }).click();
  await page.getByRole('group', { name: 'Encoder' }).getByRole('button', { name: 'GPU' }).click();
  await page.getByRole('button', { name: 'Compress' }).click();

  await expect(page.locator('.jobline')).toBeVisible();
  await expect(page.getByRole('button', { name: /Queue, 1 active/ })).toBeVisible();

  const version = page.locator('.out').first();
  await expect(version).toContainText('Archive · AV1', { timeout: 240_000 });
  await expect(page.locator('.print .pct')).toHaveText(/^−\d+%$/);
  const vmaf = Number((await version.locator('.figs').innerText()).match(/VMAF ([\d.]+)/)[1]);
  expect(vmaf).toBeGreaterThanOrEqual(92);
  await expect(page.getByRole('button', { name: /Queue, 0 active/ })).toBeVisible();
});

test('compare: wipe, solo, zoom and keyboard shortcuts', async ({ page }) => {
  await page.goto('/#/v/screen%20clip');
  await page.getByRole('button', { name: /Compare Archive/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Compare original and output' });
  await expect(dialog).toBeVisible();
  const viewport = dialog.locator('.viewport');

  const box = await viewport.boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  const wipe = await viewport.evaluate((el) => parseFloat(el.style.getPropertyValue('--wipe')));
  expect(wipe).toBeGreaterThan(20);
  expect(wipe).toBeLessThan(30);

  await page.keyboard.press(']');
  expect(await viewport.evaluate((el) => parseFloat(el.style.getPropertyValue('--wipe')))).toBeCloseTo(wipe + 5, 0);

  await page.keyboard.press('1');
  await expect(viewport).toHaveClass(/solo-a/);
  await page.keyboard.press('2');
  await expect(viewport).toHaveClass(/solo-b/);
  await page.keyboard.press('2');
  await expect(viewport).not.toHaveClass(/solo/);

  await expect.poll(() => dialog.locator('video').first().evaluate((v) => v.readyState)).toBeGreaterThan(0);
  await page.keyboard.press('z');
  await expect(viewport).toHaveClass(/zoomed/);
  await page.keyboard.press('z');
  await expect(viewport).not.toHaveClass(/zoomed/);

  await page.keyboard.press('ArrowRight');
  await expect.poll(() => dialog.locator('video').first().evaluate((v) => v.currentTime)).toBeGreaterThan(0);

  await page.keyboard.press('?');
  await expect(dialog.getByRole('heading', { name: 'Shortcuts' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog.getByRole('heading', { name: 'Shortcuts' })).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/#\/v\/screen%20clip$/);
});

test('manage: delete a version, remove the source copy, remove the video', async ({ page }) => {
  await page.goto('/#/v/screen%20clip');
  const del = page.getByRole('button', { name: /^Delete Archive/ });
  await del.click();
  await page.getByRole('button', { name: 'Confirm delete' }).click();
  await expect(page.getByText('No versions yet')).toBeVisible();

  await page.getByRole('button', { name: 'Remove source copy' }).click();
  await page.getByRole('button', { name: 'Confirm: keep versions only' }).click();
  await expect(page.locator('.facts')).toContainText('(removed)');
  await expect(page.getByRole('button', { name: 'Compress' })).toBeDisabled();

  await page.getByRole('button', { name: 'Remove from library' }).click();
  await page.getByRole('button', { name: 'Confirm: delete folder' }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.locator('a.frame', { hasText: 'screen clip' })).toHaveCount(0);
});
