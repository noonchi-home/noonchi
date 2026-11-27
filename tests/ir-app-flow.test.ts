// tests/ir-app-flow.test.ts
// 앱 리모컨 등록 흐름(apps/android/ir-remotes.ts)을 실제 허브(startServer, 가짜 보드)에 붙여 끝까지 돈다:
// 포트 고르기 → 리모컨 추가 → 단추 배우기(보드 누름 두 번) → 저장될 때까지 기다리기 → 신호 보내 보기.
// 앱의 createConnectedHub는 https /mobile/ 주소만 받아서, 같은 꼴(ok: false면 오류 글로 던짐)의 fetch 기반 가짜 ConnectedHub를 쓴다.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import type { ConnectedHub } from "../apps/android/connected-hub.js";
import { choosePort, readIr, readPorts, saveRemote, startLearn, testButton, waitLearn } from "../apps/android/ir-remotes.js";
import { fakeBoard } from "../src/devices/hub/ir-fake.js";
import { startServer, type RunningServer } from "../src/server/start.js";
import { fetchRetry } from "../src/shared/net.js";

let srv: RunningServer | undefined;
const dirs: string[] = [];
afterEach(async () => { await srv?.close(); srv = undefined; for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const HOME = "oneroom";
const PNP = "USB\\VID_1A86&PID_7523\\6&34F2BBB7&0&2";

/** 앱 ConnectedHub와 같은 꼴: JSON을 받고, 상태 코드가 틀리거나 ok: false면 서버 오류 글로 던진다. */
function fetchHub(origin: string): ConnectedHub {
  const request = async <T>(path: string, init: RequestInit): Promise<T> => {
    const r = await fetchRetry(origin + path, init);
    const data = await r.json().catch(() => null) as { ok?: unknown; error?: unknown } | null;
    if (!r.ok || !data || data.ok === false) throw new Error(typeof data?.error === "string" ? data.error : `HTTP ${r.status}`);
    return data as T;
  };
  return {
    origin, url: (path) => origin + path,
    get: (path, signal) => request(path, { signal }),
    write: (path, body, method = "POST") => request(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  };
}

it("앱 흐름: 포트를 고르고 TV 리모컨을 더한 뒤 「음량 올림」을 두 번 눌러 배우고, 저장된 단추 신호를 보드로 보낸다", async () => {
  const board = fakeBoard();
  const dir = mkdtempSync(join(tmpdir(), "ir-app-flow-"));
  dirs.push(dir);
  srv = await startServer({ env: { HUB: "memory", PORT: "0", HOME_ID: HOME, RUNTIME_DIR: dir }, log: () => {},
    irPort: board.port, irPorts: async () => [{ name: "COM7", label: "USB-SERIAL CH340", pnp: PNP, usb: true }] });
  const hub = fetchHub(srv.url);

  expect((await readPorts(hub)).ports).toEqual([{ name: "COM7", label: "USB-SERIAL CH340", firmware: "ir_bridge" }]);
  expect((await choosePort(hub, HOME, "COM7")).port.name).toBe("COM7");
  await expect.poll(async () => (await readIr(hub, HOME)).port.state, { timeout: 8000 }).toBe("connected");

  const added = await saveRemote(hub, HOME, "거실 TV 리모컨", "tv_1");
  expect(added.remotes.map((r) => [r.label, r.device, r.buttons.length])).toEqual([["거실 TV 리모컨", "tv_1", 0]]);
  const remote = added.remotes[0]!.id;

  expect((await startLearn(hub, HOME, remote, "음량 올림", null)).learning).toMatchObject({ remote, label: "음량 올림", role: null, state: "waiting", presses: 0 });
  const seen: number[] = [];
  const waiting = waitLearn(hub, HOME, { signal: new AbortController().signal, onView: (v) => seen.push(v.learning?.presses ?? -1) });
  for (let i = 0; i < 2; i++) {
    await new Promise((r) => setTimeout(r, 150));
    board.press({ protocol: "NEC", address: 4, command: 2 });
  }
  const done = await waiting;
  expect(done.learning).toMatchObject({ label: "음량 올림", state: "saved", presses: 1 });
  expect(seen[0]).toBe(0);
  const button = done.remotes[0]!.buttons.find((b) => b.id === done.learning!.button);
  expect(button).toEqual({ id: done.learning!.button, label: "음량 올림", role: null, signal: "nec" });

  const before = board.written.length;
  expect(await testButton(hub, HOME, remote, button!.id)).toEqual({ ok: true, sent: true });
  expect(board.written.slice(before)).toContain("NEC 0x4 0x2 0");
});
