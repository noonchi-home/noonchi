// 승인 규칙(src/agent/approval.ts): 묻는 때는 허락 없이 하면 위험할 때(위험 목록)뿐이다. 처음 하는 일 묻기는 한 곳의 설정값 ASK_FIRST_TIME이고
// 2026-11-18 사용자 결정으로 끔이다(그 길은 askFirst로 켜서 본다). 말로 시킨 가전 명령은 그 말이 승인이다.
// 답은 승인·거절 둘: 승인은 파일에 남아 다음부터 묻지 않고, 거절은 남기지 않아 다음에 또 묻는다.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { platform, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ASK_FIRST_TIME, ApprovalStore, approvalNeed, approvalsPath, remember, type ApprovalMemory } from "../src/agent/approval.js";
import { APPROVE } from "../src/act/prompts.js";

vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return { ...fs, renameSync: vi.fn(fs.renameSync), readFileSync: vi.fn(fs.readFileSync) };
});
vi.mock("node:os", async (original) => {
  const os = await original<typeof import("node:os")>();
  return { ...os, platform: vi.fn(os.platform) };
});
afterEach(() => {
  vi.mocked(renameSync).mockReset();
  vi.mocked(readFileSync).mockReset();
  vi.mocked(platform).mockReset();
});

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

describe("파일 승인 기억의 원자적 교체", () => {
  const previous = { always: { "task:old": "t1" } };
  const committed = { always: { "task:old": "t1", "task:new": "t2" } };
  const sharingViolation = () => Object.assign(new Error("Windows sharing violation"), { code: "EPERM" });
  const saved = () => {
    const dir = mkdtempSync(join(tmpdir(), "ap-replace-"));
    const path = join(dir, "approvals.json");
    writeFileSync(path, JSON.stringify(previous));
    vi.mocked(platform).mockReturnValue("win32");
    return { dir, path, store: new ApprovalStore(path, () => "t2") };
  };
  const fromDisk = (path: string) => JSON.parse(readFileSync(path, "utf8")) as ApprovalMemory;

  it("Windows에서 교체 공유 위반이 잠깐이면 같은 임시 파일로 다시 시도한다", () => {
    const { dir, path, store } = saved();
    vi.mocked(renameSync).mockImplementationOnce((source, dest) => {
      expect(dirname(String(source))).toBe(dir);
      expect(dest).toBe(path);
      expect(fromDisk(String(source))).toEqual(committed);
      expect(fromDisk(path)).toEqual(previous);
      expect(store.memory()).toEqual(previous);
      throw sharingViolation();
    });

    store.answer("task:new", "approve");
    const { calls } = vi.mocked(renameSync).mock;
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(calls[1]);
    expect(fromDisk(path)).toEqual(committed);
    expect(store.memory()).toEqual(committed);
    expect(readdirSync(dir)).toEqual(["approvals.json"]);
  });

  it("공유 위반이 계속되면 실패를 돌려주고 이전 기억을 보존한다. 같은 승인으로 다시 시도할 수 있다", () => {
    const { dir, path, store } = saved();
    const error = sharingViolation();
    vi.mocked(renameSync).mockImplementation(() => { throw error; });

    expect(() => store.answer("task:new", "approve")).toThrow(error);
    expect(store.memory()).toEqual(previous);
    expect(fromDisk(path)).toEqual(previous);
    expect(vi.mocked(renameSync)).toHaveBeenCalledTimes(4);
    expect(readdirSync(dir)).toEqual(["approvals.json"]);
    expect(need({ key: "task:new", memory: store.memory() })).toBe("first");

    vi.mocked(renameSync).mockReset();
    store.answer("task:new", "approve");
    expect(fromDisk(path)).toEqual(committed);
    expect(store.memory()).toEqual(committed);
  });

  it("같은 파일을 미리 연 두 승인 객체가 차례로 쓸 때 각 승인만 더하고 남은 임시 파일을 건드리지 않는다", () => {
    const { dir, path, store } = saved();
    const other = new ApprovalStore(path, () => "t3");
    const stale = `${path}.${process.pid}.tmp`;
    writeFileSync(stale, JSON.stringify({ always: { "task:unsolicited": "t0" } }));

    store.answer("task:new", "approve");
    other.answer("task:never", "reject");
    other.answer("task:other", "approve");
    expect(other.memory()).toEqual({ always: { ...committed.always, "task:other": "t3" } });
    expect(fromDisk(path)).toEqual(other.memory());
    expect(fromDisk(stale)).toEqual({ always: { "task:unsolicited": "t0" } });
    expect(readdirSync(dir).sort()).toEqual([`approvals.json.${process.pid}.tmp`, "approvals.json"].sort());
    const [first, second] = vi.mocked(renameSync).mock.calls;
    expect(first?.[0]).not.toBe(second?.[0]);
  });

  it("기존 파일을 읽을 권한이 없으면 저장을 멈추고 이전 파일과 기억을 보존한다", () => {
    const { dir, path, store } = saved();
    const error = Object.assign(new Error("Access denied"), { code: "EACCES" });
    vi.mocked(readFileSync).mockImplementationOnce(() => { throw error; });
    expect(() => store.answer("task:new", "approve")).toThrow(error);
    expect(vi.mocked(renameSync)).not.toHaveBeenCalled();
    expect(store.memory()).toEqual(previous);
    expect(fromDisk(path)).toEqual(previous);
    expect(readdirSync(dir)).toEqual(["approvals.json"]);
  });
});
