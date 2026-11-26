import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as connected from "./connected-hub.ts";

const { activeHome, createConnectedHub, readHomeCard, startPositionLabel } = connected;

const origin = "https://dashboard.example.test";
const home = { id: "mokryeon_180b", name: "한양목련 180B" };
const other = { id: "oneroom", name: "원룸" };
const pose = { position: [4, 5], yaw_deg: 30, label: "식탁 앞", facing_label: "식탁" };
const source = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");

function fixture() {
  let active = home;
  const saved = new Map<string, unknown>([[other.id, pose]]);
  const calls: string[] = [];
  let changedAfterRead = false;
  let online = true;
  let startAvailable = true;
  const hub = createConnectedHub(origin + "/mobile/", async (target, init) => {
    const path = new URL(String(target)).pathname;
    const method = init?.method ?? "GET";
    calls.push(method + " " + path);
    const response = (body: object, status = 200) => Object.defineProperty(Response.json(body, { status }), "url", { value: String(target) });
    let result: object;
    if (path === "/api/setup") {
      if (!online) return response({ ok: false, error: "허브 연결 실패" }, 503);
      result = { ok: true, home: active, switching: false, position: { start: true } };
    } else if (method === "GET") {
      if (!startAvailable) return response({ ok: false, error: "시작 위치 없음" }, 404);
      result = { ok: true, start: saved.get(active.id) ?? null };
      if (changedAfterRead) active = other;
    } else {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.home, active.id);
      if (path.endsWith("/clear")) saved.delete(body.home);
      else saved.set(body.home, pose);
      result = { ok: true, start: saved.get(active.id) ?? null };
    }
    return response(result);
  });
  return { hub, calls, select: (item: typeof home) => { active = item; }, switchDuringRead: () => { changedAfterRead = true; },
    connect: (value: boolean) => { online = value; }, allowStart: (value: boolean) => { startAvailable = value; } };
}

test("returning to the registered home reads the actual saved start after save and clear", async () => {
  const { hub, calls } = fixture();
  const label = async () => {
    const card = await readHomeCard(hub, home.id);
    return startPositionLabel(true, home.id, card.reading, card.startFailed);
  };
  assert.equal(await label(), "미설정");
  assert.deepEqual(calls, ["GET /api/setup", "GET /api/phone/start-pose", "GET /api/setup"]);
  await hub.write("/api/phone/start-pose", { home: home.id, ...pose });
  assert.equal(await label(), "설정됨");
  await hub.write("/api/phone/start-pose/clear", { home: home.id });
  assert.equal(await label(), "미설정");
});

test("a different house, a switched house and an unavailable lookup cannot appear saved", async () => {
  const { hub, select, switchDuringRead } = fixture();
  select(other);
  const previous = await readHomeCard(hub, other.id);
  assert.equal(startPositionLabel(true, home.id, previous.reading, false), "확인 중");
  assert.equal((await readHomeCard(hub, home.id)).reading, undefined);
  select(home);
  switchDuringRead();
  const changed = await readHomeCard(hub, home.id);
  assert.deepEqual(changed.setup.home, other);
  assert.equal(changed.reading, undefined);
  assert.equal(startPositionLabel(true, home.id, undefined, true), "확인 실패");
  assert.equal(startPositionLabel(false, home.id, undefined, false), "사용 불가");
  assert.equal(activeHome(null, null), null);
});

test("a setup failure loses the connection, while start-pose 404 keeps the hub reachable and allows recovery", async () => {
  const { hub, connect, allowStart } = fixture();
  const check = () => readHomeCard(hub, home.id);
  assert.deepEqual((await check()).setup.home, home);
  connect(false);
  await assert.rejects(check(), /허브 연결 실패/);
  connect(true);
  allowStart(false);
  const reachable = await check();
  assert.deepEqual(reachable.setup.home, home);
  assert.equal(startPositionLabel(true, home.id, reachable.reading, reachable.startFailed), "확인 실패");
  allowStart(true);
  assert.equal(startPositionLabel(true, home.id, (await check()).reading, false), "미설정");
});

test("only the start row opens the existing editor and Android Back returns to the home", () => {
  const screen = source("ConnectedHome.tsx");
  assert.match(screen, /<Text[^>]*>대시보드 연결<\/Text>/);
  assert.match(screen, /connected \? "연결됨" : "연결 끊김"/);
  assert.match(screen, /AppState\.addEventListener\("change", /);
  assert.match(screen, /<Pressable[^>]*onPress=\{openStartPosition\}/);
  assert.match(screen, /initialPage=\{editingHubHouse \? "house" : directStart \? "position" : undefined\}/);
  assert.match(screen, /BackHandler\.addEventListener\("hardwareBackPress", backFromStart\)/);
  assert.match(screen, /<Action title="클로이드 켜기" onPress=\{\(\) => \{[\s\S]+?onStart\(\);/);
  assert.doesNotMatch(screen, /<Action title="클로이드 켜기" disabled=/);
  const settings = source("ConnectedSettings.tsx");
  assert.match(settings, /<PositionSetting \{\.\.\.context\} \/>/);
  assert.match(settings, /backToHome \? "홈으로" : backToHouse \? "집 관리로" : "설정 목록으로"/);
});

test("native mode and appliance settings use the connection wording in the empty and save branches", () => {
  const settings = source("ConnectedSettings.tsx");
  assert.match(settings, /이 집에는 연결할 가전이 없어요\./);
  assert.match(settings, /title="연결 저장"/);
  assert.match(settings, /value="연결한 가전 사용"/);
  assert.doesNotMatch(settings, /짝짓기|짝지은/);
});
