import type { DecisionWorld } from "../contract/events.js";
import type { WorldView } from "../contract/world.js";

/** 판단 기록에 붙이는 World State 요약: 사라지지 않은 물건의 상태·면(id·이름)·위치 오차·사실, 사람이 보이는가, 분석 없음 수. */
export function decisionWorld(w: WorldView): DecisionWorld {
  return {
    objects: w.objects.filter((o) => o.status !== "gone").map((o) => ({
      id: o.id, cls: o.cls, status: o.status, surface: o.surface, surface_label: o.surface_label, error_m: o.error_m,
      facts: Object.fromEntries(Object.entries(o.facts).flatMap(([k, f]) => (f ? [[k, { value: f.value, certainty: f.certainty }]] : []))),
      ...(o.closer_rev ? { closer_rev: { ...o.closer_rev } as Record<string, number> } : {}),
    })),
    person_visible: w.person.visible, vlm_missing: w.vlm_missing, yolo_missing: w.yolo_missing,
  };
}
