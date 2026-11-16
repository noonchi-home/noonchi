// 클로이드 계획(판단·단계·이동 경로) 계약. 서버 planner와 task planner(ai 저장소)가 같은 모양을 보낸다. 평면 좌표는 scene.json plan과 같은 [x, z] 미터.
// 순수 타입만 둔다: ui/가 이 파일을 그대로 가져다 쓴다. 팀 공유 설명은 docs/plan-contract.md.
import type { Plan2 } from "./events.js";

export type XZ = Plan2;
export type PlanSource = "brain" | "agent" | "planner";
export type StepKind = "move" | "act" | "ask" | "device" | "wait";
export type StepStatus = "pending" | "active" | "done" | "failed" | "skipped";
export type PlanStatus = "planned" | "running" | "done" | "cancelled" | "failed";
/** 켠 위험 가전 끄기 추적 요약(GET /api/plan off): 지금 계획이 켠 채 추적하는 가전(hot)과 끄기 안내가 떠 있거나 줄에서 기다리는 가전(notices). */
export interface OffTrack { hot: string[]; notices: string[] }

export interface PlanTarget { objectId?: string; deviceId?: string; room?: string; position?: XZ }

export interface PlanStep { id: string; kind: StepKind; label: string; target?: PlanTarget; status: StepStatus }

export interface PlanView {
  id: string;
  /** 같은 id를 고칠 때마다 1씩 오른다(새 계획은 1). 화면은 지금 것과 같거나 작은 번호를 버린다. */
  revision: number;
  /** 다시 계획했으면 바뀌기 전 계획 id. */
  supersedes?: string;
  /** 시험으로 보낸 계획이면 "mock". 없으면 live. */
  origin?: "live" | "mock";
  source: PlanSource;
  goal: string;
  judgment: string;
  /** true면 실제로 움직이지 않는 모의 계획이고 화면에 「모의」를 붙인다. */
  dryRun: boolean;
  /** 로봇(맞춘 폰 눈) 위치. 모르면 null이고 그때 path는 []. */
  robot: { position: XZ | null; room: string | null };
  /** 로봇에서 시작하는 바닥 경로. 이동이 없으면 []. move 단계마다 legs에 path 안 끝 점 번호가 있다. */
  path: XZ[];
  legs: { stepId: string; end: number }[];
  steps: PlanStep[];
  status: PlanStatus;
  updatedAt: string;
}

/** alone: 이 단계를 도움 없이 이어서 해낸 횟수(도움을 받으면 0). */
export interface LessonStep { label: string; alone: number }
export interface Lesson { task: string; runs: number; steps: LessonStep[]; updatedAt: string }
