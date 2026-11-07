import { afterEach, describe, expect, it } from "vitest";
import { startFakeOpenAI, type FakeServer } from "../scripts/fake-openai.js";
import { VlmClient } from "../src/infer/vlm.js";
import { analyzeScene, parseScene, SCENE_JSON_SCHEMA } from "../src/observe/scene.js";
import { sha256 } from "../src/observe/ring.js";

let fake: FakeServer | undefined;
afterEach(async () => { await fake?.close(); fake = undefined; });

describe("VLM 장면 분석", () => {
  it("스키마 밖 상태는 거절하고 모르는 번호는 버린다", () => {
    expect(() => parseScene('{"scene":"k","observations":[{"object_id":"d1","state":"dirty"}],"summary":"s"}', new Set(["d1"]))).toThrow();
    expect(parseScene('{"scene":"k","observations":[{"object_id":"d9","state":"empty"}],"summary":"s"}', new Set(["d1"])).observations).toEqual([]);
  });
  it("JSON Schema는 엄격 모드(모든 칸 필수, 다른 칸 없음)", () => {
    expect(SCENE_JSON_SCHEMA).toMatchObject({ type: "object", additionalProperties: false, required: ["scene", "observations", "summary"] });
  });
  it("감지 목록을 같이 보내고 보이는 사실만 받는다", async () => {
    fake = await startFakeOpenAI();
    const vlm = new VlmClient({ baseUrl: `${fake.url}/v1`, model: "m", apiKey: "", extraBody: {} });
    const jpeg = Buffer.from([0xff, 0xd8]);
    const r = await analyzeScene(vlm, { id: "e1", capturedAtMs: 0, latestAtMs: 0, jpeg, sha256: sha256(jpeg), width: 480, height: 360, eye: null, view: null },
      [{ id: "d1", class: "cup", box: [1, 2, 3, 4], score: 0.9 }]);
    expect(r.scene?.observations).toEqual([{ object_id: "d1", state: "contents_unknown" }]);
    const text = JSON.stringify(fake.requests.at(-1)!.body.messages);
    expect(text).toContain('Detections: [{\\"id\\":\\"d1\\"');
    expect(text).toContain("Do not infer intent");
  });
});
