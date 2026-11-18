// 승인 규칙(src/agent/approval.ts): 묻는 때는 허락 없이 하면 위험할 때(위험 목록)뿐이다. 처음 하는 일 묻기는 한 곳의 설정값 ASK_FIRST_TIME이고
// 2026-11-18 사용자 결정으로 끔이다(그 길은 askFirst로 켜서 본다). 말로 시킨 가전 명령은 그 말이 승인이다.
// 답은 승인·거절 둘: 승인은 파일에 남아 다음부터 묻지 않고, 거절은 남기지 않아 다음에 또 묻는다.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { ASK_FIRST_TIME, ApprovalStore, approvalNeed, approvalsPath, remember, type ApprovalMemory } from "../src/agent/approval.js";
import { APPROVE } from "../src/act/prompts.js";

const EMPTY: ApprovalMemory = { always: {} };
/** 처음 하는 일 묻기를 켠 판단(나중에 다시 켤 때의 길). */
const need = (o: Partial<Parameters<typeof approvalNeed>[0]>) => approvalNeed({ key: "task:컵 치우기", risky: false, requested: false, memory: EMPTY, askFirst: true, ...o });

describe("승인 규칙: 기본(처음 하는 일 묻기 끔, 2026-11-18 사용자 결정)", () => {
  const plain = (o: Partial<Parameters<typeof approvalNeed>[0]>) => approvalNeed({ key: "task:컵 치우기", risky: false, requested: false, memory: EMPTY, ...o });
  it("처음 하는 일 묻기는 한 곳의 설정값이고 기본은 끔이다: 처음 하는 PAM 계획도 묻지 않고 바로 한다", () => {
    expect(ASK_FIRST_TIME).toBe(false);
    expect(plain({})).toBeNull();
    expect(plain({ key: "task:세탁물 건조기로 옮기기" })).toBeNull();
  });
  it("위험 목록은 안전 규칙이라 그대로 늘 묻는다(승인한 적이 있어도). 말로 시킨 가전 명령은 바로 한다", () => {
    expect(plain({ key: "device:door_main:unlock", risky: true, requested: true })).toBe("risky");
    expect(plain({ key: "device:door_main:unlock", risky: true, requested: true, memory: remember(EMPTY, "device:door_main:unlock", "approve", "t") })).toBe("risky");
    expect(plain({ key: "device:light_1:on", requested: true })).toBeNull();
  });
});

describe("승인 규칙: 처음 하는 일 묻기를 켰을 때(askFirst)", () => {
  it("처음 하는 PAM 계획은 묻는다", () => expect(need({})).toBe("first"));
  it("승인을 받은 계획은 다음부터 바로 한다", () => expect(need({ memory: remember(EMPTY, "task:컵 치우기", "approve", "t") })).toBeNull());
  it("거절은 기억하지 않아 다음에 또 묻는다", () => {
    expect(remember(EMPTY, "task:컵 치우기", "reject", "t")).toEqual(EMPTY);
    expect(need({ memory: remember(EMPTY, "task:컵 치우기", "reject", "t") })).toBe("first");
  });
  it("승인을 받은 뒤 거절해도 승인 기억은 그대로다", () => {
    const m = remember(EMPTY, "k", "approve", "t1");
    expect(remember(m, "k", "reject", "t2")).toEqual({ always: { k: "t1" } });
  });
  it("말로 시킨 가전 명령은 바로 한다", () => expect(need({ key: "device:light_1:on", requested: true })).toBeNull());
  it("위험 목록은 승인을 받았어도 늘 묻는다", () => {
    expect(need({ key: "device:door_main:unlock", risky: true, requested: true, memory: remember(EMPTY, "device:door_main:unlock", "approve", "t") })).toBe("risky");
    expect(need({ key: "device:door_main:unlock", risky: true, requested: true })).toBe("risky");
  });
  it("기억은 파일에 남고 다시 열어도 같다. 거절은 파일을 쓰지 않는다", () => {
    const path = join(mkdtempSync(join(tmpdir(), "ap-")), "homes", "mokryeon_180b", "approvals.json");
    const store = new ApprovalStore(path, () => "2026-11-09T00:00:00.000Z");
    store.answer("task:사용자에게 물어보기", "reject");
    expect(() => readFileSync(path)).toThrow();
    store.answer("task:컵 치우기", "approve");
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ always: { "task:컵 치우기": "2026-11-09T00:00:00.000Z" } });
    expect(new ApprovalStore(path).memory()).toEqual({ always: { "task:컵 치우기": "2026-11-09T00:00:00.000Z" } });
  });
  it("예전 파일의 「하지 마」(never) 기억은 버리고 다시 묻는다. 예전 「앞으로도」(always)는 승인으로 남는다", () => {
    const path = join(mkdtempSync(join(tmpdir(), "ap-")), "approvals.json");
    writeFileSync(path, JSON.stringify({ always: { "task:컵 치우기": "t1" }, never: { "task:사용자에게 물어보기": "t2", "device:light_living:on": "t3" } }));
    const store = new ApprovalStore(path, () => "t4");
    expect(store.memory()).toEqual({ always: { "task:컵 치우기": "t1" } });
    expect(need({ key: "task:사용자에게 물어보기", memory: store.memory() })).toBe("first");
    expect(need({ key: "device:light_living:on", requested: true, memory: store.memory() })).toBeNull();
    expect(need({ memory: store.memory() })).toBeNull();
    store.answer("task:x", "approve");
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ always: { "task:컵 치우기": "t1", "task:x": "t4" } });
  });
  it("기억 파일 자리는 runtime/homes/<집>/approvals.json이고, 파일이 없거나 깨졌으면 빈 기억으로 시작한다", () => {
    const dir = mkdtempSync(join(tmpdir(), "ap-"));
    const path = approvalsPath(dir, "mokryeon_180b");
    expect(path).toBe(join(dir, "homes", "mokryeon_180b", "approvals.json"));
    expect(new ApprovalStore(path).memory()).toEqual(EMPTY);
    mkdirSync(dirname(path), { recursive: true });
    for (const broken of ["{", "[]", "{}", '{"always":{"k":1}}', '{"always":[],"never":{}}']) {
      writeFileSync(path, broken);
      expect(new ApprovalStore(path).memory(), broken).toEqual(EMPTY);
    }
  });
  it("답은 승인·거절 둘이다", () => {
    expect(APPROVE.map((c) => [c.id, c.label])).toEqual([["approve", "승인"], ["reject", "거절"]]);
  });
});
