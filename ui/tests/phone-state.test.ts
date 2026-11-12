// 실제 폰 화면 상태(state.ts): 실제 폰은 에이전트의 손이다. 위에는 지금 할 명령 한 줄, 아래 엄지 자리에는 비전 상태 한 줄과 그 바로 아래 답 단추.
// 일이 멈추는 문제(연결 끊김·마이크 꺼짐·시작 위치 없음)는 모달, 잠깐 생기는 문제(추적 약함·잠깐 알릴 말)는 비전 상태 줄에만.
// 위치 맞춤은 서버 status.sync: 시작 위치에서 「여기서 시작」, 걸으며 벽 모양·물건으로 맞춘다.
import { describe, expect, it, vi } from "vitest";
import { ASK_PROMPT, STEP_DONE } from "../../src/act/prompts.ts";
import { STEP_COMMAND } from "../../src/plan/labels.ts";
import {
  createStore, handOf, initialView, isStartWord, onStatus, PLACE_LINE, problemOf, settingsRows, START_BUTTON,
  startLine, supportText, type Command, type PhoneView, type SyncView,
} from "../src/phone/state";

const start = { label: "거실·복도 테이블 앞", facing: "거실·복도 TV수납장" };
const sync = (over: Partial<SyncView> = {}): SyncView => ({ state: "aligned", source: "walls", start, started: true, anchors: 0, wallPoints: 60, residualM: 0.06, ...over });
const done = [{ id: STEP_DONE.id, label: STEP_DONE.label }];
const cmd = (over: Partial<Command> = {}): Command => ({ id: "plan:pam-1", step: "plan:pam-1:2", text: STEP_COMMAND.pickCup, vision: "컵 · 식탁 위", choices: done, target: "cup_1", ...over });
const ar = (over: Partial<PhoneView> = {}): PhoneView => ({ ...initialView(), ar: true, connected: true, listening: "on", aligned: true, sync: sync(), ...over });

describe("엄지 자리와 위 한 줄(handOf)", () => {
  it("명령이 없으면 위도 아래도 비어 있다(미어캣만)", () => {
    expect(handOf(ar())).toEqual({ top: null, thumb: null, vision: null });
  });

  it("명령: 위는 명령 글, 아래는 비전 상태 한 줄과 답 단추", () => {
    const c = cmd();
    expect(handOf(ar({ command: c }))).toEqual({ top: "컵을 들어 주세요", thumb: { kind: "command", command: c }, vision: { text: "컵 · 식탁 위", tone: "plain" } });
  });

  it("질문은 비전 상태 줄 없이 답 단추만", () => {
    const q = cmd({ text: ASK_PROMPT.text, vision: null, choices: ASK_PROMPT.choices.map(({ id, label }) => ({ id, label })) });
    expect(handOf(ar({ command: q }))).toMatchObject({ top: "컵을 치울까요?", vision: null });
  });

  it("추적이 약하면 비전 상태 줄이 「추적이 약해요」(경고), 잠깐 알릴 말이 있으면 그 말", () => {
    expect(handOf(ar({ command: cmd(), limited: true })).vision).toEqual({ text: "추적이 약해요", tone: "warn" });
    expect(handOf(ar({ command: cmd(), limited: true, note: "서버와 연결이 끊겨 답을 보내지 못했어요" })).vision).toEqual({ text: "서버와 연결이 끊겨 답을 보내지 못했어요", tone: "warn" });
  });

  it("승인 대기(실제 모드 가전)는 명령 자리: 위에 「기기: 까닭」, 아래 답 단추. 명령보다 먼저", () => {
    const choices = [{ id: "approve", label: "승인" }, { id: "reject", label: "거절" }];
    const pending = [{ token: "t1", deviceLabel: "현관문", reason: "현관문 잠금 해제", choices }, { token: "t2", deviceLabel: "창문", reason: "창문 열기", choices }];
    expect(handOf(ar({ command: cmd(), pending }))).toEqual({ top: "현관문: 현관문 잠금 해제", thumb: { kind: "pending", item: pending[0] }, vision: null });
  });

  it("물건 자리 맞추기: 위는 「여기」 말하기 안내, 아래는 바닥에 닿음과 「완료」. 어림 바닥이면 경고 색", () => {
    expect(handOf(ar({ setup: "place", hit: true }))).toEqual({ top: PLACE_LINE, thumb: { kind: "place" }, vision: { text: "바닥에 닿음", tone: "ok" } });
    expect(handOf(ar({ setup: "place", hit: true, hitEstimated: true })).vision).toEqual({ text: "어림잡은 바닥에 닿음", tone: "warn" });
    expect(handOf(ar({ setup: "place", hit: false })).vision).toEqual({ text: "바닥에 안 닿음", tone: "plain" });
    expect(PLACE_LINE).toBe('물건 아래 바닥을 가리키고 "냉장고 여기로"라고 말해 주세요');
  });

  it("시작 위치 맞추기: 위는 「<자리>에 서서 <보는 쪽> 쪽을 봐 주세요」, 아래는 「여기서 시작」. 명령보다 먼저", () => {
    const v = ar({ aligned: false, setup: "start", command: cmd(), sync: sync({ state: "none", started: false, source: null }) });
    expect(handOf(v)).toEqual({ top: "거실·복도 테이블 앞에 서서 거실·복도 TV수납장 쪽을 봐 주세요", thumb: { kind: "start" }, vision: null });
    expect(startLine({ label: "현관", facing: "" })).toBe("현관에 서서 정한 방향을 봐 주세요");
    expect(START_BUTTON).toBe("여기서 시작");
    expect(handOf({ ...v, limited: true }).vision).toEqual({ text: "추적이 약해요", tone: "warn" });
  });

  it("맞추는 중(어림)이면 명령의 비전 상태 줄 앞에 「위치 맞추는 중」, 맞추면 그대로", () => {
    expect(handOf(ar({ aligned: false, command: cmd(), sync: sync({ state: "estimated", source: "start" }) })).vision).toEqual({ text: "위치 맞추는 중 · 컵 · 식탁 위", tone: "plain" });
    expect(handOf(ar({ command: cmd() })).vision).toEqual({ text: "컵 · 식탁 위", tone: "plain" });
  });
});

describe("문제(problemOf): 일이 멈추면 모달 하나", () => {
  it("AR 중에만. 연결 끊김 → 마이크 꺼짐 → 시작 위치 없음 순으로 하나", () => {
    const noStart = sync({ state: "none", start: null, started: false, source: null });
    expect(problemOf(ar())).toBeNull();
    expect(problemOf(ar({ ar: false, connected: false, sync: noStart }))).toBeNull();
    expect(problemOf(ar({ connected: false, listening: "denied", sync: noStart }))).toBe("offline");
    expect(problemOf(ar({ listening: "denied", sync: noStart }))).toBe("mic");
    expect(problemOf(ar({ aligned: false, sync: noStart }))).toBe("start");
  });

  it("시작 위치가 있거나, 시작 위치 없이도 물건으로 변환이 생겼거나, 서버 상태 전이면 모달이 없다. 추적 약함도 모달이 아니다", () => {
    expect(problemOf(ar({ aligned: false, sync: sync({ state: "none", started: false }) }))).toBeNull();
    expect(problemOf(ar({ aligned: false, sync: sync({ state: "estimated", start: null, source: "objects" }) }))).toBeNull();
    expect(problemOf(ar({ aligned: false, sync: null }))).toBeNull();
    expect(problemOf(ar({ limited: true }))).toBeNull();
  });
});

describe("설정 줄(settingsRows)", () => {
  it("연결·듣기·위치(맞음과 오차)·기준(시작 위치·물건 수·벽 점 수)", () => {
    expect(settingsRows(ar({ sync: sync({ anchors: 2, wallPoints: 84, residualM: 0.03 }) }))).toEqual([
      { name: "연결", value: "됨", tone: "ok" },
      { name: "듣기", value: "켜짐", tone: "ok" },
      { name: "위치", value: "맞음 · 3cm", tone: "ok" },
      { name: "기준", value: "시작 위치 · 물건 2 · 벽 84점", tone: "plain" },
    ]);
    expect(settingsRows(ar({ connected: false, listening: "denied", aligned: false, sync: sync({ state: "none", started: false, wallPoints: 0, source: null }) }))).toEqual([
      { name: "연결", value: "끊김", tone: "error" },
      { name: "듣기", value: "꺼짐", tone: "error" },
      { name: "위치", value: "안 맞음", tone: "warn" },
    ]);
    expect(settingsRows(ar({ aligned: false, sync: sync({ state: "estimated", source: "start", wallPoints: 0 }) })).slice(2)).toEqual([
      { name: "위치", value: "어림", tone: "warn" },
      { name: "기준", value: "시작 위치", tone: "plain" },
    ]);
    expect(settingsRows(ar({ listening: "paused" }))[1]).toEqual({ name: "듣기", value: "켜짐", tone: "ok" });
    expect(settingsRows(ar({ listening: "off" }))[1]).toEqual({ name: "듣기", value: "꺼짐", tone: "plain" });
  });

  it("카메라 화면을 못 보내면 그 줄이 남는다(엄지 자리 카드가 없어도 미어캣 설정에서 보인다)", () => {
    expect(settingsRows(ar({ cameraOff: true })).at(-1)).toEqual({ name: "카메라", value: "못 보냄", tone: "warn" });
    expect(settingsRows(ar()).map((r) => r.name)).not.toContain("카메라");
  });
});

describe("처음 화면 글", () => {
  it("AR 지원 줄: 시작 위치가 있으면 그 자리에서 시작하라고", () => {
    expect(supportText({ kind: "checking" })).toBe("AR 지원을 확인하는 중…");
    expect(supportText({ kind: "insecure" })).toBe("보안 연결이 아니라 AR을 켤 수 없어요. https 주소로 여세요.");
    expect(supportText({ kind: "no-ar" })).toBe("이 브라우저는 AR을 지원하지 않아요. 안드로이드 크롬으로 여세요.");
    expect(supportText({ kind: "ready" }, true)).toBe("준비됐어요. 시작 위치에서 AR을 시작하세요.");
    expect(supportText({ kind: "ready" })).toBe("준비됐어요. AR을 시작하세요.");
    expect(supportText({ kind: "failed", message: "거부됨" })).toBe("AR을 시작하지 못했어요: 거부됨");
  });

  it("처음 값: 연결 전, 듣기 꺼짐, 명령·설정·맞추기 없음, 위치 맞춤 상태 전", () => {
    expect(initialView()).toMatchObject({ support: { kind: "checking" }, ar: false, connected: false, listening: "off", command: null, setup: null, settingsOpen: false, pending: [], sync: null });
  });
});

describe("메시지 → 상태", () => {
  const wire = { state: "none" as const, source: null, start, started: false, anchors: 0, wall_points: 0, residual_m: null };

  it("상태 메시지 → 맞춤·sync", () => {
    const v = onStatus(ar({ aligned: false }), { aligned: false, sync: wire });
    expect(v.aligned).toBe(false);
    expect(v.sync).toEqual({ state: "none", source: null, start, started: false, anchors: 0, wallPoints: 0, residualM: null });
    expect(onStatus(ar(), { aligned: true }).sync).toBeNull();
  });

  it("AR 중 시작 위치가 있고 아직 시작하지 않았으면(변환 없음) 시작 위치 맞추기를 연다. AR 밖·물건 자리 맞추기 중에는 열지 않는다", () => {
    expect(onStatus(ar({ aligned: false }), { aligned: false, sync: wire }).setup).toBe("start");
    expect(onStatus({ ...ar(), ar: false }, { aligned: false, sync: wire }).setup).toBeNull();
    expect(onStatus(ar({ setup: "place", aligned: false }), { aligned: false, sync: wire }).setup).toBe("place");
  });

  it("다시 맞추기로 연 시작 위치 맞추기는 상태가 와도 그대로다(「여기서 시작」을 보내면 controller가 닫는다). 시작 위치가 지워지면 닫는다", () => {
    const open = ar({ setup: "start" });
    expect(onStatus(open, { aligned: true, sync: { ...wire, state: "aligned", source: "walls", started: true } }).setup).toBe("start");
    expect(onStatus(open, { aligned: true, sync: { ...wire, start: null, state: "aligned", source: "walls", started: true } }).setup).toBeNull();
  });

  it("「여기서 시작」 말: 말 전체가 시작일 때만(늘 듣기라 다른 말 속 「시작」은 아니다)", () => {
    for (const t of ["여기서 시작", "시작", "여기서 시작할게", "시작해요", "응 시작", "여기서 시작!"]) expect(isStartWord(t), t).toBe(true);
    for (const t of ["시작 위치가 어디야", "TV 켜고 시작해", "여기", "시작이 반이다"]) expect(isStartWord(t), t).toBe(false);
  });
});

describe("저장소", () => {
  it("값을 바꾸면 듣는 쪽을 부르고, 끊으면 부르지 않는다", () => {
    const s = createStore(1);
    const fn = vi.fn();
    const off = s.subscribe(fn);
    s.set((n) => n + 1);
    expect([s.get(), fn.mock.calls.length]).toEqual([2, 1]);
    off();
    s.set(5);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
