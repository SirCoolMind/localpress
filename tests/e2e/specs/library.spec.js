import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { CLIPS, resetLibrary } from '../helpers.js';

test.beforeEach(() => resetLibrary());

test('empty library invites a drop and says originals stay put', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Drop a recording anywhere' })).toBeVisible();
  await expect(page.getByText('Your original is never touched')).toBeVisible();
});

test('Choose files copies a video in, cleans its name and detects a screen recording', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles(path.join(CLIPS, 'screen clip.mp4'));
  const card = page.locator('a.frame', { hasText: 'screen clip' });
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card).toContainText('Screen');
  await expect(card).toContainText('Not compressed yet');
  await expect(page.locator('.uploads')).toHaveCount(0);
});

test('drag-and-drop anywhere imports, and a repeated name becomes "name (2)"', async ({ page }) => {
  await page.goto('/');
  const bytes = fs.readFileSync(path.join(CLIPS, 'camera clip.mp4')).toString('base64');
  const drop = async () => {
    const dt = await page.evaluateHandle((b64) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const d = new DataTransfer();
      d.items.add(new File([bin], 'camera clip.mp4', { type: 'video/mp4' }));
      return d;
    }, bytes);
    await page.dispatchEvent('body', 'dragenter', { dataTransfer: dt });
    await expect(page.locator('#dropveil')).toBeVisible();
    await page.dispatchEvent('body', 'drop', { dataTransfer: dt });
  };
  await drop();
  await expect(page.locator('a.frame', { hasText: 'camera clip' })).toHaveCount(1, { timeout: 60_000 });
  await expect(page.locator('a.frame', { hasText: 'camera clip' })).toContainText('Camera');
  await drop();
  await expect(page.locator('a.frame', { hasText: 'camera clip (2)' })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('#dropveil')).toBeHidden();
});

test('a file that is not a video is refused with a clear message', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(page.locator('.upload.error')).toContainText('not a supported video file');
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.locator('.upload')).toHaveCount(0);
});
