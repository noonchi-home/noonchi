// 계획 모드 입력: 고정 시스템 프롬프트(바뀌는 값 없음, 프롬프트 캐시가 깨지지 않게)와 계획마다 쓰는 사용자 말 한 개.
// 사용자 말에는 PAM 행동·판단, World State, 평면도, 가전, 손(폰) 자리, 승인 규칙, 조건 낱말 키를 글로 넣는다.
import type { WorldView } from "../contract/world.js";
import { CONDITION_KINDS } from "../world/conditions.js";
import { CLASSES, DEVICE_STATES, STATES, type ClassKey, type Facet, type Target } from "../world/vocab.js";
import type { PlanContext } from "./planTools.js";
import { CONFIRM_RULES } from "./policy.js";
import { KIND_LABELS } from "../model/mapping.js";

export const PLANNER_PROMPT = `너는 이 집 스마트홈 에이전트의 계획 모드다. PAM이 고른 할 일 하나를 지금 집 상태에서 실제로 할 수 있는 단계 계획으로 바꾼다.

손
- 로봇이 없다. 사람이 든 실제 폰이 손이다. 사람이 할 일은 go·pick·place 단계로 만들고, 폰에 사람에게 하는 말(command)을 보낸다.
- command는 「주세요」로 끝나는 짧은 부탁이다. 예: 「식탁으로 가 주세요」, 「컵을 들어 주세요」, 「컵을 싱크대에 넣어 주세요」. 클로이드가 스스로 하는 말(「집어 들게요」)로 쓰지 않는다.

단계
- go: 그 자리로 가기. target은 평면도 id. until은 보통 {"phone_near": target}(쓰지 않으면 그것으로 본다).
- pick: 집기. target은 보이는 World State 물건 id(없으면 평면도 id). 물건 id면 until은 {"any": [{"object": id, "follow": true, "facts": {"place": "in_hand"}}, {"person_holding": 종류}]}.
- place: 내려놓기·넣기. target은 평면도 id, object는 든 물건 id(앞 pick 물건이면 생략). until은 그 물건 자리 사실(예: {"object": id, "follow": true, "facts": {"place": "in_sink"}}). 비전으로 못 보는 것(세탁물 등)은 until 없이 두면 사람이 「완료」로 넘긴다.
- device: 가전 조작. tool은 기기를 바꾸는 도구 이름(turn_on·turn_off·set_level·set_climate·set_covering·lock·unlock·start·stop·set_valve), target은 가전 id, args는 그 도구의 나머지 인자(device_id 없이). 실행할 때 승인 규칙을 거친다. until은 그 가전 상태(예: {"device": id, "state": "on"}).
- wait: 행동 중에 기다리기(예: 세탁이 멈추기). until은 World State 조건(예: {"device": 세탁기 id, "became": "stopped"}) 또는 {"elapsed_s": 초}. 폰에는 아무것도 보내지 않는다. 행동을 시작하기 전 기다림은 PAM이 맡으니 넣지 않는다.
- ask: 사람에게 묻기. question은 「?」로 끝나고 choices는 2~3개(id 영문 소문자, label 짧게). 답으로 갈라지지 않게 마지막 단계에만 둔다.
- say: 폰으로 알릴 한 줄(text).

규칙
- 쓸 수 있는 단계 종류·가전은 [할 일]의 「쓸 수 있는 단계」 안이다.
- id는 입력에 있는 것만 쓴다. 조건(until)은 [조건 낱말]의 키만 쓴다.
- 모든 단계에 timeout_s를 준다: 사람 단계·질문 보통 120, 가전 60, 기다리기는 그 일에 맞게(예: 세탁 7200). 오래 걸리는 단계는 on_timeout을 ask(계속할지 묻기)로, 그 밖에는 fail.
- label은 화면 단계 이름(예: 「식탁으로 가기」, 「컵 집기」, 「싱크대로 가기」, 「컵 내려놓기」). 30자 아래, 화살표·괄호 없이 쓴다.
- 필요하면 read_world·read_floor_plan·list_devices·find_devices·get_state·route_to로 확인한다. 그다음 add_step을 순서대로 모두 부르고 마지막에 finish_plan을 부른다. 한 번에 함께 불러도 된다. 단계는 8개까지.
- 도구 결과가 오류면 그 단계를 고쳐 다시 add_step을 부른다. 답 글은 쓰지 않는다.`;

const xz = (p: readonly number[] | null | undefined) => (p ? `[${p.map((n) => Math.round(n * 100) / 100).join(", ")}]` : "모름");
const factsOf = (f: Record<string, { value: string } | undefined>) =>
  Object.entries(f).flatMap(([k, v]) => (v ? [`${k}=${v.value}`] : [])).join(" ") || "사실 없음";

function worldLines(w: WorldView): string[] {
  const out = w.objects.map((o) =>
    `- 물건 ${o.id} ${CLASSES[o.cls as ClassKey]?.label ?? o.cls} · ${o.status} · 면 ${o.surface ?? "없음"} · 방 ${o.room ?? "모름"} · 자리 ${xz(o.position && [o.position[0], o.position[2]])} · ${factsOf(o.facts)}`);
  const p = w.person;
  out.push(p.visible
    ? `- 사람 보임 ${p.count}명 · 방 ${p.room ?? "모름"} · 든 물건 ${p.holding.join(", ") || "없음"} · ${factsOf(p.facts)}`
    : "- 사람 안 보임");
  for (const f of w.fixtures) out.push(`- 가전 설비 ${f.id} ${CLASSES[f.cls as ClassKey]?.label ?? f.cls} · 방 ${f.room ?? "모름"} · ${factsOf(f.facts)}`);
  return out;
}

/** 면마다 그 대상에 붙는 사실 키. */
function factKeys(target: Target): string {
  const by = new Map<Facet, string[]>();
  for (const [k, s] of Object.entries(STATES)) if ((s.for as readonly Target[]).includes(target)) by.set(s.facet, [...(by.get(s.facet) ?? []), k]);
  return [...by].map(([f, ks]) => `${f}: ${ks.join(" ")}`).join(" / ");
}

/** 계획마다 쓰는 사용자 말. */
export function planInput(ctx: PlanContext): string {
  const { decision: d, task, world, floor, places, rooms, devices } = ctx;
  const roomName = (id: string | null) => (id ? rooms.find((r) => r.id === id)?.label ?? id : "모름");
  const allow = [task.allow.kinds.join(", "), task.allow.devices ? `가전 ${task.allow.devices.kinds.join(", ")} · 도구 ${task.allow.devices.tools.join(", ")}` : ""].filter(Boolean).join(" · ");
  const state = new Map(world.devices.map((x) => [x.id, x.state.join(" ") || "모름"]));
  const objectClasses = (Object.keys(CLASSES) as ClassKey[]).filter((k) => CLASSES[k].role === "object");
  const fixtureClasses = (Object.keys(CLASSES) as ClassKey[]).filter((k) => CLASSES[k].role === "fixture");
  return [
    `[할 일] ${task.name}: ${task.description}`,
    `- 쓸 수 있는 단계: ${allow}`,
    `[PAM 판단] 관찰: ${d.prediction?.observation ?? "없음"} / 이유: ${d.prediction?.reasoning ?? "없음"}`,
    `[World State] ${ctx.nowIso}`,
    ...worldLines(world),
    `[평면도] 방: ${floor.rooms.map((r) => `${r.id} ${roomName(r.id)}`).join(", ")}`,
    ...places.map((p) => `- ${p.id} ${p.name} [${p.type}] · 방 ${p.room ?? "모름"} · 자리 ${xz(p.position)}`),
    "[가전]",
    ...devices.map((x) => `- ${x.id} ${x.label} [${x.kind} ${KIND_LABELS[x.kind]}] · 방 ${x.room} · 지금 ${state.get(x.id) ?? "모름"}`),
    `[손] 폰 자리 ${xz(floor.robot.position)} · 방 ${roomName(floor.robot.room)}`,
    `[승인] 처음 하는 할 일은 첫 단계 전에 폰으로 묻는다. 위험 목록(${CONFIRM_RULES.map((r) => `${r.kind} ${r.command}`).join(", ")})은 그 단계에서 늘 묻는다. 너는 승인하지 못한다.`,
    "[조건 낱말]",
    `- 조건 종류: ${CONDITION_KINDS.join(", ")}`,
    `- 물건 종류: ${objectClasses.join(" ")}`,
    `- 가전 설비 종류: ${fixtureClasses.join(" ")}`,
    `- 물건 사실: ${factKeys("object")}`,
    `- 사람 사실: ${factKeys("person")}`,
    `- 가전 설비 사실: ${factKeys("fixture")}`,
    `- 가전 상태: ${Object.keys(DEVICE_STATES).join(" ")}`,
  ].join("\n");
}
