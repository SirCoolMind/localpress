import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchQuality, sampleWindows, spotWindows, nextQAfterMiss } from '../../app/lib/search.js';

// A fake encoder: VMAF falls as q rises (roughly what av1_nvenc measured on the target laptop).
const curve = (slope, at20) => async (q) => at20 - slope * (q - 20);

test('finds the highest q that meets the target within the probe budget', async () => {
  const evaluate = curve(0.35, 100); // q=34 → 95.1, q=35 → 94.75
  const r = await searchQuality({ lo: 20, hi: 55, target: 95, start: 39, maxProbes: 6, evaluate });
  assert.equal(r.met, true);
  assert.equal(r.q, 34);
  assert.ok(r.probes.length <= 6);
});

test('converges from a bad start guess on either side', async () => {
  for (const start of [20, 55, 30, 50]) {
    const r = await searchQuality({ lo: 20, hi: 55, target: 93, start, maxProbes: 6, evaluate: curve(0.5, 100) });
    // 100 - 0.5*(q-20) >= 93 → q <= 34
    assert.equal(r.q, 34, `start ${start}`);
  }
});

test('never evaluates the same q twice and stays inside the range', async () => {
  const seen = [];
  await searchQuality({
    lo: 20, hi: 55, target: 95, start: 39, maxProbes: 6,
    evaluate: async (q) => { seen.push(q); return 100 - 0.4 * (q - 20); },
  });
  assert.equal(new Set(seen).size, seen.length);
  assert.ok(seen.every((q) => q >= 20 && q <= 55));
});

test('returns the best quality tried, flagged not met, when nothing reaches the target', async () => {
  const r = await searchQuality({ lo: 20, hi: 55, target: 99, start: 39, maxProbes: 6, evaluate: curve(0.3, 96) });
  assert.equal(r.met, false);
  assert.equal(r.q, 20);
});

test('returns hi when everything passes', async () => {
  const r = await searchQuality({ lo: 20, hi: 55, target: 80, start: 39, maxProbes: 6, evaluate: curve(0.1, 100) });
  assert.equal(r.met, true);
  assert.equal(r.q, 55);
});

test('handles a noisy, non-linear curve without breaking the budget', async () => {
  const evaluate = async (q) => 99 - 0.02 * (q - 20) ** 2 + (q % 3 === 0 ? 0.2 : -0.1);
  const r = await searchQuality({ lo: 20, hi: 55, target: 95, start: 39, maxProbes: 6, evaluate });
  assert.ok(r.probes.length <= 6);
  assert.ok(r.met && r.score >= 95);
});

test('sample windows: whole short videos, eight 4 s samples otherwise', () => {
  assert.deepEqual(sampleWindows(30), [{ ss: 0, t: 30 }]);
  const w = sampleWindows(600);
  assert.equal(w.length, 8);
  assert.ok(w.every((x, i) => x.t === 4 && x.ss >= 0 && x.ss + x.t <= 600 && (i === 0 || x.ss > w[i - 1].ss)));
});

test('after a missed verify, re-aims by the measured gap and the probe slope', () => {
  // The Tears of Steel case: probes ~0.5 VMAF per q, verify 5 points short at q42.
  const probes = [{ q: 39, score: 97.3 }, { q: 42, score: 96.07 }, { q: 44, score: 95.05 }, { q: 46, score: 93.66 }, { q: 45, score: 94.39 }];
  const next = nextQAfterMiss({ q: 42, score: 90, target: 95, probes, lo: 20, step: 2 });
  assert.ok(next <= 32 && next >= 26, `next ${next}`);
  // A small miss is one step; no room left returns null; never below the floor.
  assert.equal(nextQAfterMiss({ q: 40, score: 94.8, target: 95, probes, lo: 20, step: 2 }), 38);
  assert.equal(nextQAfterMiss({ q: 20, score: 90, target: 95, probes, lo: 20, step: 2 }), null);
  assert.equal(nextQAfterMiss({ q: 22, score: 60, target: 95, probes, lo: 20, step: 2 }), 20);
  // A flat fit cannot stall the loop.
  assert.equal(nextQAfterMiss({ q: 30, score: 94, target: 95, probes: [{ q: 30, score: 94 }, { q: 32, score: 94 }], lo: 20, step: 2 }), 24);
});

test('spot windows: ten 6 s windows spread across the video', () => {
  const w = spotWindows(600);
  assert.equal(w.length, 10);
  assert.ok(w.every((x, i) => x.t === 6 && (i === 0 || x.ss > w[i - 1].ss) && x.ss + x.t <= 600));
});
