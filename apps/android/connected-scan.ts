import { HubError, type ConnectedHub } from "./connected-hub";

export interface ReferenceScene {
  id: string;
  name: string;
  direction: string;
  image: string;
  width: number;
  height: number;
}

export type SavedPhoto = { uri: string; where: "phone" | "server" };
export type PhotoProgress = Record<string, SavedPhoto>;
export type NativePhoto = { uri: string; width: number; height: number; capturedAt: string };
const token = /^[A-Za-z0-9_-]+$/;
const directions: Record<string, string> = { C: "정면", L30: "왼쪽 30°", R30: "오른쪽 30°", L60: "왼쪽 60°", R60: "오른쪽 60°", down: "아래 보기" };

export function readReferenceScenes(hub: ConnectedHub, home: string, data: unknown): ReferenceScene[] {
  const view = data as { home?: unknown; scenes?: Array<Record<string, unknown>> } | null;
  if (!token.test(home) || view?.home !== home || !Array.isArray(view.scenes)) return [];
  const scenes = new Map<string, ReferenceScene>();
  for (const row of view.scenes) {
    if (!row || typeof row.id !== "string" || !token.test(row.id) || scenes.has(row.id)) continue;
    const { id, width, height } = row;
    if (row.home !== undefined && row.home !== home) continue;
    if (typeof width !== "number" || typeof height !== "number" || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) continue;
    const path = `/home-scenes/${home}/${id}.png`;
    if (row.image_url !== path) continue;
    const name = typeof row.spot_name === "string" ? row.spot_name : typeof row.station_name === "string" ? row.station_name : id;
    const angle = typeof row.view === "string" ? row.view : id.split("_").at(-1) ?? "";
    scenes.set(id, { id, name, direction: directions[angle] ?? "", image: hub.url(path), width, height });
  }
  return [...scenes.values()];
}

export function selectScanScene(scenes: readonly ReferenceScene[], photos: PhotoProgress, review: boolean): number {
  const saved = (scene: ReferenceScene) => Object.hasOwn(photos, scene.id);
  const preferred = scenes.findIndex(review ? saved : scene => !saved(scene));
  return Math.max(0, preferred);
}

type Size = { width: number; height: number };
export function photoCrop(photo: Size, reference: Size) {
  if (photo.width < photo.height || photo.height < 1 || reference.width < 1 || reference.height < 1) {
    throw new Error("폰을 가로로 들고 다시 찍어 주세요.");
  }
  const ratio = reference.width / reference.height;
  const width = Math.max(1, Math.floor(Math.min(photo.width, photo.height * ratio)));
  const height = Math.max(1, Math.floor(Math.min(photo.height, width / ratio)));
  const out = Math.min(reference.width, width, 1920);
  return { crop: { width, height, originX: Math.floor((photo.width - width) / 2), originY: Math.floor((photo.height - height) / 2) },
    size: { width: out, height: Math.max(1, Math.round(out / ratio)) } };
}

interface SignedPart { url: string; content_type: string }
interface SignedPhoto { home: string; scene_id: string; photo: SignedPart; label: SignedPart }
interface PhotoSave {
  bytes(photo: NativePhoto): Promise<Blob | ArrayBuffer>;
  keep(home: string, scene: string, photo: NativePhoto, where: SavedPhoto["where"]): Promise<SavedPhoto>;
  upload?: typeof fetch;
}

function signedUrl(part: SignedPart, expected: string): string {
  if (!part || part.content_type !== expected || typeof part.url !== "string") throw new Error("사진을 올릴 주소를 확인해 주세요.");
  const url = new URL(part.url);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error("사진을 올릴 주소를 확인해 주세요.");
  return part.url;
}

export async function saveReferencePhoto(hub: ConnectedHub, home: string, scene: ReferenceScene, photo: NativePhoto,
  { bytes, keep, upload = fetch }: PhotoSave): Promise<SavedPhoto> {
  if (!token.test(home) || !token.test(scene.id)) throw new Error("촬영할 장면을 확인해 주세요.");
  let signed: SignedPhoto;
  try {
    signed = await hub.write<SignedPhoto>(`/api/homes/${home}/shots`, { scene_id: scene.id });
  } catch (error) {
    if (error instanceof HubError && error.status === 503) return keep(home, scene.id, photo, "phone");
    throw error;
  }
  if (signed.home !== home || signed.scene_id !== scene.id) throw new Error("사진을 저장할 장면이 달라요.");
  const jpeg = signedUrl(signed.photo, "image/jpeg");
  const label = signedUrl(signed.label, "application/json");
  const put = async (address: string, type: string, body: NonNullable<RequestInit["body"]>) => {
    const response = await upload(address, { method: "PUT", headers: { "content-type": type }, body, credentials: "omit", redirect: "error" });
    if (!response.ok || response.redirected) throw new Error("서버에 사진을 저장하지 못했어요.");
  };
  await put(jpeg, "image/jpeg", await bytes(photo));
  await put(label, "application/json", JSON.stringify({ scene_id: scene.id, captured_at: photo.capturedAt, width: photo.width, height: photo.height }));
  return keep(home, scene.id, photo, "server");
}
