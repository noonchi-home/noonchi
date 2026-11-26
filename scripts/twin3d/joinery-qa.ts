// npm run capture -- --url <목련 대시보드?debug=steps> --out runtime-3d/joinery --ready "main[data-ready]" --joinery-qa
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MOKRYEON_MAP_CAMERA, planToPixel } from "../../ui/src/twin/3d/projection";
import type { Page } from "./cdp.js";

/** The isolated capture tab exercises the dashboard renderer's state path, without sending device commands. */
export async function inspectJoinery(page: Page, url: string, out: string) {
  const local = new URL("../../twin/homes/mokryeon_180b/bake/", import.meta.url);
  const { glb } = JSON.parse(readFileSync(new URL("manifest.json", local), "utf8"));
  const asset = await fetch(new URL(`/twin/bake/${glb}`, url));
  assert(asset.ok);
  const hash = (v: Uint8Array) => createHash("sha256").update(v).digest("hex");
  const sha256 = hash(new Uint8Array(await asset.arrayBuffer()));
  assert.equal(sha256, hash(readFileSync(new URL(glb, local))));
  const poses = await page.evaluate(`(async () => {
    const e = window.__twin3d.engine, data = (await (await fetch('/api/scene')).json()).scene;
    const checked = [];
    for (const d of data.plan.doors) {
      const id = d.id, item = data.objects.find(o => o.id === id), state = e.states.getState(id).door;
      const effect = item.states.door.effects.open.find(f => f.rotate || f.translate);
      const part = e.find(id + '_' + effect.part);
      const pose = value => {
        const {missing} = e.states.setState(id, 'door', value);
        if (missing.length) throw Error(id + ' missing ' + missing.join(','));
        part.updateMatrixWorld(true);
        return [part.position.x, part.position.y, part.position.z, part.rotation.y];
      };
      try {
        const closed = pose('closed'), opened = pose('open');
        const expected = [...(effect.translate || [0,0,0]), (effect.rotate?.[1] || 0) * Math.PI / 180];
        // Euler angles can wrap beyond 90°; the quaternion's signed Y rotation is unambiguous.
        if (effect.rotate) opened[3] = 2 * Math.atan2(part.quaternion.y, part.quaternion.w);
        if (opened.some((v, i) => Math.abs(v - closed[i] - expected[i]) > 0.0001)) throw Error('wrong pose ' + id);
        const restored = pose('closed');
        if (restored.some((v, i) => Math.abs(v - closed[i]) > 0.0001)) throw Error('restore ' + id);
        checked.push({id, kind: d.kind, delta: expected});
      } finally { pose(state); }
    }
    return checked;
  })()`, 30_000) as { id: string; kind: string; delta: number[] }[];
  assert.equal(poses.length, 15);
  const capture = async (id: string, x: number, z: number, height: number, zoom: number, pose?: string) => {
    const [cx, cy] = planToPixel(MOKRYEON_MAP_CAMERA, [x, z], height);
    const clip = await page.evaluate(`(async () => {
      const e = window.__twin3d.engine;
      if (${!!pose}) e.states.setState(${JSON.stringify(id)}, 'door', ${JSON.stringify(pose ?? "")});
      e.setView({cx:${cx},cy:${cy},scale:${zoom}}, 0); e.requestRender();
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const b = document.querySelector('canvas[data-twin3d="ready"]').getBoundingClientRect();
      return {x:b.x,y:b.y,width:b.width,height:b.height,scale:1.5};
    })()`, 15_000) as object;
    const image = await page.send("Page.captureScreenshot", { format: "png", clip });
    assert(image.result?.data);
    writeFileSync(join(out, `${id}${pose ? "-" + pose : ""}.png`), Buffer.from(image.result.data, "base64"));
  };
  // The full dashboard screenshot retains its live annotations. Expose the unobstructed
  // WebGL canvas for the detail crops, keeping its CSS layout and camera projection.
  await page.evaluate(`(() => {
    const style = document.createElement('style'); style.id = 'joinery-canvas-only';
    style.textContent = 'body * {visibility:hidden !important} canvas[data-twin3d="ready"] {visibility:visible !important}';
    document.head.append(style);
  })()`, 5_000);
  try {
    for (const pose of ["closed", "open"]) await capture("door_bed_sw", 6.24, 7.82, 1.05, 2.0, pose);
    for (const pose of ["closed", "open"]) await capture("door_balcony_living", 8.35, 12.23, 1.0, 1.1, pose);
    await capture("wardrobe_4ef026d4", 4.03, 8.31, 1.15, 1.8);
  } finally {
    await page.evaluate(`document.getElementById('joinery-canvas-only')?.remove()`, 5_000);
  }
  return { glb, sha256, poses };
}
