// Redis 디스크 저장이 켜져 있으면 noonchi는 시작하지 않고 무엇을 바꾸라는 오류를 낸다(사진·메시지가 디스크에 남지 않게).
import { describe, expect, it } from "vitest";
import { assertNoPersistence } from "../src/bus/redis.js";

const config = (v: Record<string, string>) => async (name: string) => v[name] ?? "";

describe("Redis 디스크 저장 끔 확인", () => {
  it("appendonly no·save 빈 값이면 통과", async () => {
    await expect(assertNoPersistence(config({ appendonly: "no", save: "" }))).resolves.toBeUndefined();
  });

  it("AOF나 RDB 저장이 켜져 있으면 바꿀 설정을 말하며 실패", async () => {
    await expect(assertNoPersistence(config({ appendonly: "yes", save: "" }))).rejects.toThrow('Redis 디스크 저장이 켜져 있어요(appendonly=yes, save=""). redis-server를 --appendonly no --save ""로 띄우세요');
    await expect(assertNoPersistence(config({ appendonly: "no", save: "3600 1" }))).rejects.toThrow(/save="3600 1"/);
  });
});
