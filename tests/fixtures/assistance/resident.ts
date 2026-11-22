import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { assistanceReplay } from "../../helpers/assistance-replay.js";
import { viewLooking } from "../../helpers/camera.js";
import { det } from "../../helpers/detectors.js";

export function residentStudio(home = "oneroom") {
  const root = mkdtempSync(join(tmpdir(), "adaptive-resident-"));
  const studioDir = join(root, "twin");
  const runtimeDir = join(root, "runtime");
  cpSync(resolve("twin/data"), join(studioDir, "data"), { recursive: true });
  mkdirSync(join(studioDir, "homes", home), { recursive: true });
  mkdirSync(runtimeDir);
  cpSync(resolve("twin/homes", home, "scene.json"), join(studioDir, "homes", home, "scene.json"));
  writeFileSync(join(studioDir, "homes.json"), JSON.stringify({ default: home,
    homes: [{ id: home, name: "Replay residence", data: `data/homes/${home}`, out: `homes/${home}`, single_resident: "resident" }] }));
  return { studioDir, runtimeDir };
}

export async function seeResident(replay: Awaited<ReturnType<typeof assistanceReplay>>, captured: number, count = 1) {
  const id = "resident-" + captured;
  const view = viewLooking([2.8, 1.4, 3.5], [2.8, 1, 2.6]);
  const boxes = [[250, 80, 140, 300], [40, 90, 130, 280]] as const;
  const people = boxes.slice(0, count).map((box, i) => ({ id: "d" + (i + 1), det: det("person", .99, [...box]) }));
  await replay.publish("perception", "/perception/scene", { kind: "frame", frame: {
    id, capturedAtMs: captured, latestAtMs: captured, width: 640, height: 480, eye: null, view,
  }, dets: people.map(p => p.det) });
  await replay.publish("perception", "/perception/scene", { kind: "scene", frame_id: id, observed_ms: captured,
    look: { view, width: 640, height: 480, fresh: true, person_ids: people.map(p => p.id),
      dets: people.map(p => ({ id: p.id, box: p.det.box })) },
    scene: { scene: "room", observations: people.flatMap(p => [
      { object_id: p.id, state: "watching_tv" }, { object_id: p.id, state: "sitting" }]),
    objects: [], summary: "",
    household: { seats: "clear", dining_food: "unknown", people: people.map(p => ({ id: p.id, attention: "toward_tv" })) } },
  });
  await replay.publish("perception", "/perception/frame_seen", { at_ms: captured });
}
