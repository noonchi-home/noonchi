import dotenv from "dotenv";
import { describe, expect, it } from "vitest";
import { serverEnv, serverPlan } from "../scripts/twin3d/dev.js";

describe("dev3d 서버 환경", () => {
  it("폰 서버·두뇌는 빈 값으로 넣어 .env가 다시 채우지 못한다", () => {
    const env = serverEnv("oneroom", { PATH: "x", PHONE_PORT: "8210", BRAIN: "1" });
    expect(env).toMatchObject({ PATH: "x", PORT: "8201", HUB: "memory", HOME_ID: "oneroom", RUNTIME_DIR: "runtime-3d", PHONE_PORT: "", BRAIN: "" });
    dotenv.populate(env as Record<string, string>, { PHONE_PORT: "8210", BRAIN: "1", OTHER: "y" });
    expect([env.PHONE_PORT, env.BRAIN, env.OTHER]).toEqual(["", "", "y"]);
  });
});

describe("dev3d 서버 환경: 실제 모델 주소 막기", () => {
  it("VLM·PAM·에이전트 주소는 닫힌 이 PC 포트, 키는 빈 값으로 넣어 준비 검사가 밖으로 나가지 않고 .env가 다시 채우지 못한다", () => {
    const real = { OPENAI_BASE_URL: "https://api.openai.com/v1", OPENAI_API_KEY: "k1", ANTHROPIC_API_KEY: "k2", VLM_BASE_URL: "https://vlm.example/v1", VLM_API_KEY: "k3", PAM_URL: "http://10.0.0.5:8300", INFERENCE_MODE: "live", AGENT_PROVIDER: "anthropic" };
    const env = serverEnv("mokryeon_180b", { PATH: "x", ...real });
    expect(env).toMatchObject({
      INFERENCE_MODE: "mock", AGENT_PROVIDER: "openai", OPENAI_BASE_URL: "http://127.0.0.1:9/v1", VLM_BASE_URL: "http://127.0.0.1:9/v1", PAM_URL: "http://127.0.0.1:9",
      OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "", VLM_API_KEY: "",
    });
    dotenv.populate(env as Record<string, string>, real);
    expect([env.OPENAI_BASE_URL, env.OPENAI_API_KEY, env.ANTHROPIC_API_KEY, env.VLM_API_KEY, env.PAM_URL]).toEqual(["http://127.0.0.1:9/v1", "", "", "", "http://127.0.0.1:9"]);
  });
});

describe("dev3d start: 떠 있는 서버의 집", () => {
  it("안 떠 있으면 띄우고, 같은 집이면 그대로 둔다", () => {
    expect(serverPlan("mokryeon_180b", null, false)).toBe("launch");
    expect(serverPlan("mokryeon_180b", { home: "mokryeon_180b" }, false)).toBe("keep");
  });
  it("다른 집이면 내가 띄운 서버는 다시 켜고, 남이 띄운 서버면 멈춘다", () => {
    expect(serverPlan("oneroom", { home: "mokryeon_180b" }, true)).toBe("restart");
    expect(() => serverPlan("oneroom", { home: "mokryeon_180b" }, false)).toThrow("8201에 다른 집(mokryeon_180b) 서버가 떠 있어요");
    expect(() => serverPlan("oneroom", { home: null }, false)).toThrow("8201에 다른 집(모름) 서버가 떠 있어요");
  });
});
