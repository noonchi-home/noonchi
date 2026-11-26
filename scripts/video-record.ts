// 시연 녹화(scripts/video-check.ts --record): 같은 크롬의 대시보드 창(--record-phone이면 폰 탭도)을 CDP Page.startScreencast로 받아 폴더에 JPEG로 쓰고,
// 끝나면 ffmpeg로 대시보드 한 화면(폰도 받았으면 위 가로 폰·아래 대시보드를 너비 맞춰 쌓아) mp4 하나(H.264, yuv420p, RECORD_FPS)로 합친다.
// 프레임은 받은 시각을 붙여 두고, concat 목록의 프레임마다 다음 프레임까지 보이게 해 영상 길이가 녹화한 실제 시간과 같다.
// ack는 앞 ack에서 RECORD_MS(intervalMs를 주면 그 값) 뒤에 보낸다(크롬은 ack를 받아야 다음 프레임을 보내므로 화면마다 초당 약 10장, video-check --record-fps면 그 장 수).
// 녹화 시작 답이 화면마다 START_TIMEOUT_MS 안에 오지 않거나 오류면 리스너·타이머·녹화를 정리하고 오류를 낸다.
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { withTimeout } from "./twin3d/capture-lib.js";
import type { Page } from "./twin3d/cdp.js";

export const RECORD_FPS = 10;
/** 프레임 사이 간격(ms). 판정이 느려지면 늘린다. */
export const RECORD_MS = 1000 / RECORD_FPS;
/** mp4 대시보드 높이: 대시보드를 이 높이에, 폰은 그 너비에 맞춘다. */
export const RECORD_HEIGHT = 800;
const JPEG_QUALITY = 80;
/** ffmpeg가 이보다 오래 걸리면 끝낸다. */
const ENCODE_TIMEOUT_MS = 10 * 60_000;
/** 화면마다 녹화 시작(Page.startScreencast) 답을 이만큼까지 기다린다. */
export const START_TIMEOUT_MS = 10_000;

/** 프레임 하나: 녹화 폴더 기준 경로(/ 구분), 녹화 시작에서 받은 시각(ms). */
export interface Frame { file: string; ms: number }
/** 녹화 결과: 녹화 길이, 화면 이름마다 프레임, 쓰지 못한 프레임 수. */
export interface Recorded { endMs: number; frames: Record<string, Frame[]>; lost: number }
export type ScreencastPage = Pick<Page, "send" | "on">;
export interface Recording { stop(): Promise<Recorded> }

/** 미니맵 녹화 장면 폴더 안 판 기록 파일 이름(scripts/minimap-cut.ts가 읽는다). */
export const CUT_RUN_FILE = "run.json";
/** 판 기록(video-check가 미니맵 녹화 끝에 쓴다). startMs는 녹화 시작 이 PC 시계(서버와 같은 PC라 서버 시계)이고 frames ms는 거기서 센다.
 *  t0·sync는 폰 페이지 재생 시작 서버 시각과 [서버 시각, 영상 시각] 짝, clips는 바꾼 단계 영상(영상 시각·길이), firstDurationMs는 첫 영상 길이(모르면 null).
 *  rate는 영상 빠르기(없으면 1), doneMs는 계획을 마친 완료 문장이 폰 명령 줄에 온 영상 시각(없으면 null).
 *  scenes는 미니맵이 장면을 보인 기록 [보인 시각, 그 장면 촬영 시각](서버 시계, 보인 차례). 옛 판에는 없다. */
export interface CutRun {
  startMs: number;
  endMs: number;
  size: [number, number];
  frames: Frame[];
  t0: number;
  sync: [number, number][];
  firstDurationMs: number | null;
  clips: { video_ms: number; clip: string; duration_ms?: number }[];
  rate?: number;
  doneMs?: number | null;
  scenes?: [number, number][];
}

/** 녹화 폴더 안의 시연 영상 파일: 시각표 파일 이름 줄기(.timeline.md·.md 뺌) + .demo.mp4. */
export function demoFile(recordDir: string, timelineFile: string): string {
  return join(recordDir, `${basename(timelineFile).replace(/(?:\.timeline)?\.md$/, "")}.demo.mp4`);
}

/** ffmpeg concat 목록. 프레임마다 다음 프레임(마지막은 endMs)까지 보이고 첫 프레임은 0부터다. 같은 시각이면 뒤 프레임만,
 *  endMs 이후 프레임은 뺀다. concat은 마지막 파일의 duration을 쓰지 않아 마지막 파일을 한 번 더 적는다. 남는 프레임이 없으면 null. */
export function concatList(frames: Frame[], endMs: number): string | null {
  const sorted = frames.map((f, i) => ({ ...f, i })).sort((a, b) => a.ms - b.ms || a.i - b.i).filter((f) => f.ms < endMs);
  const kept = sorted.filter((f, k) => sorted[k + 1]?.ms !== f.ms);
  if (!kept.length) return null;
  const lines = ["ffconcat version 1.0"];
  kept.forEach((f, k) => {
    const from = k === 0 ? 0 : f.ms;
    const to = kept[k + 1]?.ms ?? endMs;
    lines.push(`file '${f.file}'`, `duration ${((to - from) / 1000).toFixed(3)}`);
  });
  lines.push(`file '${kept.at(-1)!.file}'`, "");
  return lines.join("\n");
}

/** 높이 height에 맞춘 화면 너비(짝수). */
const panelWidth = (size: [number, number], height: number) => 2 * Math.round((size[0] * height) / size[1] / 2);

/** 너비 width에 맞춘 화면 높이(짝수). */
const panelHeight = (size: [number, number], width: number) => 2 * Math.round((size[1] * width) / size[0] / 2);

/** ffmpeg 인자: concat 목록(폰이 있으면 폰, 대시보드)을 fps로 고르게 하고 대시보드는 높이 height, 폰(가로 탭)은 그 대시보드 너비에 맞춰(비율 그대로, 남는 곳은 채움)
 *  폰이 있으면 위 폰·아래 대시보드로 쌓아 H.264 yuv420p로, seconds 길이. 폰이 없으면 대시보드 한 화면이다.
 *  JPEG는 전체 범위(yuvj420p)라 보통 범위(tv)로 바꾼다. 그대로 두면 mp4가 yuvj420p가 된다. */
export function ffmpegArgs(o: { phone?: string; dash: string; out: string; seconds: number; phoneSize?: [number, number]; dashSize: [number, number]; fps?: number; height?: number }): string[] {
  const fps = o.fps ?? RECORD_FPS;
  const h = o.height ?? RECORD_HEIGHT;
  const w = panelWidth(o.dashSize, h);
  const fit = (input: number, pw: number, ph: number, label: string) =>
    `[${input}:v]fps=${fps},scale=${pw}:${ph}:force_original_aspect_ratio=decrease:force_divisible_by=2:out_range=tv,pad=${pw}:${ph}:(ow-iw)/2:(oh-ih)/2,setsar=1[${label}]`;
  const both = o.phone !== undefined && o.phoneSize !== undefined;
  return [
    "-y", "-hide_banner", "-loglevel", "error",
    ...(both ? ["-f", "concat", "-safe", "0", "-i", o.phone!] : []),
    "-f", "concat", "-safe", "0", "-i", o.dash,
    "-filter_complex", both ? `${fit(0, w, panelHeight(o.phoneSize!, w), "p")};${fit(1, w, h, "d")};[p][d]vstack=inputs=2,format=yuv420p[v]` : `${fit(0, w, h, "d")};[d]format=yuv420p[v]`,
    "-map", "[v]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-r", String(fps),
    "-t", o.seconds.toFixed(3), "-movflags", "+faststart", o.out,
  ];
}

/** 다음 ack 시각: 처음이면 지금, 아니면 앞 ack에서 intervalMs 뒤(이미 지났으면 지금). */
export function ackAt(now: number, lastAck: number | null, intervalMs: number): number {
  return lastAck === null ? now : Math.max(now, lastAck + intervalMs);
}

/** 화면마다 screencast를 켜고 프레임을 dir/<이름>/000001.jpg…에 쓴다. ms는 now()로 잰 녹화 시작부터의 시각.
 *  시작 답(Page.startScreencast)이 화면마다 startTimeoutMs 안에 오지 않거나 오류면(요청 직후 CDP 끊김) 리스너·ack 타이머를 풀고
 *  시작을 보낸 화면마다 stopScreencast를 보낸 뒤(5초까지) 그 오류를 낸다. */
export async function startRecording(
  dir: string,
  screens: { name: string; page: ScreencastPage; size: [number, number] }[],
  o: { intervalMs?: number; now?: () => number; startTimeoutMs?: number } = {},
): Promise<Recording> {
  const now = o.now ?? Date.now;
  const interval = o.intervalMs ?? RECORD_MS;
  const start = now();
  const frames: Record<string, Frame[]> = {};
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const offs: (() => void)[] = [];
  /** 시작을 보낸 화면. */
  const asked: ScreencastPage[] = [];
  let stopped = false;
  let lost = 0;
  /** 프레임 받기를 멈추고 시작을 보낸 화면의 screencast를 끈다. 끊긴 탭은 답하지 않으니 5초까지만 기다린다. */
  const halt = async () => {
    stopped = true;
    for (const t of timers) clearTimeout(t);
    timers.clear();
    for (const off of offs) off();
    let wait: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.all(asked.map((p) => p.send("Page.stopScreencast").catch(() => {}))),
      new Promise((r) => { wait = setTimeout(r, 5_000); }),
    ]);
    clearTimeout(wait);
  };
  /** 한 화면: 프레임 리스너를 달고 screencast를 켠다(시작 답은 startTimeoutMs까지). */
  const listen = async (s: (typeof screens)[number]): Promise<void> => {
    mkdirSync(join(dir, s.name), { recursive: true });
    const list: Frame[] = (frames[s.name] = []);
    let lastAck: number | null = null;
    offs.push(s.page.on("Page.screencastFrame", (p) => {
      if (stopped) return;
      const at = now();
      const file = `${s.name}/${String(list.length + 1).padStart(6, "0")}.jpg`;
      try {
        writeFileSync(join(dir, file), Buffer.from(String(p.data), "base64"));
        list.push({ file, ms: at - start });
      } catch {
        lost += 1;
      }
      const ackTime = ackAt(at, lastAck, interval);
      lastAck = ackTime;
      const t = setTimeout(() => {
        timers.delete(t);
        if (!stopped) s.page.send("Page.screencastFrameAck", { sessionId: p.sessionId }).catch(() => {});
      }, ackTime - at);
      timers.add(t);
    }));
    asked.push(s.page);
    const reply = await withTimeout(
      s.page.send("Page.startScreencast", { format: "jpeg", quality: JPEG_QUALITY, maxWidth: s.size[0], maxHeight: s.size[1], everyNthFrame: 1 }),
      o.startTimeoutMs ?? START_TIMEOUT_MS, `녹화 시작 응답(${s.name})`,
    );
    // Page.send는 CDP 오류 답({error})도 거절하지 않고 돌려준다.
    if (reply?.error) throw new Error(`녹화 시작 응답(${s.name}) 오류: ${reply.error.message ?? "알 수 없음"}`);
  };
  try {
    for (const s of screens) await listen(s);
  } catch (e) {
    await halt();
    throw e;
  }
  return {
    async stop() {
      if (!stopped) await halt();
      return { endMs: now() - start, frames, lost };
    },
  };
}

/** 녹화를 mp4 하나로: dir에 concat 목록(phone.txt·dash.txt)을 쓰고 dir에서 ffmpeg를 돌린다(fps·height가 없으면 RECORD_FPS·RECORD_HEIGHT). 되면 프레임 폴더를 지운다(keepFrames면 둔다).
 *  ffmpeg가 없거나 실패하면 프레임 폴더를 남기고 까닭과 폴더를 돌려준다. */
export async function encodeDemo(
  dir: string,
  rec: Recorded,
  out: string,
  o: { phoneSize?: [number, number]; dashSize: [number, number]; fps?: number; height?: number; keepFrames?: boolean; ffmpeg?: string },
): Promise<{ ok: true } | { ok: false; why: string }> {
  // 폰 화면은 녹화했을 때만(--record-phone) 붙인다
  const withPhone = rec.frames.phone !== undefined && o.phoneSize !== undefined;
  const phone = withPhone ? concatList(rec.frames.phone!, rec.endMs) : null;
  const dash = concatList(rec.frames.dash ?? [], rec.endMs);
  if (!dash || (withPhone && !phone)) return { ok: false, why: `${dash ? "폰" : "대시보드"} 프레임이 없어요. 프레임 폴더: ${dir}` };
  if (phone) writeFileSync(join(dir, "phone.txt"), phone);
  writeFileSync(join(dir, "dash.txt"), dash);
  const args = ffmpegArgs({ ...(phone ? { phone: "phone.txt", phoneSize: o.phoneSize } : {}), dash: "dash.txt", out, seconds: rec.endMs / 1000, dashSize: o.dashSize, fps: o.fps, height: o.height });
  const result = await new Promise<{ code: number | null; missing: boolean; err: string }>((done) => {
    let err = "";
    const proc = spawn(o.ffmpeg ?? "ffmpeg", args, { cwd: dir, stdio: ["ignore", "ignore", "pipe"] });
    const timer = setTimeout(() => { err += "\n시간 넘김"; proc.kill(); }, ENCODE_TIMEOUT_MS);
    proc.stderr?.on("data", (b: Buffer) => { err = (err + b.toString()).slice(-2000); });
    proc.on("error", (e: NodeJS.ErrnoException) => { clearTimeout(timer); done({ code: null, missing: e.code === "ENOENT", err: e.message }); });
    proc.on("close", (code) => { clearTimeout(timer); done({ code, missing: false, err }); });
  });
  if (result.missing) return { ok: false, why: `ffmpeg가 없어요. 프레임 폴더만 남겼어요: ${dir}` };
  if (result.code !== 0) return { ok: false, why: `ffmpeg 실패(끝 코드 ${result.code}): ${result.err.trim().split(/\r?\n/).slice(-3).join(" / ")}. 프레임 폴더: ${dir}` };
  if (!o.keepFrames) for (let i = 0; i < 5; i++) { try { rmSync(dir, { recursive: true, force: true }); break; } catch { await new Promise((r) => setTimeout(r, 300)); } }
  return { ok: true };
}
