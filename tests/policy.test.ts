import { describe, expect, it } from "vitest";
import { CONFIRM_RULES, Policy, RISKY_ON_NAMES, isRiskyKind, riskyNames } from "../src/agent/policy.js";
import { MemoryHub } from "../src/hub/memory.js";
import type { DeviceSpec } from "../src/hub/types.js";
import { describeDevice } from "../src/model/mapping.js";

const POWER = { power: ["off", "on"] };

function spec(id: string, label: string, twinType: string, twinAttrs: Record<string, unknown[]>): DeviceSpec {
  return { id, label, room: "r", roomLabel: "방", twinType, twinAttrs, ...describeDevice(twinType, twinAttrs)! };
}

const tv = spec("tv_living", "거실 TV", "tv", POWER);
const light = spec("light_living", "거실 천장등", "ceiling_light", POWER);
const lock = spec("door_main", "현관문", "door_main", { door: ["closed", "open"], lock: ["locked", "unlocked"] });
const cooktop = spec("induction_1", "인덕션", "induction_counter", POWER);
const microwave = spec("microwave_1", "전자레인지", "microwave", POWER);
const DEVICES = [tv, light, lock, cooktop, microwave];

function setup() {
  let now = 1_000_000;
  const policy = new Policy({ now: () => now });
  const hub = new MemoryHub(DEVICES);
  return { policy, hub, advance: (ms: number) => { now += ms; } };
}

describe("requiresConfirmation", () => {
  const policy = new Policy();
  it("현관 잠금 해제·인덕션 켜기·전자레인지 시작은 승인 필요", () => {
    expect(policy.requiresConfirmation(lock, { type: "unlock" })).toMatch(/현관문.*승인/);
    expect(policy.requiresConfirmation(cooktop, { type: "on" })).toMatch(/인덕션.*승인/);
    expect(policy.requiresConfirmation(microwave, { type: "start" })).toMatch(/전자레인지.*승인/);
    expect(policy.requiresConfirmation(microwave, { type: "on" })).toMatch(/전자레인지.*승인/);
  });
  it("나머지는 바로 실행", () => {
    expect(policy.requiresConfirmation(lock, { type: "lock" })).toBeNull();
    expect(policy.requiresConfirmation(cooktop, { type: "off" })).toBeNull();
    expect(policy.requiresConfirmation(microwave, { type: "stop" })).toBeNull();
    expect(policy.requiresConfirmation(microwave, { type: "off" })).toBeNull();
    expect(policy.requiresConfirmation(tv, { type: "on" })).toBeNull();
    expect(policy.requiresConfirmation(light, { type: "level", percent: 10 })).toBeNull();
  });
});

describe("위험 가전 이름 표", () => {
  it("이름 표의 가전 종류는 CONFIRM_RULES의 켜기·시작 대상과 같다", () => {
    expect(Object.keys(RISKY_ON_NAMES).sort()).toEqual(CONFIRM_RULES.filter((r) => r.command === "on" || r.command === "start").map((r) => r.kind).sort());
    expect(["cooktop", "microwave"].every(isRiskyKind)).toBe(true);
    expect(isRiskyKind("aircon")).toBe(false);
  });
  it("글에 나오는 위험 가전 종류만 본다(켜는 말·끄는 말을 가르지 않는다. 자리마다는 tests/phone-lines.test.ts)", () => {
    expect(riskyNames("인덕션을 꺼 주세요")).toEqual(["cooktop"]);
    expect(riskyNames("가스레인지와 전자레인지")).toEqual(["cooktop", "microwave"]);
    expect(riskyNames("거실 불 켜 줘")).toEqual([]);
  });
  it("별명·흔한 오타·영어·띄어 쓴 이름도 찾는다. 긴 이름부터 맞춰 가스레인지는 인덕션 종류로만 보고, 위험 가전이 아닌 이름(레인지후드)과 다른 낱말(오렌지)은 아니다", () => {
    for (const t of ["인덕선 켜 드릴까요", "가스렌지 불", "전기렌지", "쿡톱", "하이라이트", "인덕 션을 켜요", "Induction 켜기", "가스 레인지"]) expect(riskyNames(t), t).toEqual(["cooktop"]);
    for (const t of ["전자렌지 돌려 주세요", "레인지에 데워 주세요", "전자 레인지", "Microwave 켜기"]) expect(riskyNames(t), t).toEqual(["microwave"]);
    for (const t of ["레인지후드를 켰어요", "오렌지 주스", "대화 구조", "버 너무 많아요"]) expect(riskyNames(t), t).toEqual([]);
    expect(riskyNames("가스레인지 옆 레인지")).toEqual(["cooktop", "microwave"]);
  });
});

describe("승인 토큰", () => {
  it("issue → consume는 한 번만", () => {
    const { policy } = setup();
    const p = policy.issue("door_main", { type: "unlock" }, "이유");
    expect(p.token).toMatch(/\S{8,}/);
    expect(policy.pending().map((x) => x.token)).toEqual([p.token]);
    expect(policy.consume(p.token)).toMatchObject({ deviceId: "door_main", command: { type: "unlock" }, reason: "이유" });
    expect(policy.consume(p.token)).toBeUndefined();
    expect(policy.consume("없는토큰")).toBeUndefined();
  });

  it("토큰마다 다르다", () => {
    const { policy } = setup();
    const a = policy.issue("door_main", { type: "unlock" }, "r");
    const b = policy.issue("door_main", { type: "unlock" }, "r");
    expect(a.token).not.toBe(b.token);
  });

  it("5분이 지나면 만료된다", () => {
    const { policy, advance } = setup();
    const p = policy.issue("door_main", { type: "unlock" }, "r");
    advance(5 * 60 * 1000 - 1);
    expect(policy.pending()).toHaveLength(1);
    advance(2);
    expect(policy.pending()).toHaveLength(0);
    expect(policy.consume(p.token)).toBeUndefined();
  });
});

describe("guard", () => {
  it("승인이 필요 없는 명령은 바로 실행", async () => {
    const { policy, hub } = setup();
    const r = await policy.guard(hub, "tv_living", { type: "on" });
    expect(r.ok).toBe(true);
    expect(hub.get("tv_living")!.twin.power).toBe("on");
  });

  it("현관문 열기: 승인 요청 → 토큰으로 실행 → 토큰 재사용 불가", async () => {
    const { policy, hub } = setup();
    const first = await policy.guard(hub, "door_main", { type: "unlock" });
    expect(first.ok).toBe(false);
    expect(first.needsConfirmation).toBeDefined();
    expect(first.needsConfirmation!.reason).toMatch(/승인/);
    expect(hub.get("door_main")!.twin.lock).toBe("locked");

    const token = first.needsConfirmation!.token;
    const second = await policy.guard(hub, "door_main", { type: "unlock" }, token);
    expect(second.ok).toBe(true);
    expect(second.state!.twin.lock).toBe("unlocked");

    await hub.command("door_main", { type: "lock" });
    const again = await policy.guard(hub, "door_main", { type: "unlock" }, token);
    expect(again.ok).toBe(false);
    expect(again.needsConfirmation!.token).not.toBe(token);
    expect(hub.get("door_main")!.twin.lock).toBe("locked");
  });

  it("전자레인지 on으로 받은 토큰은 start에도 맞는다(별칭 정규화)", async () => {
    const { policy, hub } = setup();
    const ask = await policy.guard(hub, "microwave_1", { type: "on" });
    const r = await policy.guard(hub, "microwave_1", { type: "start" }, ask.needsConfirmation!.token);
    expect(r.ok).toBe(true);
    expect(hub.get("microwave_1")!.twin.power).toBe("on");
  });

  it("다른 기기·명령의 토큰으로는 실행하지 않고, 원래 토큰은 살아 있다", async () => {
    const { policy, hub } = setup();
    const doorAsk = await policy.guard(hub, "door_main", { type: "unlock" });
    const token = doorAsk.needsConfirmation!.token;
    const wrong = await policy.guard(hub, "induction_1", { type: "on" }, token);
    expect(wrong.ok).toBe(false);
    expect(wrong.error).toMatch(/맞지 않습니다/);
    expect(wrong.needsConfirmation).toBeDefined();
    expect(hub.get("induction_1")!.twin.power).toBe("off");
    const ok = await policy.guard(hub, "door_main", { type: "unlock" }, token);
    expect(ok.ok).toBe(true);
  });

  it("만료된 토큰은 새 승인을 요청한다", async () => {
    const { policy, hub, advance } = setup();
    const ask = await policy.guard(hub, "induction_1", { type: "on" });
    advance(5 * 60 * 1000 + 1);
    const r = await policy.guard(hub, "induction_1", { type: "on" }, ask.needsConfirmation!.token);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/만료/);
    expect(r.needsConfirmation!.token).not.toBe(ask.needsConfirmation!.token);
    expect(hub.get("induction_1")!.twin.power).toBe("off");
  });

  it("실행할 수 없는 명령은 승인을 묻지 않고 오류", async () => {
    const { policy, hub } = setup();
    const r = await policy.guard(hub, "induction_1", { type: "level", percent: 50 });
    expect(r.ok).toBe(false);
    expect(r.needsConfirmation).toBeUndefined();
    expect(r.error).toMatch(/지원하지 않는/);
    expect(policy.pending()).toHaveLength(0);
  });

  it("없는 기기", async () => {
    const { policy, hub } = setup();
    const r = await policy.guard(hub, "ghost", { type: "on" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/찾을 수 없습니다/);
  });
});

describe("confirm(token)", () => {
  it("토큰만으로 대기 중인 명령을 실행한다(한 번만)", async () => {
    const { policy, hub } = setup();
    const ask = await policy.guard(hub, "induction_1", { type: "on" });
    const r = await policy.confirm(hub, ask.needsConfirmation!.token);
    expect(r.ok).toBe(true);
    expect(hub.get("induction_1")!.twin.power).toBe("on");
    const again = await policy.confirm(hub, ask.needsConfirmation!.token);
    expect(again.ok).toBe(false);
    expect(again.error).toMatch(/없거나 만료/);
  });
});
