// 루트 시험에서 실제 AI API로 가는 fetch는 보내기 전에 막힌다. 네트워크로 나가지 않고 확인한다.
import { describe, expect, it } from "vitest";
import { blockRealAi } from "./setup/no-real-ai.js";

describe("실제 AI 주소 차단", () => {
  it("OpenAI·OpenRouter·Anthropic 주소는 안쪽 fetch를 부르지 않고 오류, 로컬 주소는 그대로 보낸다", async () => {
    const seen: string[] = [];
    const guarded = blockRealAi((async (u: string) => { seen.push(String(u)); return new Response("{}"); }) as unknown as typeof fetch);
    for (const u of ["https://api.openai.com/v1/models", "https://openrouter.ai/api/v1/chat/completions", "https://api.anthropic.com/v1/messages"]) {
      await expect(guarded(u)).rejects.toThrow(/실제 AI API/);
    }
    await expect(guarded(new Request("https://api.openai.com/v1/responses"))).rejects.toThrow(/실제 AI API/);
    await guarded("http://127.0.0.1:9/v1/models");
    expect(seen).toEqual(["http://127.0.0.1:9/v1/models"]);
  });
  it("루트 시험의 전역 fetch는 AI·ThinQ 차단을 둘 다 거친다", async () => {
    expect((globalThis.fetch as { blocksRealAi?: boolean }).blocksRealAi).toBe(true);
    expect((globalThis.fetch as { noRealThinq?: boolean }).noRealThinq).toBe(true);
    await expect(fetch("https://api.openai.com/v1/models")).rejects.toThrow(/실제 AI API/);
  });
});
