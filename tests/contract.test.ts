import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DetLabel } from "../src/brain/detector.js";
import type { BoxView, BrainLog, ServerMessage } from "../src/contract/events.js";
import type { PlanView } from "../src/contract/plan.js";

const CONTRACT_DIR = new URL("../src/contract/", import.meta.url);

describe("메시지 계약", () => {
  it("src/contract의 파일은 타입만 가져오고 타입만 내보낸다(화면 빌드에 서버 코드가 끌려오지 않게)", () => {
    const files = readdirSync(CONTRACT_DIR).filter((f) => f.endsWith(".ts"));
    expect(files).toEqual(expect.arrayContaining(["events.ts", "plan.ts", "layout.ts"]));
    for (const f of files) {
      const src = readFileSync(new URL(f, CONTRACT_DIR), "utf8");
      const imports = src.split("\n").filter((l) => /^\s*import\b/.test(l));
      expect(imports.every((l) => /^\s*import type\b/.test(l)), f).toBe(true);
      expect(src, f).not.toMatch(/node:|from "zod"/);
      expect(src, f).not.toMatch(/^\s*export\s+(const|let|var|function|class|enum|default)\b/m);
    }
  });
});

// 대시보드가 받는 상자·말풍선 글. 계약에서 빠지거나 모양이 바뀌면 typecheck가 여기서 실패한다.
// 상자 이름은 YOLOX 감지 이름(DetLabel)과 같다: 한쪽만 바꾸면 두 표 중 하나가 typecheck에서 실패한다.
const BOX_OF_DET: Record<DetLabel, BoxView["label"]> = { person: "person", cup: "cup", bottle: "bottle", bowl: "bowl" };
const DET_OF_BOX: Record<BoxView["label"], DetLabel> = { person: "person", cup: "cup", bottle: "bottle", bowl: "bowl" };
const OBSERVE_WITH_BOXES: Extract<BrainLog, { type: "observe" }> = {
  type: "observe", at_ms: 1, frame_id: "e1", captured_at_ms: 1, yolo: "컵 0.83", vlm: null,
  boxes: [{ label: "cup", score: 0.83, box: [100, 50, 40, 60] }], frame: { width: 360, height: 640 },
};
const SAYS: Extract<ServerMessage, { type: "say" }>[] = [{ type: "say", text: "지켜보고 있어요." }, { type: "say", text: null }];

describe("대시보드 메시지 계약", () => {
  it("observe는 엔진 프레임 픽셀 상자 [x, y, w, h]와 프레임 크기를 싣고, say는 글 하나 또는 null", () => {
    expect(Object.keys(BOX_OF_DET).sort()).toEqual(Object.keys(DET_OF_BOX).sort());
    expect(OBSERVE_WITH_BOXES.boxes?.[0]?.box).toHaveLength(4);
    expect(SAYS.map((m) => m.text)).toEqual(["지켜보고 있어요.", null]);
  });
});

// PlanView의 키 전부. 계약에 키를 더하거나 빼면 typecheck가 여기서 실패한다(true = 꼭 있어야 함).
const PLAN_KEYS: Record<keyof PlanView, boolean> = {
  id: true, revision: true, supersedes: false, origin: false, source: true, goal: true, judgment: true,
  dryRun: true, robot: true, path: true, legs: true, steps: true, status: true, updatedAt: true,
};

/** 문서의 json 블록 중 { plan } 본문 예시. */
function examplePlan(): PlanView {
  const md = readFileSync(new URL("../docs/plan-contract.md", import.meta.url), "utf8");
  const blocks = [...md.matchAll(/```json\r?\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1]!) as Record<string, unknown>);
  const plan = blocks.find((b) => "plan" in b)?.plan as PlanView | undefined;
  if (!plan) throw new Error("docs/plan-contract.md에 { plan } 예시 json 블록이 없다");
  return plan;
}

describe("docs/plan-contract.md 예시", () => {
  it("본문은 { plan: PlanView } 모양", () => {
    const plan = examplePlan();
    const keys = Object.keys(plan);
    expect(keys.filter((k) => !(k in PLAN_KEYS))).toEqual([]);
    expect(Object.entries(PLAN_KEYS).filter(([k, need]) => need && !keys.includes(k)).map(([k]) => k)).toEqual([]);
    expect(plan.revision).toBe(1);
  });

  it("컵 치우기 네 단계: 식탁 가기, 컵 집기, 싱크대 가기, 내려놓기", () => {
    const plan = examplePlan();
    expect(plan.steps.map((s) => [s.kind, s.label, s.target?.objectId])).toEqual([
      ["move", "식탁으로 가기", "table_1"], ["act", "컵 집기", "table_1"],
      ["move", "싱크대로 가기", "sink_1"], ["act", "컵 내려놓기", "sink_1"],
    ]);
    expect(plan.dryRun).toBe(true);
  });

  it("경로는 로봇에서 시작하고 이동 단계마다 끝 점 번호가 있다", () => {
    const plan = examplePlan();
    expect(plan.path[0]).toEqual(plan.robot.position);
    expect(plan.legs.map((l) => l.stepId)).toEqual(plan.steps.filter((s) => s.kind === "move").map((s) => s.id));
    const ends = plan.legs.map((l) => l.end);
    expect(ends.every((e, i) => e > (ends[i - 1] ?? 0))).toBe(true);
    expect(ends.at(-1)).toBe(plan.path.length - 1);
  });
});
