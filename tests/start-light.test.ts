// 서버 입구(src/server/boot.ts, npm start)는 시작 검사(들을 주소·가전 종류 등록부, src/server/preflight.ts)를 먼저 하고,
// 지나면 서버 묶음(src/server/start.ts: 에이전트·기록·집 실행·버스·폰, 처음 불러오면 수 초)을 불러와 띄운다. 틀린 설정이면 그 전에 바로 멈춘다.
// 기계 속도와 상관없이 「서버 묶음을 불러왔는가」로 본다.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
// 성공 경로 시험이 서버 묶음을 시험 안에서 처음 불러오지 않게, 파일을 모을 때 불러 둔다(다른 서버 시험과 같다)
import "../src/server/start.js";

const ROOT = join(import.meta.dirname, "..");

/** 서버 묶음(start.ts)을 불러오는지 지켜보며 새 모듈로 돈다. */
async function watchingStart(run: (loaded: () => boolean) => Promise<void>) {
  vi.resetModules();
  let loaded = false;
  vi.doMock("../src/server/start.js", async (importOriginal) => { loaded = true; return importOriginal(); });
  try {
    await run(() => loaded);
  } finally {
    vi.doUnmock("../src/server/start.js");
    vi.resetModules();
  }
}

describe("서버 입구", () => {
  // 이 시험은 모듈을 새로 불러오기(resetModules) 전에 돈다: 파일을 모을 때 불러 둔 서버 묶음을 그대로 쓴다
  it("검사를 지나면 서버 묶음을 불러와 띄운다", async () => {
    const dir = mkdtempSync(join(tmpdir(), "boot-"));
    try {
      const { bootServer } = await import("../src/server/boot.js");
      const srv = await bootServer({ env: { HUB: "memory", PORT: "0", HOME_ID: "oneroom", RUNTIME_DIR: dir, REFLECT_AT: "off" }, log: () => {} });
      try {
        expect(srv.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      } finally {
        await srv.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("입구를 불러와도 서버 묶음은 불러오지 않는다", async () => {
    await watchingStart(async (loaded) => {
      await import("../src/server/boot.js");
      expect(loaded()).toBe(false);
    });
  });

  it("와이파이 주소로 들으려 하면 서버 묶음을 불러오기 전에 멈춘다", async () => {
    await watchingStart(async (loaded) => {
      const { bootServer } = await import("../src/server/boot.js");
      await expect(bootServer({ env: { HUB: "memory", PORT: "0", HOST: "0.0.0.0", RUNTIME_DIR: join(ROOT, "runtime", "never-used") }, log: () => {} }))
        .rejects.toThrow(/와이파이 직접 연결은 쓰지 않아요/);
      expect(loaded()).toBe(false);
    });
  });

  it("틀린 가전 종류 등록부면 서버 묶음을 불러오기 전에 멈춘다", async () => {
    await watchingStart(async (loaded) => {
      vi.doMock("../src/devices/kinds.js", async (importOriginal) => {
        const real = await importOriginal<typeof import("../src/devices/kinds.js")>();
        return { ...real, KINDS: { ...real.KINDS, dishwasher: { ...real.KINDS.dishwasher, confirm: { command: "on", reason: (l: string) => l } } } };
      });
      try {
        const { bootServer } = await import("../src/server/boot.js");
        await expect(bootServer({ env: { HUB: "memory", PORT: "0", RUNTIME_DIR: join(ROOT, "runtime", "never-used") }, log: () => {} }))
          .rejects.toThrow(/가전 종류 등록부.*dishwasher.*confirm on/);
        expect(loaded()).toBe(false);
      } finally {
        vi.doUnmock("../src/devices/kinds.js");
      }
    });
  });
});
