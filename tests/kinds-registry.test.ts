// 가전 종류 등록부(src/devices/kinds.ts): 흩어진 종류별 표를 등록부에서 파생한다. 결과는 바꾸기 전과 하나도 다르지 않다(tests/fixtures/kinds-before.json),
// 등록부 밖에 종류별 표가 생기면 구조 검사(tests/helpers/kind-tables.ts)가 실패한다.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { kindsSnapshot } from "../scripts/kinds-snapshot.js";
import { KIND_TABLE_WHY, TEMP_ALLOW, findAllKindTables, findKindTables, openKindProject, type KindProject } from "./helpers/kind-tables.js";

const ROOT = join(import.meta.dirname, "..");
const before = JSON.parse(readFileSync(join(ROOT, "tests", "fixtures", "kinds-before.json"), "utf8")) as ReturnType<typeof kindsSnapshot>;
const now = () => JSON.parse(JSON.stringify(kindsSnapshot())) as ReturnType<typeof kindsSnapshot>;

describe("kinds same: non-approval", () => {
  it("등록부 순서가 바꾸기 전 종류 순서(DeviceKind, 도구 enum 순서)와 같다", async () => {
    const { KIND_ORDER } = await import("../src/devices/kinds.js");
    expect(KIND_ORDER).toEqual(Object.keys(before.labels));
  });

  it("라벨·Matter 프로필·트윈 type·별명·위험 이름·안전 문구·손 조작·ThinQ·사건·상태 글·카메라·twinChange가 바꾸기 전과 같다(Task 11a가 더한 명시 꺼짐 값만 빼고)", () => {
    const { approval: _now, ...rest } = now();
    const { approval: _was, ...was } = before;
    // Task 11a: 카메라 규칙에 명시 꺼짐 값(not_in_use → off)을 더했다. 그 값만 빼고 나머지는 완전 일치다
    const sight = rest.camera.sight as unknown as Record<string, { values: Record<string, unknown> }[]>;
    expect(sight.microwave!.find((r) => "in_use" in r.values)!.values.not_in_use).toBe("off");
    for (const rules of Object.values(sight)) for (const r of rules) delete r.values.not_in_use;
    expect(rest).toEqual(was);
  });
});

// 승인 규칙·승인 표는 Task 11r-2에서 넓어졌다(위험 켜기 종류는 끄기 말고 전부): 좁아지지 않았는지는 tests/kinds-behavior.test.ts 「approval diff」가 본다

describe("kinds registry: TEMP_ALLOW is empty", () => {
  it("잠시 허용 목록이 비어 있다", () => {
    expect(TEMP_ALLOW, "ThinQ 갈래를 어댑터로 옮기고 TEMP_ALLOW를 비운다").toEqual([]);
  });
});

describe("kinds registry: 파생", () => {
  it("이름·위험 종류·카메라 설비 → 종류를 등록부에서 읽는다", async () => {
    const { KINDS, kindLabel, isRiskyKind, cameraKindOf, kindEntry } = await import("../src/devices/kinds.js");
    expect(kindLabel("microwave")).toBe("전자레인지");
    expect(KINDS.microwave).toMatchObject({ twinTypes: [{ types: ["microwave"] }], hand: ["열기", "닫기", "켜기", "끄기"], camera: { fixture: "microwave" } });
    expect(["cooktop", "microwave", "aircon", null, "nope"].map((k) => isRiskyKind(k))).toEqual([true, true, false, false, false]);
    expect((["tv", "refrigerator", "microwave", "sink", "oven", "toaster"] as const).map(cameraKindOf)).toEqual(["tv", "fridge", "microwave", "valve", null, null]);
    expect(kindEntry("nope")).toBeUndefined();
  });
});

describe("kinds registry: 구조 검사", () => {
  let kp: KindProject;
  beforeAll(() => { kp = openKindProject(ROOT); });
  afterAll(() => kp?.close());
  const marked = (file: string) => readFileSync(join(ROOT, file), "utf8").split(/\r?\n/).flatMap((l, i) => (/\/\/ 금지\s*$/.test(l) ? [i + 1] : []));

  it("src/·ui/src/·scripts/에 등록부 밖 가전 종류별 표가 없다", () => {
    const hits = findAllKindTables(kp).map((h) => `${h.file}:${h.line} ${h.name} [${h.rule}] ${h.text}`);
    expect(hits, KIND_TABLE_WHY).toEqual([]);
  }, 120_000);

  it("금지 예제는 하나씩 짚는다", () => {
    for (const [file, as] of [["tests/fixtures/kind-tables/forbidden.ts", undefined], ["tests/fixtures/kind-tables/forbidden-model.ts", "src/model/control.ts"], ["tests/fixtures/kind-tables/forbidden-thinq.ts", "src/devices/thinq/appliance.ts"]] as const) {
      const lines = new Set(findKindTables(kp, file, as ? { as } : {}).map((h) => h.line));
      const want = marked(file);
      expect(want.length, file).toBeGreaterThan(0);
      expect(want.filter((l) => !lines.has(l)), `${file}에서 짚지 못한 줄`).toEqual([]);
    }
  }, 60_000);

  it("허용 예제(이름 조회 콜백·등록부에서 만든 표·하나뿐인 종류·계획 단계·어댑터 이름·말 꾸밈 파일)는 짚지 않는다", () => {
    expect(findKindTables(kp, "tests/fixtures/kind-tables/allowed.ts")).toEqual([]);
    expect(findKindTables(kp, "tests/fixtures/kind-tables/allowed-summary.ts", { as: "ui/src/bubbles/summary.ts" })).toEqual([]);
  }, 60_000);
});
