// 장면·마스크 짝 맞추기(ui/src/dashboard/scene-sync.ts): 대시보드 폰 칸은 마스크(seen)를 그 마스크의 촬영 시각과 같은 장면(표시 영상 프레임) 위에만 그린다.
// 시각은 모두 서버 시계 촬영 시각(ms). 2026-11-20 사용자 「움직일때 오차가 너무 큰거같아」 → 「그래 맞춰」(짝 맞추기는 늘).
import { describe, expect, it } from "vitest";
import type { SeenEvent } from "../../../src/contract/events.ts";
import { createSeenStore } from "../../src/dashboard/masks";
import { SCENE_SYNC, createSceneSync, maskFor } from "../../src/dashboard/scene-sync";

const seen = (at: number, label: SeenEvent["shapes"][number]["label"] = "cup"): SeenEvent => ({
  type: "seen", at_ms: at + 300, frame_id: `e${at}`, captured_at_ms: at, frame: { width: 640, height: 360 },
  shapes: [{ label, score: 0.9, mask: { at: [0, 0, 64, 36], cols: 0, rows: 0, bits: "" } }],
});

describe("장면 시각에 그릴 마스크(maskFor)", () => {
  const masks = [seen(1000), seen(1200, "bottle")];
  it("촬영 시각이 그 장면(± 20ms) 이전인 마스크 가운데 가장 늦은 것", () => {
    expect(SCENE_SYNC.tolMs).toBe(20);
    expect(maskFor(1000, masks)?.captured_at_ms).toBe(1000);
    expect(maskFor(1190, masks)?.captured_at_ms).toBe(1200);
    expect(maskFor(1150, masks)?.captured_at_ms).toBe(1000);
    expect(maskFor(990, masks)?.captured_at_ms).toBe(1000);
    expect(maskFor(970, masks)).toBeNull();
  });
  it("앞 마스크는 장면과의 차가 holdMs(250) 안일 때만 쓴다(어긋나게 그리지 않는다)", () => {
    expect(SCENE_SYNC.holdMs).toBe(250);
    expect(maskFor(1450, masks)?.captured_at_ms).toBe(1200);
    expect(maskFor(1451, masks)).toBeNull();
  });
});

describe("장면·마스크 짝 맞추기(createSceneSync)", () => {
  it("마스크는 가장 새 것이 아니라 그 촬영 시각과 맞는 장면 위에 그린다", () => {
    const raw = createSeenStore({ hold: true });
    const sync = createSceneSync(raw);
    for (let at = 1000; at <= 1300; at += 33) sync.frame(at);
    const a = seen(1000), b = seen(1099, "bottle");
    raw.set(a);
    expect(sync.mask(a)).toBe(true);
    raw.set(b);
    expect(sync.mask(b)).toBe(true);
    // 보이는 장면은 지연만큼 늦다: 1000 장면에는 a, 1099 장면부터 b. 가장 새 seen(b)을 1000 장면에 얹지 않는다
    sync.shown(1000);
    expect(sync.store.get()).toBe(a);
    sync.shown(1066);
    expect(sync.store.get()).toBe(a);
    sync.shown(1099);
    expect(sync.store.get()).toBe(b);
  });

  it("마스크가 오기 전에 그 장면을 이미 그렸으면(늦은 마스크) 그 마스크는 그리지 않는다", () => {
    const raw = createSeenStore({ hold: true });
    const sync = createSceneSync(raw);
    sync.frame(1300);
    sync.shown(1200);
    const late = seen(1000);
    raw.set(late);
    expect(sync.mask(late)).toBe(false);
    sync.shown(1233);
    expect(sync.store.get()).toBeNull();
  });

  it("마스크가 없는 장면이 이어지면 앞 마스크를 250ms까지만 쓰고 지운다", () => {
    const raw = createSeenStore({ hold: true });
    const sync = createSceneSync(raw);
    sync.frame(1000);
    const a = seen(1000);
    sync.mask(a);
    sync.shown(1000);
    sync.shown(1250);
    expect(sync.store.get()).toBe(a);
    sync.shown(1283);
    expect(sync.store.get()).toBeNull();
  });

  it("영상을 늦추는 시간 = 최근 마스크 지연(그때 온 가장 새 장면 − 마스크 촬영 시각)의 최댓값 + 50ms, 0~800ms. 800ms 넘는 지연은 세지 않는다. 바뀌면 알린다", () => {
    expect([SCENE_SYNC.marginMs, SCENE_SYNC.maxDelayMs]).toEqual([50, 800]);
    const sync = createSceneSync(createSeenStore({ hold: true }));
    const told: number[] = [];
    sync.onDelay((ms) => told.push(ms));
    expect(sync.delayMs()).toBe(0);
    sync.frame(1300);
    sync.mask(seen(1000));
    expect(sync.delayMs()).toBe(350);
    // 더 짧은 지연이 와도 최근 최댓값을 지킨다
    sync.frame(1600);
    sync.mask(seen(1500));
    expect(sync.delayMs()).toBe(350);
    // 최근 SCENE_SYNC.lags개만 본다
    for (let i = 0; i < SCENE_SYNC.lags; i++) {
      sync.frame(2000 + i * 200 + 100);
      sync.mask(seen(2000 + i * 200));
    }
    expect(sync.delayMs()).toBe(150);
    // 800ms를 넘는 지연(다시 붙을 때 다시 보낸 옛 seen 등)은 맞출 수 없어 세지 않는다. 그 안이면 800까지
    sync.frame(20_000);
    sync.mask(seen(10_000));
    expect(sync.delayMs()).toBe(150);
    sync.frame(21_000);
    sync.mask(seen(20_240));
    expect(sync.delayMs()).toBe(800);
    expect(told).toEqual([350, 150, 800]);
  });

  it("시각이 붙은 장면을 그리기 전·시각 없는 장면·reset 뒤에는 서버 마지막 seen을 그대로 보인다(MJPEG·가짜 단계)", () => {
    const raw = createSeenStore({ hold: true });
    const sync = createSceneSync(raw);
    const a = seen(1000);
    raw.set(a);
    expect(sync.store.get()).toBe(a);
    sync.frame(5000);
    sync.shown(5000);
    expect(sync.store.get()).toBeNull();
    sync.shown(null);
    expect(sync.store.get()).toBe(a);
    sync.shown(5033);
    sync.reset();
    expect(sync.store.get()).toBe(a);
  });

  it("보이는 마스크가 바뀔 때만 듣는 쪽에 알린다", () => {
    const raw = createSeenStore({ hold: true });
    const sync = createSceneSync(raw);
    let told = 0;
    sync.store.subscribe(() => { told++; });
    sync.frame(1000);
    sync.mask(seen(1000));
    sync.shown(1000);
    sync.shown(1033);
    sync.shown(1066);
    expect(told).toBe(1);
  });
});
