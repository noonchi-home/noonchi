import { describe, expect, it } from "vitest";
import type { PlannedCommand, PlannedCommandMessage } from "../src/contract/phone.js";
import { RobotPhone } from "../src/act/robot/phone.js";

const command = (id: string, step: string): PlannedCommand => ({
  type: "command", id, step, text: "인덕션을 꺼 주세요", choices: [], vision: null, target: null, speak: true,
});

describe("로봇 명령 줄", () => {
  it("안전 단계의 소리 등급을 보존하고 하던 명령을 가린 뒤 도착한 옛 지우기를 버린다", () => {
    const sent: PlannedCommandMessage[] = [];
    const line = new RobotPhone((c) => sent.push(c), (c) => c.step === "p1:12");
    line.show(command("p1", "p1:12"));
    line.show(command("p2", "p2:1"));
    line.clear("p1");
    line.clear("p2");
    expect(sent).toEqual([{ ...command("p1", "p1:12"), grade: "safety" }, command("p2", "p2:1"), { type: "command_clear", id: "p2" }]);
  });
  it("명령 처리 안에서 들어온 다음 명령을 앞 명령 뒤에 내고, 닫힌 뒤에는 되풀이를 보내지 않는다", () => {
    const seen: string[] = [];
    const line = new RobotPhone((m) => {
      if (m.type !== "command") return;
      if (m.id === "p1") line.show(command("p2", "p2:1"));
      seen.push(m.id);
    }, () => false);
    line.show(command("p1", "p1:1"));
    line.close();
    line.show(command("p2", "p2:1"));
    expect(seen).toEqual(["p1", "p2"]);
  });
});
