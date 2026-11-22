// 부름(「클로이드!」, 행동 「부름에 응하기」)의 목적지는 코드가 정한다: 사용자가 있는 방(src/world/user-room.ts)의 관찰 자리,
// 그 자리가 보는 면(평면도 물건 id, 계획의 go target)이다. 방을 모르면 관찰 자리 면 후보를 주고 계획 모델이 그중에서 고른다.
// 계획 검사(src/agent/planTools.ts)는 이 목적지(또는 후보)로 가는 계획만 받는다.
import type { StationMap } from "../contract/stations.js";
import type { WorldView } from "../contract/world.js";
import type { FloorPlan } from "../layout/index.js";
import { userRoomOf } from "../world/index.js";

export interface CallDestination {
  /** 사용자가 있다고 본 방(모르면 null)과 그 자취 시각. */
  room: string | null;
  seen_ms: number | null;
  /** 그 방 관찰 자리 id와 그 자리가 보는 면(go target). 모르면 null. */
  station: string | null;
  target: string | null;
  /** 방을 모를 때 갈 수 있는 관찰 자리 면들. */
  candidates: string[];
}

const faceOf = (surfaces: readonly string[], floor: FloorPlan) => surfaces.find((id) => floor.objects.has(id)) ?? null;

export function callDestination(view: Pick<WorldView, "person" | "person_trail">, map: StationMap | null, floor: FloorPlan, now: number): CallDestination {
  const observe = (map?.stations ?? []).filter((s) => s.roles.includes("observe") && faceOf(s.surfaces, floor));
  const candidates = [...new Set(observe.map((s) => faceOf(s.surfaces, floor)!))];
  const user = userRoomOf(view, now);
  // 그 방의 관찰 자리 중 구역을 보는 자리를 먼저 쓴다(책상 관찰 자리는 책상 앞 구역을 본다)
  const station = user ? [...observe].sort((a, b) => b.observes_zone_ids.length - a.observes_zone_ids.length).find((s) => s.room === user.room) : undefined;
  return {
    room: user?.room ?? null, seen_ms: user?.at_ms ?? null,
    station: station?.id ?? null, target: station ? faceOf(station.surfaces, floor) : null,
    candidates,
  };
}

/** 방을 모를 때 자리 고르기(관찰 모드 chooseStation)가 고른 관찰 자리로 목적지를 채운다. 그 자리가 후보가 아니면 그대로. */
export function withChosenStation(call: CallDestination, map: StationMap | null, floor: FloorPlan, stationId: string | null): CallDestination {
  const s = stationId ? map?.stations.find((x) => x.id === stationId) : undefined;
  const face = s ? faceOf(s.surfaces, floor) : null;
  return s && face && call.candidates.includes(face) ? { ...call, station: s.id, target: face } : call;
}

/** 자리 고르기에 넘길 관찰 자리(후보 면을 보는 자리). */
export function callPlaces(call: CallDestination, map: StationMap | null, floor: FloorPlan): { id: string; name: string }[] {
  return (map?.stations ?? []).filter((s) => s.roles.includes("observe") && call.candidates.includes(faceOf(s.surfaces, floor) ?? "")).map(({ id, name }) => ({ id, name }));
}
