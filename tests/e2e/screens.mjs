// Developer-only: captures the main views at desktop and phone width into .impeccable/review/
// from a running LocalPress (default http://127.0.0.1:7878/). Usage: node screens.mjs [baseUrl] [videoId]
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.js';

const base = process.argv[2] || 'http://127.0.0.1:7878/';
const video = process.argv[3] || 'my screen test';
const out = path.join(ROOT, '.impeccable', 'review');
fs.mkdirSync(out, { recursive: true });

const sizes = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };
const browser = await chromium.launch();
for (const scheme of ['dark', 'light']) {
  for (const [name, viewport] of Object.entries(sizes)) {
    if (scheme === 'light' && name === 'mobile') continue;
    const page = await browser.newPage({ viewport, colorScheme: scheme, reducedMotion: 'reduce' });
    const shot = async (label) => {
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(out, `${label}-${name}-${scheme}.png`), fullPage: label === 'library' || label === 'video' });
    };
    await page.goto(base);
    await page.locator('a.frame').first().waitFor();
    await shot('library');
    await page.goto(`${base}#/v/${encodeURIComponent(video)}`);
    await page.locator('.print, .out').first().waitFor();
    await shot('video');
    await page.getByRole('button', { name: /^Compare/ }).first().click();
    await page.locator('#compare video').first().evaluate((v) => new Promise((r) => (v.readyState >= 2 ? r() : v.addEventListener('loadeddata', r, { once: true }))));
    await shot('compare');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /^Tools/ }).click();
    await shot('tools');
    await page.close();
  }
}
await browser.close();
console.log(`saved to ${out}`);
