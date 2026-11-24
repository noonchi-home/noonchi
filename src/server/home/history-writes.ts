// 집 묶음이 버스를 거치지 않고 기록 DB에 쓰거나 읽는 일의 실패 처리(쓰기는 기록 작업 스레드 HistoryWriter가 한다).
// routineReader: 도움 습관 목록을 작업 스레드에서 읽어 들고 있다. 실패하면 마지막 목록을 쓰고 1분 뒤 다시 읽으며, 같은 실패는 한 번만 로그에 남긴다.
// photoRecorder: 사진 찍기 사진의 기록 줄을 쓰지 못하면 저장한 파일을 지운다(보관 표에 없는 파일은 보관 기간이 지나도 지워지지 않는다).
// sendAgain: 쓰기가 실패했는데 기록 DB에 아직 쓸 수 있으면(작업 스레드가 다시 뜬다) 한 번 더 보낸다.
import { rmSync } from "node:fs";
import type { HelpRoutine } from "../../brain/index.js";
import type { HistoryWriter } from "../../record/index.js";

/** 다시 읽는 간격(ms). */
const ROUTINE_MS = 60_000;

export function routineReader(o: { read: (now: number) => Promise<HelpRoutine[]>; now: () => number; log: (line: string) => void; closed: () => boolean }): {
  /** 집을 열 때 한 번 기다려 읽는다(실패하면 빈 목록). */
  load(): Promise<void>;
  /** 지금 목록. 1분이 지났으면 다시 읽기를 띄우고 지난 목록을 준다. */
  list(): HelpRoutine[];
  /** help 줄을 새로 쓴 뒤 부른다(바로 다시 읽는다). */
  changed(): void;
} {
  let cache: { at: number; list: HelpRoutine[] } = { at: -Infinity, list: [] };
  let reading: Promise<void> | null = null;
  let again = false;
  let failed: string | null = null;
  const read = (): Promise<void> => {
    if (o.closed()) return Promise.resolve();
    if (reading) {
      again = true;
      return reading;
    }
    again = false;
    const at = o.now();
    reading = o.read(at).then((list) => {
      cache = { at, list };
      failed = null;
    }, (e: Error) => {
      cache = { ...cache, at };
      if (e.message !== failed && !o.closed()) o.log(`[경고] 도움 습관을 읽지 못했어요(지난 목록을 써요): ${e.message}`);
      failed = e.message;
    }).finally(() => {
      reading = null;
      if (again) void read();
    });
    return reading;
  };
  return {
    load: read,
    list: () => {
      if (o.now() - cache.at >= ROUTINE_MS) void read();
      return cache.list;
    },
    changed: () => { void read(); },
  };
}

export function photoRecorder(write: Pick<HistoryWriter, "photo">, text: string, log: (line: string) => void): (p: { id: string; atMs: number; path: string }) => void {
  return (p) => {
    write.photo(p, text).catch((e: Error) => {
      rmSync(p.path, { force: true });
      rmSync(p.path.replace(/\.jpe?g$/i, ".json"), { force: true });
      log(`[경고] 사진 기록을 쓰지 못해 사진 파일을 지웠어요(${p.id}): ${e.message}`);
    });
  };
}

export async function sendAgain<T>(send: () => Promise<T>, writable: () => boolean): Promise<T> {
  try {
    return await send();
  } catch (e) {
    if (!writable()) throw e;
    return send();
  }
}
