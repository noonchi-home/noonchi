// 메시지 상자 FSM 카드 자료(순수 함수). 서버가 보낸 습관 FSM 그림(habit, src/brain/habit.ts: 상태 목록 + 전이 목록 from·to·trigger·action)·
// 판단으로 쌓은 지금 상태와 막 일어난 전이(data.ts fsmAt) → 카드에 그릴 상태 원·전이 선·제자리 고리와 그 글 자리(판 px).
// 카드에는 사람 상태와 전이만 그린다. 미리 세운 목표는 따로 된 상태 머신이라 카드에 그리지 않고 목표 한 줄(goal-line.ts)로 보인다.
// 카드가 판을 옮겨 지금 상태를 가운데에 둔다. 상태는 한 줄로 선다(전이 선 길이 합이 가장 작은 차례). 오른쪽으로 가는 선은 위로, 왼쪽으로 가는 선은 아래로 휜다
// (그림 예시처럼 마주 보는 두 선이 갈린다). 선 글은 「조건」과 그때 「로봇 행동」(있으면) 두 줄이고, 지금 상태에 닿는 선(나가는 선·막 지나온 선)과 지금 상태의 고리만,
// 카드 안에 드는 것만 단다. 화면 글에 화살표를 쓰지 않고(화살표는 선이다) 안쪽 말(모름·규칙 여럿·대기)도 쓰지 않는다.
import type { HabitFsm } from "../../../src/contract/habit.ts";
import type { DashData } from "./data";
import { WORDS } from "./words";

/** 카드가 그리는 지금: 습관 그림, 지금 상태, 막 일어난 전이의 앞 상태(없으면 null), 지금 하는 일(없으면 null). */
export interface FsmNow {
  habit: HabitFsm;
  state: string;
  from: string | null;
  doing: string | null;
}

/** 지금 카드: 지금 상태는 판단으로 쌓은 마지막 상태(그림에 없거나 판단 전이면 기억의 처음 상태), 하는 일은 지금 상태에 닿는 전이의 행동일 때만. */
export function fsmOf(s: DashData): FsmNow | null {
  const habit = s.habit;
  if (!habit) return null;
  const known = (id: string | null) => (id && habit.states.some((x) => x.id === id) ? id : null);
  const state = known(s.fsmAt.state) ?? habit.initial;
  const from = known(s.fsmAt.from);
  const d = s.fsmAt.doing;
  const doing = d && habit.transitions.some((t) => t.action === d && (t.from === state || t.to === state)) ? d : null;
  return { habit, state, from: from === state ? null : from, doing };
}

/** 높이 FSM_BASE_H 카드의 상태 원 반지름(px, Avatar size state 88px의 반)과 한 줄 위 상태 사이(가운데 사이 px).
 *  카드가 더 높으면 원·사이·선 굵기·화살촉을 같은 배율 k(최대 FSM_K_MAX)로 키운다. 글은 부품 원래 크기 그대로다. */
export const FSM_R = 44;
export const FSM_BASE_H = 140;
export const FSM_K_MAX = 1.4;
const SPACING = 200;
/** 한 칸 옆 선이 휘는 높이(조절점, px). 두 칸 넘게 떨어진 선은 사이 원을 넘어가게 더 휜다. */
const BEND = 40;
const BEND_FAR = 110;
/** 화살촉 날개 길이(px)와 벌림(라디안). 끝은 원 가장자리에서 2px 띄운다. */
const WING = 7;
const SPREAD = Math.PI / 6;
const TIP_GAP = 2;
/** 글 자리를 선에서 더 띄우는 만큼(px)과 카드 가장자리 여유(px). */
const LABEL_OFF = 6;
const EDGE = 12;
/** 빨간 점이 지나는 자리 수(+1). */
const TRACK = 16;

type P = [number, number];
export interface FsmNode { id: string; name: string; does: string; x: number; y: number; now: boolean; prev: boolean }
export interface FsmLabel { text: string; sub?: string; x: number; y: number; side: "above" | "below" | "left" }
/** 선: edge 그 밖의 전이, out 지금 상태에서 나가는 전이, taken 막 지나온 전이. d는 선, arrow는 화살촉, track은 빨간 점이 지나는 자리. */
export interface FsmLine { id: string; from: string; to: string; kind: "edge" | "out" | "taken"; d: string; arrow: string; label: FsmLabel | null; track: P[] }
/** r 원 반지름, k 배율(r / FSM_R), width 토큰 선 굵기 → 이 배율의 굵기. */
export interface FsmView { nodes: FsmNode[]; lines: FsmLine[]; loop: FsmLine | null; focus: { x: number; y: number }; r: number; k: number; width: (w: number) => number }

const fmt = (v: number) => (Math.round(v * 10) / 10).toString();
const pt = ([x, y]: P) => `${fmt(x)} ${fmt(y)}`;
const add = (a: P, b: P): P => [a[0] + b[0], a[1] + b[1]];
const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1]];
const mul = (a: P, k: number): P => [a[0] * k, a[1] * k];
const unit = (a: P): P => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; };
const rot = ([x, y]: P, r: number): P => [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)];
const dirAt = (deg: number): P => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];

/** 2차 곡선 위 t 자리. */
const quad = (a: P, c: P, b: P, t: number): P => add(add(mul(a, (1 - t) ** 2), mul(c, 2 * (1 - t) * t)), mul(b, t * t));
/** 3차 곡선 위 t 자리. */
const cubic = (a: P, c1: P, c2: P, b: P, t: number): P =>
  add(add(mul(a, (1 - t) ** 3), mul(c1, 3 * (1 - t) ** 2 * t)), add(mul(c2, 3 * (1 - t) * t * t), mul(b, t ** 3)));

/** 끝 자리 tip에 닿는 화살촉(날개 둘): 들어오는 방향 dir, 배율 k. */
function arrowAt(tip: P, dir: P, k: number): string {
  const back = mul(unit(dir), -WING * k);
  return `M${pt(add(tip, rot(back, SPREAD)))}L${pt(tip)}L${pt(add(tip, rot(back, -SPREAD)))}`;
}

/** 상태 차례: 전이 선 길이 합(칸 수)이 가장 작은 차례. 같으면 기억 차례 번호를 앞에서부터 견줘 작은 것. 상태가 8개를 넘으면 기억 차례. */
export function fsmOrder(h: HabitFsm): string[] {
  const ids = h.states.map((s) => s.id);
  if (ids.length > 8) return ids;
  const idx = new Map(ids.map((id, i) => [id, i]));
  const pairs = h.transitions.flatMap((n) => (n.from !== n.to && idx.has(n.from) && idx.has(n.to) ? [[idx.get(n.from)!, idx.get(n.to)!] as const] : []));
  let best: number[] | null = null;
  let bestCost = Infinity;
  const pos = new Array<number>(ids.length);
  const perm: number[] = [];
  const used = new Array<boolean>(ids.length).fill(false);
  const visit = () => {
    if (perm.length === ids.length) {
      perm.forEach((s, i) => { pos[s] = i; });
      const cost = pairs.reduce((c, [a, b]) => c + Math.abs(pos[a]! - pos[b]!), 0);
      if (cost < bestCost) { bestCost = cost; best = [...perm]; }
      return;
    }
    for (let s = 0; s < ids.length; s++) {
      if (used[s]) continue;
      used[s] = true;
      perm.push(s);
      visit();
      perm.pop();
      used[s] = false;
    }
  };
  visit();
  return (best ?? ids.map((_, i) => i)).map((i) => ids[i]!);
}

/** 다른 상태가 하는 일: 그 상태 제자리 전이의 행동(여럿이면 「<첫 행동> 외 N」), 없으면 지켜봄. */
function habitDoes(h: HabitFsm, id: string): string {
  const acts = h.transitions.filter((t) => t.from === id && t.to === id && t.action).map((t) => t.action!);
  if (!acts.length) return WORDS.fsm.watch;
  return acts.length === 1 ? acts[0]! : `${acts[0]} ${WORDS.fsm.more} ${acts.length - 1}`;
}

export function fsmLayout(f: FsmNow, box: { width: number; height: number }): FsmView {
  const { habit } = f;
  const k = Math.min(FSM_K_MAX, Math.max(1, box.height / FSM_BASE_H));
  const r = FSM_R * k;
  const prev = f.from;
  const order = fsmOrder(habit);
  const cur = f.state;
  const slot = new Map(order.map((id, i) => [id, i]));
  const center = (id: string): P => [(slot.get(id) ?? 0) * SPACING * k, 0];
  const focus = { x: center(cur)[0], y: 0 };
  const inside = (l: FsmLabel) => Math.abs(l.x - focus.x) <= box.width / 2 - EDGE && Math.abs(l.y - focus.y) <= box.height / 2;
  const keep = (l: FsmLabel | null) => (l && inside(l) ? l : null);
  const name = (id: string) => habit.states.find((s) => s.id === id)?.name ?? id;

  const nodes: FsmNode[] = order.map((id) => {
    const [x, y] = center(id);
    const now = id === cur;
    return { id, name: name(id), does: now ? f.doing ?? WORDS.fsm.watch : habitDoes(habit, id), x, y, now, prev: !now && id === prev };
  });

  const lines: FsmLine[] = [];
  const seen = new Set<string>();
  const edges = habit.transitions.filter((n) => n.from !== n.to && slot.has(n.from) && slot.has(n.to));
  for (const n of edges) {
    const id = `${n.from}>${n.to}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const a = center(n.from), b = center(n.to);
    const span = Math.abs((slot.get(n.to) ?? 0) - (slot.get(n.from) ?? 0));
    const up = b[0] > a[0];
    const h = (span <= 1 ? BEND : BEND_FAR * span) * k;
    const c: P = [(a[0] + b[0]) / 2, up ? -h : h];
    const p0 = add(a, mul(unit(sub(c, a)), r));
    const p2 = add(b, mul(unit(sub(c, b)), r + TIP_GAP * k));
    const track = Array.from({ length: TRACK + 1 }, (_, i) => quad(p0, c, p2, i / TRACK));
    const mid = quad(p0, c, p2, 0.5);
    const at: P = [mid[0], mid[1] + (up ? -LABEL_OFF : LABEL_OFF) * k];
    const side = up ? "above" : "below";
    const kind: FsmLine["kind"] = n.to === cur && n.from === prev ? "taken" : n.from === cur ? "out" : "edge";
    const label: FsmLabel | null = kind === "out" || kind === "taken" ? { text: n.trigger, ...(n.action ? { sub: n.action } : {}), x: at[0], y: at[1], side } : null;
    lines.push({ id, from: n.from, to: n.to, kind, d: `M${pt(p0)}Q${pt(c)} ${pt(p2)}`, arrow: arrowAt(p2, sub(p2, c), k), label: keep(label), track });
  }

  // 지금 상태 제자리 고리(원 왼쪽 위): 하는 일이 아닌 첫 제자리 전이
  let loop: FsmLine | null = null;
  {
    const rule = habit.transitions.find((t) => t.from === cur && t.to === cur && t.action && t.action !== f.doing);
    if (rule) {
      const c0 = center(cur);
      const p0 = add(c0, mul(dirAt(-100), r));
      const p3 = add(c0, mul(dirAt(-160), r + TIP_GAP * k));
      const c1 = add(c0, mul(dirAt(-95), r + 36 * k));
      const c2 = add(c0, mul(dirAt(-165), r + 36 * k));
      const fine = Array.from({ length: 49 }, (_, i) => cubic(p0, c1, c2, p3, i / 48));
      // 글은 고리 왼쪽 끝보다 더 왼쪽에(고리를 가리지 않게), 높이는 고리 꼭대기(카드 위 끝 안쪽)
      const apex = cubic(p0, c1, c2, p3, 0.5);
      const left = Math.min(...fine.map((q) => q[0]));
      const at: P = [left - LABEL_OFF * k, Math.max(apex[1], -box.height / 2 + 20)];
      loop = {
        id: `${cur}>${cur}`, from: cur, to: cur, kind: "edge", d: `M${pt(p0)}C${pt(c1)} ${pt(c2)} ${pt(p3)}`, arrow: arrowAt(p3, sub(p3, c2), k),
        label: { text: rule.trigger, sub: rule.action!, x: at[0], y: at[1], side: "left" }, track: fine,
      };
    }
  }
  return { nodes, lines, loop, focus, r, k, width: (w) => w * k };
}
