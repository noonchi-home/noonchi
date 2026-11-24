import { api } from "../lib/api";
import type { ReferenceScene } from "./scenes";

export type StorageLocation = "phone" | "server";
export type ScanProgress = Record<string, StorageLocation>;

export interface ScanStore {
  list(home: string): Promise<ScanProgress>;
  put(home: string, scene: string, where: StorageLocation, photo?: Blob): Promise<void>;
}

function openScanStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("noonchi-reference-shots", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("progress", { keyPath: ["home", "scene"] });
      request.result.createObjectStore("photos", { keyPath: ["home", "scene"] });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

interface StoredProgress { home: string; scene: string; where: StorageLocation }

export const phoneScanStore: ScanStore = {
  async list(home) {
    const db = await openScanStore();
    try {
      return await new Promise<ScanProgress>((resolve, reject) => {
        const request = db.transaction("progress").objectStore("progress")
          .getAll(IDBKeyRange.bound([home, ""], [home, "\uffff"]));
        request.onsuccess = () => {
          const rows = request.result as StoredProgress[];
          resolve(Object.fromEntries(rows.map((row) => [row.scene, row.where])));
        };
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  },
  async put(home, scene, where, photo) {
    if (where === "phone" && !photo) throw new Error("저장할 사진이 없습니다.");
    const db = await openScanStore();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(["progress", "photos"], "readwrite");
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
        if (where === "phone") tx.objectStore("photos").put({ home, scene, photo });
        else tx.objectStore("photos").delete([home, scene]);
        tx.objectStore("progress").put({ home, scene, where });
      });
    } finally {
      db.close();
    }
  },
};

export interface PreparedPhoto { blob: Blob; width: number; height: number }
export type CapturePhoto = (file: File, bounds: { width: number; height: number }) => Promise<PreparedPhoto>;

export const preparePhoto: CapturePhoto = async (file, bounds) => {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const { naturalWidth, naturalHeight } = image;
    if (naturalWidth < naturalHeight) throw new Error("폰을 가로로 돌려 다시 찍어 주세요.");
    const ratio = bounds.width / bounds.height;
    const cropWidth = Math.min(naturalWidth, naturalHeight * ratio);
    const cropHeight = cropWidth / ratio;
    const width = Math.max(1, Math.round(Math.min(bounds.width, cropWidth, 1920)));
    const height = Math.max(1, Math.round(width / ratio));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("사진 미리보기를 만들지 못했어요.");
    ctx.drawImage(image, (naturalWidth - cropWidth) / 2, (naturalHeight - cropHeight) / 2,
      cropWidth, cropHeight, 0, 0, width, height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result?.type === "image/jpeg") resolve(result);
        else reject(new Error("JPEG 사진을 만들지 못했어요."));
      }, "image/jpeg", 0.9);
    });
    return { blob, width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
};

interface SignedUpload { url: string; content_type: string }
interface ShotUpload { home: string; scene_id: string; photo: SignedUpload; label: SignedUpload }

async function putSigned(upload: SignedUpload, type: string, body: BodyInit) {
  if (!upload || upload.content_type !== type || !/^https:\/\//i.test(upload.url))
    throw new Error("업로드 주소를 확인하지 못했어요.");
  const response = await fetch(upload.url, {
    method: "PUT", headers: { "content-type": type }, body, credentials: "omit",
    referrerPolicy: "no-referrer", redirect: "error",
  });
  if (!response.ok) throw new Error("서버에 사진을 저장하지 못했어요.");
}

export async function savePhoto(home: string, scene: ReferenceScene, photo: PreparedPhoto, capturedAt: string, store: ScanStore) {
  let where: StorageLocation = "phone";
  if (!scene.demo) {
    const signed = await api<ShotUpload>("/api/homes/" + home + "/shots", { scene_id: scene.id });
    if (signed.status !== 503) {
      const shot = signed.json;
      if (!signed.ok || shot?.home !== home || shot.scene_id !== scene.id)
        throw new Error("업로드 주소를 확인하지 못했어요.");
      await putSigned(shot.photo, "image/jpeg", photo.blob);
      await putSigned(shot.label, "application/json", JSON.stringify({
        scene_id: scene.id, captured_at: capturedAt, width: photo.width, height: photo.height,
      }));
      where = "server";
    }
  }
  if (where === "phone") await store.put(home, scene.id, where, photo.blob);
  else await store.put(home, scene.id, where);
  return where;
}
