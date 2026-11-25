// @vitest-environment node
// 가짜 단계(debug.ts) 주소 설정과 순간 자료.
import { describe, expect, it } from "vitest";
import { STEP_COMMAND } from "../../../src/act/labels";
import { EMPTY_DASH, modeNow, reduceDash, talkOf } from "../../src/dashboard/data";
import { COACH_MOMENT, debugPhone, debugQuery, EYE_FRAME, FIND_LINE, modeMoment, MOMENTS, talkMoment, type Moment } from "../../src/dashboard/debug";

/** 순간 메시지를 차례로 넣은 메시지 상자. */
const talkAt = (m: Moment) => talkOf(m.messages.reduce((s, x, i) => reduceDash(s, x, i), EMPTY_DASH));

it("컵 시연은 현재 단계의 공개 폰 지시만 내보내고 대기 중에는 비운다", () => {
  const captions = MOMENTS.map((m) => m.messages.flatMap((event) => event.type === "phone_command" && event.text !== null ? [event.text] : []));
  expect(captions).toEqual([[], [STEP_COMMAND.goTable], [STEP_COMMAND.pickCup], [STEP_COMMAND.goSink], [STEP_COMMAND.placeCup]]);
});

describe("가짜 단계 눈 그림은 가로(실제 폰도 영상도 가로만 보낸다)", () => {
  it("주소에 가로·세로를 고르는 칸이 없다(wide=1을 줘도 같은 설정)", () => {
    expect(debugQuery("?debug=steps&wide=1")).toEqual(debugQuery("?debug=steps"));
    expect(debugQuery("?debug=steps")).not.toHaveProperty("wide");
  });

  it("순간마다 seen 프레임은 가로 눈 그림 크기(405×228)이고 컵 마스크가 그 안에 다 들어온다", () => {
    expect(EYE_FRAME).toEqual({ width: 405, height: 228 });
    for (const m of MOMENTS) {
      const seen = m.messages.find((y) => y.type === "seen");
      if (seen?.type !== "seen") throw new Error("seen 없음");
      expect(seen.frame).toEqual(EYE_FRAME);
      for (const s of seen.shapes) {
        const [x, y, w, h] = s.mask.at;
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(x + w).toBeLessThanOrEqual(EYE_FRAME.width);
        expect(y + h).toBeLessThanOrEqual(EYE_FRAME.height);
      }
    }
  });

  it("대시보드 폰 칸 그림은 그 순간 가로 눈 그림과 가로 크기다", () => {
    const q = debugQuery("?debug=steps")!;
    expect(debugPhone(q, MOMENTS[2]!, "u")).toEqual({ kind: "image", src: "/debug-eye/eye-table-near.webp", width: 405, height: 228 });
  });
});

describe("가짜 단계 메시지 상자 상태(&talk)", () => {
  it("주소의 talk는 find만 받는다", () => {
    expect(debugQuery("?debug=steps&talk=find")?.talk).toBe("find");
    expect(debugQuery("?debug=steps&talk=habit")?.talk).toBeNull();
    expect(debugQuery("?debug=steps&talk=x")?.talk).toBeNull();
    expect(debugQuery("?debug=steps")?.talk).toBeNull();
  });

  it("find: 최신 줄이 찾기 상태 줄이고 판단은 컵 치우기(1번 순간의 판단)다", () => {
    const find = talkAt(talkMoment(MOMENTS[0]!, "find"))!;
    expect(find.lines.at(-1)!.text).toBe(FIND_LINE);
    const decided = talkMoment(MOMENTS[0]!, "find").messages.reduce((s, x, i) => reduceDash(s, x, i), EMPTY_DASH).decision;
    expect(decided?.action).toBe("컵 치우기");
    expect(talkMoment(MOMENTS[1]!, null)).toBe(MOMENTS[1]);
  });
});

describe("가짜 단계 모드 말풍선(&mode)", () => {
  const modeAt = (m: Moment) => modeNow(m.messages.reduce((s, x, i) => reduceDash(s, x, i), EMPTY_DASH));
  it("주소의 mode는 coach만 받는다. 순간마다 서버가 보낸 지금 모드는 눈치 모드이고, coach면 코치 모드로 바꾼다", () => {
    expect(debugQuery("?debug=steps&mode=coach")?.mode).toBe("coach");
    expect(debugQuery("?debug=steps&mode=x")?.mode).toBeNull();
    expect(debugQuery("?debug=steps")?.mode).toBeNull();
    for (const m of MOMENTS) expect(modeAt(m)).toBe("noonchi");
    // coach: 코치 행동 중 순간(라면 끓이기 알려 주기 2단계, 규칙 줄·클로이드 말)으로 바꾼다
    const coach = modeMoment(MOMENTS[2]!, "coach");
    expect(modeAt(coach)).toBe("coach");
    expect(coach).toBe(COACH_MOMENT);
    expect(talkAt(coach)!.lines.map((l) => l.text)).toEqual(["라면 끓이는 법을 알려 드릴게요.", "수납장으로 갈게요.", "냄비를 꺼낼게요."]);
    expect(coach.messages.reduce((s, x, i) => reduceDash(s, x, i), EMPTY_DASH).decision?.fsm?.state).toBe("cooking");
    expect(modeMoment(MOMENTS[2]!, null)).toBe(MOMENTS[2]);
  });
});

describe("가짜 단계 메시지 상자 줄이 굴러간다", () => {
  it("계획 순간이 넘어가면 앞 순간의 줄 끝에 새 말 한 줄이 붙는다(같은 묶음을 다시 넣어도 줄 id가 같다)", () => {
    for (const n of [1, 2, 3]) {
      const now = talkAt(MOMENTS[n]!)!.lines;
      const next = talkAt(MOMENTS[n + 1]!)!.lines;
      expect(next.slice(0, -1)).toEqual(now.slice(1));
      expect(next.at(-1)!.id).not.toBe(now.at(-1)!.id);
    }
    expect(talkAt(MOMENTS[3]!)).toEqual(talkAt(MOMENTS[3]!));
  });
});

