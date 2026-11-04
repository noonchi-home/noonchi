// 상위 판단 실행기 오프라인 재생: 녹화 프레임을 12fps로 실제 시간에 맞춰 흘리고 시간표를 찍는다.
//
//   npx tsx scripts/brain-replay.ts                      # 라벨 대본 판정(호출 0회), 판정 지연 1.3초 흉내
//   npx tsx scripts/brain-replay.ts --live --cap 20      # 실제 VLM(.env의 OPENAI_API_KEY·OPENAI_MODEL)
//   --dir <프레임 폴더>  --fps 12  --hold-ms 12000(마지막 장면을 더 두는 시간, 합성)
//   --answer-mock empty|not_empty|none  요청 뒤 판정에서 컵 안을 이 값으로 바꾼다(합성 답, 기본 empty)
//   --answer <jpg>   요청 뒤 그 사진을 프레임으로 넣는다(실제 답 사진이 있을 때)
//
// 기본 프레임은 11-01 실험의 Pexels 컵 영상(runtime/vlm-events/cup/frames, 480×270, 119장): 손이 컵을 들어
// 화면 밖에서 마시고 돌아와 내려놓은 뒤 손이 빠진다. 컵을 옆에서 찍어 안은 보이지 않는다.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import dotenv from "dotenv";
import { CupBrain, type BrainOutput } from "../src/brain/brain.js";
import { DEFAULT_BRAIN_CONFIG } from "../src/brain/config.js";
import { MockDecision } from "../src/brain/decision.js";
import {
  OpenAIPerceiver, ScriptedPerceiver, normalizePerception, type Perceiver, type PerceiveReply, type RawPerception,
} from "../src/brain/perception.js";
import type { Frame } from "../src/brain/window.js";

const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};
const live = args.includes("--live");
const dir = resolve(opt("dir", "runtime/vlm-events/cup/frames"));
const fps = Number(opt("fps", "12"));
const holdMs = Number(opt("hold-ms", "12000"));
const cap = Number(opt("cap", "20"));
const answerMock = opt("answer-mock", "empty") as "empty" | "not_empty" | "none";
const answerPath = opt("answer", "");

const files = readdirSync(dir).filter((f) => f.endsWith(".jpg")).sort();
if (!files.length) throw new Error(`프레임이 없습니다: ${dir}`);
const jpegs = files.map((f) => readFileSync(join(dir, f)));
const clipMs = (files.length * 1000) / fps;
const totalMs = clipMs + holdMs;

/** 라벨(scripts/vlm-experiment/event-clips.json의 cup 구간)을 사람·컵 판정으로 옮긴 대본. 사람 손 시점은 대략값. */
function scripted(frames: readonly Frame[]): RawPerception {
  const idx = Math.floor((frames.at(-1)!.capturedAtMs * fps) / 1000);
  const base: RawPerception = {
    person_present: "no", person_holding_cup: "no", drinking: "no", cup_visible: "yes", cup_support: "table",
    cup_contents: { visible: false, value: "unknown", certain: false }, note: "대본",
  };
  if (idx >= files.length) return base; // 합성으로 더 둔 마지막 장면
  if (idx < 12) return base;
  if (idx < 31) return { ...base, person_present: "yes" };
  if (idx < 39) return { ...base, person_present: "yes", person_holding_cup: "yes", cup_support: "hand" };
  if (idx < 62) return { ...base, person_present: "unknown", drinking: "unknown", cup_visible: "no", cup_support: "unknown" };
  if (idx < 75) return { ...base, person_present: "yes", person_holding_cup: "yes", cup_support: "hand" };
  if (idx < 108) return { ...base, person_present: "yes" };
  return base;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const state = { requestActive: false, requestAtMs: 0 };

/** 요청 뒤(요청 시각 이후에 찍힌 사진) 판정의 내용물만 합성 답으로 바꾼다. */
class AnswerMock implements Perceiver {
  constructor(private readonly inner: Perceiver) {}
  async perceive(frames: readonly Frame[]): Promise<PerceiveReply> {
    const reply = await this.inner.perceive(frames);
    if (answerMock === "none" || !state.requestActive || frames.at(-1)!.capturedAtMs <= state.requestAtMs || !reply.perception) return reply;
    const raw: RawPerception = { ...reply.perception, cup_visible: "yes", cup_contents: { visible: true, value: answerMock, certain: true }, note: `${reply.perception.note} [합성 답: ${answerMock}]` };
    return { ...reply, perception: normalizePerception(raw) };
  }
}

async function main() {
  dotenv.config({ quiet: true });
  let inner: Perceiver;
  if (live) {
    const key = process.env.OPENAI_API_KEY?.trim();
    if (!key) throw new Error("OPENAI_API_KEY가 없습니다(.env)");
    inner = new OpenAIPerceiver({ apiKey: key, model: process.env.OPENAI_MODEL?.trim() || "gpt-5.4-mini" });
  } else {
    inner = new ScriptedPerceiver(scripted, sleep, 1300);
  }
  const t0 = performance.now();
  const now = () => Math.round(performance.now() - t0);
  const fmt = (ms: number) => `${(ms / 1000).toFixed(1).padStart(5)}s`;
  const timeline: string[] = [];
  const brain = new CupBrain({
    perceiver: new AnswerMock(inner),
    decision: new MockDecision(),
    config: { ...DEFAULT_BRAIN_CONFIG, callCap: live ? cap : 1000 },
    clock: { now },
    emit: (e: BrainOutput) => {
      let line: string;
      if (e.type === "perception") {
        line = `${fmt(e.at_ms)}  판정(${e.frames}장, 근거 ${(e.evidence_age_ms / 1000).toFixed(1)}초 전${e.cost_usd ? `, $${e.cost_usd.toFixed(5)}` : ""}) ${e.error ? `실패: ${e.error}` : e.summary}`;
      } else if (e.type === "request") {
        if (e.active) { state.requestActive = true; state.requestAtMs = e.at_ms; } else state.requestActive = false;
        line = `${fmt(e.at_ms)}  📱 ${e.active ? "폰 요청" : "폰 요청 거둠"}: ${e.text}`;
      } else {
        line = `${fmt(e.at_ms)}  [${e.state}] ${e.stage}: ${e.text}`;
      }
      timeline.push(line);
      console.log(line);
    },
    time: { offsetMinutes: -new Date().getTimezoneOffset(), epochMs: Date.now() },
  });
  console.log(`재생: ${files.length}장 ${fps}fps(${(clipMs / 1000).toFixed(1)}초) + 마지막 장면 ${(holdMs / 1000).toFixed(1)}초 · 판정 ${live ? "실제 VLM" : "라벨 대본(지연 1.3초)"} · 합성 답 ${answerMock}${answerPath ? ` · 답 사진 ${answerPath}` : ""}`);
  const answerJpeg = answerPath && existsSync(answerPath) ? readFileSync(answerPath) : null;
  const ticker = setInterval(() => brain.tick(), 100);
  for (let i = 0; ; i++) {
    const at = (i * 1000) / fps;
    if (at > totalMs) break;
    while (now() < at) await sleep(Math.max(1, at - now()));
    const jpeg = answerJpeg && state.requestActive ? answerJpeg : jpegs[Math.min(i, jpegs.length - 1)]!;
    brain.onFrame({ id: `f${i}`, capturedAtMs: Math.round(at), jpeg });
    if (brain.stats().state === "done") break;
  }
  clearInterval(ticker);
  await brain.idle();
  const s = brain.stats();
  console.log(`끝: 상태 ${s.state} · 판정 호출 ${s.calls}회 · 비용 $${s.costUsd.toFixed(5)}${s.capped ? " · 호출 상한 도달" : ""}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
