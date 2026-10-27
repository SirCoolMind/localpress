/**
 * Finds the highest quality knob `q` (smallest file) in [lo, hi] whose score meets `target`,
 * assuming the score falls as q rises. Starts at `start`, then interpolates between the closest
 * passing and failing tries (each try is expensive), at most `maxProbes` evaluations.
 * Returns { q, score, met, probes: [{ q, score }] }. When even `lo` misses, returns lo (met: false).
 */
export async function searchQuality({ lo, hi, target, start, maxProbes = 6, evaluate }) {
  const probes = [];
  const scores = new Map();
  const clamp = (q) => Math.max(lo, Math.min(hi, Math.round(q)));

  const bracket = () => {
    let pass = null;
    let fail = null;
    for (const [q, s] of scores) {
      if (s >= target && (pass === null || q > pass)) pass = q;
    }
    for (const [q, s] of scores) {
      if (s < target && q > (pass ?? -Infinity) && (fail === null || q < fail)) fail = q;
    }
    return { pass, fail };
  };

  // Score change per unit of q, from the two nearest tries (falls back to a typical slope).
  const slope = () => {
    const pts = [...scores].sort((a, b) => a[0] - b[0]);
    if (pts.length < 2) return -0.6;
    const [a, b] = pts.length === 2 ? pts : pts.slice(-2);
    const s = (b[1] - a[1]) / (b[0] - a[0]);
    return s < -0.05 ? s : -0.6;
  };

  let q = clamp(start ?? (lo + hi) / 2);
  while (probes.length < maxProbes && !scores.has(q)) {
    const score = await evaluate(q, probes.length);
    scores.set(q, score);
    probes.push({ q, score });

    const { pass, fail } = bracket();
    let next;
    if (pass !== null && fail !== null) {
      if (fail - pass <= 1) break;
      const sp = scores.get(pass);
      const sf = scores.get(fail);
      const t = sp === sf ? 0.5 : (sp - target) / (sp - sf);
      next = Math.max(pass + 1, Math.min(fail - 1, Math.round(pass + t * (fail - pass))));
    } else if (pass === null) {
      // Everything so far misses: step toward better quality.
      const lowest = Math.min(...scores.keys());
      if (lowest === lo) break;
      const jump = Math.max(2, Math.min(10, Math.ceil((target - scores.get(lowest)) / -slope()) + 1));
      next = clamp(lowest - jump);
    } else {
      // Everything so far passes: step toward smaller files.
      const highest = Math.max(...scores.keys());
      if (highest === hi) break;
      const jump = Math.max(2, Math.min(10, Math.floor((scores.get(highest) - target) / -slope())));
      next = clamp(highest + jump);
    }
    q = next;
  }

  const { pass } = bracket();
  if (pass === null) {
    const best = Math.min(...scores.keys());
    return { q: best, score: scores.get(best), met: false, probes };
  }
  return { q: pass, score: scores.get(pass), met: true, probes };
}

/**
 * Sample windows used by the search: the whole video when short, else 8 × 4 s spread out.
 * More, shorter windows cost the same as 4 × 8 s but one easy scene (end credits) can no longer
 * carry the average — that made a 12-minute film pass the search at 96 and verify at 90.
 */
export function sampleWindows(duration) {
  if (duration < 40) return [{ ss: 0, t: duration }];
  return Array.from({ length: 8 }, (_, i) => ({ ss: Math.max(0, (duration * (i + 0.5)) / 8 - 2), t: 4 }));
}

/**
 * After the full encode misses the target, where to try next: steps down by the gap divided by
 * the VMAF-per-q slope the search measured (clamped, so a flat or noisy fit cannot stall or jump
 * wildly), rounded to whole encoder steps. Returns null when there is no room left.
 */
export function nextQAfterMiss({ q, score, target, probes, lo, step }) {
  if (q <= lo) return null;
  let slope = 0.5;
  if (probes.length >= 2) {
    const n = probes.length;
    const mq = probes.reduce((s, p) => s + p.q, 0) / n;
    const ms = probes.reduce((s, p) => s + p.score, 0) / n;
    const cov = probes.reduce((s, p) => s + (p.q - mq) * (p.score - ms), 0);
    const varq = probes.reduce((s, p) => s + (p.q - mq) ** 2, 0);
    if (varq > 0) slope = -cov / varq;
  }
  slope = Math.min(3, Math.max(0.25, slope));
  const steps = Math.max(1, Math.ceil((target - score + 0.3) / slope / step));
  return Math.max(lo, q - Math.min(steps, 8) * step);
}

/** Spot-check windows for verifying long outputs: 10 × 6 s, evenly spread. */
export function spotWindows(duration) {
  return Array.from({ length: 10 }, (_, i) => ({ ss: Math.max(0, (duration * (i + 0.5)) / 10 - 3), t: 6 }));
}

export const FULL_VERIFY_LIMIT = 120;
