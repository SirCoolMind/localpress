import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { TMP, TOOLS, startServer } from '../helpers.js';

// A server whose tools folder starts empty. "Install" pulls from a local zip built from the
// real ffmpeg, through the same download → checksum → extract → test path as the pinned URL.
let server;
test.beforeAll(async () => {
  const fixture = path.join(TMP, 'fixture');
  const zip = path.join(TMP, 'ffmpeg-fixture.zip');
  if (!fs.existsSync(zip)) {
    const bin = path.join(fixture, 'ffmpeg-fixture', 'bin');
    fs.mkdirSync(bin, { recursive: true });
    for (const f of ['ffmpeg.exe', 'ffprobe.exe']) fs.copyFileSync(path.join(TOOLS, 'ffmpeg', 'bin', f), path.join(bin, f));
    execFileSync(path.join(process.env.SystemRoot, 'System32', 'tar.exe'), ['-a', '-c', '-f', zip, '-C', fixture, 'ffmpeg-fixture']);
  }
  const data = fs.readFileSync(zip);
  server = await startServer('tools', 7980, {
    LOCALPRESS_TOOLS_DIR: path.join(TMP, 'tools', 'empty-tools'),
    LOCALPRESS_FFMPEG_URL: pathToFileURL(zip).href,
    LOCALPRESS_FFMPEG_SHA256: crypto.createHash('sha256').update(data).digest('hex'),
    LOCALPRESS_FFMPEG_SIZE: String(data.length),
    LOCALPRESS_FFMPEG_FOLDER: 'ffmpeg-fixture',
  });
});
test.afterAll(() => server?.kill());

test('missing tools: setup banner, install, encoders detected, uninstall', async ({ page }) => {
  await page.goto(server.url);
  await expect(page.getByRole('region', { name: 'One-time setup' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose files' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Tools, needs setup' })).toBeVisible();

  await page.getByRole('button', { name: 'Set up' }).click();
  const drawer = page.getByRole('complementary', { name: 'Tools' });
  await expect(drawer).toContainText('Not installed');
  await expect(drawer).toContainText('portable copy in app\\runtime');
  await drawer.getByRole('button', { name: 'Install', exact: true }).click();

  await expect(drawer).toContainText('Version', { timeout: 120_000 });
  await expect(drawer.locator('.enc .v.use')).toHaveCount(2, { timeout: 120_000 });
  await expect(page.getByRole('button', { name: 'Tools, ready' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'One-time setup' })).toHaveCount(0);

  await drawer.getByRole('button', { name: 'Uninstall tools' }).click();
  await drawer.getByRole('button', { name: 'Confirm uninstall' }).click();
  await expect(drawer).toContainText('Not installed', { timeout: 60_000 });
  await expect(drawer.getByRole('button', { name: 'Uninstall tools' })).toHaveCount(0);
  expect(fs.existsSync(path.join(TMP, 'tools', 'empty-tools', 'ffmpeg'))).toBe(false);
});

test('a download that fails its checksum is discarded', async ({ page }) => {
  server.kill();
  const zip = path.join(TMP, 'ffmpeg-fixture.zip');
  server = await startServer('tools', 7980, {
    LOCALPRESS_TOOLS_DIR: path.join(TMP, 'tools', 'empty-tools'),
    LOCALPRESS_FFMPEG_URL: pathToFileURL(zip).href,
    LOCALPRESS_FFMPEG_SHA256: '0'.repeat(64),
    LOCALPRESS_FFMPEG_FOLDER: 'ffmpeg-fixture',
  });
  await page.goto(server.url);
  await page.getByRole('button', { name: /Tools/ }).click();
  const drawer = page.getByRole('complementary', { name: 'Tools' });
  await drawer.getByRole('button', { name: 'Install', exact: true }).click();
  await expect(drawer.getByRole('alert')).toContainText('did not match the expected checksum');
  expect(fs.existsSync(path.join(TMP, 'tools', 'empty-tools', 'ffmpeg'))).toBe(false);
});
