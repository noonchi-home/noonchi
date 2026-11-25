// 계획 표시 자료(순수 함수): 무엇을 어디에 그릴지만 정한다. 자리는 트윈 좌표 [x, 높이, z](World State 물건 position·엔진 anchor와 같은 꼴), 글은 화면 글 그대로다.
// 그리기는 따로 한다: 트윈 판은 frame.ts가 구운 보기 그림 픽셀로 옮겨 MapOverlay가 그린다. 같은 자료를 폰 카메라 화면 위에도 그 카메라로 옮겨 그릴 수 있다.
// - 길(바닥 높이 0): 지나온 길, 지금 이동 구간(로봇 자리에서 나눔), 남은 길.
// - 번호: 단계마다 그 단계 자리(이동은 구간 끝 바닥, 그 밖은 대상 자리)와 상태. 지금 단계 이름표 「② 컵 집기」.
// - 사람 이름표: 발 자리 위 머리 높이에 「사람 · 마시는 중」(하는 일, 없으면 자세, 그것도 없으면 보임), 안 보이면 「사람 · 안 보임」.
// - 목표 고리: 미리 세운 목표가 선 동안 그 대상 물건 자리(World State position, 없으면 놓인 면의 자리). 글은 없다.
// - 미리 그린 길: 목표가 준비됨(또는 시작, 사람이 떠남)이고 열린 계획이 없으면 미리 만든 계획(목표 plan)의 길 전체와 단계 번호. 글은 없고, 준비됨은 흐리고 시작은 진하다.
//   열린 계획이 오면 그 계획의 번호 길(위)로 이어지고, 세움·끝·버림이면 없다(2026-11-19 사용자 결정).
import type { PlanTarget, PlanView, StepStatus, XZ } from "../../../src/contract/plan.ts";
import type { WorldObject, WorldView } from "../../../src/contract/world.ts";
import { STATE_TEXT } from "../../../src/world/labels.ts";
import { CLASSES } from "../../../src/world/vocab.ts";
import { isOpen, stepIndex } from "./data";
import { WORDS } from "./words";

/** 트윈 좌표 [x, 높이, z](m). */
export type Vec3 = [number, number, number];
/** 사람 이름표를 다는 높이(m, 머리 위쯤). */
export const PERSON_H = 1.7;

export interface PlanMarks {
  route: { done: Vec3[]; now: Vec3[]; ahead: Vec3[] };
  stops: { n: number; at: Vec3; status: StepStatus; now: boolean }[];
  step: { at: Vec3; text: string } | null;
  person: { at: Vec3; text: string } | null;
  goal: { at: Vec3 } | null;
  /** 미리 그린 길(목표가 준비된 계획): 길 전체, 단계 번호 자리, 진한가(시작). 없으면 null. */
  pre: { route: Vec3[]; stops: { n: number; at: Vec3 }[]; strong: boolean } | null;
}

/** 목표 자료(goal.ts goalOf): 대상 물건, 서 있는가, 단계, 미리 만든 계획. */
export interface GoalMarkInput { object: string | null; standing: boolean; stage?: "set" | "ready" | "started" | "done" | "dropped"; plan?: PlanView | null }

const len = (a: XZ, b: XZ) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const same = (a: XZ, b: XZ) => len(a, b) < 1e-9;
const floor = ([x, z]: XZ): Vec3 => [x, 0, z];

/** 손에 든 물건(확인됨)인가. 손에 든 물건은 트윈 자리를 모르는 것으로 본다. */
const held = (o: Pick<WorldObject, "facts">) => o.facts.place?.value === "in_hand" && o.facts.place.certainty === "confirmed";

/**
 * 트윈 위 물건 표시 자리(자리를 모르면 그리지 않는다): 장면 물건·가전이면 그 anchor,
 * World State 물건이면 놓인 면(surface)이 있고 손에 없을 때만 그 물건 자리(없으면 놓인 면 anchor). 사라진 물건·손에 든 물건·놓인 면이 없는 물건은 null이다.
 * 바닥 높이 0이나 폰 눈 자리로 대신하지 않는다.
 */
export function thingAt(id: string, world: WorldView | null | undefined, anchor: (id: string) => Vec3 | null): Vec3 | null {
  const scene = anchor(id);
  if (scene) return scene;
  const o = world?.objects.find((x) => x.id === id && x.status !== "gone");
  if (!o || held(o) || !o.surface) return null;
  return o.position ?? anchor(o.surface);
}

/** 꺾은선 위에서 p에 가장 가까운 자리까지 걸은 길이. */
function walkedTo(path: XZ[], p: XZ): number {
  let best = Infinity;
  let at = 0;
  let walked = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const [a, b] = [path[i]!, path[i + 1]!];
    const d = len(a, b);
    const k = d > 0 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (d * d))) : 0;
    const gap = len(p, [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]);
    if (gap < best) { best = gap; at = walked + k * d; }
    walked += d;
  }
  return at;
}

/** 꺾은선을 앞에서 길이 w 자리에서 둘로 나눈다(나눈 자리는 두 쪽에 다 든다, 꺾인 점과 같으면 한 번). */
function cut(path: XZ[], w: number): [XZ[], XZ[]] {
  let walked = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const [a, b] = [path[i]!, path[i + 1]!];
    const d = len(a, b);
    if (walked + d >= w || i + 2 === path.length) {
      const k = d > 0 ? Math.min(1, Math.max(0, (w - walked) / d)) : 0;
      const at: XZ = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
      const head = [...path.slice(0, i + 1), at].filter((q, j, all) => j === 0 || !same(q, all[j - 1]!));
      const tail = [at, ...path.slice(i + 1)].filter((q, j, all) => j === 0 || !same(q, all[j - 1]!));
      return [head, tail];
    }
    walked += d;
  }
  return [path.slice(0, 1), path.slice()];
}

/** 단계 번호 자리: 이동은 그 구간 끝(바닥, 구간이 없으면 대상 평면 자리), 그 밖은 대상 자리. 이동 아닌 단계의 대상 자리를 모르면 번호를 두지 않는다(바닥으로 대신하지 않는다). */
function stopsOf(plan: PlanView, at: (t: PlanTarget) => Vec3 | null): { n: number; at: Vec3; i: number }[] {
  const path = plan.path;
  return plan.steps.flatMap((s, i) => {
    const l = plan.legs.find((x) => x.stepId === s.id);
    const floorSpot = s.kind === "move" && s.target?.position ? floor(s.target.position) : null;
    const spot = l && path[l.end] ? floor(path[l.end]!) : s.target ? at(s.target) ?? floorSpot : null;
    return spot ? [{ n: i + 1, at: spot, i }] : [];
  });
}

/** 미리 그린 길: 목표가 준비됨·시작이고 미리 만든 계획이 있을 때(열린 계획이 없을 때만 부른다). */
function preMarks(goal: GoalMarkInput | null | undefined, at: (t: PlanTarget) => Vec3 | null): PlanMarks["pre"] {
  const p = goal?.plan;
  if (!p || (goal.stage !== "ready" && goal.stage !== "started")) return null;
  const stops = stopsOf(p, at).map(({ n, at: spot }) => ({ n, at: spot }));
  const route = p.path.length > 1 ? p.path.map(floor) : [];
  return route.length || stops.length ? { route, stops, strong: goal.stage === "started" } : null;
}

/** 동그라미 번호(①…⑳), 넘으면 숫자. */
const circled = (n: number) => (n >= 1 && n <= 20 ? String.fromCodePoint(0x245f + n) : `${n}`);

function personMark(w: WorldView | null): PlanMarks["person"] {
  const p = w?.person;
  if (!p?.position) return null;
  const f = p.facts;
  const v = f.activity?.value ?? f.posture?.value;
  const state = !p.visible ? WORDS.personGone : v ? STATE_TEXT[v] ?? v : WORDS.personSeen;
  return { at: [p.position[0], PERSON_H, p.position[1]], text: `${CLASSES.person!.label} · ${state}` };
}

/** 목표 고리 자리: 목표가 서 있으면 그 대상 World State 물건 자리(없으면 놓인 면의 자리). 손에 든 물건·놓인 면이 없는 물건·사라진 물건이면 없다. */
function goalMark(goal: GoalMarkInput | null | undefined, w: WorldView | null, at: (t: PlanTarget) => Vec3 | null): PlanMarks["goal"] {
  if (!goal?.standing || !goal.object) return null;
  const o = w?.objects.find((x) => x.id === goal.object && x.status !== "gone");
  if (!o || held(o) || !o.surface) return null;
  const spot = o.position ?? at({ objectId: o.surface });
  return spot ? { at: spot } : null;
}

/** plan 열린 계획, robot 맞춘 눈 평면 자리(모르면 null), world 지금 World State, at 단계 대상의 트윈 자리(모르면 null), goal 미리 세운 목표(goal.ts). */
export function planMarks(o: {
  plan: PlanView | null; robot: XZ | null; world: WorldView | null; at: (t: PlanTarget) => Vec3 | null;
  goal?: GoalMarkInput | null;
}): PlanMarks {
  const person = personMark(o.world);
  const goal = goalMark(o.goal, o.world, o.at);
  const plan = isOpen(o.plan) ? o.plan : null;
  if (!plan) return { route: { done: [], now: [], ahead: [] }, stops: [], step: null, person, goal, pre: preMarks(o.goal, o.at) };
  const k = stepIndex(plan) - 1;
  const path = plan.path;
  const legs = plan.legs.map((l, i) => ({ stepId: l.stepId, from: i === 0 ? 0 : plan.legs[i - 1]!.end, to: l.end }));
  const order = (id: string) => plan.steps.findIndex((s) => s.id === id);
  const leg = legs.find((l) => order(l.stepId) === k) ?? null;

  // 길: 지금 이동 구간이면 로봇 자리에서 나누고, 아니면 끝난 구간 끝에서 나눈다
  let route: PlanMarks["route"];
  if (path.length < 2) route = { done: [], now: [], ahead: [] };
  else if (leg) {
    const seg = path.slice(leg.from, leg.to + 1);
    const [passed, left] = cut(seg, o.robot ? walkedTo(seg, o.robot) : 0);
    const done = [...path.slice(0, leg.from), ...passed];
    const after = path.slice(leg.to);
    route = { done: done.length > 1 ? done.map(floor) : [], now: left.length > 1 ? left.map(floor) : [], ahead: after.length > 1 ? after.map(floor) : [] };
  } else {
    const end = legs.filter((l) => order(l.stepId) < k).at(-1)?.to ?? 0;
    const done = path.slice(0, end + 1);
    const ahead = path.slice(end);
    route = { done: done.length > 1 ? done.map(floor) : [], now: [], ahead: ahead.length > 1 ? ahead.map(floor) : [] };
  }

  // 번호: 이동은 구간 끝, 그 밖은 대상 자리(모르면 대상 평면 자리)
  const stops: PlanMarks["stops"] = stopsOf(plan, o.at).map(({ n, at, i }) => ({ n, at, status: plan.steps[i]!.status, now: i === k }));
  const cur = stops.find((s) => s.now);
  const step = cur ? { at: cur.at, text: `${circled(cur.n)} ${plan.steps[k]!.label}` } : null;
  return { route, stops, step, person, goal, pre: null };
}
