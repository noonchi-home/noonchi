import type { Vec3 } from "../../contract/layout.js";
import { findTypeRule } from "../../devices/index.js";
import { HOUSEHOLD_KINDS, kindEntry } from "../../devices/kinds.js";
import { inView } from "../../world/index.js";
import type { TrackCore } from "../track/core.js";

type StationTarget = { id: string; position: Vec3; look: { position: Vec3 } | null };
const PHOTO_MAX_AGE_MS = 3000;

/** 그 자리에 선 폰으로 찍은 최근 VLM 사진에서 비출 곳과 등록한 가전을 확인한다. */
export function stationSeen(core: TrackCore, target: StationTarget, radius: number, now: number): boolean {
  if (!target.look) return true;
  const view = core.o.state.view();
  const photo = view.household_photo;
  if (!photo?.proof || now < photo.at_ms || now - photo.at_ms > PHOTO_MAX_AGE_MS) return false;
  const camera = photo.proof.camera;
  const distance = Math.hypot(camera.origin[0] - target.position[0], camera.origin[2] - target.position[2]);
  if (distance > radius || !inView(camera, target.look.position)) return false;

  const map = core.o.stations?.map?.();
  const station = map?.stations.find(s => s.id === target.id);
  if (!station || !map) return true;
  const appliances = station.surfaces.map(id => {
    const device = view.devices.find(d => d.id === id);
    const type = device ? undefined : core.o.layout.floor().objects.get(id)?.type;
    return { id, kind: device?.kind ?? (type && findTypeRule(type)?.kind) };
  }).filter(d => kindEntry(d.kind)?.camera);
  const screen = appliances.find(d => d.kind === HOUSEHOLD_KINDS.viewerPower);
  const subject = screen ?? appliances[0];
  if (!subject) return true;

  if (screen) {
    const floor = target.position[1];
    const covered = station.observes_zone_ids.every(id => map.zones.find(z => z.id === id)?.polygon.every(
      ([x, z]) => [floor, floor + 1.2].every(y => inView(camera, [x, y, z])),
    ));
    if (!covered) return false;
  }
  return view.fixtures.some(f => (f.link ? f.link.device : f.device) === subject.id &&
    f.last_seen_ms >= photo.at_ms && f.answered_ms === photo.at_ms &&
    Object.values(f.facts).some(value => value?.at_ms === photo.at_ms));
}
