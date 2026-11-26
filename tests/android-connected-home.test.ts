import { describe, expect, it, vi } from "vitest";
import { activeHome, confirmConnectedHouse, createConnectedHub, matchesConnectedHouse, prepareConnectedHouse, type ConnectedHub } from "../apps/android/connected-hub.js";
import { photoCrop, selectScanScene, readReferenceScenes, saveReferencePhoto, type ReferenceScene } from "../apps/android/connected-scan.js";
import type { SetupView } from "../src/contract/setup.js";

const origin = "https://noonchi.example.ts.net";
const home = { id: "mokryeon_180b", name: "한양목련 180B" };
const initial: SetupView = {
  ok: true, persist: true, done: false, switching: false, error: null,
  home: { id: "oneroom", name: "원룸" }, homes: [home], rooms: [], devices: [], devices_saved: false,
  position: { start: false, layout: false, phone_urls: [] }, mode: "test", thinq: { ready: false }, pairs: {},
};
const scene: ReferenceScene = { id: "table_front_C", name: "식탁 앞", direction: "정면", image: `${origin}/home-scenes/${home.id}/table_front_C.png`, width: 1920, height: 1080 };

function at(url: string, response: Response) {
  return Object.defineProperty(response, "url", { value: url });
}

function hubWith(response: (path: string) => Response) {
  const send = vi.fn<typeof fetch>(async (url) => at(String(url), response(new URL(String(url)).pathname)));
  return { hub: createConnectedHub(origin + "/mobile/", send), send };
}

describe("Android connected hub", () => {
  it("native registration waits five seconds and returns a still-confirmed home for preview", async () => {
    vi.useFakeTimers();
    try {
      const { hub, send } = hubWith(path => Response.json(path === "/api/scene"
        ? { ok: true, scene: { plan: { rooms: [{ id: "living" }] } } } : { ...initial, home }));
      const preview = vi.fn();
      const pending = prepareConnectedHouse(hub, initial).then(preview);
      await vi.advanceTimersByTimeAsync(4999);
      expect(preview).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await pending;
      expect(preview).toHaveBeenCalledWith({ ...initial, home });
      expect(send.mock.calls.map(([url]) => url)).toEqual([origin + "/api/setup/home", origin + "/api/scene", origin + "/api/setup"]);
    } finally { vi.useRealTimers(); }
  });
  it("validates the selected portal and uses its origin for settings GET and writes", async () => {
    const { hub, send } = hubWith(() => Response.json(initial));
    await expect(hub.get<SetupView>("/api/setup")).resolves.toEqual(initial);
    await hub.write("/api/setup/devices", { home: "oneroom", sources: { ac: "none" } });
    expect(send.mock.calls).toEqual([
      [origin + "/api/setup", expect.objectContaining({ method: "GET", credentials: "omit", redirect: "error" })],
      [origin + "/api/setup/devices", expect.objectContaining({ method: "POST", body: '{"home":"oneroom","sources":{"ac":"none"}}' })],
    ]);
    expect(() => hub.url("//unrelated.example/scene.jpg")).toThrow();
    expect(() => createConnectedHub(origin + "/phone/")).toThrow();
  });

  it("rejects a response delivered from a different origin before reading it", async () => {
    const reply = at("https://other.example/api/setup", Response.json(initial));
    const json = vi.spyOn(reply, "json");
    const hub = createConnectedHub(origin + "/mobile/", vi.fn().mockResolvedValue(reply));
    await expect(hub.get("/api/setup")).rejects.toThrow();
    expect(json).not.toHaveBeenCalled();
  });

  it("does not use an unregistered default or stale saved home for the native camera", () => {
    expect(activeHome(initial, null)).toBeNull();
    expect(activeHome(initial, home.id)).toBeNull();
    expect(activeHome({ ...initial, home }, home.id)).toEqual(home);
    expect(activeHome({ ...initial, home, switching: true }, home.id)).toBeNull();
    expect(activeHome({ ...initial, done: true }, null)).toEqual(initial.home);
  });

  it("only persists native confirmation after verifying the active home again", async () => {
    expect(matchesConnectedHouse("산본로432번길 25")).toBe(true);
    expect(matchesConnectedHouse("산본로432번길 250")).toBe(false);
    const { hub, send } = hubWith(() => Response.json({ ...initial, home }));
    const remember = vi.fn(async () => {});
    await expect(confirmConnectedHouse(hub, remember)).resolves.toMatchObject({ home });
    expect(send.mock.calls.map(([url]) => url)).toEqual([origin + "/api/setup"]);
    expect(remember).toHaveBeenCalledWith(home.id);
    const changedHome = hubWith(() => Response.json(initial));
    const missingTwin = hubWith(path => path === "/api/scene" ? Response.json({ ok: false }, { status: 404 }) : Response.json({ ...initial, home }));
    remember.mockClear();
    await expect(confirmConnectedHouse(changedHome.hub, remember)).rejects.toThrow();
    await expect(prepareConnectedHouse(missingTwin.hub, initial)).rejects.toThrow();
    expect(remember).not.toHaveBeenCalled();
  });
});

describe("Android reference photos", () => {
  it("accepts only corresponding same-origin reference paths and picks first unfinished or saved scene", () => {
    const { hub } = hubWith(() => Response.json({}));
    const rows = readReferenceScenes(hub, home.id, { home: home.id, scenes: [
      { id: scene.id, spot_name: scene.name, view: "C", width: 1920, height: 1080, image_url: `/home-scenes/${home.id}/${scene.id}.png` },
      { id: "wrong", width: 1920, height: 1080, image_url: "https://other.example/wrong.png" },
    ] });
    expect(rows).toEqual([scene]);
    const scenes = [...rows, { ...scene, id: "sink_front_C" }];
    const photos = { [scene.id]: { uri: "file:///saved.jpg", where: "phone" as const } };
    expect(selectScanScene(scenes, photos, false)).toBe(1);
    expect(selectScanScene(scenes, photos, true)).toBe(0);
  });

  it("crops landscape photos into the reference ratio and rejects a portrait", () => {
    expect(photoCrop({ width: 4000, height: 3000 }, scene)).toEqual({
      crop: { originX: 0, originY: 375, width: 4000, height: 2250 }, size: { width: 1920, height: 1080 },
    });
    expect(() => photoCrop({ width: 3000, height: 4000 }, scene)).toThrow(/가로/);
  });

  it("stores a reviewable local photo when the actual hub does not provide signed upload", async () => {
    const { hub, send } = hubWith(() => Response.json({ ok: false }, { status: 503 }));
    const photo = { uri: "file:///cache.jpg", width: 1920, height: 1080, capturedAt: "2026-11-23T10:00:00.000Z" };
    const keep = vi.fn(async () => ({ uri: "file:///saved.jpg", where: "phone" as const }));
    const bytes = vi.fn();
    const upload = vi.fn();
    await expect(saveReferencePhoto(hub, home.id, scene, photo, { keep, bytes, upload })).resolves.toEqual({ uri: "file:///saved.jpg", where: "phone" });
    expect(send.mock.calls[0]?.[1]?.body).toBe(`{"scene_id":"${scene.id}"}`);
    expect(keep).toHaveBeenCalledWith(home.id, scene.id, photo, "phone");
    expect(upload).not.toHaveBeenCalled();
  });

  it("saves JPEG then its label to the signed destinations and makes the review available after both succeed", async () => {
    const photo = { uri: "file:///cache.jpg", width: 1920, height: 1080, capturedAt: "2026-11-23T10:00:00.000Z" };
    const bytes = vi.fn(async () => new Blob(["jpeg"], { type: "image/jpeg" }));
    const keep = vi.fn(async () => ({ uri: "file:///saved.jpg", where: "server" as const }));
    const upload = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    const hub: ConnectedHub = hubWith(() => Response.json({
      home: home.id, scene_id: scene.id, photo: { url: "https://bucket.example/photo", content_type: "image/jpeg" },
      label: { url: "https://bucket.example/label", content_type: "application/json" },
    })).hub;
    await saveReferencePhoto(hub, home.id, scene, photo, { bytes, keep, upload });
    expect(upload.mock.calls.map(([url, request]) => [url, request?.method, request?.redirect])).toEqual([
      ["https://bucket.example/photo", "PUT", "error"], ["https://bucket.example/label", "PUT", "error"],
    ]);
    expect(JSON.parse(String(upload.mock.calls[1]?.[1]?.body))).toEqual({
      scene_id: scene.id, captured_at: photo.capturedAt, width: photo.width, height: photo.height,
    });
    expect(keep).toHaveBeenCalledWith(home.id, scene.id, photo, "server");
    keep.mockClear();
    upload.mockResolvedValueOnce(new Response(null, { status: 200 })).mockResolvedValueOnce(new Response(null, { status: 403 }));
    await expect(saveReferencePhoto(hub, home.id, scene, photo, { bytes, keep, upload })).rejects.toThrow();
    expect(keep).not.toHaveBeenCalled();
  });
});
