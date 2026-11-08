// @vitest-environment node
// 그리기 차례: 바뀔 때만 그린다. 한 그림 안 여러 요청은 한 번, 그리기가 「더 그려야 함」이면 다음 그림 한 번 더.
import { describe, expect, it } from "vitest";
import { RenderLoop } from "../../src/twin3d/schedule";

function fakeRaf() {
  const queue: { id: number; cb: (now: number) => void }[] = [];
  let next = 1;
  let now = 0;
  return {
    raf: (cb: (now: number) => void) => { const id = next++; queue.push({ id, cb }); return id; },
    caf: (id: number) => { const i = queue.findIndex((q) => q.id === id); if (i >= 0) queue.splice(i, 1); },
    pending: () => queue.length,
    flush: () => { const list = queue.splice(0); now += 16; for (const q of list) q.cb(now); },
  };
}

describe("그리기 차례", () => {
  it("request 두 번이면 raf 한 번", () => {
    const f = fakeRaf();
    let draws = 0;
    const loop = new RenderLoop(() => { draws++; return false; }, f.raf, f.caf);
    loop.request();
    loop.request();
    expect(f.pending()).toBe(1);
    f.flush();
    expect([draws, loop.frames, f.pending()]).toEqual([1, 1, 0]);
  });
  it("draw가 true면 다음 그림을 한 번 더, false면 멈춘다", () => {
    const f = fakeRaf();
    let left = 2;
    const loop = new RenderLoop(() => --left > 0, f.raf, f.caf);
    loop.request();
    f.flush();
    expect(f.pending()).toBe(1);
    f.flush();
    expect([loop.frames, f.pending()]).toEqual([2, 0]);
    f.flush();
    expect(loop.frames).toBe(2);
  });
  it("stop 뒤 request는 그리지 않는다", () => {
    const f = fakeRaf();
    let draws = 0;
    const loop = new RenderLoop(() => { draws++; return true; }, f.raf, f.caf);
    loop.request();
    loop.stop();
    expect(f.pending()).toBe(0);
    loop.request();
    f.flush();
    expect([draws, f.pending()]).toEqual([0, 0]);
  });
});
