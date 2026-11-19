// 실행 추적의 충전 자리 돌아가기(Dock, 2026-11-18 사용자 결정): 계획이 끝나면(완료·그만·실패) 사용자 위치를 확인하고 충전 자리로 돌아가 지켜본다.
// - 명령을 낸 적이 있는 계획만이다(실행 전 검사에서 멈춘 계획·새 계획으로 바뀐 계획은 아니다). 집에 충전 자리(twin/data/homes/<집>/dock.json)가 없으면 하지 않는다.
// - 확인(look): 걷지 않고 지금 자리에서 DOCK.lookMs 동안 보기만 한 뒤, 아는 사실(World State 사람: 보이면 그 방, 아니면 마지막으로 본 방)로 사용자 위치를 메시지 상자에 올린다.
// - 가기(go): 「충전 자리로 가 주세요」 명령 하나(명령 id dock:<번호>)를 보내고, 폰 눈이 충전 자리 DOCK.nearM 안에 들면 지우고 지켜본다.
//   폰 눈을 모를 때(맞추기 전)를 위해 「완료」 단추·그 명령에 한 말 「다 했어」로도 닿은 것으로 받는다(answers.ts).
//   이미 그 안이면 명령 없이 지켜본다. DOCK.totalMs가 지나도 닿지 않으면 그만둔다. 명령 줄 막힘(폰 판본·끄기 안내·승인 대기·폰 대화)이면 거두었다가 다시 보낸다.
// - 확인·가기 동안 새 행동 판단은 미룬다(start.ts, 새 일은 충전 자리에서 시작한다). 계획 밖 가까이 가서 보기도 하지 않고, 끝낸 대상과 그 무리는 치운 것이다(steps.ts placed).
// - 「그만」은 충전 자리 가기도 그만둔다(answers.ts). 새 계획이 열리면 거둔다.
// - 비상(쓰러짐 의심·끄기 안내, src/act/mode.ts emergencyOf)이 오면 바로 거둔다: 안전 일은 미루지 않는다(그 뒤 판단도 바로 받는다).
// - 사람이 말로 한 부탁(관찰 텍스트에 들은 말이 든 판단)은 복귀를 멈추고 바로 받는다(start.ts): 판단에 쓴 들은 말은 다시 보내지 않으니 미루면 사라진다.
import type { PlannedCommand } from "../../contract/phone.js";
import type { WorldView } from "../../contract/world.js";
import { dockId } from "../dock-step.js";
import { DOCK_TEXT, VISION_TEXT } from "../labels.js";
import { emergencyOf } from "../mode.js";
import { STEP_DONE } from "../prompts.js";
import { Part, type Run } from "../track/core.js";
import { eyeNow, idleLine, refreshLine, sendLine, type IdleSlot } from "./phone-line.js";

/** 충전 자리: 닿았다고 보는 폰 눈-충전 자리 수평 거리(m), 지금 자리에서 보기만 하는 시간(ms), 닿지 못하면 그만두는 기한(ms). */
export const DOCK = { nearM: 1.2, lookMs: 3000, totalMs: 120_000 } as const;

/** 충전 자리 칸: 명령 줄(dock:<번호>), 확인(look)·가기(go), 충전 자리, 그 단계 시작 때, 끝난 계획의 판단 id(메시지 상자 줄이 붙는다). */
export interface DockSlot extends IdleSlot { phase: "look" | "go"; at: [number, number, number]; since: number; startedAt: number; decision: string }

/** 아는 사실로 본 사용자 위치 한 줄. */
export function userWhere(world: Pick<WorldView, "person">): string {
  const p = world.person;
  if (p.visible && p.room_label) return DOCK_TEXT.userHere(p.room_label);
  if (p.room_label) return DOCK_TEXT.userLast(p.room_label);
  return DOCK_TEXT.userUnknown;
}

export class Dock extends Part {
  private seq = 0;

  /** 계획이 닫혔다. close null은 새 계획으로 바뀐 것이다. 명령을 낸 적이 있는 계획(단계를 시작함)만 충전 자리로 간다. */
  planClosed(r: Run, close: "done" | "failed" | "cancelled" | null): void {
    const core = this.core;
    if (core.stopped || close === null || r.at < 0) return;
    const at = this.o.layout.dock?.() ?? null;
    if (!at) return;
    this.drop();
    const now = this.clock.now();
    core.docking = { id: dockId(++this.seq), sent: null, spokeAt: now, visionAt: now, phase: "look", at: [...at], since: now, startedAt: now, decision: r.decision.id };
  }

  /** 타이머(250ms)마다: 확인이 끝나면 위치를 올리고 명령을 보내고, 닿았는지 본다. 새 계획이 열리면 거둔다. */
  tick(): void {
    const core = this.core;
    const q = core.docking;
    if (!q || core.stopped) return;
    if (core.open() || core.planning || this.emergency()) return this.drop();
    const now = this.clock.now();
    if (q.phase === "look") {
      if (now - q.since < DOCK.lookMs) return;
      this.o.events.thought?.(userWhere(this.o.state.view()), q.decision);
      q.phase = "go";
      q.since = now;
    }
    const line = idleLine(core, q);
    const eye = eyeNow(core, now);
    const d = eye ? Math.hypot(eye.position[0] - q.at[0], eye.position[1] - q.at[2]) : null;
    if (d !== null && d <= DOCK.nearM) return this.arrived();
    if (now - q.startedAt > DOCK.totalMs) {
      line.clear();
      core.docking = null;
      this.o.events.thought?.(DOCK_TEXT.gaveUp, q.decision);
      return;
    }
    if (this.blocked()) return line.clear();
    const vision = VISION_TEXT.distance(DOCK_TEXT.label, d);
    if (!q.sent) {
      const sent: PlannedCommand = {
        type: "command", id: q.id, step: `${q.id}:1`, text: DOCK_TEXT.command, vision, choices: [{ id: STEP_DONE.id, label: STEP_DONE.label }],
        target: { id: "dock", label: DOCK_TEXT.label, position: [...q.at] }, speak: true, kind: "go", near_m: DOCK.nearM,
      };
      sendLine(line, sent, now);
      this.o.events.thought?.(DOCK_TEXT.going, q.decision);
      return;
    }
    refreshLine(core, line, q.sent, vision, now);
  }

  /** 충전 자리에 닿음(폰 눈이 nearM 안, 「완료」 단추·말): 명령을 지우고 지켜본다. */
  arrived(): void {
    const q = this.core.docking;
    if (!q) return;
    idleLine(this.core, q).clear();
    this.core.docking = null;
    this.o.events.thought?.(DOCK_TEXT.docked, q.decision);
  }

  /** 충전 자리로 가는 중(확인 포함)인가: 그동안 새 행동 판단을 미룬다. 비상이면 거두고 아니라고 한다(안전 일은 미루지 않는다). */
  busy(): boolean {
    if (!this.core.docking || this.core.stopped) return false;
    if (!this.emergency()) return true;
    this.drop();
    return false;
  }

  /** 비상: 쓰러짐 의심이거나 끄기 안내가 떠 있거나 줄에서 기다린다. */
  private emergency(): boolean {
    return emergencyOf({ world: this.o.state.view(), offNotices: this.core.safety.offTrack().notices });
  }

  /** 「그만」·새 계획·멈춤: 명령을 거두고 칸을 비운다. */
  drop(): void {
    const q = this.core.docking;
    if (!q) return;
    idleLine(this.core, q).clear();
    this.core.docking = null;
  }

  /** 명령 줄 막힘: 판본이 맞는 폰 없음, 끄기 안내, 승인 대기, 폰 대화(맞춘 눈은 없어도 보낸다: 거리 모름). */
  private blocked(): boolean {
    const core = this.core;
    return !core.start.phoneOk() || core.safety.offPending() || !!core.safety.shownOff() || (this.o.phone.approvalsWaiting?.() ?? false) || (this.o.phone.talking?.() ?? false);
  }
}
