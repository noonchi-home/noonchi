// apps/android/ir-remotes.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { IrRemoteView, IrView } from "../../src/contract/ir.ts";
import type { ConnectedHub } from "./connected-hub.ts";
import { buttonNameProblem, canPreset, learnLines, portLine, readIr, remoteValue, roleLabel, startLearn, testButton, waitLearn } from "./ir-remotes.ts";
import { IR_LABEL_MAX, IR_PATHS } from "../../src/contract/ir.ts";
import {
  LABEL_MAX, PATHS, POLL_MS, ROLE_CHOICES, addPreset, cancelLearn, choosePort, deleteButton, deleteRemote, firmwareLabel, readPorts, saveRemote,
} from "./ir-remotes.ts";

const tvRemote: IrRemoteView = { id: "r_0000000a", label: "거실 TV 리모컨", device: "tv_1", deviceLabel: "TV", roomLabel: "거실", deviceKind: "tv",
  buttons: [{ id: "b_00000008", label: "전원", role: "toggle", signal: "nec" }] };
const base: IrView = { ok: true, home: "mokryeon_180b", mode: "test", port: { name: "COM7", state: "connected" }, remotes: [tvRemote], learning: null, devices: [] };
const waiting = (presses: number, left_ms: number): IrView => ({ ...base, learning: { remote: tvRemote.id, label: "음량 올림", role: null, state: "waiting", presses, left_ms } });

function fakeHub(views: IrView[]) {
  const calls: { method: string; path: string; body?: object }[] = [];
  let i = 0;
  const next = () => views[Math.min(i++, views.length - 1)];
  const hub: ConnectedHub = {
    origin: "https://hub.test", url: (p) => "https://hub.test" + p,
    async get<T>(path: string) { calls.push({ method: "GET", path }); return next() as T; },
    async write<T>(path: string, body: object) { calls.push({ method: "POST", path, body }); return (path.endsWith("/test") ? { ok: true, sent: true } : next()) as T; },
  };
  return { hub, calls };
}

test("읽기·배우기·시험 쏘기는 계약 경로와 본문 그대로 부른다", async () => {
  const { hub, calls } = fakeHub([base]);
  await readIr(hub, "mokryeon_180b");
  await startLearn(hub, "mokryeon_180b", tvRemote.id, "음량 올림", null);
  await testButton(hub, "mokryeon_180b", tvRemote.id, "b_00000008");
  assert.deepEqual(calls, [
    { method: "GET", path: "/api/setup/ir?home=mokryeon_180b" },
    { method: "POST", path: "/api/setup/ir/learn", body: { home: "mokryeon_180b", remote: tvRemote.id, label: "음량 올림", role: null } },
    { method: "POST", path: "/api/setup/ir/test", body: { home: "mokryeon_180b", remote: tvRemote.id, button: "b_00000008", confirm: true } },
  ]);
});

test("배우기가 끝날 때까지 500 ms마다 읽고, 멈추면 더 읽지 않는다", async () => {
  const done: IrView = { ...base, learning: { remote: tvRemote.id, label: "음량 올림", role: null, state: "saved", presses: 1, left_ms: 0, button: "b_00000002" } };
  const { hub, calls } = fakeHub([waiting(0, 29_000), waiting(1, 28_500), done]);
  const slept: number[] = [];
  const seen: string[] = [];
  const end = await waitLearn(hub, "mokryeon_180b", { signal: new AbortController().signal, sleep: async (ms) => { slept.push(ms); }, onView: (v) => seen.push(v.learning!.state) });
  assert.equal(end.learning?.state, "saved");
  assert.deepEqual(slept, [500, 500]);
  assert.deepEqual(seen, ["waiting", "waiting", "saved"]);
  assert.equal(calls.length, 3);
  const stop = new AbortController();
  const again = fakeHub([waiting(0, 29_000)]);
  const pending = waitLearn(again.hub, "mokryeon_180b", { signal: stop.signal, sleep: async () => { stop.abort(); } });
  await assert.rejects(pending);
  assert.equal(again.calls.length, 1);
});

test("배우기 상태 글", () => {
  assert.deepEqual(learnLines(waiting(1, 23_100).learning!), { copy: ["리모컨을 수신기에 대고 「음량 올림」 단추를 두 번 누르세요.", "남은 시간 24초 · 1번 받음"], failure: "" });
  const end = (state: "timeout" | "duplicate" | "overflow" | "lost" | "saved" | "cancelled") => learnLines({ ...waiting(0, 0).learning!, state, duplicate_of: "전원" });
  assert.deepEqual(end("saved"), { copy: ["「음량 올림」 저장됨"], failure: "" });
  assert.equal(end("timeout").failure, "30초 안에 같은 신호를 두 번 받지 못했어요.");
  assert.equal(end("duplicate").failure, "「전원」 단추와 같은 신호예요.");
  assert.equal(end("overflow").failure, "신호가 너무 길어요. 단추를 짧게 눌러 주세요.");
  assert.equal(end("lost").failure, "적외선 장치 연결이 끊겼어요.");
  assert.deepEqual(end("cancelled"), { copy: ["배우기를 멈췄어요."], failure: "" });
});

test("포트·리모컨·단추 글과 프리셋 조건", () => {
  assert.equal(portLine({ name: null, state: "none" }), "적외선 장치 · 포트 고르기 전");
  assert.equal(portLine({ name: "COM7", state: "busy" }), "적외선 장치 · COM7 · 다른 프로그램이 사용 중");
  assert.equal(remoteValue(tvRemote), "거실 · TV · 단추 1개");
  assert.deepEqual([roleLabel("on"), roleLabel("off"), roleLabel("toggle"), roleLabel(null)], ["켜기", "끄기", "전원", "그 밖"]);
  assert.equal(canPreset(tvRemote), true);
  assert.equal(canPreset({ ...tvRemote, buttons: [...tvRemote.buttons, { id: "b_000000c4", label: "켜기", role: "on", signal: "nec" }] }), false);
  assert.equal(canPreset({ ...tvRemote, deviceKind: "aircon" }), false);
  assert.equal(buttonNameProblem(" "), "단추 이름을 넣어 주세요.");
  assert.equal(buttonNameProblem("가".repeat(21)), "단추 이름은 20자까지예요.");
  assert.equal(buttonNameProblem("음량 올림"), "");
});

test("경로 표·이름 길이·뜻 고르기는 계약 그대로다", () => {
  assert.deepEqual(PATHS, IR_PATHS);
  assert.equal(LABEL_MAX, IR_LABEL_MAX);
  assert.equal(POLL_MS, 500);
  assert.deepEqual(ROLE_CHOICES, ["on", "off", "toggle", null]);
});

test("포트·리모컨·단추를 바꾸는 부르기는 계약 경로와 본문 그대로다", async () => {
  const { hub, calls } = fakeHub([base]);
  await readPorts(hub);
  await choosePort(hub, "mokryeon_180b", "COM7");
  await saveRemote(hub, "mokryeon_180b", "거실 TV 리모컨", "tv_1");
  await saveRemote(hub, "mokryeon_180b", "TV 리모컨", "tv_1", tvRemote.id);
  await deleteRemote(hub, "mokryeon_180b", tvRemote.id);
  await cancelLearn(hub, "mokryeon_180b");
  await deleteButton(hub, "mokryeon_180b", tvRemote.id, "b_00000008");
  await addPreset(hub, "mokryeon_180b", tvRemote.id);
  assert.deepEqual(calls, [
    { method: "GET", path: "/api/setup/ir/ports" },
    { method: "POST", path: "/api/setup/ir/port", body: { home: "mokryeon_180b", port: "COM7" } },
    { method: "POST", path: "/api/setup/ir/remote", body: { home: "mokryeon_180b", label: "거실 TV 리모컨", device: "tv_1" } },
    { method: "POST", path: "/api/setup/ir/remote", body: { home: "mokryeon_180b", id: tvRemote.id, label: "TV 리모컨", device: "tv_1" } },
    { method: "POST", path: "/api/setup/ir/remote/delete", body: { home: "mokryeon_180b", id: tvRemote.id } },
    { method: "POST", path: "/api/setup/ir/learn/cancel", body: { home: "mokryeon_180b" } },
    { method: "POST", path: "/api/setup/ir/button/delete", body: { home: "mokryeon_180b", remote: tvRemote.id, button: "b_00000008" } },
    { method: "POST", path: "/api/setup/ir/preset", body: { home: "mokryeon_180b", remote: tvRemote.id, preset: "lg_tv_power" } },
  ]);
});

test("집 id는 주소 글자로 바꿔 붙이고, 읽기를 멈추는 신호를 허브 읽기에 넘긴다", async () => {
  const seen: { path: string; signal?: AbortSignal }[] = [];
  const hub: ConnectedHub = {
    origin: "https://hub.test", url: (p) => "https://hub.test" + p,
    async get<T>(path: string, signal?: AbortSignal) { seen.push({ path, signal }); return base as T; },
    async write<T>() { return base as T; },
  };
  const stop = new AbortController();
  await readIr(hub, "a b&c", stop.signal);
  await waitLearn(hub, "h", { signal: stop.signal, sleep: async () => {} });
  assert.deepEqual(seen.map((s) => s.path), ["/api/setup/ir?home=a%20b%26c", "/api/setup/ir?home=h"]);
  assert(seen.every((s) => s.signal === stop.signal));
});

test("포트 상태와 펌웨어 글", () => {
  const states = { connecting: "연결 중", connected: "연결됨", wrong_firmware: "다른 펌웨어", silent: "답 없음", missing: "USB 장치 없음", busy: "다른 프로그램이 사용 중", lost: "연결 끊김" } as const;
  for (const [state, text] of Object.entries(states)) assert.equal(portLine({ name: "COM7", state: state as keyof typeof states }), `적외선 장치 · COM7 · ${text}`);
  assert.deepEqual([firmwareLabel("ir_bridge"), firmwareLabel("other"), firmwareLabel("silent"), firmwareLabel("in_use")],
    ["적외선 장치", "다른 펌웨어", "답 없음", "다른 프로그램이 사용 중"]);
});
