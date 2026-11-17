// 시험 장면 대본(감지)을 장면 VLM 답으로 넣는 도우미: World State 물건은 장면 VLM 물건(objects)으로만 생긴다(src/world/state/sceneobjects.ts).
// 대본의 물건 감지마다 그 감지와 이은(det) VLM 물건을 답에 넣는다. 사람·가전 설비·관절은 그대로 YOLO 감지(applyDetections)로 넣는다.
import type { Detection, EngineFrame, Pose, SceneObject, SceneObservation } from "../../src/contract/observe.js";
import type { WorldChange } from "../../src/contract/world.js";
import type { SceneState } from "../../src/observe/scene.js";
import type { WorldState } from "../../src/world/state/world.js";
import { CLASSES, type ClassKey } from "../../src/world/vocab.js";

const OBJECT = new Set((Object.keys(CLASSES) as ClassKey[]).filter((k) => CLASSES[k].role === "object"));

/** 감지(d1… 차례) 가운데 물건 감지마다 그 감지와 이은 VLM 물건(v1…). 상자는 그 사진 비율. */
export function vlmObjects(dets: readonly Pick<Detection, "label" | "score" | "box">[], size: { width: number; height: number }, accepts: (d: Pick<Detection, "label" | "score">) => boolean): SceneObject[] {
  const out: SceneObject[] = [];
  dets.forEach((d, i) => {
    if (!OBJECT.has(d.label as ClassKey) || !accepts(d)) return;
    const [x, y, w, h] = d.box;
    out.push({ id: `v${out.length + 1}`, cls: d.label, box: { x: x / size.width, y: y / size.height, w: w / size.width, h: h / size.height }, det: `d${i + 1}` });
  });
  return out;
}

export interface SeeOptions {
  poses?: Pose[];
  /** 그 사진 VLM 답의 사실(감지 번호 d1… 또는 VLM 물건 번호 v1…). */
  facts?: [string, SceneState][];
  summary?: string;
  /** 그 사진의 폰 눈(없으면 frame.eye, 그것도 없으면 카메라 자리). null이면 폰 눈 모름. */
  eye?: [number, number] | null;
  /** 장면 VLM 답을 넣지 않는다(빠른 프레임: YOLO만). */
  fast?: boolean;
}

/** 엔진 프레임 한 장: YOLO 감지(사람·가전 설비·관절)를 넣고, 같은 사진의 장면 VLM 답(감지와 이은 물건 + 사실)을 넣는다. 변화와 감지·물건 번호 → id. */
export function see(w: WorldState, frame: EngineFrame, dets: Detection[], o: SeeOptions = {}): { changes: WorldChange[]; ids: Map<string, string> } {
  const r = w.applyDetections(frame, dets, o.poses);
  if (o.fast) return r;
  const scene: SceneObservation = {
    scene: "test", summary: o.summary ?? "", objects: vlmObjects(dets, frame, (d) => w.accepts(d)),
    observations: (o.facts ?? []).map(([object_id, state]) => ({ object_id, state })),
  };
  const eye = o.eye !== undefined ? o.eye : frame.eye ? frame.eye.position : frame.view ? [frame.view.origin[0], frame.view.origin[2]] as [number, number] : null;
  const look = frame.view ? { view: frame.view, width: frame.width, height: frame.height, eye, dets: dets.map((d, i) => ({ id: `d${i + 1}`, box: d.box, foot: d.foot })) } : undefined;
  const changes = w.applyScene(frame.id, frame.capturedAtMs, scene, r.ids, look);
  return { changes: [...r.changes, ...changes], ids: r.ids };
}
