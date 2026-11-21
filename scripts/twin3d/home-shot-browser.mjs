// Browser entry bundled only for npm run capture -- --home-shots.
import { PerspectiveCamera, WebGLRenderTarget, ShaderMaterial, Color, DoubleSide } from "three";
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
  // Linear optical-axis distance, millimetres. RG = high/low bytes; zero is sky.
  // Read a non-MSAA target directly so AA, tone mapping and screenshot colour profiles
  // cannot interpolate or transform the packed bytes.
  let depthTarget, depthMaterial;
  function depthPng() {
    depthTarget ??= new WebGLRenderTarget(width, height);
    depthMaterial ??= new ShaderMaterial({
      side: DoubleSide, toneMapped: false,
      vertexShader: `varying float axial;
        void main(){ vec4 p=modelViewMatrix*vec4(position,1.); axial=-p.z; gl_Position=projectionMatrix*p; }`,
      fragmentShader: `varying float axial;
        void main(){float mm=floor(axial*1000.+0.5); if(mm<1.||mm>65535.) discard;
          gl_FragColor=vec4(floor(mm/256.)/255.,mod(mm,256.)/255.,0.,1.);}`,
    });
    const renderer = engine.renderer, scene = engine.scene;
    const previous = scene.background, override = scene.overrideMaterial;
    const target = renderer.getRenderTarget();
    const pixels = new Uint8Array(width*height*4);
    try {
      scene.background = new Color(0);
      scene.overrideMaterial = depthMaterial;
      renderer.setRenderTarget(depthTarget);
      renderer.render(scene, camera);
      renderer.readRenderTargetPixels(depthTarget,0,0,width,height,pixels);
    } finally {
      scene.overrideMaterial = override;
      scene.background = previous;
      renderer.setRenderTarget(target);
    }
    const output = document.createElement("canvas");
    output.width = width; output.height = height;
    const ctx = output.getContext("2d"), data = ctx.createImageData(width,height);
    const stride = width*4;
    for (let y=0;y<height;y++) data.data.set(pixels.subarray(y*stride,(y+1)*stride),(height-y-1)*stride);
    ctx.putImageData(data,0,0);
    return output.toDataURL("image/png").split(",")[1];
  }
  return async function draw(shot, depth = false) {
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
    if (depth) return depthPng();
    await new Promise(resolve => requestAnimationFrame(() => {
      engine.renderer.render(engine.scene, camera);
      resolve();
    }));
  };
}
