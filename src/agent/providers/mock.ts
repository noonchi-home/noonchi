// mock 공급자: 규칙 기반 한국어 의도 해석기. 진짜 LLM처럼 도구를 부른다.
// 1라운드 find_devices(문장 조각마다) → 2라운드 제어 도구 → 마지막에 결과 문장.
// 지원: 켜/꺼/열어/닫아/잠가/잠금 해제/시작/멈춰/온도 N도/밝기·음량 N%/상태, "~고"·"그리고"·","로 여러 요청.

import type { Command, DeviceKind } from "../../hub/types.js";
import type { LlmProvider, StepOptions, StepResult, ToolCall, ToolCallResult } from "../agent.js";
import { askApproval, doneSentence, josa, stateText } from "../phrases.js";
import type { ToolResult } from "../tools.js";

type Intent =
  | { kind: "on" | "off" | "open" | "close" | "lock" | "unlock" | "start" | "stop" | "state" }
  | { kind: "level"; percent: number }
  | { kind: "climate"; setpointC?: number; mode?: "cool" | "heat" | "auto" | "dry" | "fan"; fan?: "low" | "medium" | "high" | "auto" };

interface Clause {
  text: string;
  intent?: Intent;
  query: string;
  all: boolean;
}

interface Found {
  id: string;
  label: string;
  room: string;
  roomLabel: string;
  kind: DeviceKind;
  capabilities: string[];
  sensors: string[];
}

interface Act {
  callId: string;
  device: Found;
  clause: number;
}

interface Turn {
  message: string;
  phase: "parse" | "find" | "act" | "done";
  clauses: Clause[];
  finds: Map<string, number>; // callId → clause index
  found: Map<number, { rooms: { id: string }[]; devices: Found[] }>;
  acts: Act[];
  results: Map<string, ToolResult>;
  notes: string[];
}

interface MockState {
  lastRoom?: string;
  turn?: Turn;
  seq: number;
}

export const MOCK_HELP = "무엇을 도와드릴까요? 예: '거실 불 켜줘', '거실 불 켜고 TV 꺼줘', '에어컨 24도로 맞춰줘', '안방 커튼 닫아줘', '현관문 열어줘'.";

const SPLIT = /\s*(?:,|그리고|그다음에?|다음에)\s*|(?<=(?:켜|끄|열|닫|잠그|틀|맞추|하|멈추|돌리|올리|내리|바꾸|잠가|잠궈))고\s+|(?<=[가-힣])(?:이)?랑\s+/;
const PERCENT = /(\d{1,3})\s*(?:%|퍼센트|프로)\s*(?:로|으로|만|정도|까지)?/;
const TEMP = /(\d{1,2}(?:\.\d)?)\s*(?:도|℃|°C?)\s*(?:로|으로|에|정도)?/i;
const MODES: [RegExp, "cool" | "heat" | "auto" | "dry" | "fan"][] = [[/냉방/, "cool"], [/난방/, "heat"], [/제습/, "dry"], [/송풍/, "fan"], [/자동\s*모드/, "auto"]];
const FANS: [RegExp, "low" | "medium" | "high" | "auto"][] = [[/바람\S*\s*(?:약하게|약|살살)/, "low"], [/바람\S*\s*(?:중간|보통)/, "medium"], [/바람\S*\s*(?:세게|강하게|강)/, "high"], [/바람\S*\s*자동/, "auto"]];
const VERBS: [RegExp, Intent["kind"]][] = [
  [/상태|어때|알려|켜져\s*있|꺼져\s*있|열려\s*있|닫혀\s*있|잠겨\s*있|있어\?|있니/, "state"],
  [/잠금\s*(?:을|를)?\s*(?:해제|풀)|문\s*(?:을|를)?\s*따/, "unlock"],
  [/잠가|잠궈|잠그|잠금/, "lock"],
  [/시작|돌려|작동|가동|청소\s*해/, "start"],
  [/멈춰|멈추|정지|중지|그만|스톱/, "stop"],
  [/열어|열기|열고|열/, "open"],
  [/닫아|닫기|닫고|닫/, "close"],
  [/켜|틀어|틀고|틀/, "on"],
  [/꺼|끄/, "off"],
];
// 대상 말을 남기려고 지우는 것: 동사(어간부터 낱말 끝까지)와 군말
const VERB_WORDS = /(?:켜|꺼|끄|틀|열|닫|잠그|잠가|잠궈|잠금|맞춰|맞추|설정|바꿔|변경|시작|멈춰|멈추|정지|중지|돌려|작동|가동|해제|풀어|그만|스톱)[가-힣]*/g;
const FILLERS = /(?:^|\s)(?:좀|지금|당장|빨리|해줘|해\s*주세요|해|줘|주세요|부탁해|부탁|요|밝기|음량|볼륨|소리|온도|모드|상태|어때|알려줘|알려|확인|있어|있니|다|모두|전부|모든|전체|하고|청소|냉방|난방|제습|송풍|자동|바람\S*|약하게|세게|강하게|중간|보통)(?=\s|$)/g;
const ALL = /(?:^|\s)(?:다|모두|전부|모든|전체)(?=\s|$)/;

function parseIntent(t: string): Intent | undefined {
  const p = t.match(PERCENT);
  if (p) return { kind: "level", percent: Math.min(100, Number(p[1])) };
  const temp = t.match(TEMP);
  const mode = MODES.find(([re]) => re.test(t))?.[1];
  const fan = FANS.find(([re]) => re.test(t))?.[1];
  if (temp || fan || (mode && /모드|로\s*(?:바꿔|해|맞춰|틀어)|틀어/.test(t))) {
    const c: Intent = { kind: "climate" };
    if (temp) c.setpointC = Number(temp[1]);
    if (mode) c.mode = mode;
    if (fan) c.fan = fan;
    return c;
  }
  const v = VERBS.find(([re]) => re.test(t));
  return v ? ({ kind: v[1] } as Intent) : undefined;
}

function targetQuery(t: string): string {
  return t.replace(PERCENT, " ").replace(TEMP, " ").replace(VERB_WORDS, " ").replace(/[.?!~]/g, " ")
    .replace(FILLERS, " ").replace(FILLERS, " ").replace(/\s+/g, " ").trim();
}

export function parseMessage(message: string): Clause[] {
  const parts = message.split(SPLIT).map((s) => s.trim()).filter(Boolean);
  const clauses: Clause[] = parts.map((text) => ({ text, intent: parseIntent(text), query: targetQuery(text), all: ALL.test(text) }));
  // 동사 없는 조각("거실 불이랑 TV 꺼줘"의 "거실 불")은 뒤 조각의 동작을 따른다
  for (let i = 0; i < clauses.length; i++) {
    const c = clauses[i]!;
    if (!c.intent) c.intent = clauses.slice(i + 1).find((x) => x.intent)?.intent ?? clauses.slice(0, i).reverse().find((x) => x.intent)?.intent;
  }
  // 대상 없는 조각("에어컨 켜고 24도로 맞춰줘"의 뒤)은 앞 조각의 대상을 쓴다
  for (let i = 0; i < clauses.length; i++) {
    const c = clauses[i]!;
    if (!c.query) c.query = clauses.slice(0, i).reverse().find((x) => x.query)?.query ?? defaultQuery(c.intent);
  }
  return clauses.filter((c) => c.intent);
}

function defaultQuery(intent?: Intent): string {
  if (intent?.kind === "climate") return intent.mode === "heat" ? "보일러" : "에어컨";
  return "";
}

function supports(d: Found, intent: Intent): boolean {
  const c = d.capabilities;
  switch (intent.kind) {
    case "on":
    case "off":
      return c.includes("onoff") || c.includes("operation") || c.includes("valve");
    case "level":
      return c.includes("level") || c.includes("covering");
    case "climate":
      return intent.setpointC !== undefined || intent.mode !== undefined ? c.includes("climate") : c.includes("fan");
    case "open":
    case "close":
      return c.includes("covering") || c.includes("lock") || c.includes("valve");
    case "lock":
    case "unlock":
      return c.includes("lock");
    case "start":
    case "stop":
      return c.includes("operation");
    case "state":
      return true;
  }
}

function toCall(d: Found, intent: Intent): { name: string; args: Record<string, unknown> } {
  const id = d.id;
  const c = d.capabilities;
  switch (intent.kind) {
    case "on": return { name: "turn_on", args: { device_id: id } };
    case "off": return { name: "turn_off", args: { device_id: id } };
    case "level":
      return c.includes("level") ? { name: "set_level", args: { device_id: id, percent: intent.percent } } : { name: "set_covering", args: { device_id: id, open_percent: intent.percent } };
    case "climate": {
      const args: Record<string, unknown> = { device_id: id };
      if (intent.setpointC !== undefined) args.setpoint_c = intent.setpointC;
      if (intent.mode !== undefined) args.mode = intent.mode;
      if (intent.fan !== undefined) args.fan = intent.fan;
      return { name: "set_climate", args };
    }
    case "open":
      if (c.includes("covering")) return { name: "set_covering", args: { device_id: id, open_percent: 100 } };
      if (c.includes("lock")) return { name: "unlock", args: { device_id: id } };
      return { name: "set_valve", args: { device_id: id, open: true } };
    case "close":
      if (c.includes("covering")) return { name: "set_covering", args: { device_id: id, open_percent: 0 } };
      if (c.includes("lock")) return { name: "lock", args: { device_id: id } };
      return { name: "set_valve", args: { device_id: id, open: false } };
    case "lock": return { name: "lock", args: { device_id: id } };
    case "unlock": return { name: "unlock", args: { device_id: id } };
    case "start": return { name: "start", args: { device_id: id } };
    case "stop": return { name: "stop", args: { device_id: id } };
    case "state": return { name: "get_state", args: { device_id: id } };
  }
}

const isLiving = (d: Found) => d.room === "living_room" || d.roomLabel === "거실";

export class MockProvider implements LlmProvider {
  readonly name = "mock";
  readonly model = "rules-ko";

  createState(): MockState {
    return { seq: 0 };
  }

  addUserMessage(state: unknown, text: string): void {
    const s = state as MockState;
    s.turn = { message: text, phase: "parse", clauses: [], finds: new Map(), found: new Map(), acts: [], results: new Map(), notes: [] };
  }

  addToolResults(state: unknown, results: ToolCallResult[]): void {
    const t = (state as MockState).turn;
    if (!t) return;
    for (const r of results) {
      t.results.set(r.call.id, r.result);
      const idx = t.finds.get(r.call.id);
      if (idx !== undefined && r.result.ok) t.found.set(idx, r.result.data as { rooms: { id: string }[]; devices: Found[] });
    }
  }

  async step(state: unknown, opts: StepOptions): Promise<StepResult> {
    const s = state as MockState;
    const t = s.turn;
    if (!t || t.phase === "done") return { text: MOCK_HELP, calls: [] };
    if (t.phase === "parse") {
      t.clauses = parseMessage(t.message);
      if (t.clauses.length === 0) {
        t.phase = "done";
        return { text: /^(응|네|예|그래)/.test(t.message.trim()) ? "지금 승인을 기다리는 작업이 없어요." : MOCK_HELP, calls: [] };
      }
      const calls: ToolCall[] = [];
      t.clauses.forEach((c, i) => {
        if (!c.query) {
          t.notes.push(`'${c.text}'에서 어떤 기기를 말씀하시는지 모르겠어요.`);
          return;
        }
        const id = this.id(s);
        t.finds.set(id, i);
        calls.push({ id, name: "find_devices", args: { query: c.query } });
      });
      t.phase = "find";
      if (calls.length === 0 || !opts.allowTools) return this.finish(t);
      return { text: "", calls };
    }
    if (t.phase === "find") {
      const calls: ToolCall[] = [];
      t.clauses.forEach((c, i) => {
        const f = t.found.get(i);
        if (!f || !c.intent) return;
        for (const d of this.pick(s, c, f)) {
          const call = toCall(d, c.intent);
          const id = this.id(s);
          t.acts.push({ callId: id, device: d, clause: i });
          calls.push({ id, name: call.name, args: call.args });
        }
      });
      t.phase = "act";
      if (calls.length === 0 || !opts.allowTools) return this.finish(t);
      return { text: "", calls };
    }
    return this.finish(t);
  }

  /** find 결과에서 대상 기기를 고른다. 고를 수 없으면 notes에 이유를 남긴다. */
  private pick(s: MockState, c: Clause, f: { rooms: { id: string }[]; devices: Found[] }): Found[] {
    const intent = c.intent!;
    const notes = s.turn!.notes;
    if (f.rooms.length > 0) s.lastRoom = f.rooms[f.rooms.length - 1]!.id;
    if (f.devices.length === 0) {
      notes.push(`'${c.query}'에 맞는 기기를 찾지 못했어요.`);
      return [];
    }
    const ok = f.devices.filter((d) => supports(d, intent));
    if (ok.length === 0) {
      const d = f.devices[0]!;
      notes.push(d.capabilities.length === 0
        ? `${josa(d.label, "은/는")} 센서라서 직접 바꿀 수 없어요(화면의 시뮬레이션으로 바꿀 수 있어요).`
        : `${josa(d.label, "은/는")} 그 명령을 지원하지 않아요.`);
      return [];
    }
    let targets = ok;
    if (!c.all && f.rooms.length === 0 && new Set(ok.map((d) => d.room)).size > 1) {
      const byLast = ok.filter((d) => d.room === s.lastRoom);
      const byLiving = ok.filter(isLiving);
      if (byLast.length > 0) targets = byLast;
      else if (byLiving.length > 0) targets = byLiving;
      else {
        notes.push(`어느 기기인지 알려 주세요: ${ok.slice(0, 6).map((d) => `${d.roomLabel} ${d.label}`).join(", ")}`);
        return [];
      }
    }
    if (intent.kind === "state" && targets.length > 8) targets = targets.slice(0, 8);
    return targets;
  }

  private finish(t: Turn): StepResult {
    t.phase = "done";
    const done = new Map<string, { labels: string[]; kind: DeviceKind; cmd: Command }>();
    const lines: string[] = [];
    const errors: string[] = [];
    const asks: string[] = [];
    for (const a of t.acts) {
      const r = t.results.get(a.callId);
      if (!r) continue;
      if (r.pendingApproval) asks.push(askApproval(r.pendingApproval.reason));
      else if (!r.ok) errors.push(r.error ?? `${a.device.label}: 실패했어요.`);
      else if (r.command) {
        const key = `${a.device.kind}|${JSON.stringify(r.command)}`;
        const g = done.get(key) ?? { labels: [], kind: a.device.kind, cmd: r.command };
        g.labels.push(a.device.label);
        done.set(key, g);
      } else if (r.data && typeof r.data === "object" && "state" in r.data) {
        const d = r.data as { label: string; kind: DeviceKind; state: Record<string, unknown>; matter: Record<string, unknown> };
        lines.push(`${d.label}: ${stateText(d, { twin: d.state, matter: d.matter })}.`);
      }
    }
    const text = [...[...done.values()].map((g) => doneSentence(g.labels, g.kind, g.cmd)), ...lines, ...errors, ...t.notes, ...asks].join(" ");
    return { text: text || MOCK_HELP, calls: [] };
  }

  private id(s: MockState): string {
    s.seq += 1;
    return `mock_${s.seq}`;
  }
}
