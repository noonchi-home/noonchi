import type { ActionPrompt } from "../act/prompts.js";
import type { Condition } from "../world/condition-schema.js";
import type { PlanView } from "./plan.js";
import type { WorldObject } from "./world.js";

/** 에이전트 단계 종류. go·pick·place·do는 사람이 하는 일(실제 폰 명령, do는 그 자리에서 하는 일: 따르기·붓기), ask 질문, say 알림, device 가전 조작, wait 기다리기. */
export type AgentStepKind = "go" | "pick" | "place" | "do" | "device" | "ask" | "say" | "wait";

/** 실행 단계 하나. id는 화면 단계 id와 같다. */
export interface AgentStep {
  id: string;
  kind: AgentStepKind;
  label: string;
  /** go: 평면도 물건 id(방 id 아님, 집으러 가면 그 물건이 놓인 면 id), place: 평면도 id, pick·do: World State 물건 id 또는 평면도 id, device: 가전 id. */
  target: string | null;
  /** pick·place: 든 World State 물건 id(없으면 null). */
  object: string | null;
  /** 사람 단계: 실제 폰에 보낼 명령(「…주세요」). */
  command: string | null;
  /** ask: 질문과 답. */
  prompt: (ActionPrompt & { ends: string[] }) | null;
  /** say: 알릴 글. */
  text: string | null;
  device: { tool: string; deviceId: string; args: Record<string, unknown> } | null;
  /** do: 사람이 손으로 켜거나 끄는 가전(없으면 null). 위험 목록 가전을 켜는 단계는 실행 추적이 명령 전에 묻는다(riskyHand). */
  hand: { deviceId: string; to: "on" | "off" | "open" | "close" } | null;
  /** do: 위험한 단계 앞에 폰이 읽을 안전 한 줄(없으면 null). */
  caution: string | null;
  /** 끝나는 조건(World State 낱말 조건). 사람 단계는 없으면 「완료」로만 넘긴다. */
  until: Condition | null;
  timeoutMs: number;
  onTimeout: "ask" | "fail";
  /** top: 서버가 넣은 컵 안 보기 단계(do, 위에서 비추기, 모델은 쓰지 않음). 끝은 위에서 본 사진이고 가르기는 실행 추적이 한다(src/act/robot/steps.ts topStep). */
  look?: "top";
}

/** 검사를 통과한 계획: 화면 계획(PlanView, 단계 순서·id가 steps와 같다)과 실행 단계.
 *  submitted: 이 계획을 낸 submit_plan 인자(모델이 낸 그대로). 미리 만든 계획을 다른 판단으로 다시 낼 때 쓴다(resubmit). add·finish로 만든 계획은 없다. */
export interface AgentPlan { view: PlanView; steps: AgentStep[]; task: string; submitted?: unknown }

/** 계획 입력의 미리 세운 목표(src/goal/watch.ts): 사람이 아직 대상을 쓰는 동안 만드는 계획이다. trigger는 그 습관 규칙의 트리거,
 *  on은 지금 상태에서 그 상태로 가는 글(없으면 null), object는 목표 물건(World State id): 계획 검사가 같은 종류의 다른 물건을 쓰는 단계를 버린다.
 *  stand: 목표 물건이 아직 면 위에 놓인 World State 물건이 아닐 때 사람이 다 쓰고 둘 자리에 둔 대신 물건(id는 object). 계획 모드가 World State 물건 맨 앞에 넣는다(withStand). */
export interface PlanAhead { trigger: string; on: string | null; object: string; stand?: WorldObject }

/** 계획 결과: 통과한 계획, 또는 버린 까닭. */
export type PlanResult = { ok: true; plan: AgentPlan } | { ok: false; error: string };
