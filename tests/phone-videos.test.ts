// 영상 모드 영상 폴더: 시연 폴더(RUNTIME_DIR=runtime/demo/day1·week)로 띄운 서버도 공용 영상 폴더 runtime/videos 하나에서 영상을 내준다.
// PHONE_VIDEO_DIR로 바꿀 수 있다. 영상은 커서 시연 폴더에 복사하거나 잇지 않는다.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { fetchRetry } from "../src/shared/net.js";
import { phoneVideoDir } from "../src/server/home.js";
import { startServer, type RunningServer } from "../src/server/start.js";

const REPO_VIDEOS = fileURLToPath(new URL("../runtime/videos/", import.meta.url));

describe("영상 모드 영상 폴더", () => {
  let srv: RunningServer | undefined;
  const cleanups: (() => void)[] = [];
  afterEach(async () => {
    await srv?.close();
    srv = undefined;
    while (cleanups.length) cleanups.pop()!();
  });

  const start = async (env: Record<string, string>) => {
    srv = await startServer({ env: { HUB: "memory", PORT: "0", PHONE_PORT: "0", PHONE_HOST: "127.0.0.1", ...env }, log: () => {} });
    return new URL(srv.phoneUrls[0]!).origin;
  };

  it("RUNTIME_DIR가 시연 폴더여도 영상 폴더는 공용 runtime/videos다. PHONE_VIDEO_DIR가 있으면 그 폴더", () => {
    expect(phoneVideoDir({ RUNTIME_DIR: "runtime/demo/day1" })).toBe(REPO_VIDEOS);
    expect(phoneVideoDir({ RUNTIME_DIR: "runtime/demo/day1", PHONE_VIDEO_DIR: "D:/clips" })).toBe("D:/clips");
  });

  it("day1 폴더로 띄운 서버가 runtime/videos의 영상을 /phone/videos/로 내준다", async () => {
    const day1 = mkdtempSync(join(tmpdir(), "demo-day1-"));
    cleanups.push(() => rmSync(day1, { recursive: true, force: true }));
    mkdirSync(REPO_VIDEOS, { recursive: true });
    const name = `test-${process.pid}-${Date.now()}.mp4`;
    writeFileSync(join(REPO_VIDEOS, name), Buffer.from([0, 0, 0, 24, 1, 2, 3, 4]));
    cleanups.push(() => rmSync(join(REPO_VIDEOS, name), { force: true }));
    const origin = await start({ RUNTIME_DIR: day1 });
    const res = await fetchRetry(`${origin}/phone/videos/${name}`);
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(Buffer.from([0, 0, 0, 24, 1, 2, 3, 4]));
  });

  it("PHONE_VIDEO_DIR의 영상을 내준다", async () => {
    const clips = mkdtempSync(join(tmpdir(), "clips-"));
    const rt = mkdtempSync(join(tmpdir(), "rt-"));
    cleanups.push(() => rmSync(clips, { recursive: true, force: true }), () => rmSync(rt, { recursive: true, force: true }));
    writeFileSync(join(clips, "a.mp4"), Buffer.from([9, 8, 7]));
    const origin = await start({ RUNTIME_DIR: rt, PHONE_VIDEO_DIR: clips });
    const res = await fetchRetry(`${origin}/phone/videos/a.mp4`);
    expect(res.status).toBe(200);
  });
});
