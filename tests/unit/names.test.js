import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanName, uniqueName, outputName, isPlainSegment } from '../../app/lib/names.js';

test('cleanName strips the extension and characters Windows forbids', () => {
  assert.equal(cleanName('my screen: test.mp4'), 'my screen test');
  assert.equal(cleanName('a<b>c"d|g?h*i.mkv'), 'abcdghi');
  assert.equal(cleanName('tab\there\u0001.mov'), 'tab here');
});

test('cleanName trims trailing dots and spaces and collapses whitespace', () => {
  assert.equal(cleanName('clip...   .mp4'), 'clip');
  assert.equal(cleanName('  lots   of   space  .mp4'), 'lots of space');
});

test('cleanName guards reserved device names and empty results', () => {
  assert.equal(cleanName('CON.mp4'), 'CON_');
  assert.equal(cleanName('CON.. clip.mp4'), '_CON.. clip');
  assert.equal(cleanName('nul .backup.mp4'), '_nul .backup');
  assert.equal(cleanName('nul.mkv'), 'nul_');
  assert.equal(cleanName('com1.mp4'), 'com1_');
  assert.equal(cleanName('console.mp4'), 'console');
  assert.equal(cleanName('???.mp4'), 'video');
  assert.equal(cleanName('.mp4'), 'mp4');
  assert.equal(cleanName('...hidden.mp4'), 'hidden');
});

test('cleanName never returns a path and caps the length', () => {
  assert.equal(cleanName('C:\\Users\\x\\..\\evil.mp4'), 'evil');
  assert.equal(cleanName('../../etc/passwd.mp4'), 'passwd');
  assert.ok(cleanName(`${'a'.repeat(200)}.mp4`).length <= 80);
});

test('uniqueName adds (2), (3)… case-insensitively', () => {
  assert.equal(uniqueName('clip', []), 'clip');
  assert.equal(uniqueName('clip', ['Clip']), 'clip (2)');
  assert.equal(uniqueName('clip', ['clip', 'clip (2)']), 'clip (3)');
});

test('outputName encodes profile, codec, max and target', () => {
  const d = new Date(2026, 9, 26, 14, 32, 15);
  assert.equal(outputName({ profile: 'archive', codec: 'av1', max: false, target: 95 }, d), 'archive-av1_vmaf95_2026-10-26-143215.mp4');
  assert.equal(outputName({ profile: 'share', codec: 'h264', max: true, target: 93 }, d), 'share-h264-max_vmaf93_2026-10-26-143215.mp4');
});

test('isPlainSegment rejects traversal and separators', () => {
  assert.ok(isPlainSegment('archive-av1_vmaf95_2026-10-26-143215.mp4'));
  for (const bad of ['', '.', '..', '../x', 'a/b', 'a\\b', 'c:x']) assert.ok(!isPlainSegment(bad), bad);
});
