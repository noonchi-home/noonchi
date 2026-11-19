// 실행 추적의 실제 폰 명령 줄과 답(Answers): 지금 띄운 명령·질문(openCommand), 답 단추(onAnswer), 들은 말(onHeard).
// 떠 있는 끄기 안내의 「완료」는 확인된 꺼짐일 때만 지우고(SafetyTracker.releaseIfOff), 아니면 보이게 해 달라는 부탁으로 바꾼다. 말 「완료」로는 풀지 않는다.
import type { HeardAt } from "../../contract/phone.js";
import type { ApprovalAnswer } from "../../agent/index.js";
import { EXEC_TEXT } from "../labels.js";
import { ASK_FOLLOW, STEP_DONE, STOP, type ActionChoice } from "../prompts.js";
import { ASK_ACTION, matchChoice } from "../tasks.js";
import { Part, choicesOf } from "./core.js";

/** 들은 말의 결과: 답으로 받음, 말할 때와 다른 명령에 온 답이라 버림(stale), 답이 아님(null). */
export type HeardResult = { kind: "answer"; choice: ActionChoice } | { kind: "stale" } | null;

/** 폰 명령 줄·답·말. */
export class Answers extends Part {
  /** 실제 폰에 띄운 지금 명령·질문(답을 기다리는 중). 승인·다시 묻기·질문 단계는 질문(ask), 그 밖은 부탁(command). 없으면 null. */
  openCommand(): { planId: string; stepId: string; kind: "command" | "ask"; text: string; choices: ActionChoice[] } | null {
    const core = this.core;
    // 끄기 안내가 떠 있으면 명령 줄은 그 안내다(폰이 필요 없는 가전 계획이 함께 돌 수 있다)
    const off = core.safety.shownOff();
    if (off && !core.stopped) return { planId: off.sent.id, stepId: off.sent.step, kind: "command", text: off.sent.text, choices: off.note.ask ? [] : [STEP_DONE] };
    const r = core.shown();
    if (!r) {
      // 계획 전 찾기(src/act/robot/find.ts)·계획 밖 가까이 가서 보기(src/act/robot/contents.ts idle): 단추 없는 사람 단계 명령
      const q = core.finding?.sent ? core.finding : core.docking?.sent ? core.docking : core.idlePeek;
      // 충전 자리 명령만 「완료」가 있다(폰 눈을 모를 때 닿음을 받는다, dock.ts)
      return q?.sent && !core.stopped ? { planId: q.id, stepId: q.sent.step, kind: "command", text: q.sent.text, choices: q === core.docking ? [STEP_DONE] : [] } : null;
    }
    const ask = r.asking !== null || core.stepOf(r)?.kind === "ask";
    return { planId: r.plan.view.id, stepId: r.sent.step, kind: ask ? "ask" : "command", text: r.sent.text, choices: choicesOf(r, core.stepOf(r)) };
  }

  /** 답 단추(「완료」·질문 답·승인 답·계속·그만). 지금 명령의 계획·단계·답이 아니면 무시한다. 받았으면 true. */
  onAnswer(planId: string, stepId: string, choice: string): boolean {
    const { core } = this;
    const { safety, steps, approval } = core;
    const off = safety.shownOff();
    if (!core.stopped && off && off.sent.id === planId && off.sent.step === stepId) {
      // 「완료」는 확인된 꺼짐일 때만 지운다. 아니면 보이게 해 달라는 부탁으로 바꾼다(부를 이름이 없으면 그대로)
      if (choice !== STEP_DONE.id || off.note.ask) return false;
      if (!safety.releaseIfOff(off.note.deviceId)) safety.askToShow(off.note.deviceId);
      return true;
    }
    // 충전 자리 명령의 「완료」: 닿은 것으로 받는다
    const dock = core.docking;
    if (!core.stopped && dock?.sent && dock.id === planId && dock.sent.step === stepId) {
      if (choice !== STEP_DONE.id) return false;
      core.dock.arrived();
      return true;
    }
    const r = core.shown();
    if (!r || r.plan.view.id !== planId || r.sent.step !== stepId) return false;
    const step = core.stepOf(r);
    const picked = choicesOf(r, step).find((c) => c.id === choice);
    if (!picked) return false;
    const a = r.asking;
    // 기한이 지난 답은 받지 않는다(시간 초과가 먼저다)
    const now = this.clock.now();
    if (a && now - r.askAt > this.cfg.askMs) {
      steps.finish(r, "failed", EXEC_TEXT.noAnswer);
      return false;
    }
    if (!a && step && now > r.deadline) {
      steps.timeout(r, step);
      return false;
    }
    if (a?.why === "plan") approval.approvedPlan(r, picked.id as ApprovalAnswer);
    else if (a?.why === "device") approval.approvedDevice(r, a.token, picked.id as ApprovalAnswer);
    else if (a?.why === "hand") approval.approvedHand(r, picked.id as ApprovalAnswer);
    else if (a?.why === "leftover") steps.leftover(r, picked.id);
    else if (a?.why === "again") {
      if (picked.id === "continue") steps.resume(r);
      else steps.finish(r, "failed", EXEC_TEXT.stopped, "cancelled");
    } else if (step?.kind === "ask") {
      if (r.at + 1 >= r.plan.steps.length || step.prompt?.ends.includes(picked.id)) {
        steps.finish(r, "done", EXEC_TEXT.answered(picked.label));
        // 묻기 답 → 말 부탁(「치워 주세요」면 컵 치우기를 말 부탁 길로 시작한다, 「그대로 둬요」는 하지 않는다)
        const task = r.decision.action === ASK_ACTION ? ASK_FOLLOW[picked.id] : undefined;
        if (task) core.start.request({ task, heard: picked.label, atMs: now, afterSeq: this.o.brain.sentSeq?.() ?? 0, via: "answer" });
      } else steps.advance(r);
    } else steps.advance(r);
    return true;
  }

  /** 폰에서 들은 말. at: 말할 때 폰에 떠 있던 명령(새 폰은 늘 싣는다. 칸이 없으면 옛 탭).
   *  「그만」은 at과 상관없이(칸이 없어도) 계획을 그만두는 답으로 받는다(명령이 없는 기다리기·기기 단계·만드는 중인 계획도).
   *  지금 명령(질문·승인 질문 포함)의 답 말이면 at이 그 명령(계획 id·단계 id)일 때만 그 답으로 받고, at이 다른 명령·none이거나 칸이 없으면 버린다(stale).
   *  떠 있는 끄기 안내의 「완료」·「다 했어」는 버린다(확인된 꺼짐으로만 푼다). 지금 명령이 없는데 at이 명령인 「완료」·「다 했어」도 버린다. 그 밖은 답이 아니다(null). */
  onHeard(text: string, at?: HeardAt): HeardResult {
    const core = this.core;
    if (core.stopped) return null;
    const open = core.open();
    // 미리 세운 목표(미리 만든 계획·만드는 중 포함)에 「그만」: 목표를 버린다. 남겨 두면 사람이 떠날 때 그 계획을 실행한다(goal.ts)
    const stopping = matchChoice(text, [STOP]) !== null;
    const awaiting = stopping && core.start.cancelSpeech();
    const deferred = (stopping && core.manager.cancel()) || awaiting;
    const goal = !!core.goal.current() && matchChoice(text, [STOP]) !== null;
    if (goal) core.goal.drop("stop");
    // 명령이 없는 단계(기다리기·기기)와 만드는 중인 계획에도 「그만」은 받는다
    if ((open || core.planning) && matchChoice(text, [STOP])) {
      core.start.dropPlanning(EXEC_TEXT.stopped);
      if (open) core.steps.finish(open, "failed", EXEC_TEXT.stopped, "cancelled");
      // 다음 tick 전이라 남은 계획 밖 가까이 가서 보기·계획 전 찾기도 그만둔다(그 컵·자리는 잠시 다시 보내지 않는다)
      if (core.idlePeek) core.contents.stopIdle();
      if (core.finding) core.finder.stopIdle();
      return { kind: "answer", choice: STOP };
    }
    // 계획 전 찾기에 「그만」(명령을 거둔 뒤 가까이 보는 중·사진을 기다리는 중에도): 그만두고 그 자리는 잠시 다시 가지 않는다
    if (!open && !core.planning && core.finding && matchChoice(text, [STOP])) {
      core.finder.stopIdle();
      return { kind: "answer", choice: STOP };
    }
    // 충전 자리 돌아가기(사용자 위치 확인 포함)에 「그만」: 명령을 거두고 그만둔다. 그 명령에 한 「완료」·「다 했어」는 닿은 것이다
    const dock = !open && !core.planning ? core.docking : null;
    if (dock && matchChoice(text, [STOP])) {
      core.dock.drop();
      return { kind: "answer", choice: STOP };
    }
    if (goal || deferred) return { kind: "answer", choice: STOP };
    if (dock?.sent && matchChoice(text, [STEP_DONE])) {
      if (at?.kind !== "command" || at.id !== dock.id || at.step !== dock.sent.step) return { kind: "stale" };
      core.dock.arrived();
      return { kind: "answer", choice: STEP_DONE };
    }
    // 계획 밖 가까이 가서 보기에 「그만」(명령을 거둔 뒤 위에서 보는 중·사진을 기다리는 중에도): 그만두고 그 컵은 잠시 다시 보내지 않는다
    if (!open && !core.planning && core.idlePeek && matchChoice(text, [STOP])) {
      core.contents.stopIdle();
      return { kind: "answer", choice: STOP };
    }
    const off = core.safety.shownOff();
    const r = off ? null : core.shown();
    if (r) {
      const picked = matchChoice(text, choicesOf(r, core.stepOf(r)));
      if (!picked) return null;
      if (at?.kind !== "command" || at.id !== r.plan.view.id || at.step !== r.sent.step) return { kind: "stale" };
      this.onAnswer(r.plan.view.id, r.sent.step, picked.id);
      return { kind: "answer", choice: picked };
    }
    if (matchChoice(text, [STEP_DONE]) && (off || at?.kind === "command")) return { kind: "stale" };
    return null;
  }

}
