import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { hideViewerBar } from "../src/lib/twin-embed";
import { TwinStage } from "../src/twin/TwinStage";
import { useViewer, waitForViewer } from "../src/lib/twin-viewer";

// 실제 뷰어(twin-studio main.mjs)처럼: window.aptViewer는 scene.json을 받기 전에 먼저 생기고,
// 그때 ready는 이미 풀린 Promise다. show()가 시작되면 loading=true, 끝나면 results.mode가 채워진다.
type FakeViewer = { ready: Promise<unknown>; loading: boolean; results: Record<string, unknown>; setBadges: (on: boolean) => void; setWallMode: (mode: string) => void };
const loaded = (): FakeViewer => ({ ready: Promise.resolve(), loading: false, results: { mode: "scene" }, setBadges: vi.fn(), setWallMode: vi.fn() });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const winWith = (v?: FakeViewer) => ({ aptViewer: v }) as unknown as Window & { aptViewer?: FakeViewer };

describe("waitForViewer", () => {
  it("aptViewer가 생기고 불러오기가 끝나면 돌려준다", async () => {
    const win = winWith();
    const v = loaded();
    setTimeout(() => { win.aptViewer = v; }, 30);
    await expect(waitForViewer(win, 1000)).resolves.toBe(v);
  });

  it("show() 전(ready는 풀렸지만 아직 안 불러옴)이면 불러오기가 끝날 때까지 기다린다", async () => {
    const v: FakeViewer = { ...loaded(), results: {} };
    let done = false;
    const p = waitForViewer(winWith(v), 2000).then((r) => { done = true; return r; });
    await sleep(150);
    expect(done).toBe(false);
    let finish!: () => void;
    v.loading = true;
    v.ready = new Promise<void>((r) => { finish = r; });
    await sleep(150);
    expect(done).toBe(false);
    v.results.mode = "scene";
    v.loading = false;
    finish();
    await expect(p).resolves.toBe(v);
  });

  it("불러오는 중에는 시간 제한이 지나도 기다린다", async () => {
    let finish!: () => void;
    const v: FakeViewer = { ...loaded(), ready: new Promise<void>((r) => { finish = r; }), loading: true, results: {} };
    const p = waitForViewer(winWith(v), 50);
    setTimeout(() => { v.results.mode = "scene"; v.loading = false; finish(); }, 200);
    await expect(p).resolves.toBe(v);
  });

  it("시간 안에 없으면 실패", async () => {
    await expect(waitForViewer(winWith(), 50)).rejects.toThrow("3D 트윈을 찾을 수 없어요.");
  });

  it("불러오기에 실패하면 실패", async () => {
    const v: FakeViewer = { ...loaded(), results: { mode: "scene", error: "Error: 404" } };
    await expect(waitForViewer(winWith(v), 1000)).rejects.toThrow("3D 트윈을 불러오지 못했어요.");
    const broken: FakeViewer = { ...loaded(), ready: Promise.reject(new Error("x")) };
    await expect(waitForViewer(winWith(broken), 1000)).rejects.toThrow("3D 트윈을 불러오지 못했어요.");
  });
});

function Probe() {
  return <p>{useViewer() ? "뷰어 있음" : "뷰어 없음"}</p>;
}

describe("TwinStage", () => {
  it("iframe이 뜨고 뷰어가 준비되면 배지를 끄고 덮개 자식에게 뷰어를 준다", async () => {
    render(<TwinStage><Probe /></TwinStage>);
    expect(screen.getByLabelText("3D 트윈")).toBeInTheDocument();
    expect(screen.getByText("뷰어 없음")).toBeInTheDocument();
    const frame = screen.getByTitle("3D 집 트윈") as HTMLIFrameElement;
    expect(frame.getAttribute("src")).toBe("/twin/viewer/?live=auto&embed=1");
    const v = loaded();
    (frame.contentWindow as Window & { aptViewer?: FakeViewer }).aptViewer = v;
    frame.dispatchEvent(new Event("load"));
    expect(await screen.findByText("뷰어 있음")).toBeInTheDocument();
    expect(v.setBadges).toHaveBeenCalledWith(false);
  });

  it("뷰어가 준비되면 벽을 한 번만 모두 낮춘다(그 뒤 벽 선택은 사용자 몫)", async () => {
    const { rerender } = render(<TwinStage><Probe /></TwinStage>);
    const frame = screen.getByTitle("3D 집 트윈") as HTMLIFrameElement;
    const v = loaded();
    (frame.contentWindow as Window & { aptViewer?: FakeViewer }).aptViewer = v;
    frame.dispatchEvent(new Event("load"));
    await screen.findByText("뷰어 있음");
    rerender(<TwinStage><Probe /><p>다시 그림</p></TwinStage>);
    expect(v.setWallMode).toHaveBeenCalledTimes(1);
    expect(v.setWallMode).toHaveBeenCalledWith("low");
  });
});

describe("뷰어 위 막대 숨기기", () => {
  it("hideViewerBar는 막대를 숨기는 스타일을 한 번만 넣고 resize를 보낸다", () => {
    const doc = document.implementation.createHTMLDocument("viewer");
    hideViewerBar(doc);
    hideViewerBar(doc);
    const styles = doc.querySelectorAll("style#twin-home-embed");
    expect(styles).toHaveLength(1);
    expect(styles[0]!.textContent).toMatch(/\.bar\s*\{\s*display:\s*none/);
  });

  it("iframe이 뜨면 뷰어 문서에 막대 숨김을 넣고 캔버스가 다시 크기를 재게 한다", async () => {
    render(<TwinStage><Probe /></TwinStage>);
    const frame = screen.getByTitle("3D 집 트윈") as HTMLIFrameElement;
    const doc = frame.contentDocument!;
    doc.open();
    doc.write('<!doctype html><html><head></head><body><header class="bar">벽</header><main class="stage"></main></body></html>');
    doc.close();
    const resized = vi.fn();
    frame.contentWindow!.addEventListener("resize", resized);
    (frame.contentWindow as Window & { aptViewer?: FakeViewer }).aptViewer = loaded();
    frame.dispatchEvent(new Event("load"));
    expect(frame.contentDocument!.getElementById("twin-home-embed")).not.toBeNull();
    expect(resized).toHaveBeenCalled();
    await screen.findByText("뷰어 있음");
  });
});
