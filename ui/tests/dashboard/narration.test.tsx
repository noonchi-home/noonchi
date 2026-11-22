import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import type { ServerMessage } from "../../../src/contract/events";
import { EMPTY_DASH, reduceDash } from "../../src/dashboard/data";
import { MOMENTS } from "../../src/dashboard/debug";
import { narrationOf } from "../../src/dashboard/narration";
import narrationSource from "../../src/dashboard/narration.ts?raw";
import { NarrationPane } from "../../src/dashboard/NarrationPane";

const feed = (messages: ServerMessage[]) => messages.reduce((d, m) => reduceDash(d, m, 0), EMPTY_DASH);
const messages = MOMENTS[2]!.messages;
const cup = feed(messages);
const command = messages.find(m => m.type === "phone_command")!.text;

it("설명 선택기는 서버 실행·월드 도메인을 직접 가져오지 않는다", () => {
  expect(narrationSource).not.toMatch(/(?:from\s*|import\s*\(?\s*)["'][^"']*src\/(?:act|world)\//);
});

it("저장된 컵 장면에서 관찰, 배운 습관, 완료된 이동과 실제 폰 송신을 세 줄로 설명한다", () => {
  const lines = narrationOf(cup, command, true);
  expect(lines).toEqual({
    status: "먹거나 마시던 분이 자리를 비웠어요.",
    judgment: "배운 습관에 따라 컵을 치우기로 했어요.",
    execution: "식탁으로 가는 단계를 마쳤어요. 폰에 컵을 들어 달라고 했어요.",
  });
  const { container } = render(<NarrationPane lines={lines} />);
  expect([...container.querySelectorAll("dl > dt")].map(node => node.textContent)).toEqual(["상태", "판단", "실행"]);
  expect([...container.querySelectorAll("dl > dd")].map(node => node.textContent)).toEqual([lines.status, lines.judgment, lines.execution]);
  expect(screen.queryByRole("heading")).toBeNull();
  expect(container.querySelector("img,svg")).toBeNull();
});

it("폰 송신과 계획 단계를 구분하고 해제·예정·종료 상태에서 송신을 추정하지 않는다", () => {
  const plan = cup.plan!;
  const active = narrationOf(cup, null, true).execution;
  expect(active).toContain("컵 집기");
  expect(active).not.toMatch(/보냈|달라고|마쳤어요.*컵 집기/);
  const pending = { ...plan, status: "planned" as const, steps: plan.steps.map(s => ({ ...s, status: "pending" as const })) };
  expect(narrationOf({ ...cup, plan: pending }, null, true).execution).toMatch(/시작을 기다/);
  expect(narrationOf({ ...cup, plan: { ...plan, status: "cancelled" } }, null, true).execution).toMatch(/취소/);
  const other = narrationOf(cup, "싱크대로 가 주세요", true).execution;
  expect(other).toMatch(/싱크대/);
  expect(other).not.toMatch(/컵을 들어|식탁.*마쳤/);
});

it("유효한 안전 안내만 앞세우고 해제 뒤에는 일반 설명으로 돌아간다", () => {
  const safety = reduceDash(cup, { type: "say", safety: true, text: "사람이 쓰러진 것 같아요." }, 0);
  const lines = narrationOf(safety, command, true);
  expect(lines.status).toBe("사람이 쓰러진 것 같아요.");
  expect(JSON.stringify(lines)).not.toMatch(/컵|식탁/);
  const cleared = reduceDash(safety, { type: "say", text: "사적인 말" }, 0);
  expect(narrationOf(cleared, command, true)).toEqual(narrationOf(cup, command, true));
});

it("접속 전과 연결 단절 중에는 보관된 판단·명령·안전 안내를 현재처럼 표시하지 않는다", () => {
  const saved = reduceDash(cup, { type: "say", safety: true, text: "기존 안전 안내" }, 0);
  for (const connected of [null, false]) {
    const lines = narrationOf(saved, command, connected);
    expect(lines.status).toContain("연결");
    expect(JSON.stringify(lines)).not.toMatch(/컵|식탁|기존 안전 안내/);
  }
  expect(narrationOf(saved, command, false).status).not.toBe(narrationOf(saved, command, null).status);
  expect(narrationOf(EMPTY_DASH, null, true).status).toContain("기다");
});

it("늦은 판단과 다른 계획에 속한 판단으로 현재 행동을 설명하지 않는다", () => {
  const late = { ...cup.decision!, late: true as const };
  const lines = narrationOf({ ...cup, decision: late }, command, true);
  expect(lines.judgment).toBe("—");
  expect(lines.status).not.toContain("비웠");
  expect(lines.execution).toContain("폰");
  const observed = reduceDash({ ...cup, decision: late }, {
    type: "person", state: "studying", name: "공부하는 중", source: "world", since_ms: late.at_ms + 1, decision_id: null,
  }, 0);
  expect(narrationOf(observed, null, true).status).toMatch(/공부/);
  expect(narrationOf({ ...cup, plan: { ...cup.plan!, id: "다른 계획" } }, null, true).judgment).toBe("—");
  const fixed = { ...cup.decision!, fsm: { ...cup.decision!.fsm!, learned: false } };
  expect(narrationOf({ ...cup, decision: fixed }, null, true).judgment).not.toContain("배운 습관");
});

it("판단 원문·사적 대화·승인 질문은 설명의 어느 줄에도 들어가지 않는다", () => {
  const raw = "보여 주면 안 되는 원문";
  const question = "개인 연락처로 전화할까요?";
  const plan = { ...cup.plan!, judgment: raw, steps: [{ ...cup.plan!.steps[1]!, kind: "ask" as const, label: question }] };
  const decision = { ...cup.decision!, text_sent: raw, prediction: { ...cup.decision!.prediction!, reasoning: raw, observation: raw } };
  const dash = reduceDash({ ...cup, plan, decision }, { type: "thought", messages: [{ id: "private", at_ms: decision.at_ms + 1, decision: decision.id, text: raw }] }, 0);
  for (const text of [question, null]) {
    const lines = narrationOf(reduceDash(dash, { type: "say", text: raw }, 0), text, true);
    expect(JSON.stringify(lines)).not.toMatch(/원문|연락처/);
    expect(lines.execution).toContain(text ? "폰에 안내를 보냈어요." : "응답 확인");
  }
  const other = { ...dash, decision: { ...decision, action: raw, source: "speech" as const } };
  expect(narrationOf(other, raw, true).judgment).toBe("다음 행동을 정했어요.");
  expect(narrationOf(other, raw, true).execution).toBe("폰에 안내를 보냈어요.");
});

it("뒤늦게 받은 옛 계획이 새 계획의 실행 설명을 되돌리지 않는다", () => {
  const old = { ...cup.plan!, updatedAt: "2026-11-22T10:00:00Z" };
  const current = { ...old, id: "new", supersedes: old.id, updatedAt: "2026-11-22T10:00:02Z", status: "done" as const };
  const dash = feed([{ type: "plan", plan: current }, { type: "plan", plan: old }]);
  expect(narrationOf(dash, null, true).execution).toBe("계획을 마쳤어요.");
});

it("서버가 공개한 활동의 이름을 표시하고, 식탁 밖에서도 확인된 앞 단계만 완료로 설명한다", () => {
  const observed = reduceDash(cup, {
    type: "person", state: "~new_activity", name: "책 정리하는 중", source: "world", since_ms: cup.decision!.at_ms + 1, decision_id: null,
  }, 0);
  expect(narrationOf(observed, null, true).status).toContain("책 정리하는 중");
  const plan = { ...cup.plan!, steps: [
    { ...cup.plan!.steps[2]!, status: "done" as const }, { ...cup.plan!.steps[3]!, status: "active" as const },
  ] };
  const command = "컵을 싱크대에 넣어 주세요";
  expect(narrationOf({ ...cup, plan }, command, true).execution).toBe("싱크대로 가는 단계를 마쳤어요. 폰에 컵을 싱크대에 넣어 달라고 했어요.");
});

it("자리를 비우기 직전의 공개 관찰을 찾고 원래 이력의 순서를 보존한다", () => {
  const person = (state: string, name: string, since_ms: number): ServerMessage =>
    ({ type: "person", state, name, since_ms, source: "world", decision_id: null });
  const first = person("drinking", "먹거나 마시는 중", 10);
  const last = person("away", "자리에 없음", 30);
  expect(narrationOf(feed([last, first]), null, true).status).toBe("먹거나 마시던 분이 자리를 비웠어요.");
  const dash = feed([last, first, person("studying", "공부하는 중", 20)]);
  expect(narrationOf(dash, null, true).status).toBe("사용자가 자리를 비웠어요.");
  expect(dash.people.map(p => p.at_ms)).toEqual([10, 20, 30]);
});
