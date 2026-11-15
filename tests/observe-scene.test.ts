import { afterEach, describe, expect, it } from "vitest";
import { startFakeOpenAI, type FakeServer } from "../scripts/fake-openai.js";
import { VlmClient } from "../src/infer/vlm.js";
import { analyzeScene, CLOSER_NOTE, parseScene, SCENE_JSON_SCHEMA, SCENE_PROMPT } from "../src/observe/scene.js";
import { sha256, type EngineFrame } from "../src/observe/ring.js";

let fake: FakeServer | undefined;
afterEach(async () => { await fake?.close(); fake = undefined; });
const frameAt = (id: string, capturedAtMs: number, jpeg: Buffer): EngineFrame =>
  ({ id, capturedAtMs, latestAtMs: capturedAtMs, jpeg, sha256: sha256(jpeg), width: 480, height: 360, eye: null, view: null });
type Part = { type: string; text?: string; image_url?: { url: string } };

describe("VLM 장면 분석", () => {
  it("스키마 밖 상태는 거절하고 모르는 번호는 버린다", () => {
    expect(() => parseScene('{"scene":"k","observations":[{"object_id":"d1","state":"dirty"}],"summary":"s"}', new Set(["d1"]))).toThrow();
    expect(parseScene('{"scene":"k","observations":[{"object_id":"d9","state":"empty"}],"summary":"s"}', new Set(["d1"])).observations).toEqual([]);
  });
  it("VLM 스키마 enum과 프롬프트 값 목록에 「꺼져 있음」(not_in_use)이 있다", () => {
    expect(JSON.stringify(SCENE_JSON_SCHEMA)).toContain('"not_in_use"');
    expect(SCENE_PROMPT).toContain("not_in_use");
  });
  it("JSON Schema는 엄격 모드(모든 칸 필수, 다른 칸 없음)", () => {
    expect(SCENE_JSON_SCHEMA).toMatchObject({ type: "object", additionalProperties: false, required: ["scene", "observations", "summary"] });
  });
  it("감지 목록을 같이 보내고 보이는 사실만 받는다", async () => {
    fake = await startFakeOpenAI();
    const vlm = new VlmClient({ baseUrl: `${fake.url}/v1`, model: "m", apiKey: "", extraBody: {} });
    const jpeg = Buffer.from([0xff, 0xd8]);
    const r = await analyzeScene(vlm, [frameAt("e1", 0, jpeg)], [{ id: "d1", class: "cup", box: [1, 2, 3, 4], score: 0.9 }]);
    expect(r.scene?.observations).toEqual([{ object_id: "d1", state: "contents_unknown" }]);
    const text = JSON.stringify(fake.requests.at(-1)!.body.messages);
    expect(text).toContain('Detections: [{\\"id\\":\\"d1\\"');
    expect(text).toContain("Do not infer intent");
  });
  it("최근 프레임 여러 장을 오래된 것부터 보내고, 장마다 가장 새 프레임 기준 촬영 시각을 앞에 붙인다. 감지 목록은 가장 새 프레임 것이다", async () => {
    fake = await startFakeOpenAI();
    const vlm = new VlmClient({ baseUrl: `${fake.url}/v1`, model: "m", apiKey: "", extraBody: {} });
    const frames = [0, 1, 2].map((i) => frameAt(`e${i + 1}`, 10_000 + i * 2000, Buffer.from([0xff, 0xd8, i])));
    const r = await analyzeScene(vlm, frames, [{ id: "d1", class: "cup", box: [1, 2, 3, 4], score: 0.9 }]);
    expect(r.scene?.observations).toEqual([{ object_id: "d1", state: "contents_unknown" }]);
    const content = (fake.requests.at(-1)!.body.messages as { content: Part[] }[])[0]!.content;
    expect(content.filter((p) => p.type === "image_url")).toHaveLength(3);
    const tail = content.slice(-6).map((p) => (p.type === "text" ? p.text : `img ${p.image_url!.url.slice(-4)}`));
    // [ff d8 00] → /9gA, [ff d8 01] → /9gB, [ff d8 02] → /9gC
    expect(tail).toEqual(["Photo 1 of 3, t-4s", "img /9gA", "Photo 2 of 3, t-2s", "img /9gB", "Photo 3 of 3, t-0s (latest)", "img /9gC"]);
    const text = content.filter((p) => p.type === "text").map((p) => p.text).join("\n");
    expect(text).toContain("Detections: [{\"id\":\"d1\"");
    expect(text).toContain("found in the latest photo");
    expect(text).toContain("across the photos");
  });

  it("잘라 키운 사진은 앞에 CLOSER_NOTE 한 줄을 두고 그다음 감지 목록을 보낸다", async () => {
    fake = await startFakeOpenAI();
    const vlm = new VlmClient({ baseUrl: `${fake.url}/v1`, model: "m", apiKey: "", extraBody: {} });
    await analyzeScene(vlm, [frameAt("e3.c1", 5000, Buffer.from([0xff, 0xd8, 0]))], [{ id: "d1", class: "cup", box: [220.4, 160, 40, 20], score: 0.7 }], undefined, CLOSER_NOTE);
    const content = (fake.requests.at(-1)!.body.messages as { content: Part[] }[])[0]!.content;
    const texts = content.filter((p) => p.type === "text").map((p) => p.text!);
    const at = texts.indexOf(CLOSER_NOTE);
    expect(at).toBeGreaterThan(0);
    expect(texts[at + 1]).toBe(`Detections: [{"id":"d1","class":"cup","box":[220,160,40,20]}]`);
    expect(CLOSER_NOTE).toContain("enlarged 2x");
  });

  it("프레임이 한 장이면 그 한 장만 가장 새 프레임으로 보낸다", async () => {
    fake = await startFakeOpenAI();
    const vlm = new VlmClient({ baseUrl: `${fake.url}/v1`, model: "m", apiKey: "", extraBody: {} });
    await analyzeScene(vlm, [frameAt("e1", 5000, Buffer.from([0xff, 0xd8, 0]))], []);
    const content = (fake.requests.at(-1)!.body.messages as { content: Part[] }[])[0]!.content;
    expect(content.slice(-2).map((p) => (p.type === "text" ? p.text : p.type))).toEqual(["Photo 1 of 1, t-0s (latest)", "image_url"]);
    // 실제 VLM(gpt-5.4-nano)은 한 장이면 「한 장뿐이라 변화를 볼 수 없다」 같은 말을 요약에 붙였다: 보이는 것만 쓰라고 한다
    expect(String(content[0]!.text)).toContain("With one photo or no change, describe only what is visible");
  });
});
