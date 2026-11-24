import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { findTypes } from "../src/layout/catalog.js";
import { LayoutEditor, type HereResolver, type LayoutMessage } from "../src/layout/editor.js";
import { CATALOG, scene, yaw } from "./helpers/layout.js";

const temps: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "twin-home-layout-"));
  temps.push(d);
  return d;
}
afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

function editor(opts: { here?: HereResolver; outDir?: string; libraryDir?: string; savePath?: string } = {}) {
  const e = new LayoutEditor({ homeId: "oneroom", scene: scene(), catalog: CATALOG, savePath: opts.savePath ?? join(tempDir(), "edits.json"), ...opts });
  const messages: LayoutMessage[] = [];
  e.subscribe((m) => messages.push(m));
  return { e, messages };
}

const near = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 6));

describe("옮기기", () => {
  it("절대 좌표로 옮기면 방·바닥 높이가 바뀌고 방향은 그대로", () => {
    const { e, messages } = editor();
    const r = e.move("fridge_1", { x: 3, y: 4.5 });
    expect(r.object.room).toBe("entrance");
    near(r.object.position, [3, -0.1, 4.5]);
    expect(r.object.plan.facing_deg).toBe(90);
    expect(messages).toEqual([{ type: "layout", op: "move", id: "fridge_1", room: "entrance", plan: { position: [3, 4.5], facing_deg: 90, elevation: -0.1 }, position: [3, -0.1, 4.5], rotation: [0, 0, 0] }]);
    expect(e.edits()).toEqual([{ op: "move", id: "fridge_1", position: [3, 4.5], facing_deg: 90, room: "entrance" }]);
  });

  it("상대 이동, 방향 바꾸기, 돌리기", () => {
    const { e } = editor();
    e.move("fridge_1", { dx: 0.5, dy: -0.5 });
    near(e.object("fridge_1")!.plan.position, [1.5, 0.5]);
    e.move("fridge_1", undefined, { facing_deg: 180 });
    expect(e.object("fridge_1")!.rotation[1]).toBeCloseTo(yaw(180));
    e.move("fridge_1", undefined, { turn_deg: 270 });
    expect(e.object("fridge_1")!.plan.facing_deg).toBe(90);
  });

  it("집 밖이나 고정된 것은 거절한다", () => {
    const { e } = editor();
    expect(() => e.move("fridge_1", { x: 9, y: 9 })).toThrow(/집 밖/);
    for (const id of ["walls", "door_main", "light_room"]) expect(() => e.move(id, { x: 1, y: 1 })).toThrow(/옮길 수 없/);
    expect(() => e.move("nothing", { x: 1, y: 1 })).toThrow(/찾을 수 없/);
  });

  it("받침을 옮기면 위에 놓인 물건이 같이 움직이고, 위 물건을 옮기면 받침째 옮긴다", () => {
    const { e } = editor();
    e.move("tv_stand_1", { x: 1, y: 3.5 });
    near(e.object("tv_1")!.plan.position, [1, 3.55]);
    near(e.object("tv_1")!.position, [1, 0.45, 3.55]);
    e.move("tv_1", { x: 3, y: 3.55 });
    near(e.object("tv_stand_1")!.plan.position, [3, 3.5]);
    near(e.object("tv_1")!.plan.position, [3, 3.55]);
    expect(e.edits().map((x) => x.id)).toEqual(["tv_stand_1", "tv_1"]);
  });

  it("받침을 돌리면 위 물건도 받침 중심으로 돈다", () => {
    const { e } = editor();
    e.move("tv_stand_1", undefined, { turn_deg: 90 });
    near(e.object("tv_1")!.plan.position, [1.95, 3.5]);
    expect(e.object("tv_1")!.plan.facing_deg).toBe(0);
  });

  it("벽걸이는 가장 가까운 벽 면에 붙고 벽을 등진다", () => {
    const { e } = editor({ here: () => ({ position: [1, 0.3] }) });
    e.move("ac_1", "here");
    near(e.object("ac_1")!.plan.position, [1, 0.1]);
    expect(e.object("ac_1")!.plan.facing_deg).toBe(90);
    near(e.object("ac_1")!.position, [1, 1.95, 0.1]);
  });

  it("벽걸이는 끝점 없이 외곽선만 있는 고체(기둥) 옆에서도 선 벽에 붙는다", () => {
    const withColumn = scene();
    withColumn.plan.walls!.push({ id: "column", kind: "solid", a: null, b: null, thickness: null, polygon: [[1.6, 0.2], [2.4, 0.2], [2.4, 0.6], [1.6, 0.6]] });
    const e = new LayoutEditor({ homeId: "oneroom", scene: withColumn, catalog: CATALOG, savePath: join(tempDir(), "edits.json"), here: () => ({ position: [2, 0.7] }) });
    e.move("ac_1", "here");
    near(e.object("ac_1")!.plan.position, [2, 0.1]);
    expect(e.object("ac_1")!.plan.facing_deg).toBe(90);
  });

  it("여기: 바닥 물건은 폰 쪽을 보게 놓는다", () => {
    const { e } = editor({ here: () => ({ position: [2, 2], from: [2, 3] }) });
    e.move("fridge_1", "here");
    near(e.object("fridge_1")!.plan.position, [2, 2]);
    expect(e.object("fridge_1")!.plan.facing_deg).toBe(90);
  });

  it("여기를 알 수 없으면 그 이유로 실패한다", () => {
    expect(() => editor().e.move("fridge_1", "here")).toThrow(/폰/);
    const { e } = editor({ here: () => ({ error: "조준점이 바닥에 닿지 않았어요" }) });
    expect(() => e.move("fridge_1", "here")).toThrow(/조준점/);
  });
});

describe("더하기·빼기", () => {
  it("바닥 종류를 더하면 id·이름·높이·상태가 카탈로그에서 온다", () => {
    const { e, messages } = editor();
    const r = e.add("air_purifier", { x: 3, y: 3 });
    expect(r.object).toMatchObject({
      id: "air_purifier_1", name: "공기청정기", type: "air_purifier", mount: "floor", room: "room", asset: null,
      attrs: { power: ["off", "on"] }, footprint: [0.29, 0.29], height: 0.75, interactive: true,
    });
    near(r.object.position, [3, 0, 3]);
    expect(messages.at(-1)).toMatchObject({ type: "layout", op: "add", object: { id: "air_purifier_1" } });
    expect(e.edits()).toEqual([{ op: "add", id: "air_purifier_1", type: "air_purifier", label: "공기청정기", room: "room", position: [3, 3], facing_deg: 90 }]);
    expect(e.add("air_purifier", { x: 1, y: 3 }).object.id).toBe("air_purifier_2");
  });

  it("GLB는 집 산출물 → 라이브러리 → 없음 순서로 찾는다", () => {
    const out = tempDir();
    const lib = tempDir();
    mkdirSync(join(lib, "assets", "appliances"), { recursive: true });
    writeFileSync(join(lib, "assets", "appliances", "air_purifier.glb"), "glTF");
    const { e } = editor({ outDir: out, libraryDir: lib });
    expect(e.add("air_purifier", { x: 3, y: 3 }).object.asset).toBe("lib/assets/appliances/air_purifier.glb");
    mkdirSync(join(out, "assets", "appliances"), { recursive: true });
    writeFileSync(join(out, "assets", "appliances", "air_purifier.glb"), "glTF");
    expect(e.add("air_purifier", { x: 3, y: 2 }).object.asset).toBe("assets/appliances/air_purifier.glb");
  });

  it("벽걸이 에어컨은 벽에 붙고 1.95m 높이, 천장등은 천장 높이", () => {
    const { e } = editor({ here: () => ({ position: [3.8, 1] }) });
    const ac = e.add("wall_ac", "here").object;
    near(ac.plan.position, [3.9, 1]);
    expect(ac.plan.facing_deg).toBe(180);
    expect(ac.position[1]).toBeCloseTo(1.95);
    expect(e.edits()[0]).toMatchObject({ op: "add", type: "wall_ac", elevation: 1.95 });
    expect(e.add("ceiling_light", { x: 1, y: 1 }).object.position[1]).toBeCloseTo(2.3);
  });

  it("올려놓는 종류·모르는 종류·고정 종류는 더하지 않는다", () => {
    const { e } = editor();
    expect(() => e.add("microwave", { x: 1, y: 1 })).toThrow(/올려/);
    expect(() => e.add("rocket", { x: 1, y: 1 })).toThrow(/종류/);
    expect(() => e.add("door_main", { x: 1, y: 1 })).toThrow(/더할 수 없/);
  });

  it("빼기: 원래 것은 remove, 더한 것은 수정본에서 사라지고, 받침을 빼면 위 물건도 빠진다", () => {
    const { e, messages } = editor();
    e.remove("fridge_1");
    expect(e.object("fridge_1")).toBeUndefined();
    const added = e.add("air_purifier", { x: 3, y: 3 }).object.id;
    e.remove(added);
    e.remove("tv_stand_1");
    expect(e.edits()).toEqual([{ op: "remove", id: "fridge_1" }, { op: "remove", id: "tv_stand_1" }, { op: "remove", id: "tv_1" }]);
    expect(messages.filter((m) => m.op === "remove").map((m) => (m as { id: string }).id)).toEqual(["fridge_1", added, "tv_1", "tv_stand_1"]);
  });
});

describe("수정본·되돌리기·저장", () => {
  it("더한 뒤 옮기면 add 하나, 원래 자리로 돌아오면 수정 없음", () => {
    const { e } = editor();
    e.add("air_purifier", { x: 3, y: 3 });
    e.move("air_purifier_1", { x: 1, y: 3 });
    expect(e.edits()).toEqual([{ op: "add", id: "air_purifier_1", type: "air_purifier", label: "공기청정기", room: "room", position: [1, 3], facing_deg: 90 }]);
    e.move("fridge_1", { x: 3, y: 3 });
    e.move("fridge_1", { x: 1, y: 1 });
    expect(e.edits().map((x) => x.id)).toEqual(["air_purifier_1"]);
  });

  it("연결 때 보낼 메시지와 되돌리기", () => {
    const { e, messages } = editor();
    e.move("fridge_1", { x: 3, y: 3 });
    e.remove("ac_1");
    e.add("air_purifier", { x: 1, y: 3 });
    expect(e.syncMessages().map((m) => m.op)).toEqual(["move", "remove", "add"]);
    messages.length = 0;
    e.reset();
    expect(messages.map((m) => m.op)).toEqual(["move", "add", "remove"]);
    expect(messages[0]).toMatchObject({ id: "fridge_1", plan: { position: [1, 1] } });
    expect(messages[1]).toMatchObject({ object: { id: "ac_1", type: "wall_ac" } });
    expect(e.edits()).toEqual([]);
    expect(e.syncMessages()).toEqual([]);
  });

  it("구운 장면에 없는 기본 물건(unbaked)은 연결 때 지금 자리로 add, 지우면 보내지 않고, reset() 뒤에도 남는다", () => {
    const e = new LayoutEditor({ homeId: "oneroom", scene: scene(), catalog: CATALOG, savePath: join(tempDir(), "edits.json"), unbaked: ["fridge_1"] });
    expect(e.syncMessages()).toEqual([{ type: "layout", op: "add", object: expect.objectContaining({ id: "fridge_1", plan: expect.objectContaining({ position: [1, 1] }) }) }]);
    e.move("fridge_1", { x: 3, y: 3 });
    expect(e.syncMessages()).toEqual([{ type: "layout", op: "add", object: expect.objectContaining({ id: "fridge_1", plan: expect.objectContaining({ position: [3, 3] }) }) }]);
    expect(e.edits()).toEqual([{ op: "move", id: "fridge_1", position: [3, 3], facing_deg: 90, room: "room" }]);
    e.remove("fridge_1");
    expect(e.syncMessages()).toEqual([]);
    e.reset();
    expect(e.objects().some((o) => o.id === "fridge_1")).toBe(true);
    expect(e.syncMessages().map((m) => m.op)).toEqual(["add"]);
  });

  it("저장하면 계약 B 모양의 파일, 저장 뒤 바뀐 것이 없으면 dirty false", () => {
    const path = join(tempDir(), "homes", "oneroom", "edits.json");
    const { e } = editor({ savePath: path });
    e.move("fridge_1", { x: 3, y: 3 });
    expect(e.status()).toMatchObject({ home: "oneroom", edits: 1, dirty: true });
    const r = e.save();
    expect(r).toMatchObject({ path, count: 1 });
    const file = JSON.parse(readFileSync(path, "utf8"));
    expect(file).toMatchObject({ version: 1, home: "oneroom", edits: [{ op: "move", id: "fridge_1", position: [3, 3], facing_deg: 90, room: "room" }] });
    expect(Date.parse(file.saved_at)).not.toBeNaN();
    expect(e.status().dirty).toBe(false);
    e.move("fridge_1", { dx: 0.1, dy: 0 });
    expect(e.status().dirty).toBe(true);
  });
});

describe("찾기·초점 위치", () => {
  it("이름으로 물건과 종류를 찾는다", () => {
    const { e } = editor();
    expect(e.find("냉장고").map((o) => o.id)).toEqual(["fridge_1"]);
    expect(e.find("방 에어컨").map((o) => o.id)).toEqual(["ac_1"]);
    expect(findTypes(CATALOG, "공기청정").map((t) => t.type)).toEqual(["air_purifier"]);
    expect(findTypes(CATALOG, "에어컨").map((t) => t.type)).toEqual(["wall_ac"]);
  });

  it("초점 위치는 물건 가운데 높이(천장 물건은 아래로)", () => {
    const { e } = editor();
    near(e.center("fridge_1")!.position, [1, 0.925, 1]);
    near(e.center("ac_1")!.position, [3.9, 1.95 + 0.135, 2]);
    near(e.center("light_room")!.position, [2, 2.3 - 0.04, 2]);
    expect(e.center("door_main")!.label).toBe("현관문");
    expect(e.center("nothing")).toBeUndefined();
  });
});

describe("저장한 수정본 다시 적용(재시작)", () => {
  it("다른 편집기의 수정본을 적용하면 같은 결과, 두 번 적용해도 같다", () => {
    const a = editor().e;
    a.move("fridge_1", { x: 3, y: 3 });
    a.move("tv_stand_1", undefined, { turn_deg: 90 });
    a.remove("ac_1");
    a.add("air_purifier", { x: 1, y: 3 });
    const edits = a.edits();
    const b = editor().e;
    expect(b.applyEdits(edits)).toBe(4); // tv_1은 받침을 옮길 때 이미 따라가서 자기 move는 바꾼 것이 없다
    expect(b.edits()).toEqual(edits);
    expect(b.object("tv_1")!.plan.position).toEqual(a.object("tv_1")!.plan.position);
    expect(b.status().dirty).toBe(false);
    b.applyEdits(edits);
    expect(b.edits()).toEqual(edits);
  });

  it("이미 원본에 반영된 수정본(빌드 뒤)은 아무것도 바꾸지 않는다", () => {
    const { e } = editor();
    const n = e.applyEdits([
      { op: "move", id: "fridge_1", position: [1, 1], facing_deg: 90, room: "room" },
      { op: "add", id: "fridge_1", type: "fridge", label: "냉장고", room: "room", position: [2, 2], facing_deg: 90 },
      { op: "remove", id: "gone_1" },
      { op: "add", id: "x_1", type: "rocket", label: "로켓", room: "room", position: [2, 2], facing_deg: 90 },
    ]);
    expect(n).toBe(0);
    expect(e.edits()).toEqual([]);
  });
});
