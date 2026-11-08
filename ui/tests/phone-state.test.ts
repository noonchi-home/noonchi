// 폰 화면 상태(state.ts): 옮기기 전 phone.js의 render·renderStatus·showRequest·showAction 글과 규칙 그대로인지 본다.
import { describe, expect, it, vi } from "vitest";
import {
  anchorCount, anchorLabel, anchorNames, createStore, initialView, onAction, onRequest, onStatus, photoSavedText, statusLine, supportText, wouldLine,
  type Anchor,
} from "../src/phone/state";

const anchors: Anchor[] = [{ id: "A", label: "거실 창가", recorded: true }, { id: "B", label: "현관", recorded: false }];
const base = { aligned: false, mismatchM: null, limited: false, anchorCount: "1/2", note: null };

describe("위 상태 줄", () => {
  it("맞추기 전: 바닥 기준점은 창가 기준 방향만, 벽 기준점은 벽 지점 수", () => {
    expect(statusLine({ ...base, mode: "floor" }).text).toBe("맞추기 전 · 창가 기준 방향만 · 기준점 1/2 기록");
    expect(statusLine({ ...base, mode: "touch" }).text).toBe("맞추기 전 · 벽 지점 1/2 기록");
  });
  it("맞춤: 거리 차이 cm, 벽 기준점은 근사, 추적이 약하면 덧붙인다", () => {
    expect(statusLine({ ...base, mode: "floor", aligned: true, mismatchM: 0.123 }).text).toBe("맞춤 ✓ · 거리 차이 12cm");
    expect(statusLine({ ...base, mode: "touch", aligned: true, mismatchM: 0.05, limited: true }).text).toBe("근사 맞춤 ✓ · 거리 차이 5cm · 추적 약함");
  });
  it("잠깐 알릴 말이 있으면 그 말, title은 늘 맞춤 상태", () => {
    expect(statusLine({ ...base, mode: "floor", note: "AR을 먼저 시작하세요" })).toEqual({ text: "AR을 먼저 시작하세요", title: "맞추기 전 · 창가 기준 방향만 · 기준점 1/2 기록" });
  });
  it("처음 값: 바닥을 비춰 주세요, 0 fps, 측정 전", () => {
    const v = initialView(true);
    expect([v.status.text, v.fps, v.perfDetail, v.speech, v.support]).toEqual(["바닥을 비춰 주세요", "0 fps", "측정 전", true, { kind: "checking" }]);
  });
});

describe("기준점 글", () => {
  it("기록 수/전체, 첫 안내 이름(상태 전이면 방 모서리), 단추 글", () => {
    expect(anchorCount(anchors)).toBe("1/2");
    expect(anchorNames("floor", null)).toBe("방 모서리");
    expect(anchorNames("floor", anchors)).toBe("거실 창가, 현관");
    expect(anchorNames("touch", anchors)).toBe("A 거실 창가, B 현관");
    expect(anchorLabel("floor", anchors[0]!)).toBe("✓ 거실 창가 지점 기록");
    expect(anchorLabel("touch", anchors[1]!)).toBe("B 현관 아래 바닥 조준하고 기록");
  });
});

describe("처음 화면·알림 글", () => {
  it("AR 지원 줄", () => {
    expect(supportText({ kind: "checking" })).toBe("AR 지원을 확인하는 중…");
    expect(supportText({ kind: "insecure" })).toBe("보안 연결이 아니라 AR을 켤 수 없어요. https 주소로 여세요.");
    expect(supportText({ kind: "no-ar" })).toBe("이 브라우저는 AR을 지원하지 않아요. 안드로이드 크롬으로 여세요.");
    expect(supportText({ kind: "ready" })).toBe("준비됐어요. 폰을 가로로 들고 첫 기준점 근처에서 AR을 시작하세요.");
    expect(supportText({ kind: "failed", message: "거부됨" })).toBe("AR을 시작하지 못했어요: 거부됨");
  });
  it("사진 보냄 알림, 클로이드라면 줄", () => {
    expect(photoSavedText({ answer: true })).toBe("요청한 컵 사진을 보냈어요");
    expect(photoSavedText({ aligned: true })).toBe("사진을 위치와 함께 보냈어요");
    expect(photoSavedText({})).toBe("위치 없이 사진을 보냈어요");
    expect(wouldLine("컵 집기")).toBe("클로이드라면: 컵 집기 · 기기 명령은 보내지 않아요");
    expect(wouldLine(null)).toBeNull();
  });
});

describe("메시지 → 상태", () => {
  it("상태 메시지: 방식·기준점·맞춤(방식이 없으면 floor)", () => {
    const v = onStatus(initialView(false), { anchors, aligned: true });
    expect([v.mode, v.anchors, v.aligned]).toEqual(["floor", anchors, true]);
  });
  it("사진 요청: 거둘 때까지 둔다. 다른 요청을 거두는 말은 무시한다", () => {
    const shown = onRequest(initialView(false), { id: "r1", text: "컵 안을 비춰 주세요", active: true });
    expect(shown.request).toEqual({ id: "r1", text: "컵 안을 비춰 주세요" });
    expect(onRequest(shown, { id: "r0", text: "", active: false })).toBe(shown);
    expect(onRequest(shown, { id: "r1", text: "", active: false }).request).toBeNull();
  });
  it("행동 부탁: 같은 부탁을 거둘 때만 지운다. 선택·클로이드라면이 없으면 빈 값", () => {
    const shown = onAction(initialView(false), { id: "a1", text: "식탁 위 컵을 치워 주세요", active: true });
    expect(shown.action).toEqual({ id: "a1", text: "식탁 위 컵을 치워 주세요", would: null, choices: [] });
    expect(onAction(shown, { id: "a0", active: false })).toBe(shown);
    expect(onAction(shown, { id: "a1", active: false }).action).toBeNull();
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
