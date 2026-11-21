import type { Vec3 } from "../../contract/layout.js";
import { findTypeRule } from "../../devices/index.js";
import { HOUSEHOLD_KINDS, kindEntry } from "../../devices/kinds.js";
import { inView } from "../../world/index.js";
import type { TrackCore } from "../track/core.js";

type StationTarget = { id: string; position: Vec3; look: { position: Vec3 } | null };
/** 자리에 닿은 뒤 이만큼(ms) 지나도 VLM이 그 자리 가전 사실을 내지 않으면, 비출 곳(거실 대기는 시청 구역까지)을 담은 사진만으로 도착을 받는다.
 *  VLM 사진 간격 1~2초와 답 지연 1.5~2초를 두 번 넘는 시간이다. */
export const FIXTURE_WAIT_MS = 6000;

/** 도착을 받은 규칙: 가전 사실까지 본 사진, 사진 범위만(가전 사실을 기다리다), 볼 가전이 없는 자리, 비출 곳이 없는 자리. */
export type StationRule = "fixture" | "coverage" | "no_appliance" | "no_look";

/** 그 자리에 닿은 뒤(reachedAt) 찍은 VLM 사진에서 비출 곳과 등록한 가전을 확인한다. 사진의 나이는 보지 않는다(답이 늦게 와도 닿은 뒤 찍었으면 그 자리 사진이다).
 *  그 사진의 위치 찾기 결과가 있으면 자리 반경 안이어야 한다(구현명세서 6.15 관찰 자리 도착). AR 자세와 다른 사진은 근거(proof)가 없어 도착이 아니고,
 *  위치를 모르는 사진(지도 없음·특징점 부족)은 사진 근거만 본다. 도착이면 받은 규칙, 아니면 null. */
export function stationSeen(core: TrackCore, target: StationTarget, radius: number, now: number, reachedAt: number): StationRule | null {
  if (!target.look) return "no_look";
  const view = core.o.state.view();
  const photo = view.household_photo;
  if (!photo?.proof || photo.at_ms < reachedAt || now < photo.at_ms) return null;
  const camera = photo.proof.camera;
  const distance = Math.hypot(camera.origin[0] - target.position[0], camera.origin[2] - target.position[2]);
  if (distance > radius || !inView(camera, target.look.position)) return null;
  // 사진으로 찾은 위치가 있으면 자리와 맞아야 한다
  const localized = photo.proof.localized_position;
  if (localized && Math.hypot(localized[0] - target.position[0], localized[2] - target.position[2]) > radius) return null;

  const map = core.o.stations?.map?.();
  const station = map?.stations.find(s => s.id === target.id);
  if (!station || !map) return "no_appliance";
  const appliances = station.surfaces.map(id => {
    const device = view.devices.find(d => d.id === id);
    const type = device ? undefined : core.o.layout.floor().objects.get(id)?.type;
    return { id, kind: device?.kind ?? (type && findTypeRule(type)?.kind) };
  }).filter(d => kindEntry(d.kind)?.camera);
  const screen = appliances.find(d => d.kind === HOUSEHOLD_KINDS.viewerPower);
  const subject = screen ?? appliances[0];
  if (!subject) return "no_appliance";

  if (screen) {
    const floor = target.position[1];
    const covered = station.observes_zone_ids.every(id => map.zones.find(z => z.id === id)?.polygon.every(
      ([x, z]) => [floor, floor + 1.2].every(y => inView(camera, [x, y, z])),
    ));
    if (!covered) return null;
  }
  const fact = view.fixtures.some(f => (f.link ? f.link.device : f.device) === subject.id &&
    f.last_seen_ms >= photo.at_ms && f.answered_ms === photo.at_ms &&
    Object.values(f.facts).some(value => value?.at_ms === photo.at_ms));
  if (fact) return "fixture";
  return now - reachedAt >= FIXTURE_WAIT_MS ? "coverage" : null;
}

/** 자리에 닿은 때를 일마다 기억한다(반경을 벗어나면 지운다). */
export class StationReach {
  private at = new Map<string, number>();
  /** near면 처음 닿은 때, 아니면 null(기억을 지운다). */
  since(key: string, near: boolean, now: number): number | null {
    if (!near) { this.at.delete(key); return null; }
    const first = this.at.get(key) ?? now;
    this.at.set(key, first);
    return first;
  }
  forget(key: string): void { this.at.delete(key); }
}
