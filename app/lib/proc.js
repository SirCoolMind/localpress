import { spawn } from 'node:child_process';

export class CancelledError extends Error {
  constructor() {
    super('Cancelled');
    this.cancelled = true;
  }
}

/**
 * Runs a tool and resolves with { code, stdout, stderr }.
 * - `progress: true` adds `-progress pipe:1 -nostats` (ffmpeg) and calls onProgress with the
 *   parsed key/value block ({ out_time_us, frame, speed, ... }) each time ffmpeg reports.
 * - `signal` (AbortSignal) kills the process and rejects with CancelledError.
 * Rejects with an Error carrying the stderr tail when the exit code is not 0 (unless allowFail).
 */
export function run(bin, args, { signal, onProgress, progress = false, allowFail = false, cwd } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new CancelledError());
    const fullArgs = progress ? ['-progress', 'pipe:1', '-nostats', ...args] : args;
    const child = spawn(bin, fullArgs, { windowsHide: true, cwd });

    let stdout = '';
    let stderr = '';
    let block = {};
    child.stdout.on('data', (d) => {
      const text = d.toString();
      if (!progress) {
        stdout += text;
        return;
      }
      for (const line of text.split(/\r?\n/)) {
        const eq = line.indexOf('=');
        if (eq < 0) continue;
        const key = line.slice(0, eq).trim();
        const value = line.slice(eq + 1).trim();
        block[key] = value;
        if (key === 'progress') {
          onProgress?.(block);
          block = {};
        }
      }
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
    });

    const onAbort = () => child.kill();
    signal?.addEventListener('abort', onAbort, { once: true });

    child.on('error', (err) => {
      signal?.removeEventListener('abort', onAbort);
      reject(err);
    });
    child.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) return reject(new CancelledError());
      if (code !== 0 && !allowFail) {
        const tail = stderr.trim().split(/\r?\n/).slice(-8).join('\n');
        const err = new Error(`${bin.split(/[\\/]/).pop()} exited with code ${code}\n${tail}`);
        err.code = code;
        err.stderr = stderr;
        return reject(err);
      }
      resolve({ code, stdout, stderr });
    });
  });
}
