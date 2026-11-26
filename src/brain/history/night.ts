// 밤 흐름(하루 한 번, 판단 속도와 상관없음): 덩어리 기록 → 반성(후보 FSM) → 코드 모양 검사 → 배우지 않는 행동 후보 빼기 → 기억 뜻 검사(LLM, 거절이면 까닭을 붙여 한 번 다시)
// → 시각 찾기(지난 날까지, 모르는 것만) → 채택 검사(석준 님 trigger_check, src/brain/pam/adopt.ts) → 로봇 FSM(seed 화살표 + 통과한 배우는 행동 후보) → 코드 검사
// → 저장(로봇 판본·후보 판본·반성 기록을 한 트랜잭션, HistoryDb.saveNight). 어느 단계든 끝내 거절·실패면 새 판본을 저장하지 않고 전날 기억을 쓴다(반성 기록에 까닭).
// 셈하기(사용자 결정 2026-11-18): 행동 때 = 사람이 직접 그 일을 한 때(시각 찾기) ∪ 로봇이 그 일을 물었을 때 「치워 주세요」류로 답한 때(answerActions, 묻기 답 말 부탁 판단).
// 「그대로 둬요」 답은 따라오지 않은 것이고, 답이 있는 창은 사람이 안 보였어도 본 것이다(answerTimes → CheckDay.answered). 로봇이 그 행동을 한 구간은 안 보인 구간에 더해 못 봄이고
// 그 안의 행동 표시(폰 명령대로 사람이 한 일)는 행동으로 세지 않는다(robotSpans).
// 시각 찾기 결과는 그날 사실의 사본(<dir>/marks-<날>.json, 임시 파일 → 이름 바꾸기)이라 기억이 저장되지 않아도 다음 밤에 다시 쓴다. 검사 결과 사본(<dir>/check-<날>.json)은 커밋 뒤에 쓴다.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ASK_CHOICES, ASK_FOLLOW } from "../../act/prompts.js";
import { ASK_ACTION, LEARNED_ACTIONS, TASKS } from "../../act/tasks.js";
import type { BrainLog, PamUsage } from "../../contract/events.js";
import type { CandidateFsm } from "../../contract/pam.js";
import { CUP_FSM_MEMORY, ContractError, MAX_REFLECT_TEXT, validateMemory, type FsmMemory } from "../decision.js";
import { candidateText, MARKING_PROMPT, type PamClient } from "../pam/index.js";
import { adoptKey, adoptedFsm, candidateFsmOf, findRules, type CtxDay, type CheckResult } from "../pam/adopt.js";
import type { Ctx } from "../../contract/pam.js";
import { clock, type Chunk, type Marks } from "../pam/marks.js";
import { headWithin } from "../../shared/cut.js";
import type { HistoryDb } from "./db.js";
import { edgeKey, learnedEdges, settingsGuard, type EdgeLine, type HabitFilter, type HabitRuleNote } from "./habits.js";
import { NIGHT_TEXT, REFLECT_TEXT } from "./labels.js";
import { memoryForDay, readDayMemory } from "./reflect.js";
import { daySummary, fitLines } from "./summary.js";

const DAY_MS = 86_400_000;
const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
const bytes = (s: string) => Buffer.byteLength(s, "utf8");
/** 다시 반성할 때 피드백에 붙이는 까닭의 길이 상한(글자). 하루 요약 한도에서 그만큼 미리 뺀다. */
const RETRY_WHY_MAX = 1_000;
/** 반성 입력에 붙이는 지난 검사 결과의 바이트 상한. */
const CHECKS_MAX = 4_000;
/** 그날 기록이 있다고 보는 종류. */
export const DAY_KINDS = ["detection", "world", "device", "vlm", "yolo", "decision", "execution", "feedback"] as const;
/** 습관 거르기에 넘기는 기록 종류. */
const HABIT_KINDS = ["world", "device", "decision", "execution", "feedback"] as const;
/** 덩어리 기록·시각 찾기가 읽는 그날 기록 줄 종류(사람·물건·가전·사람 말). */
const LINE_KINDS = ["detection", "world", "device", "feedback"] as const;

/** PAM 사용량 더하기(밤 흐름은 여러 번 부른다): 토큰은 더하고, 비용은 모두 알 때만 더하며, 모델은 다르면 이어 적는다. */
export function addUsage(a: PamUsage | undefined, b: PamUsage): PamUsage {
  if (!a) return { ...b };
  const models = [...new Set([...a.model.split("+"), b.model])].join("+");
  return { model: models, prompt: a.prompt + b.prompt, completion: a.completion + b.completion, cached: a.cached + b.cached,
    cost_usd: a.cost_usd === null || b.cost_usd === null ? null : a.cost_usd + b.cost_usd };
}

/** 최근 줄부터 max 바이트까지 담는다(시각 순으로 돌려줌). */
export function latestWithin(lines: string[], max: number): string[] {
  const out: string[] = [];
  let used = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const b = bytes(lines[i]!) + (out.length ? 1 : 0);
    if (used + b > max) break;
    out.unshift(lines[i]!);
    used += b;
  }
  return out;
}

/** 기록 시간대의 HH:MM:SS. */
const hms = (ms: number, offset: number) => new Date(ms + offset * 60_000).toISOString().slice(11, 19);
const secOf = (ms: number, offset: number) => clock(hms(ms, offset), "time");

/** 그날 기록 줄(`HH:MM:SS | 글`, 시각 차례, 같은 시각·같은 글은 한 줄). */
export function dayLines(db: HistoryDb, day: string): { time: string; line: string }[] {
  const out: { time: string; line: string }[] = [];
  for (const r of db.list({ day, kinds: [...LINE_KINDS], limit: 10_000_000 })) {
    const time = hms(r.at_ms, db.offsetMinutes);
    const line = `${time} | ${r.text}`;
    if (out.at(-1)?.line !== line) out.push({ time, line });
  }
  return out;
}

/** 로봇이 물었을 때 그 일을 해 달라고 답한 때(묻기 답으로 만든 말 부탁 판단, source speech·via answer): 행동마다 자정부터 초. 「두세요」 답은 넣지 않는다. */
export function answerActions(db: HistoryDb, day: string): { action: string; times: number[] }[] {
  const by = new Map<string, number[]>();
  for (const r of db.list({ day, kinds: ["decision"], limit: 10_000_000 })) {
    const d = r.data as { source?: string; via?: string } | null;
    if (d?.source !== "speech" || d.via !== "answer") continue;
    by.set(r.text, [...(by.get(r.text) ?? []), secOf(r.at_ms, db.offsetMinutes)]);
  }
  return [...by].map(([action, times]) => ({ action, times }));
}

/** 그 행동을 물은 질문에 답한 때(「치워 주세요」·「그대로 둬요」 모두): 그 행동으로 이어지는 답 묶음(ASK_FOLLOW)의 답 단추·말 줄. */
export function answerTimes(db: HistoryDb, day: string, action: string): number[] {
  const group = Object.values(ASK_CHOICES).find((cs) => cs.some((c) => ASK_FOLLOW[c.id] === action));
  if (!group) return [];
  const ids = new Set(group.map((c) => c.id));
  return db.list({ day, kinds: ["feedback"], limit: 10_000_000 })
    .filter((r) => ids.has((r.data as { choice?: string } | null)?.choice ?? ""))
    .map((r) => secOf(r.at_ms, db.offsetMinutes));
}

/** 로봇이 그 행동을 실행한 구간: 그 행동 판단(PAM·말 부탁)의 계획이 running이 된 때부터 done·failed까지(끝이 없으면 그날 끝까지). */
export function robotSpans(db: HistoryDb, day: string, action: string): [number, number][] {
  const plans = new Set(db.list({ day, kinds: ["decision"], limit: 10_000_000 }).filter((r) => r.text === action && r.subject).map((r) => `plan:${r.subject}`));
  const open = new Map<string, number>();
  const out: [number, number][] = [];
  for (const r of db.list({ day, kinds: ["execution"], limit: 10_000_000 })) {
    if (!r.subject || !plans.has(r.subject)) continue;
    const state = (r.data as { state?: string } | null)?.state;
    const at = secOf(r.at_ms, db.offsetMinutes);
    if (state === "running" && !open.has(r.subject)) open.set(r.subject, at);
    if ((state === "done" || state === "failed") && open.has(r.subject)) {
      out.push([open.get(r.subject)!, at]);
      open.delete(r.subject);
    }
  }
  for (const start of open.values()) out.push([start, DAY_MS / 1000]);
  return out.sort((a, b) => a[0] - b[0]);
}

/** 안 보인 구간(시각 찾기 답: 첫 줄 ~ 마지막 안 보인 줄)의 반열린 끝: 그 뒤 첫 기록 줄 시각, 없으면 그날 끝. 석준 님 daily_run.py가 끝에 줄 간격을 더하는 것과 같다
 *  (그쪽 기록은 줄 간격이 고르고, 이 집 기록은 바뀔 때만 줄이 생긴다. Codex 1b07d3e2 P2: 마지막 줄 시각을 그대로 써 「사람 안 보임」 한 줄뿐이면 빈 구간이었다). times는 그날 줄 시각(초, 차례). */
export function unseenEnd(times: readonly number[], last: number): number {
  return times.find((x) => x > last) ?? DAY_MS / 1000;
}

/** 덩어리에 그 동안의 사람 상태(판단 기록 fsm.state, 가장 많이 나온 것, 없으면 그 앞 마지막 판단 상태)를 붙인 줄 `HH:MM:SS~HH:MM:SS [상태] 글`. */
export function chunkLines(db: HistoryDb, day: string, chunks: readonly Chunk[]): string[] {
  const states = db.list({ day, kinds: ["decision"], limit: 10_000_000 }).flatMap((r) => {
    const s = (r.data as { fsm?: { state?: unknown } | null } | null)?.fsm?.state;
    return typeof s === "string" ? [{ at: secOf(r.at_ms, db.offsetMinutes), state: s }] : [];
  });
  return chunks.map((c) => {
    const from = clock(c.start, "start"), to = clock(c.end, "end");
    const inside = states.filter((s) => s.at >= from && s.at <= to);
    const count = new Map<string, number>();
    for (const s of inside) count.set(s.state, (count.get(s.state) ?? 0) + 1);
    const most = [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? states.filter((s) => s.at <= to).at(-1)?.state ?? null;
    return `${c.start}~${c.end} ${most ? `[${most}] ` : ""}${c.text}`;
  });
}

/** 그날 시각 찾기 사본: 읽은 기록 줄의 표시(record), 시각 찾기 지시문의 표시(prompt), 덩어리, (상태, 상태 설명, 후보 글)마다 시각, 행동마다 시각, 안 보인 구간(아직 안 물었으면 null). */
interface DayMarks { day: string; record: string; prompt: string; chunks: Chunk[] | null; candidates: Record<string, string[]>; actions: Record<string, string[]>; unseen: { start: string; end: string }[] | null }
/** 후보 시각의 열쇠: 상태 설명이 바뀌면 시각 찾기가 그 상태를 다르게 볼 수 있어 다시 묻는다(2026-11-25 사용자 결정). */
const markKey = (state: string, description: string, text: string) => JSON.stringify([state, description, text]);
/** 시각 찾기 지시문의 표시(sha256 앞 16자리). 지시문이 바뀌면 그 전 사본을 버리고 다시 묻는다(2026-11-25 사용자 결정). */
const PROMPT_MARK = createHash("sha256").update(MARKING_PROMPT).digest("hex").slice(0, 16);
/** 사본이 읽은 그날 기록 줄의 표시(줄 수와 줄 전체의 sha256). 다르면 그날 기록이 바뀐 것이라 사본을 버리고 다시 묻는다. */
const recordMark = (lines: readonly { line: string }[]) => `${lines.length}:${createHash("sha256").update(lines.map((l) => l.line).join("\n")).digest("hex")}`;

export interface NightOptions {
  now?: () => number; emit?: (l: BrainLog) => void; filter?: HabitFilter; windowDays?: number; signal?: AbortSignal;
  /** 시각 찾기·검사 결과 사본 폴더(runtime/homes/<집>/habit). 없으면 사본을 쓰지 않는다. */
  dir?: string;
  /** 파일 쓰기(기본 writeFileSync, 시험이 실패를 넣는다). */
  writeFile?: (path: string, text: string) => void;
  log?: (line: string) => void;
}
/** 후보 하나의 채택 검사 결과. n·k·rate…는 맥락 없는 검사 숫자다. 맥락 없이 통과하지 못해도 요일·시각 맥락이 통과하면 ctx_rules에 맥락마다 숫자가 있고 passed가 true다
 *  (src/brain/pam/adopt.ts findRules: 맥락 없음 → 하나 → 둘). */
export type NightCheck = CheckResult & { state: string; action: string; on: string; when: string | null; ctx_rules?: { ctx: Ctx; n: number; k: number; rate: number; base_rate: number; p_value: number }[] };
/** 밤 흐름 결과. ok면 새 로봇 판본(version)·적용일·배운·쓰는 화살표·뺀 후보도 있다. */
export type NightResult =
  | { ok: true; version: number; appliesDay: string; learned: EdgeLine[]; active: EdgeLine[]; dropped: HabitRuleNote[]; passed: { state: string; action: string; on: string; when?: string; ctx?: Ctx[] }[]; checks: NightCheck[] }
  | { ok: false; error: string; empty?: true; passed: []; checks: [] };

export async function runNight(db: HistoryDb, pam: PamClient, day: string, o: NightOptions = {}): Promise<NightResult> {
  const now = o.now ?? (() => Date.now());
  const write = o.writeFile ?? ((path: string, text: string) => writeFileSync(path, text));
  let usage: PamUsage | undefined;
  const fail = (error: string, extra: { empty?: true } = {}): NightResult => ({ ok: false, error, ...extra, passed: [], checks: [] });
  const done = (ok: boolean, text: string, version: number | null, appliesDay: string | null, found?: Record<string, unknown>) => {
    const at = now();
    const used = usage ? { usage } : {};
    db.add("reflection", at, text, { data: { day, ok, version, applies_day: appliesDay, ...found, ...used } });
    o.emit?.({ type: "reflection", at_ms: at, day, ok, version, applies_day: appliesDay, text, ...found, ...used } as BrainLog);
  };
  if (!db.list({ day, kinds: [...DAY_KINDS], limit: 1 }).length) {
    done(false, REFLECT_TEXT.failed(REFLECT_TEXT.empty), null, null);
    return fail(REFLECT_TEXT.empty, { empty: true });
  }
  const cancelled = () => fail(REFLECT_TEXT.cancelled);
  /** 사본 파일 쓰기(임시 파일 → 이름 바꾸기). */
  const save = (path: string, value: unknown) => {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    write(tmp, `${JSON.stringify(value, null, 2)}\n`);
    renameSync(tmp, path);
  };
  try {
    // 그날 판본을 읽기만 한다(날 고정·seed 판본을 남기지 않는다: 끊긴 반성이 다른 반성의 적용일을 밀지 않게)
    const cur = readDayMemory(db, day);
    const feedback = latestWithin(db.list({ day, kinds: ["feedback"] }).map((r) => r.text), MAX_REFLECT_TEXT.feedback).join("\n") || null;
    // 사용량은 그 밤에 부른 PAM 호출(덩어리·반성·뜻 검사·시각 찾기)을 모두 더한다(Codex 1b07d3e2 P3: 덮어써 마지막 호출만 남았다)
    const call = { signal: o.signal, onUsage: (u: PamUsage) => { usage = addUsage(usage, u); } };
    const limits = await pam.limits();
    if (cur.kind === "list") {
      const maxBytes = limits.reflect_input_bytes - bytes(JSON.stringify(cur.memory, null, 2)) - bytes(feedback ?? "") - bytes(REFLECT_TEXT.noObservation) - bytes(REFLECT_TEXT.noAction);
      if (maxBytes <= 0) throw new Error(REFLECT_TEXT.tooBig);
      const summary = daySummary(db, day, { maxBytes, caps: MAX_REFLECT_TEXT });
      const memory = await pam.reflect({ day, memory: cur.memory, memory_kind: "list", observation_text: summary.observation_text || REFLECT_TEXT.noObservation, action_summary: summary.action_summary || REFLECT_TEXT.noAction, feedback }, "list", call);
      if (o.signal?.aborted) return cancelled();
      memoryForDay(db, day);
      let appliesDay = nextDay(day);
      while (db.pinnedMemory(appliesDay) !== null) appliesDay = nextDay(appliesDay);
      const version = db.saveMemory({ kind: "list", memory, day, appliesDay, source: "reflection" });
      done(true, REFLECT_TEXT.done(version, appliesDay), version, appliesDay, { learned: [], active: [], dropped: [] });
      return { ok: true, version, appliesDay, learned: [], active: [], dropped: [], passed: [], checks: [] };
    }
    const today = cur.memory as FsmMemory;
    // 반성 입력 기억: 지금까지의 후보 FSM(지난 밤 후보 판본, 없으면 그날 로봇 FSM을 후보 모양으로)
    const input = (db.candidatesFor(day)?.memory as CandidateFsm | undefined) ?? candidateFsmOf(today);
    const markPath = (d: string) => (o.dir ? join(o.dir, `marks-${d}.json`) : null);
    const linesCache = new Map<string, { time: string; line: string }[]>();
    const linesOf = (d: string) => linesCache.get(d) ?? linesCache.set(d, dayLines(db, d)).get(d)!;
    const marksCache = new Map<string, DayMarks>();
    // 사본은 그때 읽은 기록 줄·시각 찾기 지시문과 같을 때만 쓴다(Codex 1b07d3e2 P2: 23:30 반성 뒤 더해진 같은 날 기록이 사본 때문에 영원히 셈에서 빠졌다)
    const marksOf = (d: string): DayMarks => {
      const hit = marksCache.get(d);
      if (hit) return hit;
      const path = markPath(d);
      const record = recordMark(linesOf(d));
      const read = path && existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as DayMarks) : null;
      const m: DayMarks = read?.record === record && read.prompt === PROMPT_MARK ? read : { day: d, record, prompt: PROMPT_MARK, chunks: null, candidates: {}, actions: {}, unseen: null };
      marksCache.set(d, m);
      return m;
    };
    // 시각 찾기 사본 쓰기가 실패해도 밤 흐름은 잇는다(그날 사실의 사본이라 다음 밤에 다시 묻는다)
    const keepMarks = (m: DayMarks) => {
      const path = markPath(m.day);
      if (!path) return;
      try { save(path, m); } catch (e) { o.log?.(NIGHT_TEXT.copyFailed((e as Error).message)); }
    };
    // 1) 덩어리 기록(그날 기록 줄 → 하는 일 덩어리). 줄이 없으면 하루 요약 관찰 텍스트를 쓴다
    const lines = linesOf(day);
    const prevChecks = ((db.list({ kinds: ["reflection"], latest: true, limit: 50 }).reverse().find((r) => (r.data as { ok?: boolean; checks?: unknown } | null)?.ok === true && Array.isArray((r.data as { checks?: unknown }).checks))?.data as { checks: NightCheck[] } | undefined)?.checks) ?? [];
    const checksText = prevChecks.length ? latestWithin([NIGHT_TEXT.checksHead, ...prevChecks.map((c) => NIGHT_TEXT.check(c.state, candidateText({ on: c.on, ...(c.when ? { when: c.when } : {}) }), c.action, c.n, c.k, c.passed))], CHECKS_MAX).join("\n") : "";
    // 팀이 정한 로봇 일 화살표는 후보 FSM에 없어서(candidateFsmOf), 이미 채택된 것으로 따로 보여 준다: 묻기 자리를 같은 트리거로 바꿀 수 있게(2026-11-25 사용자 결정)
    const seedText = [NIGHT_TEXT.seedHead, NIGHT_TEXT.seedAsk(ASK_ACTION),
      ...CUP_FSM_MEMORY.states.flatMap((s) => s.next.filter((e) => e.action).map((e) => NIGHT_TEXT.seed(s.id, candidateText({ on: e.on, ...(e.when ? { when: e.when } : {}) }), e.action!)))].join("\n");
    // 요약이 비면 대신 보내는 글(관찰 없음·행동 없음)과 다시 반성할 때 붙는 까닭(RETRY_WHY_MAX 글자, UTF-8 3바이트까지), 지난 검사 결과·정한 화살표도 한도 안에 들게 미리 뺀다
    const retryRoom = bytes(REFLECT_TEXT.retry("")) + 1 + RETRY_WHY_MAX * 3;
    const maxBytes = limits.reflect_input_bytes - bytes(JSON.stringify(input, null, 2)) - bytes(feedback ?? "") - retryRoom - bytes(checksText) - 2 - bytes(seedText) - 2
      - bytes(REFLECT_TEXT.noObservation) - bytes(REFLECT_TEXT.noAction);
    if (maxBytes <= 0) throw new Error(REFLECT_TEXT.tooBig);
    // 행동 칸에는 지난 검사 결과와 정한 화살표가 함께 들어가니, 하루 요약의 행동 몫은 칸 상한에서 그만큼 뺀다
    const summary = daySummary(db, day, { maxBytes, caps: { ...MAX_REFLECT_TEXT, action: MAX_REFLECT_TEXT.action - bytes(checksText) - bytes(seedText) - 4 } });
    let chunks: Chunk[] | null = null;
    if (lines.length) {
      try {
        chunks = (await pam.chunk(latestWithin(lines.map((l) => l.line), limits.reflect_input_bytes), call)).chunks;
      } catch (e) {
        // 덩어리 답이 틀리거나 한도를 넘으면 하루 요약 관찰 텍스트로 반성한다(연결 오류는 그대로 던진다)
        if (!(e instanceof ContractError)) throw e;
        o.log?.(NIGHT_TEXT.chunkFailed((e as Error).message));
      }
      if (o.signal?.aborted) return cancelled();
      if (chunks) {
        const m = marksOf(day);
        m.chunks = chunks;
        keepMarks(m);
      }
    }
    const observation = chunks ? fitLines(chunkLines(db, day, chunks), Math.min(MAX_REFLECT_TEXT.observation, maxBytes - bytes(summary.action_summary))) : summary.observation_text;
    const actionSummary = [summary.action_summary || REFLECT_TEXT.noAction, checksText, seedText].filter(Boolean).join("\n\n");
    const req = { day, memory: input, observation_text: observation || REFLECT_TEXT.noObservation, action_summary: actionSummary, feedback };
    // 2) 반성 한 번(후보 FSM 종류) + 배우지 않는 행동 후보 빼기 + 뜻 검사. 거절이면 까닭 글
    const attempt = async (fb: string | null): Promise<{ candidates: CandidateFsm; notes: HabitRuleNote[]; why: null } | { candidates: null; notes: HabitRuleNote[]; why: string }> => {
      let raw: CandidateFsm;
      try {
        // 반성 답은 후보 FSM 종류로 받는다: PamClient.reflect가 validateCandidateFsm(raw, seed)로 보고 모양 오류는 PamAnswerError(Codex 2966378 P2).
        // 모양 오류도 까닭으로 받아 한 번 다시 반성한다(Codex 8ab2d06 P2). 연결 오류(PamLinkError)는 그대로 던진다
        raw = await pam.reflect({ ...req, feedback: fb, memory_kind: "fsm_candidates" }, "fsm_candidates", call);
      } catch (e) {
        if (e instanceof ContractError) return { candidates: null, notes: [], why: e.message };
        throw e;
      }
      const guarded = settingsGuard(raw);
      const verdict = await pam.checkMemory(guarded.candidates, call);
      return verdict.ok ? { candidates: guarded.candidates, notes: guarded.notes, why: null }
        : { candidates: null, notes: [], why: verdict.items.filter((x) => !x.ok).map((x) => `${x.ref}: ${x.why}`).join(" / ") };
    };
    let got = await attempt(feedback);
    if (o.signal?.aborted) return cancelled();
    if (got.why !== null) got = await attempt([feedback, REFLECT_TEXT.retry(headWithin(got.why, RETRY_WHY_MAX))].filter(Boolean).join("\n"));
    if (o.signal?.aborted) return cancelled();
    if (got.candidates === null) {
      done(false, REFLECT_TEXT.rejected(got.why!), null, null, { rejected: got.why });
      return fail(got.why!);
    }
    const candidates = got.candidates;
    // 3) 시각 찾기(지난 날까지, 날마다 아직 모르는 (상태, 후보)·행동만)
    const rules = candidates.states.flatMap((s) => s.rules.filter((r) => LEARNED_ACTIONS.includes(r.action)).flatMap((r) => r.candidates.map((c) => ({ state: s.id, action: r.action, to: r.to, cand: c }))));
    const actions = [...new Set(rules.map((r) => r.action))];
    const descOf = new Map(candidates.states.map((s) => [s.id, s.description]));
    const keyOf = (state: string, text: string) => markKey(state, descOf.get(state) ?? "", text);
    const days = db.daysUpTo(day);
    for (const d of days) {
      if (!rules.length) break;
      const m = marksOf(d);
      const ask = [...new Map(rules.map((r) => [keyOf(r.state, candidateText(r.cand)), r])).values()].filter((r) => !(keyOf(r.state, candidateText(r.cand)) in m.candidates));
      const want = actions.filter((a) => !(a in m.actions));
      if (!ask.length && !want.length && m.unseen !== null) continue;
      const dl = linesOf(d);
      if (!dl.length) continue;
      if (m.chunks === null) {
        try { m.chunks = (await pam.chunk(latestWithin(dl.map((l) => l.line), limits.reflect_input_bytes), call)).chunks; } catch (e) { if (!(e instanceof ContractError)) throw e; m.chunks = []; }
      }
      let marks: Marks;
      try {
        marks = await pam.mark({
          states: candidates.states.map((s) => ({ id: s.id, description: s.description })), candidates: ask.map((r) => ({ state: r.state, candidate: r.cand })), actions: want,
          lines: dl.map((l) => l.line), chunks: chunkLines(db, d, m.chunks),
        }, call, o.log);
      } catch (e) {
        // 그날 시각 찾기가 틀리거나 줄 하나로도 문맥 한도를 넘으면 그날만 셈에서 빼고 잇는다(사본에 남기지 않아 다음 밤에 다시 묻는다, Codex 1b07d3e2 P2). 연결 오류는 그대로 던진다
        if (!(e instanceof ContractError)) throw e;
        o.log?.(NIGHT_TEXT.markFailed(d, (e as Error).message));
        continue;
      }
      if (o.signal?.aborted) return cancelled();
      for (const c of marks.candidates) m.candidates[keyOf(c.state, c.candidate)] = c.times;
      for (const a of marks.actions) m.actions[a.action] = a.times;
      m.unseen = marks.unseen;
      keepMarks(m);
    }
    // 4) 채택 검사(지난 날을 모두 모아 다시 센다)
    const checks: NightCheck[] = rules.map((r) => {
      const perDay: CtxDay[] = days.flatMap((d) => {
        const dl = linesOf(d);
        const m = marksOf(d);
        // 시각 찾기가 실패한 날(그 후보·행동 시각이 없음)은 셈에 넣지 않는다
        if (!dl.length || !(keyOf(r.state, candidateText(r.cand)) in m.candidates) || !(r.action in m.actions) || m.unseen === null) return [];
        const sec = (t: string) => clock(t, "time");
        const asked = answerActions(db, d).find((x) => x.action === r.action)?.times ?? [];
        // 로봇이 그 일을 한 구간은 못 봄: 그 안의 행동 표시(폰 명령대로 사람이 한 일)는 행동으로 세지 않는다(Codex 1b07d3e2 P2: checkCandidate가 행동을 못 봄보다 먼저 센다)
        const robot = robotSpans(db, d, r.action);
        const byRobot = (a: number) => robot.some(([s, e]) => s <= a && a <= e);
        const times = dl.map((l) => sec(l.time));
        return [{
          date: d,
          start: times[0]!, end: times.at(-1)! + 1,
          candidate: (m.candidates[keyOf(r.state, candidateText(r.cand))] ?? []).map(sec),
          action: [...(m.actions[r.action] ?? []).map(sec).filter((a) => !byRobot(a)), ...asked],
          unseen: [...(m.unseen ?? []).map((u) => [sec(u.start), unseenEnd(times, sec(u.end))] as [number, number]), ...robot],
          answered: answerTimes(db, d, r.action),
        }];
      });
      // 맥락 없음 → 하나 → 둘(요일·3시간 칸): 첫 줄이 맥락 없는 검사이고 통과하지 못하면 맥락 규칙이 이어진다
      const [plain, ...withCtx] = findRules(perDay);
      const { ctx: _none, ...base } = plain!;
      const ctxRules = withCtx.map((x) => ({ ctx: x.ctx!, n: x.n, k: x.k, rate: x.rate, base_rate: x.base_rate, p_value: x.p_value }));
      return { ...base, passed: base.passed || ctxRules.length > 0, state: r.state, action: r.action, on: r.cand.on, when: r.cand.when ?? null, ...(ctxRules.length ? { ctx_rules: ctxRules } : {}) };
    });
    const ctxOf = new Map<string, Ctx[]>(checks.flatMap((c) => (c.ctx_rules?.length ? [[adoptKey(c.state, c.action, { on: c.on, ...(c.when ? { when: c.when } : {}) }), c.ctx_rules.map((x) => x.ctx)] as const] : [])));
    let passed = new Set(checks.filter((c) => c.passed).map((c) => adoptKey(c.state, c.action, { on: c.on, ...(c.when ? { when: c.when } : {}) })));
    // 5) 로봇 FSM(seed 화살표 + 통과한 배우는 행동 후보, 맥락이 통과했으면 맥락 있는 화살표) → 습관 거르기(배운 화살표만 뺄 수 있음) → 코드 검사
    let robot = adoptedFsm(candidates, passed, CUP_FSM_MEMORY, ctxOf);
    let filtered: HabitRuleNote[] = [];
    if (o.filter) {
      const windowDays = o.windowDays ?? 30;
      const dayStart = Date.parse(`${day}T00:00:00Z`) - db.offsetMinutes * 60_000;
      // 기록 줄은 따로 넘긴 거르기만 읽는다(기본은 쓰지 않으니 30일 기록을 올리지 않는다: 기록 DB가 커도 서버를 멈추지 않게)
      const rows = db.list({ since: dayStart - (windowDays - 1) * DAY_MS, until: dayStart + DAY_MS - 1, kinds: [...HABIT_KINDS], limit: Number.MAX_SAFE_INTEGER });
      const out = await o.filter({ day, windowDays, offsetMinutes: db.offsetMinutes, previous: today, proposed: robot, rows });
      if (o.signal?.aborted) return cancelled();
      const kept = new Set(learnedEdges(CUP_FSM_MEMORY, validateMemory(out.memory, "fsm") as FsmMemory).map(edgeKey));
      const removed = learnedEdges(CUP_FSM_MEMORY, robot).filter((e) => !kept.has(edgeKey(e))).map((e) => adoptKey(e.from, e.action, { on: e.on, ...(e.when ? { when: e.when } : {}) }));
      passed = new Set([...passed].filter((k) => !removed.includes(k)));
      robot = adoptedFsm(candidates, passed, CUP_FSM_MEMORY, ctxOf);
      filtered = out.notes;
    }
    const memory = validateMemory(robot, "fsm") as FsmMemory;
    const dropped = [...got.notes, ...filtered].filter((n) => !n.kept);
    const learned = learnedEdges(today, memory).filter((r) => !TASKS[r.action]?.coach);
    const active = learnedEdges(CUP_FSM_MEMORY, memory).filter((r) => !TASKS[r.action]?.coach);
    const passedList = checks.filter((c) => passed.has(adoptKey(c.state, c.action, { on: c.on, ...(c.when ? { when: c.when } : {}) })))
      .map((c) => ({ state: c.state, action: c.action, on: c.on, ...(c.when ? { when: c.when } : {}), ...(c.ctx_rules?.length ? { ctx: c.ctx_rules.map((x) => x.ctx) } : {}) }));
    // 저장 바로 전에도 끊겼는지 본다(끊긴 반성은 날 고정·새 판본·성공 기록을 남기지 않는다)
    if (o.signal?.aborted) return cancelled();
    // 6) 저장: 끝난 반성만 그날 판본을 고정하고(판본이 없으면 seed를 저장), 로봇·후보 판본과 반성 기록을 한 트랜잭션으로
    memoryForDay(db, day);
    let appliesDay = nextDay(day);
    while (db.pinnedMemory(appliesDay) !== null) appliesDay = nextDay(appliesDay);
    const at = now();
    const found = { learned, active, dropped, rejected: null, ...(checks.length ? { checks } : {}) };
    const used = usage ? { usage } : {};
    const saved = db.saveNight({
      day, appliesDay, robot: memory, candidates,
      reflection: (version) => {
        const text = REFLECT_TEXT.done(version, appliesDay) + (learned.length ? ` · ${REFLECT_TEXT.learned(learned.length)}` : "");
        return { atMs: at, text, data: { day, ok: true, version, applies_day: appliesDay, ...found, ...used } };
      },
    });
    const text = REFLECT_TEXT.done(saved.robot, appliesDay) + (learned.length ? ` · ${REFLECT_TEXT.learned(learned.length)}` : "");
    o.emit?.({ type: "reflection", at_ms: at, day, ok: true, version: saved.robot, applies_day: appliesDay, text, ...found, ...used } as BrainLog);
    // 검사 결과 사본(커밋 뒤, 실패하면 로그 한 줄만: 결과는 반성 기록 data.checks에 있다)
    if (o.dir) {
      try { save(join(o.dir, `check-${day}.json`), { day, checks, passed: passedList }); } catch (e) { o.log?.(NIGHT_TEXT.copyFailed((e as Error).message)); }
    }
    return { ok: true, version: saved.robot, appliesDay, learned, active, dropped, passed: passedList, checks };
  } catch (e) {
    // 서버를 끄느라 끊었으면 기록하지 않는다(닫히는 DB에 쓰지 않는다)
    if (o.signal?.aborted) return cancelled();
    const error = (e as Error).message;
    done(false, REFLECT_TEXT.failed(error), null, null);
    return fail(error);
  }
}

