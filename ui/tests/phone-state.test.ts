// 실제 폰 화면 상태(state.ts): 실제 폰은 에이전트의 손이다. 위에는 지금 할 명령 한 줄, 아래 엄지 자리에는 비전 상태 한 줄과 그 바로 아래 답 단추.
// 일이 멈추는 문제(연결 끊김·마이크 꺼짐·기준점 안 맞음)는 모달, 잠깐 생기는 문제(추적 약함·잠깐 알릴 말)는 비전 상태 줄에만.
import { describe, expect, it, vi } from "vitest";
import { ASK_PROMPT, STEP_DONE } from "../../src/act/prompts.ts";
import { STEP_COMMAND } from "../../src/plan/labels.ts";
import {
  anchorCount, anchorNames, createStore, handOf, initialView, nextAnchor, onStatus, PLACE_LINE, problemOf, settingsRows, setupLine, supportText,
  type Anchor, type Command, type PhoneView,
} from "../src/phone/state";

const anchors: Anchor[] = [{ id: "A", label: "거실 창 오른쪽 벽", recorded: true }, { id: "B", label: "반대편 벽", recorded: false }];
const done = [{ id: STEP_DONE.id, label: STEP_DONE.label }];
const cmd = (over: Partial<Command> = {}): Command => ({ id: "plan:pam-1", step: "plan:pam-1:2", text: STEP_COMMAND.pickCup, vision: "컵 · 식탁 위", choices: done, target: "cup_1", ...over });
const ar = (over: Partial<PhoneView> = {}): PhoneView => ({
  ...initialView(), ar: true, connected: true, listening: "on", mode: "touch", anchors: anchors.map((a) => ({ ...a, recorded: true })), aligned: true, mismatchM: 0.06, ...over,
});

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

  it("기준점 찍기: 위는 다음 기준점 안내, 아래는 바닥에 닿음·기록 수와 「기록」. 명령보다 먼저", () => {
    const v = ar({ setup: "anchors", aligned: false, anchors, command: cmd(), hit: true });
    expect(handOf(v)).toEqual({ top: "B 반대편 벽 바로 아래 바닥을 가리켜 주세요", thumb: { kind: "record", anchor: anchors[1] }, vision: { text: "바닥에 닿음 · 기준점 1/2", tone: "ok" } });
    expect(handOf({ ...v, hit: false }).vision).toEqual({ text: "바닥에 안 닿음 · 기준점 1/2", tone: "plain" });
  });

  it("물건 자리 맞추기: 위는 「여기」 말하기 안내, 아래는 바닥에 닿음과 「완료」", () => {
    expect(handOf(ar({ setup: "place", hit: true }))).toEqual({ top: PLACE_LINE, thumb: { kind: "place" }, vision: { text: "바닥에 닿음", tone: "ok" } });
    expect(PLACE_LINE).toBe('물건 아래 바닥을 가리키고 "냉장고 여기로"라고 말해 주세요');
  });
});

describe("기준점 안내", () => {
  it("다음 기준점은 아직 안 찍은 첫 곳, 다 찍었으면 첫 곳", () => {
    expect(nextAnchor(anchors)).toBe(anchors[1]);
    expect(nextAnchor(anchors.map((a) => ({ ...a, recorded: true })))?.id).toBe("A");
    expect(nextAnchor(null)).toBeNull();
  });

  it("벽 기준점은 「A 이름 바로 아래 바닥」, 바닥 기준점은 「이름 바닥」", () => {
    expect(setupLine("touch", anchors[0]!)).toBe("A 거실 창 오른쪽 벽 바로 아래 바닥을 가리켜 주세요");
    expect(setupLine("floor", { id: "a1", label: "거실 창 앞", recorded: false })).toBe("거실 창 앞 바닥을 가리켜 주세요");
  });
});

describe("문제(problemOf): 일이 멈추면 모달 하나", () => {
  it("AR 중에만. 연결 끊김 → 마이크 꺼짐 → 기준점 안 맞음 순으로 하나", () => {
    expect(problemOf(ar())).toBeNull();
    expect(problemOf(ar({ ar: false, connected: false }))).toBeNull();
    expect(problemOf(ar({ connected: false, listening: "denied", aligned: false }))).toBe("offline");
    expect(problemOf(ar({ listening: "denied", aligned: false }))).toBe("mic");
    expect(problemOf(ar({ aligned: false }))).toBe("align");
  });

  it("기준점을 찍는 중이거나 아직 서버 상태가 없으면 기준점 모달을 띄우지 않는다. 추적 약함은 모달이 아니다", () => {
    expect(problemOf(ar({ aligned: false, setup: "anchors" }))).toBeNull();
    expect(problemOf(ar({ aligned: false, anchors: null }))).toBeNull();
    expect(problemOf(ar({ limited: true }))).toBeNull();
  });
});

describe("설정 줄(settingsRows)", () => {
  it("연결·듣기·기준점 상태", () => {
    expect(settingsRows(ar())).toEqual([
      { name: "연결", value: "됨", tone: "ok" },
      { name: "듣기", value: "켜짐", tone: "ok" },
      { name: "기준점", value: "맞음 · 6cm", tone: "ok" },
    ]);
    expect(settingsRows(ar({ connected: false, listening: "denied", aligned: false, anchors }))).toEqual([
      { name: "연결", value: "끊김", tone: "error" },
      { name: "듣기", value: "꺼짐", tone: "error" },
      { name: "기준점", value: "안 맞음 · 1/2", tone: "warn" },
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
  it("AR 지원 줄", () => {
    expect(supportText({ kind: "checking" })).toBe("AR 지원을 확인하는 중…");
    expect(supportText({ kind: "insecure" })).toBe("보안 연결이 아니라 AR을 켤 수 없어요. https 주소로 여세요.");
    expect(supportText({ kind: "no-ar" })).toBe("이 브라우저는 AR을 지원하지 않아요. 안드로이드 크롬으로 여세요.");
    expect(supportText({ kind: "ready" })).toBe("준비됐어요. 폰을 세로로 들고 첫 기준점 근처에서 AR을 시작하세요.");
    expect(supportText({ kind: "failed", message: "거부됨" })).toBe("AR을 시작하지 못했어요: 거부됨");
  });

  it("기록 수/전체, 첫 안내 이름(상태 전이면 방 모서리)", () => {
    expect(anchorCount(anchors)).toBe("1/2");
    expect(anchorNames("floor", null)).toBe("방 모서리");
    expect(anchorNames("touch", anchors)).toBe("A 거실 창 오른쪽 벽, B 반대편 벽");
  });

  it("처음 값: 연결 전, 듣기 꺼짐, 명령·설정·기준점 찍기 없음", () => {
    expect(initialView()).toMatchObject({ support: { kind: "checking" }, ar: false, connected: false, listening: "off", command: null, setup: null, settingsOpen: false, pending: [] });
  });
});

describe("메시지 → 상태", () => {
  it("상태 메시지: 방식·기준점·맞춤·거리 차이(방식이 없으면 floor)", () => {
    const v = onStatus(initialView(), { anchors, aligned: true, mismatch_m: 0.12 });
    expect([v.mode, v.anchors, v.aligned, v.mismatchM]).toEqual(["floor", anchors, true, 0.12]);
  });

  it("맞추면 기준점 찍기를 끝낸다(물건 자리 맞추기는 그대로)", () => {
    expect(onStatus({ ...initialView(), setup: "anchors" }, { anchors, aligned: true }).setup).toBeNull();
    expect(onStatus({ ...initialView(), setup: "anchors" }, { anchors, aligned: false }).setup).toBe("anchors");
    expect(onStatus({ ...initialView(), setup: "place" }, { anchors, aligned: true }).setup).toBe("place");
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
