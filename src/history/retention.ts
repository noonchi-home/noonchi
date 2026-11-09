// 사진 보관: 분석한 엔진 프레임은 디스크에 쓰지 않는다. 디스크에는 폰 사진 찍기 사진과 DATASET_COLLECT=1일 때의 시험 자료만 쓰고
// photos 표에 적는다. 보관 기간(PHOTO_RETENTION_DAYS, DATASET_RETENTION_DAYS, 기본 7일)이 지나면 파일(같은 이름의 .json 포함)과 표 줄을 지운다.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EngineFrame } from "../observe/ring.js";
import type { HistoryDb } from "./db.js";

const DAY_MS = 86_400_000;

const days = (env: Record<string, string | undefined>, key: string) => {
  const raw = env[key]?.trim();
  if (!raw) return 7;
  const v = Number(raw);
  if (!Number.isFinite(v) || v <= 0) throw new Error(`${key}=${raw}: 0보다 큰 숫자(일)여야 합니다`);
  return v;
};

/** 보관 기간(일). 틀린 값이면 시작을 막는다. */
export function loadRetention(env: Record<string, string | undefined>): { photoDays: number; datasetDays: number } {
  return { photoDays: days(env, "PHOTO_RETENTION_DAYS"), datasetDays: days(env, "DATASET_RETENTION_DAYS") };
}

export function sweep(db: HistoryDb, o: { photoDays: number; datasetDays: number; nowMs: number }): { photos: number; dataset: number } {
  const out = { photos: 0, dataset: 0 };
  for (const p of db.listPhotos()) {
    const keep = (p.origin === "dataset" ? o.datasetDays : o.photoDays) * DAY_MS;
    if (o.nowMs - p.atMs < keep) continue;
    rmSync(p.path, { force: true });
    rmSync(p.path.replace(/\.jpe?g$/i, ".json"), { force: true });
    db.removePhoto(p.id);
    if (p.origin === "dataset") out.dataset++;
    else out.photos++;
  }
  return out;
}

/** DATASET_COLLECT=1일 때만 쓰는 시험 자료 저장: dir/<날짜>/<프레임>-<촬영 ms>.jpg와 같은 이름의 .json(크기·자세·카메라). */
export function datasetWriter(dir: string, db: HistoryDb): (frame: EngineFrame) => void {
  return (frame) => {
    const day = db.dayOf(frame.capturedAtMs);
    const name = `${frame.id}-${frame.capturedAtMs}`;
    mkdirSync(join(dir, day), { recursive: true });
    const path = join(dir, day, `${name}.jpg`);
    writeFileSync(path, frame.jpeg);
    writeFileSync(join(dir, day, `${name}.json`), JSON.stringify({
      id: frame.id, captured_at_ms: frame.capturedAtMs, latest_at_ms: frame.latestAtMs, sha256: frame.sha256, width: frame.width, height: frame.height, eye: frame.eye, view: frame.view,
    }, null, 2));
    db.addPhoto({ id: `${day}/${name}`, atMs: frame.capturedAtMs, path, origin: "dataset" });
  };
}
