// npx tsx scripts/minimap-cut.ts <장면 폴더 …/wide-glass.pfsm4.frames> [--out <파일.mp4>] [--fps 20] [--lag-ms 0]
// 미니맵 녹화(scripts/video-check.ts --record-view minimap)를 시험 영상이 처음부터 끝까지 한 번 이어 재생된 것처럼 다시 엮는다.
// 입력은 녹화 장면 폴더(dash/000001.jpg…)와 그 안의 판 기록 run.json(CUT_RUN_FILE: 녹화 시작 시각, 장면과 받은 ms, 폰 페이지 [서버 시각, 영상 시각] 짝,
// 바꾼 단계 영상과 길이, 첫 영상 길이). 장면마다 (녹화 시작 + ms − lag)를 짝으로 영상 시각에 옮기고(videoClock), 영상 조각(playSegments)으로 이은 영상 시각을 붙인다:
// 재생 시작 전과 조각 사이·끝의 마지막 장면 붙잡기(hold)는 뺀다. 받은 차례대로 이은 시각이 앞 장면보다 앞으로 가는 장면만 두고,
// 그 시각으로 ffmpeg concat(scripts/video-record.ts encodeDemo, fps 필터로 일정한 초당 장수)에 넣어 H.264 mp4 하나를 만든다. 같은 판이면 늘 같은 파일이다.
// 기본 출력은 장면 폴더 옆 <줄기>.minimap.mp4(…/wide-glass.pfsm4.frames → …/wide-glass.pfsm4.minimap.mp4). 장면 폴더는 지우지 않는다. 판정·시험 기록은 건드리지 않는다.
// --lag-ms: 대시보드 화면이 폰 장면을 보이기까지 늦는 시간(ms, 기본 0). 장면을 그만큼 앞 영상 시각으로 옮긴다.
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { videoClock, type VideoClip } from "./video-check.js";
import { CUT_RUN_FILE, encodeDemo, type CutRun, type Frame } from "./video-record.js";

export { CUT_RUN_FILE, type CutRun };

/** 재생 조각(영상 시각 [from, to))과 그 조각의 이은 시각 시작(at). */
export interface Segment { from: number; to: number; at: number }

/** 재생 조각: 첫 영상 [0, 첫 길이), 단계 영상마다 [바꾼 영상 시각, + 길이). 다음 영상이 먼저 오면 거기서 자른다. 길이를 모르면 다음 영상까지(마지막이면 끝없음).
 *  at은 앞 조각 길이 합이다. */
export function playSegments(firstDurationMs: number | null, clips: readonly VideoClip[]): Segment[] {
  const starts = [{ from: 0, len: firstDurationMs }, ...clips.map((c) => ({ from: c.video_ms, len: c.duration_ms ?? null }))];
  const segs: Segment[] = [];
  let at = 0;
  starts.forEach((s, i) => {
    const next = starts[i + 1]?.from ?? Infinity;
    const to = Math.min(s.len === null ? Infinity : s.from + s.len, next);
    if (to <= s.from) return;
    segs.push({ from: s.from, to, at });
    at += to - s.from;
  });
  return segs;
}

/** 영상 시각 v의 이은 시각: 조각 안이면 at + (v − from), 재생 전·붙잡기·끝 뒤면 null. */
export function cutTime(v: number, segs: readonly Segment[]): number | null {
  const s = segs.find((x) => v >= x.from && v < x.to);
  return s ? s.at + (v - s.from) : null;
}

/** 녹화 장면 → 이은 장면: 받은 차례대로 이은 시각이 앞 장면보다 앞으로 가는 장면만(ms = 이은 시각).
 *  endMs는 녹화된 마지막 장면의 이은 시각 + tailMs(한 장, 기본 초당 20장의 50ms)이고 조각 길이 합을 넘지 않는다:
 *  계획이 끝나 마지막 영상 중간에 녹화를 끝내도 녹화 안 된 나머지를 마지막 장면으로 늘이지 않는다(Codex b5da6c36 P3). */
export function cutFrames(run: CutRun, lagMs = 0, tailMs = 50): { frames: Frame[]; endMs: number } {
  const toVideo = videoClock(run.t0, run.sync);
  const segs = playSegments(run.firstDurationMs, run.clips);
  const frames: Frame[] = [];
  for (const f of run.frames) {
    const c = cutTime(toVideo(run.startMs + f.ms - lagMs), segs);
    if (c === null || (frames.length && c <= frames.at(-1)!.ms)) continue;
    frames.push({ file: f.file, ms: Math.round(c) });
  }
  const last = segs.at(-1);
  const total = last ? last.at + (last.to - last.from) : 0;
  const endMs = frames.length ? Math.min(total, frames.at(-1)!.ms + tailMs) : 0;
  return { frames, endMs };
}

/** 장면 폴더 dir(run.json)에서 이은 영상 out을 만든다(초당 fps장, 녹화 크기 그대로). 장면 폴더는 그대로 둔다. */
export async function makeCut(dir: string, out: string, o: { fps?: number; lagMs?: number; ffmpeg?: string } = {}): Promise<{ ok: true; seconds: number; frames: number } | { ok: false; why: string }> {
  const file = join(dir, CUT_RUN_FILE);
  if (!existsSync(file)) return { ok: false, why: `판 기록이 없어요: ${file}` };
  const run = JSON.parse(readFileSync(file, "utf8")) as CutRun;
  const fps = o.fps ?? 20;
  const { frames, endMs } = cutFrames(run, o.lagMs ?? 0, 1000 / fps);
  if (!frames.length) return { ok: false, why: "재생 중 장면이 없어요" };
  const made = await encodeDemo(dir, { endMs, frames: { dash: frames }, lost: 0 }, out, { dashSize: run.size, fps, height: run.size[1], keepFrames: true, ...(o.ffmpeg ? { ffmpeg: o.ffmpeg } : {}) });
  return made.ok ? { ok: true, seconds: endMs / 1000, frames: frames.length } : made;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const arg = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
  const dir = argv[0] && !argv[0].startsWith("--") ? resolve(argv[0]) : null;
  const fps = Number(arg("fps") ?? 20);
  const lagMs = Number(arg("lag-ms") ?? 0);
  if (!dir || !Number.isInteger(fps) || fps < 1 || fps > 60 || !Number.isFinite(lagMs) || lagMs < 0) {
    console.error("쓰는 법: npx tsx scripts/minimap-cut.ts <장면 폴더 *.frames> [--out <파일.mp4>] [--fps 20] [--lag-ms 0]");
    return 2;
  }
  const out = resolve(arg("out") ?? join(dirname(dir), `${basename(dir).replace(/\.frames$/, "")}.minimap.mp4`));
  const r = await makeCut(dir, out, { fps, lagMs });
  if (!r.ok) { console.error(`[minimap-cut] ${r.why}`); return 1; }
  console.log(`[minimap-cut] ${out} · ${r.seconds.toFixed(1)}초 · 장면 ${r.frames}장 · 초당 ${fps}장`);
  return 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exit(await main());
