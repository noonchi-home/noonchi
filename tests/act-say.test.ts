import { describe, expect, it } from "vitest";
import type { PlannedCommand } from "../src/contract/phone.js";
import type { PlanView } from "../src/contract/plan.js";
import type { WorldView } from "../src/contract/world.js";
import { SAY_DONE_MS, SAY_LOOK_MS, SAY_TOLD_MS, sayLine, sayOf } from "../src/act/say.js";
import { STEP_LABEL } from "../src/act/labels.js";
import { POSE_FALL } from "../src/world/vocab.js";

const T = Date.parse("2026-11-09T00:00:00Z");
const plan = (status: PlanView["status"], goal = "컵 치우기", at = T): PlanView => ({
  id: "plan:d1", revision: 1, source: "brain", goal, judgment: "", dryRun: true, robot: { position: null, room: null }, path: [], legs: [], status, updatedAt: new Date(at).toISOString(),
  steps: [
    { id: "plan:d1:1", kind: "move", label: STEP_LABEL.goTable, status: "active" },
    { id: "plan:d1:2", kind: "act", label: STEP_LABEL.pickCup, status: "pending" },
    { id: "plan:d1:3", kind: "move", label: STEP_LABEL.goSink, status: "pending" },
    { id: "plan:d1:4", kind: "act", label: STEP_LABEL.placeCup, status: "pending" },
  ],
});
const cmd = (step: string, choices = [{ id: "done", label: "완료" }]): PlannedCommand => ({ type: "command", id: "plan:d1", step, text: "x", vision: null, choices, target: null, speak: true });
const world = (surface: string | null) => ({ objects: surface ? [{ id: "cup-1", cls: "cup", status: "seen", surface_label: surface, last_seen_ms: T }] : [] }) as unknown as WorldView;
const withCup = (p: PlanView): PlanView => ({ ...p, steps: p.steps.map((s, i) => (i === 1 ? { ...s, target: { objectId: "cup-1" } } : s)) });
const say = (o: Partial<Parameters<typeof sayLine>[0]>) => sayLine({ plan: null, command: null, world: null, nowMs: T, ...o });

describe("말풍선 카드 글: 반성 뒤", () => {
  it("반성 뒤 20초 동안 새로 배운 습관이 있으면 그 수를, 없고 쓰는 습관이 있으면 그 수를 말한다. 둘 다 없거나 20초가 지나면 지켜보기다", () => {
    expect(say({ reflected: { atMs: T - 1000, learned: 2, active: 3 } })).toBe("어제 기록으로 새 습관 2개를 배웠어요.");
    expect(say({ reflected: { atMs: T - 1000, learned: 0, active: 1 } })).toBe("배운 습관 1개를 쓰고 있어요.");
    expect(say({ reflected: { atMs: T - 1000, learned: 0, active: 0 } })).toBe("지켜보고 있어요.");
    expect(say({ reflected: { atMs: T - SAY_DONE_MS - 1, learned: 1, active: 1 } })).toBe("지켜보고 있어요.");
  });
});

describe("말풍선 카드 글", () => {
  it("계획이 없으면 지켜보거나 본 면을 말한다", () => {
    expect(say({})).toBe("지켜보고 있어요.");
    expect(say({ world: world("식탁") })).toBe("식탁을 보고 있어요.");
    expect(say({ world: world("싱크대") })).toBe("싱크대를 보고 있어요.");
  });
  it("정했고 명령 전이면 정한 것(대상 컵이 놓인 면을 알면 그 면)", () => {
    expect(say({ plan: plan("planned") })).toBe("컵을 치우기로 했어요.");
    expect(say({ plan: withCup(plan("planned")), world: world("식탁") })).toBe("식탁 컵을 치우기로 했어요.");
  });
  it("실제 폰에 낸 명령을 말한다", () => {
    expect(say({ plan: plan("running"), command: cmd("plan:d1:1") })).toBe("식탁으로 가라고 했어요.");
    expect(say({ plan: plan("running"), command: cmd("plan:d1:2") })).toBe("컵을 들라고 했어요.");
    expect(say({ plan: plan("running"), command: cmd("plan:d1:3") })).toBe("싱크대로 가라고 했어요.");
    expect(say({ plan: plan("running"), command: cmd("plan:d1:4") })).toBe("컵을 싱크대에 넣으라고 했어요.");
  });
  it("승인 질문 중에는 정한 것만 말한다", () => {
    expect(say({ plan: plan("planned"), command: cmd("plan:d1:approve", [{ id: "approve", label: "승인" }, { id: "reject", label: "거절" }]) })).toBe("컵을 치우기로 했어요.");
  });
  it("질문 명령이면 물어봤다고 한다", () => {
    expect(say({ plan: plan("running", "사용자에게 물어보기"), command: cmd("plan:d1:1", [{ id: "a", label: "네" }, { id: "b", label: "아니요" }]) })).toBe("폰으로 물어봤어요.");
  });
  it("끝난 뒤 20초는 끝낸 일, 그 뒤는 지켜보기", () => {
    expect(say({ plan: plan("done", "컵 치우기", T - 5000) })).toBe("컵을 다 치웠어요.");
    expect(say({ plan: plan("cancelled", "컵 치우기", T - 5000) })).toBe("컵 치우기를 그만뒀어요.");
    expect(say({ plan: plan("done", "컵 치우기", T - SAY_DONE_MS - 1) })).toBe("지켜보고 있어요.");
  });
  describe("코치 계획", () => {
    const coach = (status: PlanView["status"] = "running"): PlanView => ({
      ...plan(status, "라면 끓이기 알려 주기"),
      steps: [
        { id: "plan:d1:1", kind: "act", label: "냄비 꺼내기", status: "active" }, { id: "plan:d1:2", kind: "act", label: "인덕션 켜기", status: "pending" },
      ],
    });
    const YESNO = [{ id: "approve", label: "승인" }, { id: "reject", label: "거절" }];
    it("사람 단계는 단계 이름을 부탁했다고 한다", () => {
      expect(say({ plan: coach(), command: cmd("plan:d1:1") })).toBe("냄비 꺼내기를 부탁했어요.");
    });
    it("바로잡은 뒤 8초는 「다시 알려 줬어요.」, 그 뒤에는 앞 글로 돌아간다. 계획이 닫혔으면 보이지 않는다", () => {
      expect(SAY_TOLD_MS).toBe(8000);
      expect(say({ plan: coach(), command: cmd("plan:d1:1"), told: { atMs: T - 3000 } })).toBe("다시 알려 줬어요.");
      expect(say({ plan: coach(), command: cmd("plan:d1:1"), told: { atMs: T - SAY_TOLD_MS } })).toBe("다시 알려 줬어요.");
      expect(say({ plan: coach(), command: cmd("plan:d1:1"), told: { atMs: T - SAY_TOLD_MS - 1 } })).toBe("냄비 꺼내기를 부탁했어요.");
      expect(say({ plan: coach("done"), told: { atMs: T - 1000 } })).not.toBe("다시 알려 줬어요.");
      expect(say({ told: { atMs: T - 1000 } })).toBe("지켜보고 있어요.");
    });
    it("조용한 단계는 「…를 지켜보고 있어요.」", () => {
      expect(say({ plan: coach(), command: { ...cmd("plan:d1:1"), speak: false }, quiet: "냄비 꺼내기" })).toBe("냄비 꺼내기를 지켜보고 있어요.");
      expect(say({ plan: coach(), command: cmd("plan:d1:1"), quiet: null })).toBe("냄비 꺼내기를 부탁했어요.");
      expect(say({ quiet: "냄비 꺼내기" })).toBe("지켜보고 있어요.");
    });
    it("켜기 전 질문 명령(단계 id :hand)은 승인이라 말풍선 카드에 보이지 않는다: 정한 것만 말한다", () => {
      const asking = cmd("plan:d1:2:hand", YESNO);
      expect(say({ plan: coach(), command: { ...asking, text: "냄비가 뜨거워져요. 인덕션을 켤까요?" } })).toBe("라면 끓이기 알려 주기를 하기로 했어요.");
      expect(say({ plan: coach(), command: asking })).not.toBe("폰으로 물어봤어요.");
    });
    it("끄기 안내가 떠 있는 동안은 「불을 꺼 달라고 했어요.」(계획이 닫힌 뒤에도)", () => {
      const off = { ...cmd("off:plan:d1:induction_1:1"), text: "인덕션을 꺼 주세요" };
      expect(say({ plan: coach("cancelled"), command: off })).toBe("불을 꺼 달라고 했어요.");
      expect(say({ plan: null, command: off })).toBe("불을 꺼 달라고 했어요.");
      expect(say({ plan: coach("cancelled"), command: null })).toBe("라면 끓이기 알려 주기를 그만뒀어요.");
    });

    it("다시 걸린 끄기 안내가 줄에서 기다리면(다른 계획이 도는 중) 20초 동안 「인덕션이 다시 켜졌어요.」, 그 뒤 그 계획 줄로 돌아온다", () => {
      const b = coach("running");
      const told = { device: "인덕션", atMs: T };
      expect(say({ plan: b, command: null, offTold: told })).toBe("인덕션이 다시 켜졌어요.");
      expect(say({ plan: b, command: null, offTold: told, nowMs: T + SAY_DONE_MS })).toBe("인덕션이 다시 켜졌어요.");
      expect(say({ plan: b, command: null, offTold: told, nowMs: T + SAY_DONE_MS + 1 })).toBe(say({ plan: b, command: null, nowMs: T + SAY_DONE_MS + 1 }));
    });

    it("끄기 안내 때문에 새 계획을 미루는 동안은 「인덕션 꺼짐을 기다리고 있어요.」(끄기 안내 글보다 먼저)", () => {
      const off = { ...cmd("off:plan:d0:induction_1:1"), id: "plan:d0", text: "인덕션을 꺼 주세요" };
      expect(say({ plan: coach("planned"), command: off, offWait: "인덕션" })).toBe("인덕션 꺼짐을 기다리고 있어요.");
      expect(say({ plan: coach("planned"), command: off, offWait: null })).toBe("불을 꺼 달라고 했어요.");
    });
  });
  it("그대로 둔 지 20초 안이면 「컵을 그대로 두기로 했어요.」, 그 뒤에는 지켜보는 글. 열린 계획이나 그 뒤에 끝난 계획이 있으면 그 글이 먼저다", () => {
    const left = { atMs: T - 5000 };
    expect(say({ left })).toBe("컵을 그대로 두기로 했어요.");
    expect(say({ left, world: world("식탁") })).toBe("컵을 그대로 두기로 했어요.");
    expect(say({ left: { atMs: T - SAY_DONE_MS } })).toBe("컵을 그대로 두기로 했어요.");
    expect(say({ left: { atMs: T - SAY_DONE_MS - 1 } })).toBe("지켜보고 있어요.");
    expect(say({ left: { atMs: T - SAY_DONE_MS - 1 }, world: world("식탁") })).toBe("식탁을 보고 있어요.");
    expect(say({ left: null })).toBe("지켜보고 있어요.");
    expect(say({ left, plan: plan("running"), command: cmd("plan:d1:1") })).toBe("식탁으로 가라고 했어요.");
    // 앞서 끝난 계획보다 그대로 둔 것이 새것이면 그대로 둔 글, 그대로 둔 뒤에 끝난 계획이면 끝낸 일
    expect(say({ left, plan: plan("done", "컵 치우기", T - 8000) })).toBe("컵을 그대로 두기로 했어요.");
    expect(say({ left, plan: plan("done", "컵 치우기", T - 2000) })).toBe("컵을 다 치웠어요.");
    expect(say({ left, look: { place: "컵", atMs: T } })).toBe("컵을 가까이 보고 있어요.");
  });
  it("가까이 보는 중이면 6초 동안 계획이 있든 없든 「싱크대를 가까이 보고 있어요.」, 승인 질문 중에도 같다. 6초가 지나면 앞 글로 돌아간다", () => {
    const look = { place: "싱크대", atMs: T };
    expect(SAY_LOOK_MS).toBe(6000);
    expect(say({ look })).toBe("싱크대를 가까이 보고 있어요.");
    expect(say({ plan: plan("running"), command: cmd("plan:d1:4"), look, nowMs: T + SAY_LOOK_MS })).toBe("싱크대를 가까이 보고 있어요.");
    expect(say({ plan: plan("planned"), command: cmd("plan:d1:approve", [{ id: "approve", label: "승인" }, { id: "reject", label: "거절" }]), look })).toBe("싱크대를 가까이 보고 있어요.");
    expect(say({ look: { place: "컵", atMs: T } })).toBe("컵을 가까이 보고 있어요.");
    expect(say({ plan: plan("running"), command: cmd("plan:d1:4"), look, nowMs: T + SAY_LOOK_MS + 1 })).toBe("컵을 싱크대에 넣으라고 했어요.");
    expect(say({ world: world("식탁"), look, nowMs: T + SAY_LOOK_MS + 1 })).toBe("식탁을 보고 있어요.");
    expect(say({ look: null })).toBe("지켜보고 있어요.");
  });
});

describe("말풍선 카드 글: 외부 연락 결과", () => {
  const service = { text: "AS센터에 전화를 요청했어요.", atMs: T - 1000 };
  const fallen = { objects: [], person: { facts: { posture: { value: POSE_FALL } } } } as unknown as WorldView;
  it("결과는 20초 동안 계획·지켜보기 글보다 먼저 말하고, 20초가 지나면 원래 글이다", () => {
    expect(say({ service })).toBe("AS센터에 전화를 요청했어요.");
    expect(say({ service, plan: plan("running") })).toBe("AS센터에 전화를 요청했어요.");
    expect(say({ service: { ...service, atMs: T - SAY_DONE_MS - 1 } })).toBe("지켜보고 있어요.");
  });
  it("안전 알림(쓰러짐 의심·다시 켜짐·끄기 안내·꺼짐 기다림)은 결과보다 먼저다", () => {
    expect(say({ service, world: fallen })).toBe(say({ world: fallen }));
    expect(say({ service, offTold: { device: "인덕션", atMs: T - 500 } })).toBe("인덕션이 다시 켜졌어요.");
    expect(say({ service, offWait: "인덕션" })).toBe(say({ offWait: "인덕션" }));
    expect(say({ service, command: cmd("off:plan:d1:1") })).toBe(say({ command: cmd("off:plan:d1:1") }));
  });
});

// Codex(2a449e5 data.ts:75·126): 안전 알림 뒤 생각 두 줄이 오면 그 알림이 메시지 상자 밖으로 밀렸다. 서버가 안전 알림인 말에 표시를 단다
describe("말풍선 말의 안전 알림 표시(sayOf safety)", () => {
  const fallen = { objects: [], person: { facts: { posture: { value: POSE_FALL } } } } as unknown as WorldView;
  const of = (o: Partial<Parameters<typeof sayOf>[0]>) => sayOf({ plan: null, command: null, world: null, nowMs: T, ...o });
  it("쓰러짐 의심·다시 켜짐·꺼짐 기다림·끄기 안내는 safety이고, 글은 sayLine과 같다", () => {
    for (const o of [{ world: fallen }, { offTold: { device: "인덕션", atMs: T - 500 } }, { offWait: "인덕션" }, { command: cmd("off:plan:d1:1") }]) {
      expect(of(o)).toEqual({ text: say(o), safety: true });
    }
  });
  it("그 밖의 말(지켜보기·외부 연락 결과·가까이 보기·계획 단계)은 safety가 아니다", () => {
    for (const o of [{}, { service: { text: "AS센터에 전화를 요청했어요.", atMs: T - 1000 } }, { look: { place: "식탁", atMs: T - 1000 } }, { plan: plan("running") }]) {
      expect(of(o)).toEqual({ text: say(o), safety: false });
    }
  });
});
