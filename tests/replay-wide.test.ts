// 실제 판 재생: 기록 DB(vlm 이벤트)의 장면 VLM 답 원문·그 사진의 카메라·YOLO 감지를 같은 순서로 World State에 넣는다(사진은 넣지 않는다).
// 고정 자료: tests/fixtures/replay/<판>.json(2026-11-18 06:15~06:29 가로 유리컵 r10·가로 키 큰 컵 r4·가로 머그 r7, 0af95a1).
// 가까이 보기 답은 이 판 기록에 원문이 없어 넣지 못한다(다음 판부터 기록한다). 트윈 면은 넣지 않는다(바닥만).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CameraView, Detection, SceneObservation } from "../src/contract/observe.js";
import { linkDets } from "../src/observe/pipeline.js";
import { WorldState } from "../src/world/state/world.js";
import type { DetLabel } from "../src/world/vocab.js";
import { det } from "./helpers/detectors.js";

interface Step { frame: string; at: number; size: [number, number]; view: CameraView; dets: { id: string; class: string; box: [number, number, number, number]; score: number }[]; scene: SceneObservation }

/** 한 판을 재생하고 확정된 마시는 그릇 id와 그 물건들의 놓인 곳 값을 돌려준다. */
function replay(name: string) {
  const steps = JSON.parse(readFileSync(new URL(`./fixtures/replay/${name}.json`, import.meta.url), "utf-8")) as Step[];
  const w = new WorldState({ evidenceStepMs: 1000, surfaces: () => [], floorAt: () => 0, roomAt: () => null, devices: () => [] });
  const places = new Set<string>();
  for (const s of steps) {
    const at = s.at + 1000;
    const eye = { position: [s.view.origin[0], s.view.origin[2]] as [number, number], height_m: s.view.origin[1], yaw_deg: 0, pitch_deg: 0 };
    const frame = { id: s.frame, capturedAtMs: at, latestAtMs: at, jpeg: Buffer.alloc(0), sha256: s.frame, width: s.size[0], height: s.size[1], eye, view: s.view, vlm: true };
    const dets: Detection[] = s.dets.map((d) => det(d.class as DetLabel, d.score, d.box, 0));
    const { ids } = w.applyDetections(frame, dets);
    const scene = linkDets(s.scene, s.dets, s.size[0], s.size[1]);
    w.applyScene(s.frame, at, scene, ids, { view: s.view, width: s.size[0], height: s.size[1], eye: eye.position });
    for (const o of w.view(at).objects) if (o.facts.place) places.add(`${o.id}:${o.facts.place.value}`);
  }
  const end = (steps.at(-1)?.at ?? 0) + 1000;
  const cups = w.view(end).objects.filter((o) => o.cls === "cup" || o.cls === "bottle");
  return { cups: cups.map((o) => o.id), places: [...places] };
}

// 이 판들의 VLM 답은 0af95a1 글(「비율, 픽셀 아님」)로 받은 것이라 물건 목록이 많고, 선반의 장식(트로피 모양 잔 등)도 컵·그릇으로 답했다.
// 85ce9df(실제 판 3/4)와 0af95a1의 World State는 이 자료에서 같은 결과였다(유리컵 5·키 큰 컵 3·머그 2 id): 나빠진 원인은 World 규칙이 아니라 VLM 답(글·상자 받기)이다.
// 그래서 글·상자 받기를 85ce9df로 되돌렸고, 이 자료는 World 규칙의 회귀 그물로 둔다: 마시는 그릇 id 수가 아래보다 늘지 않는다(시야 안 같은 무리 잇기로 유리컵 5 → 3).
describe("실제 판 재생(장면 VLM 답 + 카메라 + YOLO 감지)", () => {
  const limit: Record<string, number> = { "wide-glass-r10": 3, "wide-tall-r4": 3, "wide-mug-r7": 2 };
  for (const name of Object.keys(limit)) {
    it(`${name}: 마시는 그릇 id가 ${limit[name]}개를 넘지 않는다`, () => {
      const r = replay(name);
      expect(r.cups.length, JSON.stringify(r)).toBeLessThanOrEqual(limit[name]!);
    });
  }
});
