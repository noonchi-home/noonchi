// 승인 규칙(src/agent/approval.ts): 묻는 때는 셋뿐이다. 허락 없이 하면 위험할 때(위험 목록), 처음이라 승인받은 적 없을 때(PAM 계획),
// 기억한 「하지 마」와 반대일 때. 말로 시킨 가전 명령은 그 말이 승인이다. 답(이번만·앞으로도·하지 마)은 파일에 남는다.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { ApprovalStore, approvalChoices, approvalNeed, approvalsPath, remember, type ApprovalMemory } from "../src/agent/approval.js";
import { APPROVE } from "../src/act/prompts.js";

const EMPTY: ApprovalMemory = { always: {}, never: {} };
const need = (o: Partial<Parameters<typeof approvalNeed>[0]>) => approvalNeed({ key: "task:컵 치우기", risky: false, requested: false, memory: EMPTY, ...o });

describe("승인 규칙", () => {
  it("처음 하는 PAM 계획은 묻는다", () => expect(need({})).toEqual({ ask: "first", skip: false }));
  it("앞으로도를 받은 계획은 바로 한다", () => expect(need({ memory: remember(EMPTY, "task:컵 치우기", "always", "t") })).toEqual({ ask: null, skip: false }));
  it("이번만은 기억하지 않아 다음에 또 묻는다", () => expect(need({ memory: remember(EMPTY, "task:컵 치우기", "once", "t") })).toEqual({ ask: "first", skip: false }));
  it("하지 마를 기억한 계획은 하지 않는다", () => expect(need({ memory: remember(EMPTY, "task:컵 치우기", "never", "t") })).toEqual({ ask: null, skip: true }));
  it("말로 시킨 가전 명령은 바로 한다", () => expect(need({ key: "device:light_1:on", requested: true })).toEqual({ ask: null, skip: false }));
  it("말로 시켜도 하지 마를 기억한 일이면 묻는다", () => {
    expect(need({ key: "device:light_1:on", requested: true, memory: remember(EMPTY, "device:light_1:on", "never", "t") })).toEqual({ ask: "preference", skip: false });
  });
  it("위험 목록은 앞으로도를 받았어도 늘 묻는다", () => {
    expect(need({ key: "device:door_main:unlock", risky: true, requested: true, memory: remember(EMPTY, "device:door_main:unlock", "always", "t") })).toEqual({ ask: "risky", skip: false });
  });
  it("앞으로도는 하지 마 기억을 지우고, 하지 마는 앞으로도 기억을 지운다", () => {
    const a = remember(remember(EMPTY, "k", "never", "t1"), "k", "always", "t2");
    expect(a).toEqual({ always: { k: "t2" }, never: {} });
    expect(remember(a, "k", "never", "t3")).toEqual({ always: {}, never: { k: "t3" } });
  });
  it("기억은 파일에 남고 다시 열어도 같다", () => {
    const path = join(mkdtempSync(join(tmpdir(), "ap-")), "homes", "mokryeon_180b", "approvals.json");
    new ApprovalStore(path, () => "2026-11-09T00:00:00.000Z").answer("task:컵 치우기", "always");
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ always: { "task:컵 치우기": "2026-11-09T00:00:00.000Z" }, never: {} });
    expect(new ApprovalStore(path).memory().always).toHaveProperty("task:컵 치우기");
  });
  it("기억 파일 자리는 runtime/homes/<집>/approvals.json이고, 파일이 없거나 깨졌으면 빈 기억으로 시작한다", () => {
    const dir = mkdtempSync(join(tmpdir(), "ap-"));
    const path = approvalsPath(dir, "mokryeon_180b");
    expect(path).toBe(join(dir, "homes", "mokryeon_180b", "approvals.json"));
    expect(new ApprovalStore(path).memory()).toEqual(EMPTY);
    mkdirSync(dirname(path), { recursive: true });
    for (const broken of ["{", "[]", '{"always":{"k":1},"never":{}}', '{"always":[],"never":{}}']) {
      writeFileSync(path, broken);
      expect(new ApprovalStore(path).memory(), broken).toEqual(EMPTY);
    }
  });
  it("답은 이번만·앞으로도·하지 마 셋이고, 위험 목록은 이번만·하지 마 둘이다", () => {
    expect(APPROVE.map((c) => [c.id, c.label])).toEqual([["once", "이번만"], ["always", "앞으로도"], ["never", "하지 마"]]);
    expect(approvalChoices("first").map((c) => c.id)).toEqual(["once", "always", "never"]);
    expect(approvalChoices("preference").map((c) => c.id)).toEqual(["once", "always", "never"]);
    expect(approvalChoices("risky").map((c) => c.id)).toEqual(["once", "never"]);
  });
});
