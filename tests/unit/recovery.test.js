import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// config.js reads these at import time, so set them before importing the library modules.
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'localpress-unit-'));
process.env.LOCALPRESS_VIDEOS_DIR = path.join(dir, 'videos');
process.env.LOCALPRESS_TOOLS_DIR = path.join(dir, 'tools');
process.env.LOCALPRESS_STATE_DIR = path.join(dir, 'state');

const { loadLibrary, listVideos } = await import('../../app/lib/library.js');
const { loadQueue, queueState } = await import('../../app/lib/queue.js');
const { audioArgs } = await import('../../app/lib/engine.js');

const videos = process.env.LOCALPRESS_VIDEOS_DIR;
const meta = (id, outputs) => ({
  id, originalName: `${id}.mp4`, importedAt: '2026-10-26T10:00:00.000Z', sourceRemoved: false,
  source: { file: 'source.mp4', size: 1000, duration: 10, fps: 30, fpsExpr: '30/1' },
  contentType: { detected: 'screen', override: null, dupRatio: 0.5 }, preview: null, outputs,
});
const job = (id, videoId, status) => ({ id, videoId, profile: 'archive', target: 95, max: false, status, progress: 0.4 });

before(async () => {
  for (const id of ['clip', 'other']) {
    await fs.mkdir(path.join(videos, id, 'outputs'), { recursive: true });
    await fs.writeFile(path.join(videos, id, 'source.mp4'), 'x');
  }
  await fs.writeFile(path.join(videos, 'clip', 'outputs', 'kept.mp4'), 'x');
  await fs.writeFile(path.join(videos, 'clip', 'meta.json'), JSON.stringify(meta('clip', [
    { file: 'kept.mp4', size: 10 }, { file: 'deleted-in-explorer.mp4', size: 20 },
  ])));
  await fs.writeFile(path.join(videos, 'other', 'meta.json'), JSON.stringify(meta('other', [])));
  await fs.mkdir(path.join(videos, 'clip', '.work'), { recursive: true });
  await fs.writeFile(path.join(videos, 'clip', '.work', 'output.mp4'), 'half-written');
  await fs.mkdir(path.join(videos, 'not-a-video'), { recursive: true });
  await fs.writeFile(path.join(videos, 'queue.json'), JSON.stringify({
    paused: false,
    jobs: [job('a', 'clip', 'running'), job('b', 'other', 'queued'), job('c', 'gone', 'queued'), job('d', 'clip', 'done')],
  }));
  await loadLibrary();
  await loadQueue();
});

after(() => fs.rm(dir, { recursive: true, force: true }));

test('library scan ignores folders without meta.json and drops outputs deleted outside the app', () => {
  const ids = listVideos().map((v) => v.id).sort();
  assert.deepEqual(ids, ['clip', 'other']);
  assert.deepEqual(listVideos().find((v) => v.id === 'clip').outputs.map((o) => o.file), ['kept.mp4']);
});

test('a running job becomes interrupted and its half-written files are removed', async () => {
  const q = queueState();
  assert.equal(q.jobs.find((j) => j.id === 'a').status, 'interrupted');
  await assert.rejects(fs.stat(path.join(videos, 'clip', '.work')));
});

test('waiting jobs stay queued but the queue starts paused', () => {
  const q = queueState();
  assert.equal(q.paused, true);
  assert.equal(q.jobs.find((j) => j.id === 'b').status, 'queued');
  assert.equal(q.running, null);
});

test('jobs for videos no longer in the library are dropped', () => {
  assert.equal(queueState().jobs.some((j) => j.id === 'c'), false);
});

test('recovery is persisted to queue.json', async () => {
  const saved = JSON.parse(await fs.readFile(path.join(videos, 'queue.json'), 'utf8'));
  assert.equal(saved.paused, true);
  assert.equal(saved.jobs.find((j) => j.id === 'a').status, 'interrupted');
});

test('audio is copied when already efficient, re-encoded otherwise', () => {
  assert.deepEqual(audioArgs({ acodec: null }), ['-an']);
  assert.deepEqual(audioArgs({ acodec: 'aac', abitrate: 128000 }), ['-map', '0:a:0', '-c:a:0', 'copy']);
  assert.deepEqual(audioArgs({ acodec: 'opus', abitrate: 96000 }), ['-map', '0:a:0', '-c:a:0', 'copy']);
  assert.deepEqual(audioArgs({ acodec: 'aac', abitrate: 320000 }), ['-map', '0:a:0', '-c:a:0', 'aac', '-b:a:0', '128k']);
  assert.deepEqual(audioArgs({ acodec: 'pcm_s16le', abitrate: 1536000 }), ['-map', '0:a:0', '-c:a:0', 'aac', '-b:a:0', '128k']);
  assert.deepEqual(audioArgs({ acodec: 'aac', abitrate: null }), ['-map', '0:a:0', '-c:a:0', 'aac', '-b:a:0', '128k']);
  // Every track survives (OBS: game on track 1, mic on track 2); 5.1 gets more bits.
  assert.deepEqual(audioArgs({ audioTracks: [{ codec: 'mp3', bitrate: 160000, channels: 2 }, { codec: 'ac3', bitrate: 320000, channels: 6 }] }),
    ['-map', '0:a:0', '-c:a:0', 'copy', '-map', '0:a:1', '-c:a:1', 'aac', '-b:a:1', '256k']);
  assert.deepEqual(audioArgs({ audioTracks: [] }), ['-an']);
});

test('vmafScale scores anything above 1080p at 1080p, keeping orientation', async () => {
  const { vmafScale } = await import('../../app/lib/media.js');
  assert.equal(vmafScale(1920, 1080), '');
  assert.equal(vmafScale(1080, 1920), '');
  assert.equal(vmafScale(1366, 767), '');
  assert.equal(vmafScale(2560, 1440), ',scale=1920:1080:flags=bicubic');
  assert.equal(vmafScale(3840, 2160), ',scale=1920:1080:flags=bicubic');
  assert.equal(vmafScale(2160, 3840), ',scale=1080:1920:flags=bicubic');
  assert.equal(vmafScale(3840, 1600), ',scale=2592:1080:flags=bicubic');
  assert.equal(vmafScale(undefined, undefined), '');
});
