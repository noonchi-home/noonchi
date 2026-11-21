// Browser entry bundled only for npm run capture -- --home-shots.
import { PerspectiveCamera } from "three";
import { collectWalls } from "@viewer/walls.mjs";
import { TwinEngine } from "../../ui/src/twin/3d/engine.ts";
import { projectionFromFov, yawPitchQuat } from "../../ui/src/phone/core/video-math.js";

export async function loadRoom() {
  const canvas = document.querySelector("canvas");
  const { innerWidth: width, innerHeight: height } = window;
  const [engine, { scene }, manifest] = await Promise.all([
    TwinEngine.load({ canvas, home: "mokryeon_180b", box: { width, height }, dpr: 1 }),
    fetch("/api/scene").then(r => r.json()),
    fetch("/twin/bake/manifest.json").then(r => r.json()),
  ]);

  // The dashboard starts in its overhead cutaway. Use whole walls, actual windows
  // and complete furniture for the indoor perspective, retaining the baked materials.
  for (const wall of collectWalls(engine.root, scene.plan.walls)) {
    if (wall.upper) wall.upper.visible = true;
  }
  for (const obj of scene.objects) {
    if (scene.added?.includes(obj.id)) await engine.layout.add(obj);
    else if (["opening","wall"].includes(obj.mount)) {
      const node = engine.find(obj.id);
      if (node) node.visible = true;
    }
  }
  for (const rail of Object.values(manifest.view.rails)) {
    const node = engine.root.getObjectByName(rail);
    if (node) node.visible = false;
  }
  engine.renderer.localClippingEnabled = false;
  engine.scene.traverse(node => {
    const { isInside, isStencil, isLid } = node.userData;
    if (isLid) node.userData.on = false;
    if (isInside || isStencil || isLid || node.name === "cap_plane") node.visible = false;
  });

  const camera = new PerspectiveCamera();
  return async function draw(shot) {
    for (const [id, state] of Object.entries(shot.doors)) {
      if (engine.states.getState(id).door !== state) engine.states.setState(id, "door", state);
    }
    // Plan yaw increases from +X toward +Z. Phone yaw rotates about +Y from -Z.
    camera.position.fromArray(shot.position);
    camera.quaternion.fromArray(yawPitchQuat((-90 - shot.yaw_deg) * Math.PI / 180, shot.pitch_deg));
    camera.projectionMatrix.fromArray(projectionFromFov(shot.vfov_deg, shot.width / shot.height));
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    camera.updateMatrixWorld();
    engine.states.beforeDraw(0);
    await new Promise(resolve => requestAnimationFrame(() => {
      engine.renderer.render(engine.scene, camera);
      resolve();
    }));
  };
}
