// scripts/minimap-cut.ts: 미니맵 녹화 장면을 시험 영상이 처음부터 끝까지 한 번 이어 재생된 것처럼 다시 엮는다(2026-11-19 사용자 「그냥 테스트 영상 보여준다 생각하고
// 결정론적으로 보여줘, 그냥 하나의 영상으로」). 장면마다 녹화 시각을 폰 페이지 짝(sync)으로 영상 시각에 옮기고, 영상 조각 사이 마지막 장면 붙잡기(hold)를 빼
// 이은 영상 시각을 붙인 뒤, 이은 시각이 앞으로 가는 장면만 그 순서로 일정한 초당 장수로 엮는다. 같은 판이면 늘 같은 결과다.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import jpeg from "jpeg-js";
import { describe, expect, it } from "vitest";
import { cutFrames, cutTime, makeCut, playSegments, type CutRun } from "../scripts/minimap-cut.js";

// 녹화 시작 500, 재생 시작(t0) 1000. 첫 영상 8초 → 붙잡기 4초 → 12초에 단계 영상(5초) → 끝에서 붙잡기. 서버 시각과 영상 시각은 1:1(짝 둘)
const RUN: CutRun = {
  startMs: 500, endMs: 20_000, size: [64, 36], t0: 1000, sync: [[1000, 0], [19_000, 18_000]], firstDurationMs: 8000,
  clips: [{ video_ms: 12_000, clip: "pick.mp4", duration_ms: 5000 }],
  frames: Array.from({ length: 200 }, (_, i) => ({ file: `dash/${String(i + 1).padStart(6, "0")}.jpg`, ms: i * 100 })),
};

describe("미니맵 이은 영상(minimap-cut)", () => {
  it("재생 조각: 첫 영상 [0, 첫 길이), 단계 영상마다 [바꾼 영상 시각, +길이). 다음 영상이 먼저 오면 거기서 자르고, 이은 시각(at)은 앞 조각 길이 합이다", () => {
    expect(playSegments(8000, RUN.clips)).toEqual([{ from: 0, to: 8000, at: 0 }, { from: 12_000, to: 17_000, at: 8000 }]);
    // 첫 영상이 끝나기 전에 바꿨으면 바꾼 때까지
    expect(playSegments(8000, [{ video_ms: 6000, clip: "a.mp4", duration_ms: 3000 }])).toEqual([{ from: 0, to: 6000, at: 0 }, { from: 6000, to: 9000, at: 6000 }]);
    // 길이를 모르는 조각은 다음 영상까지(마지막이면 끝없음)
    expect(playSegments(null, [{ video_ms: 9000, clip: "a.mp4" }])).toEqual([{ from: 0, to: 9000, at: 0 }, { from: 9000, to: Infinity, at: 9000 }]);
  });

  it("영상 시각 → 이은 시각: 조각 안이면 at + (v − from), 시작 전·붙잡기면 null", () => {
    const segs = playSegments(8000, RUN.clips);
    expect(cutTime(-1, segs)).toBeNull();
    expect(cutTime(0, segs)).toBe(0);
    expect(cutTime(7999, segs)).toBe(7999);
    expect(cutTime(8000, segs)).toBeNull();
    expect(cutTime(11_999, segs)).toBeNull();
    expect(cutTime(12_000, segs)).toBe(8000);
    expect(cutTime(16_500, segs)).toBe(12_500);
    expect(cutTime(17_000, segs)).toBeNull();
  });

  it("장면: 재생 전·붙잡기 장면을 빼고 이은 시각을 붙이며, 이은 시각이 앞으로 가는 장면만 받은 차례대로 둔다. 길이는 마지막 장면 + 한 장(12.95초, 조각 합 13초 안)", () => {
    const { frames, endMs } = cutFrames(RUN);
    expect(endMs).toBe(12_950);
    // 녹화 500 + i×100 → 서버 시각, 영상 시각 = 서버 시각 − 1000
    expect(frames[0]).toEqual({ file: "dash/000006.jpg", ms: 0 });
    expect(frames.every((f, i) => i === 0 || f.ms > frames[i - 1]!.ms)).toBe(true);
    expect(frames.every((f) => f.ms >= 0 && f.ms < 13_000)).toBe(true);
    // 붙잡기(영상 시각 8~12초 = 녹화 ms 8500~12400)의 장면은 없다
    const held = new Set(RUN.frames.filter((f) => f.ms >= 8500 && f.ms < 12_500).map((f) => f.file));
    expect(frames.some((f) => held.has(f.file))).toBe(false);
    expect(frames.find((f) => f.ms === 8000)).toEqual({ file: "dash/000126.jpg", ms: 8000 });
    // 같은 판이면 늘 같은 결과
    expect(cutFrames(RUN)).toEqual(cutFrames(structuredClone(RUN)));
  });

  it("뒤로 가는 장면(영상 시각이 앞 장면보다 작거나 같음)은 버린다. 화면 지연(lagMs)만큼 앞 시각으로 옮긴다", () => {
    const back: CutRun = { ...RUN, frames: [{ file: "a.jpg", ms: 1000 }, { file: "b.jpg", ms: 1000 }, { file: "c.jpg", ms: 900 }, { file: "d.jpg", ms: 1100 }] };
    expect(cutFrames(back).frames).toEqual([{ file: "a.jpg", ms: 500 }, { file: "d.jpg", ms: 600 }]);
    expect(cutFrames(back, 200).frames).toEqual([{ file: "a.jpg", ms: 300 }, { file: "d.jpg", ms: 400 }]);
  });

  // Codex(b5da6c36) P3: 계획이 끝나 마지막 영상 중간에 녹화를 끝냈는데 원본 영상 길이까지 내 녹화 안 된 나머지가 마지막 장면으로 늘어났다
  it("녹화가 마지막 조각 중간에 끝나면 녹화된 마지막 장면의 이은 시각(+ 한 장)까지만 낸다(조각 끝까지 늘이지 않는다)", () => {
    const cut = { ...RUN, frames: RUN.frames.filter((f) => f.ms <= 14_500) };
    const { frames, endMs } = cutFrames(cut);
    expect(frames.at(-1)!.ms).toBe(10_000);
    expect(endMs).toBe(10_050);
    expect(cutFrames(cut, 0, 100).endMs).toBe(10_100);
    // 녹화가 조각 끝을 지나면 조각 길이 합을 넘지 않는다
    expect(cutFrames(RUN, 0, 1000).endMs).toBe(13_000);
  });

  const ffmpegHere = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;
  it.skipIf(!ffmpegHere)("makeCut: 녹화 장면 폴더(run.json)에서 이은 영상을 초당 20장·녹화 크기로 만들고, 두 번 만들어도 같은 파일이다. 장면 폴더는 그대로 둔다", async () => {
    const dir = mkdtempSync(join(tmpdir(), "minimap-cut-"));
    try {
      mkdirSync(join(dir, "dash"));
      RUN.frames.forEach((f, i) => writeFileSync(join(dir, f.file), jpeg.encode({ data: Buffer.alloc(64 * 36 * 4, (i * 7) % 255), width: 64, height: 36 }, 80).data));
      writeFileSync(join(dir, "run.json"), JSON.stringify(RUN));
      const a = join(dir, "..", `${dir.split(/[\\/]/).at(-1)}-a.minimap.mp4`);
      const b = join(dir, "..", `${dir.split(/[\\/]/).at(-1)}-b.minimap.mp4`);
      try {
        expect(await makeCut(dir, a, { fps: 20 })).toMatchObject({ ok: true, seconds: 12.95 });
        expect(await makeCut(dir, b, { fps: 20 })).toMatchObject({ ok: true });
        const probe = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate,duration", "-of", "json", a], { encoding: "utf8" });
        const s = (JSON.parse(probe.stdout) as { streams: Record<string, unknown>[] }).streams[0]!;
        expect(s).toMatchObject({ width: 64, height: 36, r_frame_rate: "20/1" });
        expect(Number(s.duration)).toBeCloseTo(12.95, 1);
        expect(readFileSync(a).equals(readFileSync(b))).toBe(true);
        expect(existsSync(join(dir, "run.json")) && existsSync(join(dir, RUN.frames[0]!.file))).toBe(true);
      } finally {
        rmSync(a, { force: true });
        rmSync(b, { force: true });
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
