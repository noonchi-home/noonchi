import { Directory, File, Paths } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { photoCrop, type NativePhoto, type PhotoProgress, type ReferenceScene, type SavedPhoto } from "./connected-scan";

const token = /^[a-zA-Z0-9_-]+$/;

export function connectedStore(origin: string) {
  const root = new Directory(Paths.document, "noonchi-hubs", encodeURIComponent(new URL(origin).host));
  const nativeHome = new File(root, "registered.json");
  const photos = (home: string) => {
    if (!token.test(home)) throw new Error("집 번호를 확인해 주세요.");
    return new Directory(root, home, "reference-photos");
  };

  return {
    async registered(): Promise<string | null> {
      if (!nativeHome.exists) return null;
      try {
        const id = JSON.parse(await nativeHome.text()) as unknown;
        return typeof id === "string" && token.test(id) ? id : null;
      } catch { return null; }
    },
    async remember(home: string) {
      if (!token.test(home)) throw new Error("집 번호를 확인해 주세요.");
      await root.create({ intermediates: true, idempotent: true });
      if (!nativeHome.exists) await nativeHome.create();
      await nativeHome.write(JSON.stringify(home));
    },
    async list(home: string): Promise<PhotoProgress> {
      const folder = photos(home);
      if (!folder.exists) return {};
      const entries = (await folder.list()).filter((entry): entry is File => entry instanceof File && entry.name.endsWith(".json"));
      entries.sort((a, b) => b.name.localeCompare(a.name));
      const result: Array<[string, SavedPhoto]> = [];
      const seen = new Set<string>();
      for (const entry of entries) {
        try {
          const { scene, where } = JSON.parse(await entry.text()) as { scene?: unknown; where?: unknown };
          if (typeof scene !== "string" || !token.test(scene) || seen.has(scene) || (where !== "server" && where !== "phone")) continue;
          const photo = new File(folder, entry.name.replace(/\.json$/, ".jpg"));
          if (!photo.exists) continue;
          seen.add(scene);
          result.push([scene, { uri: photo.uri, where }]);
        } catch { /* An interrupted record leaves earlier completed revisions readable. */ }
      }
      return Object.fromEntries(result);
    },
    async keep(home: string, scene: string, photo: NativePhoto, where: SavedPhoto["where"]): Promise<SavedPhoto> {
      if (!token.test(scene)) throw new Error("촬영 장면을 확인해 주세요.");
      const folder = photos(home);
      await folder.create({ intermediates: true, idempotent: true });
      const stamp = `${Date.now()}-${Math.random().toString(36).split(".")[1] ?? "0"}`;
      const stem = `${scene}.${stamp}`;
      const picture = new File(folder, `${stem}.jpg`);
      const record = new File(folder, `${stem}.json`);
      try {
        await new File(photo.uri).copy(picture);
        await record.create();
        await record.write(JSON.stringify({ scene, where }));
      } catch (error) {
        await removeTemporary(record.uri);
        await removeTemporary(picture.uri);
        throw error;
      }
      // Publish the new review before removing the earlier revision.
      try {
        for (const file of await folder.list()) {
          if (file instanceof File && file.name.startsWith(`${scene}.`) && file.name !== picture.name && file.name !== record.name) {
            await removeTemporary(file.uri);
          }
        }
      } catch { /* A cleanup failure does not invalidate the saved photo. */ }
      return { uri: picture.uri, where };
    },
    bytes: (photo: NativePhoto) => new File(photo.uri).arrayBuffer(),
  };
}

export type ConnectedStore = ReturnType<typeof connectedStore>;

export async function removeTemporary(uri: string) {
  try { const file = new File(uri); if (file.exists) await file.delete(); } catch { /* Cache cleanup is best effort. */ }
}

export async function prepareNativePhoto(photo: { uri: string; width: number; height: number }, reference: ReferenceScene): Promise<NativePhoto> {
  try {
    const { crop, size } = photoCrop(photo, reference);
    const context = ImageManipulator.manipulate(photo.uri);
    const image = await context.crop(crop).resize(size).renderAsync();
    const result = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.9 });
    return { uri: result.uri, width: result.width, height: result.height, capturedAt: new Date().toISOString() };
  } finally { await removeTemporary(photo.uri); }
}
