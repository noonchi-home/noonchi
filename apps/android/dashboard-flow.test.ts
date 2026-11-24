import assert from "node:assert/strict";
import { test } from "node:test";
import { createDashboardFlow } from "./dashboard-flow.ts";

const qr = "https://hub.example.test/mobile/";
const portal = "https://hub.example.test/mobile/?tab=home";

function pending<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const done = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { done, resolve, reject };
}

test("a fresh launch accepts one QR and opens AR only after an explicit press on the connected home", async () => {
  const check = pending<string>();
  const scans: string[] = [];
  const urls: string[] = [];
  const flow = createDashboardFlow({
    connect: (raw) => { scans.push(raw); return check.done; },
    open: async (url) => { urls.push(url); },
  });
  const epoch = flow.view().cameraEpoch;
  await flow.scan(qr, epoch);
  assert.equal(flow.view().screen.kind, "launch");
  assert.deepEqual(scans, []);
  flow.finishLaunch();
  const connect = flow.scan(qr, flow.view().cameraEpoch);
  await flow.scan(qr, flow.view().cameraEpoch);
  assert.equal(flow.view().screen.kind, "checking");
  assert.deepEqual(scans, [qr]);
  assert.deepEqual(urls, []);
  check.resolve(portal);
  await connect;
  assert.deepEqual(urls, []);
  assert.deepEqual(flow.view().screen, { kind: "dashboard", url: portal, opening: false });
  await flow.startAr();
  assert.deepEqual(urls, [portal]);
  assert.deepEqual(flow.view().screen, { kind: "dashboard", url: portal, opening: false });
});

test("returning from the trusted AR browser keeps the QR camera off until disconnect", async () => {
  const urls: string[] = [];
  const flow = createDashboardFlow({ connect: async () => portal, open: async (url) => { urls.push(url); } });
  flow.finishLaunch();
  const oldCamera = flow.view().cameraEpoch;
  await flow.scan(qr, oldCamera);
  await flow.startAr();
  flow.setActive(false);
  flow.setActive(true);
  assert.equal(flow.view().screen.kind, "dashboard");
  await flow.scan(qr, oldCamera);
  assert.deepEqual(urls, [portal]);
  await flow.startAr();
  assert.deepEqual(urls, [portal, portal]);
  flow.retryScan();
  assert.equal(flow.view().screen.kind, "scan");
  await flow.scan(qr, oldCamera);
  assert.deepEqual(urls, [portal, portal]);
});

test("backgrounding aborts validation and a late answer cannot open the AR browser", async () => {
  const check = pending<string>();
  let signal: AbortSignal | undefined;
  const urls: string[] = [];
  const flow = createDashboardFlow({
    connect: (_, options) => { signal = options?.signal; return check.done; },
    open: async (url) => { urls.push(url); },
  });
  flow.finishLaunch();
  const oldCamera = flow.view().cameraEpoch;
  const connecting = flow.scan(qr, oldCamera);
  flow.setActive(false);
  assert.equal(signal?.aborted, true);
  assert.equal(flow.view().active, false);
  flow.setActive(true);
  check.resolve(portal);
  await connecting;
  assert.deepEqual(urls, []);
  assert.deepEqual(flow.view().screen, { kind: "scan", message: "QR 확인을 중단했어요. 다시 찍어 주세요." });
});

test("validation failures and camera failures require a fresh scan without leaving the app", async () => {
  let attempts = 0;
  const flow = createDashboardFlow({
    connect: async () => { attempts++; throw new Error("대시보드 QR을 찍어 주세요."); },
    open: async () => assert.fail("unverified URL opened"),
  });
  flow.finishLaunch();
  const epoch = flow.view().cameraEpoch;
  await flow.scan(qr, epoch);
  await flow.scan(qr, epoch);
  assert.equal(attempts, 1);
  assert.deepEqual(flow.view().screen, { kind: "scan", message: "대시보드 QR을 찍어 주세요." });
  flow.retryScan();
  flow.cameraFailed(epoch);
  assert.deepEqual(flow.view().screen, { kind: "scan" });
  flow.cameraFailed(flow.view().cameraEpoch);
  assert.equal(flow.view().screen.kind, "scan");
  await flow.scan(qr, flow.view().cameraEpoch);
  assert.equal(attempts, 1);
});

test("a TWA error preserves the connected home and prevents overlapping opens", async () => {
  const launch = pending<void>();
  let attempts = 0;
  const flow = createDashboardFlow({
    connect: async () => portal,
    open: async () => { if (++attempts === 1) await launch.done; },
  });
  flow.finishLaunch();
  await flow.scan(qr, flow.view().cameraEpoch);
  const opening = flow.startAr();
  await Promise.resolve();
  await flow.startAr();
  assert.equal(attempts, 1);
  launch.reject(new Error("Chrome에서 신뢰 관계를 확인하지 못했어요."));
  await opening;
  assert.deepEqual(flow.view().screen, { kind: "dashboard", url: portal, opening: false,
    message: "Chrome에서 신뢰 관계를 확인하지 못했어요." });
  await flow.startAr();
  assert.equal(attempts, 2);
});

test("backgrounding a pending AR launch cancels it and keeps the hub available", async () => {
  const launch = pending<void>();
  let signal: AbortSignal | undefined;
  const flow = createDashboardFlow({ connect: async () => portal, open: async (_, options) => {
    signal = options.signal;
    await launch.done;
  } });
  flow.finishLaunch();
  await flow.scan(qr, flow.view().cameraEpoch);
  const opening = flow.startAr();
  flow.setActive(false);
  assert.equal(signal?.aborted, true);
  assert.deepEqual(flow.view().screen, { kind: "dashboard", url: portal, opening: false });
  launch.reject(new Error("late error"));
  await opening;
  flow.setActive(true);
  assert.deepEqual(flow.view().screen, { kind: "dashboard", url: portal, opening: false });
});
