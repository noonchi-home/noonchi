// 버스를 거치지 않는 기록 쓰기의 실패 처리(src/server/home/history-writes.ts):
// 도움 습관 다시 읽기는 실패하면 마지막 목록을 쓰고 같은 실패는 한 번만 로그에 남긴다,
// 사진 줄을 쓰지 못하면 저장한 사진 파일을 지운다, 도움 줄·하루 기억 고정은 기록 DB에 아직 쓸 수 있으면 한 번 다시 보낸다.
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { HelpRoutine } from "../src/brain/index.js";
import { photoRecorder, routineReader, sendAgain } from "../src/server/home/history-writes.js";

const routine = (action: string) => ({ action }) as unknown as HelpRoutine;
const flush = () => new Promise((r) => setImmediate(r));

describe("도움 습관 다시 읽기", () => {
  it("다시 읽기가 실패하면 마지막 목록을 쓰고, 같은 실패는 한 번만 로그에 남기며 1분 뒤에 다시 읽는다", async () => {
    let now = 0;
    let answer: () => Promise<HelpRoutine[]> = async () => [routine("물 가져오기")];
    const read = vi.fn((_at: number) => answer());
    const logs: string[] = [];
    const reader = routineReader({ read, now: () => now, log: (l) => logs.push(l), closed: () => false });
    await reader.load();
    expect(reader.list()).toEqual([routine("물 가져오기")]);
    answer = async () => { throw new Error("기록 DB 작업 스레드가 끝나 쓰지 못했어요"); };
    for (let k = 1; k <= 3; k++) {
      now = k * 60_000;
      expect(reader.list()).toEqual([routine("물 가져오기")]);
      await flush();
      // 250ms마다 불러도 실패한 뒤 1분 안에는 다시 읽지 않는다
      now += 250;
      reader.list();
      await flush();
    }
    expect(read).toHaveBeenCalledTimes(4);
    expect(logs).toHaveLength(1);
    answer = async () => [routine("약 알려 주기")];
    reader.changed();
    await flush();
    expect(reader.list()).toEqual([routine("약 알려 주기")]);
    answer = async () => { throw new Error("기록 DB 작업 스레드가 끝나 쓰지 못했어요"); };
    reader.changed();
    await flush();
    expect(logs).toHaveLength(2);
  });

  it("처음 읽기가 실패해도 빈 목록으로 집을 연다", async () => {
    const logs: string[] = [];
    const reader = routineReader({ read: async () => { throw new Error("못 읽음"); }, now: () => 0, log: (l) => logs.push(l), closed: () => false });
    await reader.load();
    expect(reader.list()).toEqual([]);
    expect(logs).toHaveLength(1);
  });
});

describe("사진 줄", () => {
  const dir = mkdtempSync(join(tmpdir(), "photo-"));
  const save = (name: string) => {
    const path = join(dir, `${name}.jpg`);
    writeFileSync(path, "jpeg");
    writeFileSync(join(dir, `${name}.json`), "{}");
    return { id: name, atMs: 1, path };
  };

  it("사진 줄을 두 번 다 쓰지 못하면 저장한 사진과 크기 정보 파일을 지우고, 쓰면 둔다", async () => {
    const logs: string[] = [];
    let tries = 0;
    const failing = photoRecorder({ photo: async () => { tries++; throw new Error("못 씀"); }, writable: () => true }, "사진 저장", (l) => logs.push(l));
    const lost = save("lost");
    failing(lost);
    await vi.waitFor(() => expect(existsSync(lost.path)).toBe(false));
    expect(existsSync(join(dir, "lost.json"))).toBe(false);
    expect(tries).toBe(2);
    expect(logs).toHaveLength(1);
    const ok = photoRecorder({ photo: async () => {}, writable: () => true }, "사진 저장", () => {});
    const kept = save("kept");
    ok(kept);
    await flush();
    expect(existsSync(kept.path)).toBe(true);
  });

  it("작업 스레드가 한 번 다시 떠서 첫 쓰기가 실패해도 한 번 더 보내 사진을 둔다", async () => {
    let tries = 0;
    const record = photoRecorder({ photo: async () => { if (tries++ === 0) throw new Error("작업 스레드가 끝남"); }, writable: () => true }, "사진 저장", () => {});
    const photo = save("again");
    record(photo);
    await vi.waitFor(() => expect(tries).toBe(2));
    await flush();
    expect(existsSync(photo.path)).toBe(true);
  });

  it("파일 지우기가 실패해도 처리 안 된 거절 없이 로그만 남긴다", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => { unhandled.push(e); };
    process.on("unhandledRejection", onUnhandled);
    try {
      const logs: string[] = [];
      // 폴더는 rmSync(force)로 지우지 못한다(EISDIR)
      const folder = mkdtempSync(join(dir, "folder-"));
      const record = photoRecorder({ photo: async () => { throw new Error("못 씀"); }, writable: () => false }, "사진 저장", (l) => logs.push(l));
      record({ id: "folder", atMs: 1, path: folder });
      await vi.waitFor(() => expect(logs.length).toBeGreaterThanOrEqual(1));
      await new Promise((r) => setTimeout(r, 50));
      expect(unhandled).toEqual([]);
      expect(existsSync(folder)).toBe(true);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});

describe("한 번 더 보내기", () => {
  it("실패했는데 기록 DB에 아직 쓸 수 있으면 한 번 더 보내고, 못 쓰면(작업 스레드가 3번 죽음) 다시 보내지 않는다", async () => {
    let calls = 0;
    const once = () => (++calls === 1 ? Promise.reject(new Error("작업 스레드가 끝남")) : Promise.resolve("커밋"));
    await expect(sendAgain(once, () => true)).resolves.toBe("커밋");
    expect(calls).toBe(2);
    calls = 0;
    await expect(sendAgain(once, () => false)).rejects.toThrow("작업 스레드가 끝남");
    expect(calls).toBe(1);
    calls = 0;
    await expect(sendAgain(() => (++calls, Promise.reject(new Error("또 실패"))), () => true)).rejects.toThrow("또 실패");
    expect(calls).toBe(2);
  });
});
