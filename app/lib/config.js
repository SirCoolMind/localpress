import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ROOT_DIR = path.dirname(APP_DIR);

// Env overrides exist for the test suites; normal launches never set them.
const env = process.env;

export const paths = {
  root: ROOT_DIR,
  app: APP_DIR,
  ui: path.join(APP_DIR, 'ui'),
  tools: env.LOCALPRESS_TOOLS_DIR || path.join(APP_DIR, 'tools'),
  state: env.LOCALPRESS_STATE_DIR || path.join(APP_DIR, '.state'),
  videos: env.LOCALPRESS_VIDEOS_DIR || path.join(ROOT_DIR, 'videos'),
};

export const FFMPEG_PIN = {
  version: '8.0',
  url: env.LOCALPRESS_FFMPEG_URL || 'https://github.com/GyanD/codexffmpeg/releases/download/8.0/ffmpeg-8.0-full_build.zip',
  sha256: (env.LOCALPRESS_FFMPEG_SHA256 || '48ca5e824d2660a94f89fd55287b7c35129b55bbe680c4330efeed5269c4820f').toLowerCase(),
  size: Number(env.LOCALPRESS_FFMPEG_SIZE || 220298274),
  folder: env.LOCALPRESS_FFMPEG_FOLDER || 'ffmpeg-8.0-full_build',
};

export const PORT_START = Number(env.LOCALPRESS_PORT || 7878);
export const PORT_END = PORT_START + 21;
export const OPEN_BROWSER = env.LOCALPRESS_NO_OPEN !== '1';

export const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mkv', '.mov', '.avi', '.webm', '.m4v', '.wmv', '.flv',
  '.ts', '.mts', '.m2ts', '.3gp', '.mpg', '.mpeg',
]);

// Free space we insist on beyond the copy and a worst-case output.
export const DISK_MARGIN = 200 * 1024 * 1024;
