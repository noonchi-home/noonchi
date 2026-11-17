// 지금 모드(눈치·코치)를 정하는 한 곳(2026-11-18 사용자 결정). 서버는 이것으로 판단 기록(assist)·대시보드 모드 말풍선(mode 메시지)·PAM 행동 목록을 정한다.
// - 평소에는 눈치 모드다.
// - 코치 모드는 (가) 비상: 안전 알림이 유효함(사람 자세가 쓰러짐 의심, 켠 위험 가전 끄기 안내가 떠 있거나 줄에서 기다림), (나) 사람이 말로 코치 행동을 부탁함:
//   그 코치 계획이 열려 있거나 만드는 중이거나, 이번 판단이 코치 행동을 골랐을 때뿐이다. 그 계획이 끝나고 비상이 풀리면 눈치 모드로 돌아온다.
// - PAM 행동 목록은 모드를 따른다: 눈치 모드는 눈치 행동, 코치 모드는 코치 행동과 「사용자에게 물어보기」. 눈치 모드에서 사람이 방금 말했으면(관찰 텍스트에 들은 말)
//   말로 부탁한 코치 행동을 고를 수 있게 코치 행동도 넣는다(들은 말 없이 코치 행동을 고르지 않는다).
import type { PlanView } from "../contract/plan.js";
import type { WorldView } from "../contract/world.js";
import { POSE_FALL } from "../world/vocab.js";
import { TASK_NAMES, modeOf, tasksFor } from "./tasks.js";

export type Mode = "noonchi" | "coach";

export interface ModeFacts {
  /** 지금 World State(쓰러짐 의심을 본다). 없으면 null. */
  world: Pick<WorldView, "person"> | null;
  /** 떠 있거나 줄에서 기다리는 끄기 안내의 가전 id(실행 추적 offTrack().notices). */
  offNotices: readonly string[];
  /** 코치 행동 계획이 열려 있거나 만드는 중인가(실행 추적 coaching()). */
  coaching: boolean;
  /** 지금 계획(PlanHub). 열린(planned·running) 코치 행동 계획이면 코치 모드다: 계획 방송이 실행 추적이 그 계획을 받기 전에 먼저 간다. */
  plan?: Pick<PlanView, "goal" | "status"> | null;
  /** 이번 판단이 고른 행동(판단 기록에 붙일 모드를 정할 때). */
  action?: string | null;
}

/** 안전 알림이 유효한가: 쓰러짐 의심이거나 끄기 안내가 있다. */
export const emergencyOf = (f: Pick<ModeFacts, "world" | "offNotices">): boolean =>
  f.world?.person?.facts.posture?.value === POSE_FALL || f.offNotices.length > 0;

/** 지금 모드. */
export function modeNow(f: ModeFacts): Mode {
  const open = f.plan && (f.plan.status === "planned" || f.plan.status === "running") ? f.plan.goal : null;
  return emergencyOf(f) || f.coaching || modeOf(open) === "coach" || modeOf(f.action ?? null) === "coach" ? "coach" : "noonchi";
}

/** PAM에 보내는 행동 목록(순서가 task_index, 행동 목록 순서 그대로). heard: 이번 관찰 텍스트에 사람이 한 말이 있다. */
export function pamTasks(mode: Mode, heard: boolean): string[] {
  if (mode === "coach") return tasksFor("coach");
  return heard ? [...TASK_NAMES] : tasksFor("noonchi");
}
