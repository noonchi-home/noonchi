// pam-predict/2·pam-reflect/2 요청 모양: 사진 칸이 없고, 논문 판단 규칙 문장은 그대로 두고 사진 자리에 관찰 텍스트를 넣는다.
import { describe, expect, it } from "vitest";
import { PamRequestError, buildPredictMessages, buildReflectMessages, predictRequest, pyIsoformat, reflectRequest } from "../src/brain/pam/index.js";

const MEMORY = { initial_state: "drinking", states: [
  { id: "drinking", description: "마시는 중", rules: [], next: [{ to: "left_cup", on: "컵을 두고 떠남" }] },
  { id: "left_cup", description: "컵을 두고 자리를 비움", rules: [{ trigger: "빈 컵이 식탁에 남음", action: "컵 치우기" }], next: [] }] };
const LIST = { rules: [{ trigger: "빈 컵이 식탁에 남음", action: "컵 치우기" }] };
const P = { contract: "pam-predict/2", final_time: "2026-11-07T21:00:08.000+09:00", observation_text: "21:00:00 사람 보임\n21:00:04 사람 안 보임",
  memory_kind: "fsm", memory: MEMORY, tasks: ["컵 치우기", "사용자에게 물어보기"] };
const R = { contract: "pam-reflect/2", day: "2026-11-07", memory_kind: "fsm", memory: MEMORY, observation_text: "07:58:02 사람 보임",
  action_summary: "08:10:40 컵 치우기 부탁", feedback: "다 마신 뒤에만 치워 줘" };
const texts = (b: ReturnType<typeof buildReflectMessages>) => (b.messages[1]!.content as { text: string }[]).map((p) => p.text).join("\n");

describe("요청 모양", () => {
  it("사진 칸·시간대 없는 시각·옛 계약 이름은 PamRequestError", () => {
    for (const bad of [{ ...P, frames: [{ image: { base64: "AAAA" } }] }, { ...P, image: "data:image/jpeg;base64,AAAA" },
      { ...P, final_time: "2026-11-07T21:00:08" }, { ...P, contract: "pam-predict/1" }]) {
      expect(() => predictRequest(bad)).toThrow(PamRequestError);
    }
  });

  it("반성 글 크기 상한(코드 포인트)과 모르는 칸", () => {
    for (const [k, n] of [["observation_text", 100_001], ["action_summary", 50_001], ["feedback", 8_001]] as const) {
      expect(() => reflectRequest({ ...R, [k]: "가".repeat(n) }), k).toThrow(PamRequestError);
    }
    expect(() => reflectRequest({ ...R, photos: [] })).toThrow(PamRequestError);
    expect(predictRequest({ ...P, observation_text: "가".repeat(19_999) + "🍜" }).observation_text).toHaveLength(20_001);
  });

  it("시각은 Python isoformat 꼴로 바꾼다", () => {
    expect(pyIsoformat("2026-11-07T21:00:08.000+09:00")).toBe("2026-11-07T21:00:08+09:00");
    expect(pyIsoformat("2026-11-07T21:00:08.5+09:00")).toBe("2026-11-07T21:00:08.500000+09:00");
    expect(pyIsoformat("2026-11-07T21:00:08.1234567+09:00")).toBe("2026-11-07T21:00:08.123456+09:00");
    expect(pyIsoformat("2026-11-07T12:00:08Z")).toBe("2026-11-07T12:00:08+00:00");
    expect(pyIsoformat("2026-11-07T12:00:08-00:00")).toBe("2026-11-07T12:00:08+00:00");
    expect(pyIsoformat("2026-11-07T21:00+09:00")).toBe("2026-11-07T21:00:00+09:00");
    for (const bad of ["2026-11-07T21:00:08", "2026-11-07T24:00:00+09:00", "2026-11-07T21:00:60+09:00", "2026-02-30T21:00:00+09:00", "2026-11-07T21:00:08+24:00"]) {
      expect(pyIsoformat(bad), bad).toBeNull();
    }
  });
});

describe("메시지", () => {
  it("판단: 판단 규칙 문장은 그대로, 사진 자리에 관찰 텍스트", () => {
    const built = buildPredictMessages(predictRequest(P));
    const system = built.messages[0]!.content as string;
    const user = built.messages[1]!.content as { type: string; text: string }[];
    expect(system).toContain("If the person is holding or touching an object, the robot cannot perform any");
    expect(system).toContain("action on that object until the person sets it down on the desk.");
    expect(system).not.toContain("camera frames");
    expect(system).not.toContain("back-facing cameras");
    expect(system).toContain("a home with a dining table");
    expect(system).not.toContain("personal desk");
    expect(system).toContain("0: 컵 치우기\n1: 사용자에게 물어보기");
    expect(system).toContain(JSON.stringify(MEMORY, null, 2));
    expect(system).not.toMatch(/\{(window|fsm_block)\}/);
    expect(user.every((p) => p.type === "text")).toBe(true);
    expect(user[0]!.text).toBe("Wall-clock time of the final observation: 2026-11-07T21:00:08+09:00");
    expect(user[1]!.text).toContain("21:00:04 사람 안 보임");
    expect(built.generation).toEqual({ temperature: 0.3, enable_thinking: false });
  });

  it("list 기억은 list 프롬프트를 쓴다", () => {
    const system = buildPredictMessages(predictRequest({ ...P, memory_kind: "list", memory: LIST })).messages[0]!.content as string;
    expect(system).toContain("flat list of production rules");
    expect(system).toContain(JSON.stringify(LIST, null, 2));
    expect(buildReflectMessages(reflectRequest({ ...R, memory_kind: "list", memory: LIST })).messages[0]!.content).not.toContain("Today's video");
  });

  it("반성: 하루 관찰·요약·피드백, 피드백이 없거나 비면 넣지 않는다", () => {
    const built = buildReflectMessages(reflectRequest(R));
    expect(built.messages[0]!.content).not.toContain("Today's video");
    expect(texts(built)).toContain("07:58:02 사람 보임");
    expect(texts(built)).toContain("Summary:\n08:10:40 컵 치우기 부탁");
    expect(texts(built)).toContain("Human feedback:\n다 마신 뒤에만 치워 줘");
    expect(built.generation).toEqual({ temperature: 0.3, enable_thinking: true });
    for (const feedback of [null, ""]) expect(texts(buildReflectMessages(reflectRequest({ ...R, feedback })))).not.toContain("Human feedback");
  });
});
