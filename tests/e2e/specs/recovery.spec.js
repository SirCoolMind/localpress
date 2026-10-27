import { test, expect } from '@playwright/test';
import path from 'node:path';
import { CLIPS, startServer, importFile, call, waitFor } from '../helpers.js';

test('a job cut off by closing the app shows as interrupted, waits for Retry, and the queue is paused', async ({ page }) => {
  let server = await startServer('recovery', 7981);
  await server.ready();
  const meta = await importFile(server.url, path.join(CLIPS, 'screen clip.mp4'));
  await importFile(server.url, path.join(CLIPS, 'camera clip.mp4'));
  await call(server.url, 'POST', '/api/queue', { videoIds: [meta.id, 'camera clip'], profile: 'archive', target: 95, max: true });
  await waitFor(async () => (await call(server.url, 'GET', '/api/state')).data.queue.running, { timeout: 30_000 });

  server.kill(); // like closing the console window mid-encode
  server = await startServer('recovery', 7981, {}, { fresh: false });
  try {
    const { data } = await call(server.url, 'GET', '/api/state');
    expect(data.queue.paused).toBe(true);
    expect(data.queue.running).toBe(null);

    await page.goto(server.url);
    await page.getByRole('button', { name: /^Queue/ }).click();
    const drawer = page.getByRole('complementary', { name: 'Queue' });
    await expect(drawer).toContainText('The queue is paused');
    await expect(drawer.locator('.job.interrupted')).toContainText('Interrupted');
    await expect(drawer.locator('.job.queued')).toContainText('Waiting');
    await expect(drawer.getByRole('button', { name: 'Resume' })).toBeVisible();

    await drawer.getByRole('button', { name: `Retry ${meta.id}` }).click();
    await expect(drawer.locator('.job.running')).toHaveCount(1);
    await drawer.getByRole('button', { name: `Cancel ${meta.id}` }).click();
    await expect(drawer.locator('.job.cancelled')).toHaveCount(1);
  } finally {
    server.kill();
  }
});
