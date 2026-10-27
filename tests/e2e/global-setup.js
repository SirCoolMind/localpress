import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CLIPS, FFMPEG } from './helpers.js';

// Short generated clips: a screen-like one (static text, a moving cursor; constant bitrate with filler, like Game Bar or OBS CBR) and a camera-like one
// (constant motion plus sensor-style noise), both saved the way recorders do (high-bitrate H.264).
export default function globalSetup() {
  fs.mkdirSync(CLIPS, { recursive: true });
  const make = (name, args) => {
    const out = path.join(CLIPS, name);
    if (!fs.existsSync(out)) execFileSync(FFMPEG, ['-hide_banner', '-v', 'error', '-y', ...args, out]);
  };
  make('screen clip.mp4', [
    '-f', 'lavfi', '-i', 'color=c=0x1e1e1e:s=960x540:r=30:d=12',
    '-f', 'lavfi', '-i', 'color=c=white:s=10x16:r=30',
    '-f', 'lavfi', '-i', 'sine=f=440:d=12',
    '-filter_complex', "[0:v]drawbox=x=0:y=0:w=180:h=ih:color=0x2a2a2a:t=fill,drawgrid=w=960:h=24:t=1:c=0x3a3a3a[bg];[bg][1:v]overlay=x='if(lt(t\\,5)\\,300+t*60\\,600)':y=200:eval=frame[v]",
    '-map', '[v]', '-map', '2:a', '-t', '12',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '8M', '-minrate', '8M', '-maxrate', '8M', '-bufsize', '8M',
    '-x264-params', 'nal-hrd=cbr:filler=1', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k',
  ]);
  make('camera clip.mp4', [
    '-f', 'lavfi', '-i', 'testsrc2=s=960x540:r=30:d=8',
    '-vf', 'noise=alls=10:allf=t',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '10M', '-pix_fmt', 'yuv420p', '-an',
  ]);
}
