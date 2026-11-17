// 판단 입력에 YOLO 물건 사실을 넣지 않는다(사용자 결정 2026-11-18): World State 물건(등장·확정·사라짐·자리·손에 있음·마시기)은 장면 VLM 답으로만 바뀐다.
// YOLO 감지가 World State로 들어가는 입구(src/world/state/objects.ts applyDetections, 관절 src/world/state/people.ts)는 물건을 읽거나 쓰지 않는다.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Detection, EngineFrame, SceneObservation } from "../src/contract/observe.js";
import { WorldState } from "../src/world/state/world.js";
import { CLASSES, type ClassKey, type DetLabel } from "../src/world/vocab.js";
import { engineFrame, LOOK_SIZE, LOOK_VIEW } from "./helpers/camera.js";
import { det } from "./helpers/detectors.js";
import { standing } from "./helpers/poses.js";

const ROOT = new URL("../", import.meta.url);
/** YOLO 입구 파일이 World State 물건을 읽거나 쓰는 줄(물건 맵·물건 타입·물건 만들기·잇기·관절이 든 물건). */
const TOUCH = [/\bcore\.objects\b/, /\bthis\.core\.objects\b/, /\bObj\b/, /\.create\(/, /\.matchAt\(/, /\bheldIds\b/, /\bheldByAny\b/, /\batMouth\b/, /\bpouringInto\b/];
function touchesObjects(src: string): string[] {
  return src.split("\n").filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*") && TOUCH.some((re) => re.test(line)));
}

const OBJECTS = (Object.keys(CLASSES) as ClassKey[]).filter((k) => CLASSES[k].role === "object") as DetLabel[];
const ws = () => new WorldState({ evidenceStepMs: 1000, surfaces: () => [], floorAt: () => 0, roomAt: () => null, devices: () => [] });
const CUP: [number, number, number, number] = [230, 170, 20, 10];
const frame = (id: string, at: number): EngineFrame => ({ ...engineFrame(id, at, { view: LOOK_VIEW, jpeg: Buffer.from(id) }), eye: { position: [0, 0], height_m: 1.5, yaw_deg: 0, pitch_deg: 0 } as never });
const cupScene: SceneObservation = { scene: "k", summary: "s", objects: [{ id: "v1", cls: "cup", box: { x: CUP[0] / 480, y: CUP[1] / 360, w: CUP[2] / 480, h: CUP[3] / 360 }, det: null }], observations: [] };

describe("YOLO 물건 감지는 World State 물건을 바꾸지 않는다", () => {
  it("모든 물건 종류 감지와 그 상자를 쥔·입에 댄 관절을 3초 넣어도 VLM이 확정한 컵은 그대로이고 새 물건·후보·사실이 생기지 않는다", () => {
    const w = ws();
    w.applyScene("e1", 1000, cupScene, new Map(), { view: LOOK_VIEW, ...LOOK_SIZE, eye: [0, 0] });
    w.applyScene("e2", 2000, cupScene, new Map(), { view: LOOK_VIEW, ...LOOK_SIZE, eye: [0, 0] });
    const before = JSON.stringify(w.view(2000).objects);
    const person = det("person", 0.9, [150, 20, 160, 330], 0);
    // 손목·코가 컵 상자 안(쥠·입에 댐)
    const grip = standing({ 0: [240, 175, 0.9], 9: [240, 175, 0.9], 10: [240, 175, 0.9] }, [150, 20, 160, 330]);
    for (let t = 2100; t <= 5000; t += 100) {
      const dets: Detection[] = [person, ...OBJECTS.map((label) => det(label, 0.95, CUP, label === "cup" ? 41 : undefined))];
      w.applyDetections(frame(`y${t}`, t), dets, [grip]);
    }
    expect(JSON.stringify(w.view(2000).objects)).toBe(before);
    expect(w.view(5000).objects.map((o) => [o.id, o.status, o.facts])).toEqual([["cup_1", "present", {}]]);
    expect(w.view(5000).person.holding).toEqual([]);
  });

  it("YOLO 입구 파일(objects.ts·people.ts)은 World State 물건을 읽거나 쓰지 않는다", () => {
    for (const f of ["src/world/state/objects.ts", "src/world/state/people.ts"]) {
      expect(touchesObjects(readFileSync(new URL(f, ROOT), "utf-8")), f).toEqual([]);
    }
  });

  it("검사는 7607f37의 실제 줄(YOLO 감지로 물건 만들기·관절이 든 물건·마시기)을 잡는다", () => {
    const past = [
      "      const obj = this.match(cls, placed?.position ?? null, used, frame.eye ? frame.eye.position : null, sees, nearest) ?? core.create(cls, at, frame.id);",
      "    const present = [...core.objects.values()].filter((x) => x.confirmed && x.status !== \"gone\").map((x) => x.id);",
      "  applyPose(frame: EngineFrame, poses: Pose[], boxes: { obj: Obj; box: Detection[\"box\"]; mask: Detection[\"mask\"] }[], changes: WorldChange[]): void {",
      "      if (!heldByAny(people, box)) {",
      "    for (const { obj, box } of boxes) if (vessel(obj) && atMouth(people, box)) say(obj, core.contents.reopen(obj, at, \"drink\"));",
      "      core.heldIds = held; // 확인 전 물건도 든다: 무엇을 들었는지는 id 앞 종류로 본다",
    ];
    for (const line of past) expect(touchesObjects(line), line).toEqual([line]);
  });
});
