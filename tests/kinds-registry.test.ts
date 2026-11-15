// 가전 종류 등록부(src/model/kinds.ts): 흩어진 종류별 표를 등록부에서 파생한다. 결과는 바꾸기 전과 하나도 다르지 않다(tests/fixtures/kinds-before.json),
// 등록부 밖에 종류별 표가 생기면 구조 검사(tests/helpers/kind-tables.ts)가 실패한다.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { kindsSnapshot } from "../scripts/kinds-snapshot.js";
import { KIND_TABLE_WHY, findAllKindTables, findKindTables, openKindProject, type KindProject } from "./helpers/kind-tables.js";

const ROOT = join(import.meta.dirname, "..");
const before = JSON.parse(readFileSync(join(ROOT, "tests", "fixtures", "kinds-before.json"), "utf8")) as ReturnType<typeof kindsSnapshot>;
const now = () => JSON.parse(JSON.stringify(kindsSnapshot())) as ReturnType<typeof kindsSnapshot>;

describe("kinds same: non-approval", () => {
  it("등록부 순서가 바꾸기 전 종류 순서(DeviceKind, 도구 enum 순서)와 같다", async () => {
    const { KIND_ORDER } = await import("../src/model/kinds.js");
    expect(KIND_ORDER).toEqual(Object.keys(before.labels));
  });

  it("라벨·Matter 프로필·트윈 type·별명·위험 이름·안전 문구·손 조작·ThinQ·사건·상태 글·카메라·twinChange가 바꾸기 전과 같다", () => {
    const { approval: _now, ...rest } = now();
    const { approval: _was, ...was } = before;
    expect(rest).toEqual(was);
  });
});

describe("kinds same: approval", () => {
  it("승인 규칙(CONFIRM_RULES, 순서 포함)과 승인 표(종류·사양·표본 명령마다 requiresConfirmation)가 바꾸기 전과 같다", () => {
    expect(now().approval).toEqual(before.approval);
  });
});

describe("kinds registry: 파생", () => {
  it("이름·위험 종류·카메라 설비 → 종류를 등록부에서 읽는다", async () => {
    const { KINDS, kindLabel, isRiskyKind, cameraKindOf, kindEntry } = await import("../src/model/kinds.js");
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
    for (const [file, as] of [["tests/fixtures/kind-tables/forbidden.ts", undefined], ["tests/fixtures/kind-tables/forbidden-model.ts", "src/model/control.ts"], ["tests/fixtures/kind-tables/forbidden-thinq.ts", "src/thinq/appliance.ts"]] as const) {
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
