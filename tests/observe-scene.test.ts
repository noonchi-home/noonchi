import { afterEach, describe, expect, it } from "vitest";
import { startFakeOpenAI, type FakeServer } from "../scripts/fake-openai.js";
import { VlmClient } from "../src/infer/vlm.js";
import { analyzeScene, CLOSER_NOTE, parseScene, SCENE_JSON_SCHEMA, SCENE_PROMPT } from "../src/observe/scene.js";
import { CLASSES, VLM_FIND, VLM_SKIP } from "../src/world/vocab.js";
import { sha256 } from "../src/observe/ring.js";
import type { EngineFrame } from "../src/contract/observe.js";

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
    expect(SCENE_JSON_SCHEMA).toMatchObject({ type: "object", additionalProperties: false, required: ["scene", "observations", "objects", "summary"] });
  });

  // 가로 유리컵 실제 판(2026-11-18): 잘라 본 칸의 YOLO가 컵을 못 잡아 found가 비었지만 VLM은 컵을 봤다. VLM이 대상 종류 물건을 상자와 함께 답한다
  it("VLM 물건(objects): 대상 종류(컵·병·그릇)만, 상자는 그 사진 비율(0~1)이고 넓이가 있어야 하며, det는 감지 목록에 있는 번호일 때만 남는다", () => {
    const raw = {
      scene: "k", summary: "s",
      objects: [
        { id: "v1", cls: "cup", box: { x: 0.4, y: 0.5, w: 0.1, h: 0.1 }, det: null },
        { id: "v2", cls: "cup", box: { x: 0.95, y: 0.5, w: 0.1, h: 0.1 }, det: null },
        { id: "v3", cls: "bowl", box: { x: 0.2, y: 0.2, w: 0, h: 0.1 }, det: null },
        { id: "v4", cls: "bottle", box: { x: 0.1, y: 0.1, w: 0.1, h: 0.2 }, det: "d9" },
        { id: "v5", cls: "cup", box: { x: 0.6, y: 0.6, w: 0.1, h: 0.1 }, det: "d1" },
      ],
      observations: [{ object_id: "v1", state: "empty" }, { object_id: "v2", state: "empty" }, { object_id: "d1", state: "in_sink" }],
    };
    const s = parseScene(JSON.stringify(raw), new Set(["d1"]));
    expect(s.objects).toEqual([
      { id: "v1", cls: "cup", box: { x: 0.4, y: 0.5, w: 0.1, h: 0.1 }, det: null },
      { id: "v4", cls: "bottle", box: { x: 0.1, y: 0.1, w: 0.1, h: 0.2 }, det: null },
      { id: "v5", cls: "cup", box: { x: 0.6, y: 0.6, w: 0.1, h: 0.1 }, det: "d1" },
    ]);
    // 관찰은 감지 번호와 남은 VLM 물건 번호에만 단다(버린 v2의 사실도 버린다)
    expect(s.observations).toEqual([{ object_id: "v1", state: "empty" }, { object_id: "d1", state: "in_sink" }]);
    expect(() => parseScene(JSON.stringify({ ...raw, objects: [{ id: "v1", cls: "person", box: { x: 0, y: 0, w: 0.1, h: 0.1 }, det: null }] }), new Set())).toThrow();
    // objects가 없는 옛 답도 읽는다(빈 목록)
    expect(parseScene('{"scene":"k","observations":[],"summary":"s"}', new Set()).objects ?? []).toEqual([]);
  });

  // 가로 유리컵 실제 판 r2(2026-11-18): 가까이 본 VLM이 투명한 유리컵을 병(bottle)으로 답했다
  it("프롬프트가 종류 기준을 낱말 표(CLASSES vlm)에서 그대로 싣는다: 마시는 잔·유리컵·머그·텀블러는 cup, 좁은 목·마개가 있는 것만 bottle", () => {
    for (const c of VLM_FIND) expect(SCENE_PROMPT).toContain(`${c} = ${(CLASSES[c] as { vlm?: string }).vlm}`);
    expect(CLASSES.cup.vlm).toMatch(/drinking glass.*mug.*tumbler/);
    expect(CLASSES.bottle.vlm).toMatch(/narrow neck/);
    expect(SCENE_PROMPT).toContain("A clear drinking glass is a cup, not a bottle.");
    // 가로 유리컵 r6: 가까이 본 VLM이 유리잔을 그릇으로 답했다
    expect(CLASSES.bowl.vlm).toMatch(/wide, low/);
    expect(CLASSES.bowl.vlm).toMatch(/never a bowl/);
  });

  // 0af95a1·키 큰 컵 q1·q2: 「모든 컵을 답하라」에 창턱·선반 장식(트로피 모양 잔 등)도 컵으로 답해 식탁 위 컵이 여러 id로 갈라졌다. VLM 답 시간도 물건 하나에 약 0.25초 늘었다
  it("프롬프트는 컵·병·그릇 모양이어도 장식품(트로피·꽃병·장식 유리잔)은 물건 목록에 넣지 말라고 한다", () => {
    expect(SCENE_PROMPT).toContain(VLM_SKIP);
    expect(VLM_SKIP).toMatch(/trophies/);
    expect(VLM_SKIP).toMatch(/vases/);
    expect(VLM_SKIP).toMatch(/window ledge/);
  });

  it("스키마 objects의 종류 enum은 낱말 표에서 VLM 종류 기준(vlm)이 있는 물건(VLM_FIND)이고, 프롬프트가 감지 목록에 없는 물건도 상자와 함께 답하라고 한다", () => {
    const schema = JSON.stringify(SCENE_JSON_SCHEMA);
    for (const c of VLM_FIND) expect(schema).toContain(`"${c}"`);
    expect([...VLM_FIND].sort()).toEqual(["bottle", "bowl", "cup", "pot", "ramen"]);
    expect(VLM_FIND).toEqual((Object.keys(CLASSES) as (keyof typeof CLASSES)[]).filter((k) => CLASSES[k].role === "object" && "vlm" in CLASSES[k]));
    expect(SCENE_PROMPT).toContain("including ones missing from Detections");
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
