// 가전 종류 등록부의 결과가 바뀌는 부분(Task 11r-2): 승인 판정(needsConfirm), ThinQ 어댑터, 등록부 검증(checkKinds).
// 승인 차이표: 바꾸기 전 승인 표(tests/fixtures/kinds-before.json)와 견줘 좁아진 칸이 없고, 넓어진 칸은 위험 켜기 종류의 끄기 아닌 명령뿐이다.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Capability, Command, DeviceSpec } from "../src/hub/types.js";
import { KINDS, isRiskyKind, type KindEntry } from "../src/model/kinds.js";
import { checkKinds } from "../src/model/kinds-check.js";
import { KIND_PROFILES, TYPE_RULES, normalizeCommand } from "../src/model/mapping.js";
import { riskyHand } from "../src/agent/planTools.js";
import { Policy, needsConfirm } from "../src/agent/policy.js";
import { THINQ_ADAPTERS, mirrorPlan, readAppliance, thinqSteps } from "../src/thinq/appliance.js";

const ROOT = join(import.meta.dirname, "..");
type Cell = { command: Command; reason: string | null };
const before = JSON.parse(readFileSync(join(ROOT, "tests", "fixtures", "kinds-before.json"), "utf8")) as {
  approval: { table: Record<string, { from: string; results: Cell[] }[]> };
};
type Kind = DeviceSpec["kind"];

/** 승인 표의 사양: profile이면 등록부 프로필, 그 밖이면 그 twin type 줄이 덮어쓴 capabilities. */
function capsOf(kind: Kind, from: string): readonly Capability[] {
  if (from === "profile") return KIND_PROFILES[kind].capabilities;
  const rule = TYPE_RULES.find((r) => r.kind === kind && (r.types ?? r.prefixes ?? []).join(",") === from);
  if (!rule?.capabilities) throw new Error(`승인 표 사양을 찾지 못했어요: ${kind} ${from}`);
  return rule.capabilities;
}

describe("approval diff: only widened, never narrowed", () => {
  it("전에 승인이던 칸은 모두 지금도 승인이고, 새로 승인이 된 칸은 위험 켜기 종류(riskyOn)의 끄기 아닌 명령뿐이다", () => {
    const narrowed: string[] = [];
    const widened: string[] = [];
    const bad: string[] = [];
    for (const [kind, specs] of Object.entries(before.approval.table) as [Kind, { from: string; results: Cell[] }[]][]) {
      for (const spec of specs) {
        const caps = [...capsOf(kind, spec.from)];
        for (const cell of spec.results) {
          const was = cell.reason !== null;
          const now = needsConfirm({ kind, capabilities: caps }, cell.command);
          const name = `${kind} [${spec.from}] ${JSON.stringify(cell.command)}`;
          if (was && !now) narrowed.push(name);
          if (!was && now) {
            widened.push(name);
            const c = normalizeCommand({ capabilities: caps }, cell.command);
            if (!isRiskyKind(kind) || c.type === "off" || c.type === "stop") bad.push(name);
          }
        }
      }
    }
    console.info(`승인 차이표: 넓어진 칸 ${widened.length}개\n${widened.join("\n")}`);
    expect(narrowed, "좁아진 칸").toEqual([]);
    expect(bad, "위험 켜기 종류의 끄기 아닌 명령이 아닌데 넓어진 칸").toEqual([]);
  });
});

describe("승인 대상(needsConfirm 하나로 판정)", () => {
  const policy = new Policy();
  const mw = { kind: "microwave" as Kind, label: "전자레인지", capabilities: ["onoff", "operation"] as Capability[] };

  it("twin type이 capabilities를 [onoff, operation]으로 덮은 전자레인지에 on을 보내도 승인 질문이 나온다(이름이 start로 정규화되지 않아도)", () => {
    expect(normalizeCommand(mw, { type: "on" }).type).toBe("on");
    expect(needsConfirm(mw, { type: "on" })).toBe(true);
    expect(policy.requiresConfirmation(mw, { type: "on" })).toBe("전자레인지 시작은 사용자 승인이 필요합니다.");
  });

  it("같은 기기의 start·level 같은 다른 바꾸기 명령도 승인, off·stop은 승인 없이 간다", () => {
    expect(needsConfirm(mw, { type: "start" })).toBe(true);
    expect(needsConfirm(mw, { type: "level", percent: 30 })).toBe(true);
    expect(needsConfirm(mw, { type: "off" })).toBe(false);
    expect(needsConfirm(mw, { type: "stop" })).toBe(false);
  });

  it("cooktop on은 승인, lock unlock은 승인이고 lock은 승인 없음, 위험 종류가 아닌 에어컨 on은 승인 없음", () => {
    expect(policy.requiresConfirmation({ kind: "cooktop", label: "인덕션", capabilities: ["onoff"] }, { type: "on" })).toBe("인덕션 켜기는 화재 위험이 있어 사용자 승인이 필요합니다.");
    expect(policy.requiresConfirmation({ kind: "lock", label: "현관문", capabilities: ["lock"] }, { type: "unlock" })).toBe("현관문 잠금 해제는 사용자 승인이 필요합니다.");
    expect(needsConfirm({ kind: "lock", capabilities: ["lock"] }, { type: "lock" })).toBe(false);
    expect(needsConfirm({ kind: "aircon", capabilities: ["onoff", "climate", "fan"] }, { type: "on" })).toBe(false);
  });

  it("실행 추적의 손 조작 켜기 질문도 같은 판정으로 나온다(덮은 capabilities 포함)", () => {
    const step = { hand: { deviceId: "mw_1", to: "on" as const } };
    expect(riskyHand(step, [{ id: "mw_1", kind: "microwave", capabilities: ["onoff", "operation"] }])).toBe(true);
    expect(riskyHand(step, [{ id: "mw_1", kind: "aircon" }])).toBe(false);
    expect(riskyHand({ hand: { deviceId: "mw_1", to: "off" } }, [{ id: "mw_1", kind: "microwave" }])).toBe(false);
  });
});

describe("ThinQ 어댑터", () => {
  afterEach(() => {
    vi.doUnmock("../src/model/kinds.js");
    vi.resetModules();
  });
  /** 시험 전용으로 등록부를 넓힌 모듈 묶음을 새로 불러온다. */
  async function extended(extra: Record<string, KindEntry>) {
    vi.resetModules();
    vi.doMock("../src/model/kinds.js", async (importOriginal) => {
      const real = await importOriginal<typeof import("../src/model/kinds.js")>();
      const kinds = { ...real.KINDS, ...extra };
      return { ...real, KINDS: kinds, KIND_ORDER: Object.keys(kinds), kindEntry: (k: string | null | undefined) => (k ? (kinds as Record<string, KindEntry>)[k] : undefined) };
    });
    const { MemoryHub: Hub } = await import("../src/hub/memory.js");
    const { ThinqLink } = await import("../src/thinq/link.js");
    return { Hub, ThinqLink };
  }
  const spec = (id: string, kind: string, twinAttrs: Record<string, unknown[]>, capabilities: Capability[], sensors: string[] = []): DeviceSpec => ({
    id, label: "시험 가전", room: "living", roomLabel: "거실", twinType: `${kind}_box`, kind: kind as Kind, matterDeviceType: "none", capabilities, sensors, twinAttrs,
  });

  it("시험 전용 새 종류(refrigerator 어댑터, 문 센서 프로필)를 짝지어 ThinQ 원본 값을 읽으면 어댑터 read → mirror를 거쳐 트윈 문 센서가 바뀐다", async () => {
    const { Hub, ThinqLink } = await extended({
      test_cooler: { label: "시험 냉장고", synonyms: [], profile: KINDS.fridge.profile, twinTypes: [{ types: ["test_cooler_box"] }], thinq: { type: /COOLER/i, adapter: "refrigerator" } },
    });
    const world = Hub.fromTwin({ devices: [spec("cooler_1", "test_cooler", { door: ["closed", "open"] }, [], ["door"])], initial: { cooler_1: { door: "closed" } } });
    const link = new ThinqLink({ client: { state: async () => ({ doorStatus: [{ locationName: "MAIN", doorState: "OPEN" }] }), control: async () => ({}) }, world, pairs: { cooler_1: "X" }, pollMs: 0 });
    await link.refresh("cooler_1");
    expect(world.get("cooler_1")!.twin.door).toBe("open");
  });

  it("air_conditioner 어댑터로 짝지은 시험 전용 새 종류가 climate 명령을 ThinQ 단계로 바꾸고, 읽은 전원·모드가 트윈에 비친다", async () => {
    const { Hub, ThinqLink } = await extended({
      test_ac: { label: "시험 에어컨", synonyms: [], profile: KINDS.aircon.profile, twinTypes: [{ types: ["test_ac_box"] }], thinq: { type: /COOLING/i, adapter: "air_conditioner" } },
    });
    const world = Hub.fromTwin({ devices: [spec("ac_1", "test_ac", { power: ["off", "on"] }, ["onoff", "climate", "fan"])], initial: { ac_1: { power: "off" } } });
    const sent: Record<string, unknown>[] = [];
    let raw: Record<string, unknown> = { operation: { airConOperationMode: "POWER_OFF" }, airConJobMode: { currentJobMode: "COOL" } };
    const link = new ThinqLink({
      client: { state: async () => raw, control: async (_id: string, body: Record<string, unknown>) => { sent.push(body); raw = { operation: { airConOperationMode: "POWER_ON" }, airConJobMode: { currentJobMode: "HEAT" } }; return {}; } },
      world, pairs: { ac_1: "X" }, pollMs: 0, readbackMs: [0],
    });
    await link.refresh("ac_1");
    expect(world.get("ac_1")!.twin.power).toBe("off");
    await link.command("ac_1", { type: "climate", mode: "heat" });
    expect(sent[0]).toEqual({ operation: { airConOperationMode: "POWER_ON" } });
    expect(world.get("ac_1")!.twin.power).toBe("on");
    expect(world.get("ac_1")!.matter.systemMode).toBe("heat");
  });

  it("readAppliance·thinqSteps·mirrorPlan은 종류 이름이 아니라 어댑터 이름을 받는다", () => {
    expect(readAppliance("refrigerator", { doorStatus: { doorState: "OPEN" } })).toEqual({ door: "open" });
    expect(thinqSteps("refrigerator", { type: "on" })).toBeNull();
    expect(thinqSteps("air_conditioner", { type: "on" })?.map((s) => s.name)).toEqual(["전원 켜기"]);
    expect(mirrorPlan("refrigerator", { door: "open" }, { twin: { door: "closed" }, matter: {} })).toEqual({ commands: [], sensors: [["door", "open"]] });
    expect(THINQ_ADAPTERS.refrigerator.commands).toEqual([]);
    // 타입 검사만(부르지 않는다): 종류 이름은 받지 않는다
    const typeOnly = () => {
      // @ts-expect-error 종류 이름(aircon)은 어댑터 이름이 아니다
      readAppliance("aircon", {});
    };
    expect(typeOnly).toBeTypeOf("function");
  });
});

describe("등록부 검증(checkKinds)", () => {
  const with_ = (k: string, e: Partial<KindEntry>) => ({ ...KINDS, [k]: { ...(KINDS as Record<string, KindEntry>)[k]!, ...e } });

  it("지금 21종 등록부는 까닭 없음, lock의 confirm unlock은 통과", () => {
    expect(checkKinds(KINDS)).toEqual([]);
  });

  it("operation 종류에 confirm.command on(정규화로 이름이 바뀜)이면 거절", () => {
    expect(checkKinds(with_("dishwasher", { confirm: { command: "on", reason: (l) => l } })).join("\n")).toMatch(/dishwasher.*confirm on.*start/);
  });

  it("riskyOn 종류에 confirm을 두면 거절(riskyReason을 쓴다)", () => {
    expect(checkKinds(with_("cooktop", { confirm: { command: "on", reason: (l) => l } })).join("\n")).toMatch(/cooktop.*riskyReason/);
    expect(checkKinds(with_("cooktop", { riskyReason: undefined })).join("\n")).toMatch(/cooktop.*riskyReason/);
  });

  it("operation 프로필에 air_conditioner 어댑터를 붙이면 「start를 받지 않는다」로 거절하고, twinTypes가 operation을 더한 사양도 본다", () => {
    expect(checkKinds(with_("dishwasher", { thinq: { type: /X/, adapter: "air_conditioner" } })).join("\n")).toMatch(/ThinQ 어댑터 air_conditioner는 start를 받지 않는다/);
    const overridden = with_("aircon", { twinTypes: [...KINDS.aircon.twinTypes, { types: ["test_ac_washer"], capabilities: ["operation"] }] });
    expect(checkKinds(overridden).join("\n")).toMatch(/aircon.*ThinQ 어댑터 air_conditioner는 start를 받지 않는다/);
  });

  it("설정값이 필요한 confirm 명령(climate)은 프로필에서 만든 유효한 표본으로 본다: 에어컨형 프로필에 confirm climate면 통과", () => {
    expect(checkKinds(with_("aircon", { confirm: { command: "climate", reason: (l) => l } }))).toEqual([]);
    expect(checkKinds(with_("thermostat", { confirm: { command: "climate", reason: (l) => l } }))).toEqual([]);
  });

  it("설정 온도 표본은 반올림하지 않은 범위 가운데라 좁은 범위(37.2~37.4)에서도 범위 안이다", async () => {
    vi.resetModules();
    vi.doMock("../src/model/kinds.js", async (importOriginal) => {
      const real = await importOriginal<typeof import("../src/model/kinds.js")>();
      const aircon = { ...real.KINDS.aircon, profile: { ...real.KINDS.aircon.profile, setpoint: { min: 37.2, max: 37.4 } }, confirm: { command: "climate" as const, reason: (l: string) => l } };
      return { ...real, KINDS: { ...real.KINDS, aircon } };
    });
    try {
      const { KINDS: mocked } = await import("../src/model/kinds.js");
      const { checkKinds: check } = await import("../src/model/kinds-check.js");
      expect(check(mocked)).toEqual([]);
    } finally {
      vi.doUnmock("../src/model/kinds.js");
      vi.resetModules();
    }
  });

  it("onoff와 operation이 함께 있는 사양도 start·stop·pause를 낼 수 있다: 거기에 air_conditioner 어댑터면 「start를 받지 않는다」로 거절", () => {
    const both = with_("aircon", { twinTypes: [...KINDS.aircon.twinTypes, { types: ["test_ac_runner"], capabilities: ["onoff", "operation", "climate"] }] });
    const why = checkKinds(both).join(" / ");
    expect(why).toMatch(/aircon.*ThinQ 어댑터 air_conditioner는 start를 받지 않는다/);
    expect(why).toMatch(/air_conditioner는 pause를 받지 않는다/);
  });

  it("제어가 있는 프로필에 refrigerator 어댑터(읽기만)를 붙이면 거절", () => {
    expect(checkKinds(with_("dryer", { thinq: { type: /X/, adapter: "refrigerator" } })).join("\n")).toMatch(/dryer.*refrigerator/);
  });

  it("손 조작: 켜기·끄기는 제어가 있을 때만, 열기·닫기는 문 센서나 열림을 보는 카메라 설비가 있을 때만", () => {
    expect(checkKinds(with_("contact", { hand: ["켜기"] })).join("\n")).toMatch(/contact.*켜기/);
    expect(checkKinds(with_("tv", { hand: ["열기"] })).join("\n")).toMatch(/tv.*열기/);
  });

  it("서버 시작이 틀린 등록부에서 까닭과 함께 멈춘다", async () => {
    vi.resetModules();
    vi.doMock("../src/model/kinds.js", async (importOriginal) => {
      const real = await importOriginal<typeof import("../src/model/kinds.js")>();
      return { ...real, KINDS: { ...real.KINDS, dishwasher: { ...real.KINDS.dishwasher, confirm: { command: "on", reason: (l: string) => l } } } };
    });
    try {
      const { startServer } = await import("../src/server/start.js");
      await expect(startServer({ env: { HUB: "memory", PORT: "0", RUNTIME_DIR: join(ROOT, "runtime", "never-used"), REFLECT_AT: "off" }, log: () => {} }))
        .rejects.toThrow(/가전 종류 등록부.*dishwasher.*confirm on/);
    } finally {
      vi.doUnmock("../src/model/kinds.js");
      vi.resetModules();
    }
  });
});
