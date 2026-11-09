import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SetupApp, UPPER_BODY } from "../src/setup/SetupApp";
import { MASCOT } from "../src/dashboard/mascot-image";
import { FakeWebSocket, fakeSetupApi, setupView } from "./helpers/setup-api";

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
  history.replaceState(null, "", "/setup/");
});
afterEach(() => { vi.unstubAllGlobals(); });

function open(hash = "", view = setupView(), routes = {}) {
  history.replaceState(null, "", `/setup/${hash}`);
  const api = fakeSetupApi(view, routes);
  vi.stubGlobal("fetch", api.fetchMock);
  const navigate = vi.fn();
  render(<SetupApp navigate={navigate} />);
  return { api, navigate, user: userEvent.setup() };
}

describe("설정 1단계: 집 고르기", () => {
  it("단계 표시와 집 목록, 지금 집이 골라져 있다", async () => {
    open();
    expect(await screen.findByRole("heading", { name: "어느 집을 쓸까요?" })).toBeInTheDocument();
    const steps = within(screen.getByRole("list", { name: "설정 단계" })).getAllByRole("listitem");
    expect(steps.map((s) => s.textContent)).toEqual(["1집 고르기", "2가전 선택", "3운영 모드", "4위치 동기화"]);
    expect(steps[0]).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("radio", { name: /원룸/ })).toBeChecked();
    expect(screen.getByText("지금 띄운 집")).toBeInTheDocument();
  });

  it("단계 표시 너비는 가로 변형(data-[orientation=horizontal]:)으로 줘서 받은 w-full을 이긴다(잇는 선이 보인다)", async () => {
    open();
    await screen.findByRole("heading", { name: "어느 집을 쓸까요?" });
    const classes = screen.getByRole("list", { name: "설정 단계" }).className.split(/\s+/);
    expect(classes).toContain("data-[orientation=horizontal]:w-[min(640px,60vw)]");
    expect(classes).not.toContain("data-[orientation=horizontal]:w-full");
  });

  it("좁은 화면에서 단계 표시는 번호만 보이게 줄여 머리줄을 넘지 않는다(이름은 화면 읽기용으로 남김)", async () => {
    open();
    await screen.findByRole("heading", { name: "어느 집을 쓸까요?" });
    const list = screen.getByRole("list", { name: "설정 단계" });
    expect(list.className.split(/\s+/)).toContain("max-sm:data-[orientation=horizontal]:w-40");
    for (const t of within(list).getAllByText(/집 고르기|가전 선택|운영 모드|위치 동기화/)) expect(t.className.split(/\s+/)).toContain("max-sm:sr-only");
  });

  it("머리줄은 로고 짝(얼굴 상자 + NOONCHI)과 「설정」", async () => {
    open();
    await screen.findByRole("heading", { name: "어느 집을 쓸까요?" });
    expect(screen.getByRole("heading", { name: "NOONCHI" })).toBeInTheDocument();
    expect(screen.getByText("설정")).toBeInTheDocument();
    expect(document.querySelector("header [data-shape=logo]")).not.toBeNull();
  });

  it("다른 집을 고르고 다음: 집을 바꾸고 2단계로", async () => {
    const { api, user } = open();
    await user.click(await screen.findByRole("radio", { name: /마곡 아파트/ }));
    await user.click(screen.getByRole("button", { name: "다음" }));
    expect(await screen.findByRole("heading", { name: "어떤 가전의 상태를 읽을까요?" })).toBeInTheDocument();
    expect(api.posts("/api/setup/home")[0]!.body).toEqual({ home: "apartment" });
    expect(screen.getByRole("status")).toHaveTextContent("마곡 아파트(으)로 바꿨어요.");
    expect(location.hash).toBe("#devices");
  });

  it("집을 못 바꾸면 이유를 보이고 1단계에 남는다", async () => {
    const { user } = open("", setupView(), { "POST /api/setup/home": () => [400, { ok: false, error: "집 apartment를 띄우지 못했어요" }] });
    await user.click(await screen.findByRole("radio", { name: /마곡 아파트/ }));
    await user.click(screen.getByRole("button", { name: "다음" }));
    expect(await screen.findByText("집 apartment를 띄우지 못했어요")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "어느 집을 쓸까요?" })).toBeInTheDocument();
  });
});

describe("설정 2단계: 가전 선택", () => {
  it("처음 고르는 집은 모두 신호 없음으로 시작한다", async () => {
    open("#devices");
    expect(await screen.findByText("추가 0 · 신호 없음 5")).toBeInTheDocument();
    expect(screen.getByText("아직 추가한 가전이 없어요. 위에서 검색해서 추가하세요.")).toBeInTheDocument();
  });

  it("검색: 거실 결과, Enter로 첫 결과 추가, 초성으로 냉장고, × 로 빼기", async () => {
    const { user } = open("#devices");
    const box = await screen.findByRole("searchbox", { name: "가전 검색" });
    await user.type(box, "거실");
    const results = screen.getByRole("list", { name: "검색 결과" });
    expect(within(results).getByText("3개")).toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(screen.getByText("추가 1 · 신호 없음 4")).toBeInTheDocument();
    const picked = screen.getByRole("list", { name: "추가한 가전" });
    expect(within(picked).getByText("거실 TV")).toBeInTheDocument();
    expect(within(results).getByRole("button", { name: /거실 TV/ })).toHaveAttribute("aria-pressed", "true");
    await user.clear(box);
    await user.type(box, "ㄴㅈㄱ");
    await user.click(within(screen.getByRole("list", { name: "검색 결과" })).getByRole("button", { name: /냉장고/ }));
    expect(within(screen.getByRole("list", { name: "추가한 가전" })).getByText("냉장고")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "주방 냉장고 빼기" }));
    expect(within(screen.getByRole("list", { name: "추가한 가전" })).queryByText("냉장고")).toBeNull();
  });

  it("방 단추와 모두 추가, Escape는 검색어를 지운다", async () => {
    const { user } = open("#devices");
    await user.click(await screen.findByRole("button", { name: "거실" }));
    const box = screen.getByRole("searchbox", { name: "가전 검색" });
    expect(box).toHaveValue("거실");
    await user.click(screen.getByRole("button", { name: "모두 추가 (3)" }));
    expect(screen.getByText("추가 3 · 신호 없음 2")).toBeInTheDocument();
    await user.click(box);
    await user.keyboard("{Escape}");
    expect(box).toHaveValue("");
    expect(screen.queryByRole("list", { name: "검색 결과" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "모두 빼기" }));
    expect(screen.getByText("추가 0 · 신호 없음 5")).toBeInTheDocument();
  });

  it("다음: 추가한 가전은 virtual, 나머지는 none으로 저장하고 운영 모드 단계로", async () => {
    const { api, user } = open("#devices");
    await user.type(await screen.findByRole("searchbox", { name: "가전 검색" }), "거실 TV{Enter}");
    await user.click(screen.getByRole("button", { name: "다음" }));
    await waitFor(() => expect(api.posts("/api/setup/devices")).toHaveLength(1));
    expect(api.posts("/api/setup/devices")[0]!.body).toEqual({
      home: "oneroom",
      sources: { fridge_1: "none", tv_living: "virtual", light_living: "none", ac_living: "none", light_room1: "none" },
    });
    expect(await screen.findByRole("heading", { name: "가전을 어떻게 다룰까요?" })).toBeInTheDocument();
  });

  it("저장한 적이 있는 집은 저장한 출처로 연다", async () => {
    const view = setupView({ devices_saved: true });
    view.devices = view.devices.map((d) => ({ ...d, source: { kind: d.id === "tv_living" ? "virtual" : "none" } }));
    open("#devices", view);
    expect(await screen.findByText("추가 1 · 신호 없음 4")).toBeInTheDocument();
  });
});

describe("설정 4단계: 위치 동기화", () => {
  it("트윈·폰 서버·시작 위치를 못 쓰는 집은 상태만 보이고, 완료하고 대시보드로를 바로 누른다(건너뛰기 없음)", async () => {
    const { api, navigate, user } = open("#position");
    expect(await screen.findByText("3D 트윈을 찾을 수 없어요.")).toBeInTheDocument();
    expect(screen.getByText("폰 서버가 꺼져 있어요.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "시작 위치" })).toBeNull();
    expect(screen.queryByRole("region", { name: "배치 보정" })).toBeNull();
    expect(screen.queryByRole("button", { name: "건너뛰고 대시보드로" })).toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: "완료하고 대시보드로" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "완료하고 대시보드로" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/"));
    expect(api.posts("/api/setup/done")[0]!.body).toEqual({ home: "oneroom" });
  });

  it("폰 주소·시작 위치·배치 보정이 있으면 보인다", async () => {
    open("#position", setupView({ position: { start: true, layout: true, phone_urls: ["https://pc.tail:8210/phone/"] } }), {
      "GET /api/phone/start-pose": () => [200, { ok: true, start: null }],
      "GET /api/layout": () => [200, { ok: true, edits: 2, dirty: true }],
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "폰 연결" }));
    const addr = await screen.findByText("https://pc.tail:8210/phone/");
    expect(screen.getByRole("img", { name: "폰 연결 QR" })).toBeInTheDocument();
    // 주소는 / 뒤에서만 줄을 바꾼다
    expect(addr.closest("ul")!.className).not.toMatch(/break-all/);
    expect([...addr.childNodes].map((n) => (n.nodeName === "WBR" ? "|" : n.textContent)).join("")).toBe("https://|pc.tail:8210/|phone/|");
    expect(screen.getByText("폰 크롬에서 이 주소를 열고 시작 자리에서 「여기서 시작」을 하세요.")).toBeInTheDocument();
    const start = await screen.findByRole("region", { name: "시작 위치" });
    expect(within(start).getByRole("status")).toHaveTextContent("트윈 바닥을 눌러 폰을 켤 자리를 고르세요.");
    expect(within(start).queryByRole("button", { name: "저장" })).toBeNull();
    expect(await screen.findByText("보정 2건 · 저장 안 함")).toBeInTheDocument();
  });

  it("말풍선 안은 트윈 칸 하나: 안내 줄·폰 칩·시작 위치·배치 보정·이전·완료가 모두 트윈 칸 안에 떠 있다. A·B 칩과 벽 고르기는 없다", async () => {
    open("#position", setupView({ position: { start: true, layout: true, phone_urls: ["https://pc.tail:8210/phone/"] } }), {
      "GET /api/phone/start-pose": () => [200, { ok: true, start: null }],
      "GET /api/layout": () => [200, { ok: true, edits: 2, dirty: true }],
      "HEAD /twin/viewer/": () => [200, null],
    });
    await screen.findByText("보정 2건 · 저장 안 함");
    const box = document.querySelector<HTMLElement>("[data-twin-box]")!;
    expect(box).not.toBeNull();
    for (const el of [
      screen.getByTitle("3D 집 트윈"), screen.getByRole("region", { name: "시작 위치" }), screen.getByRole("region", { name: "배치 보정" }),
      screen.getByRole("button", { name: "폰 연결" }), screen.getByRole("button", { name: "이전" }),
      screen.getByRole("button", { name: "완료하고 대시보드로" }), screen.getAllByRole("status")[0]!,
    ]) expect(box.contains(el)).toBe(true);
    expect(screen.queryByRole("region", { name: "폰 기준점" })).toBeNull();
    expect(screen.queryByRole("button", { name: "A 다시 고르기" })).toBeNull();
    expect(screen.queryByRole("button", { name: "벽 하나로 A·B 고르기" })).toBeNull();
    expect(touchCalls()).toEqual([]);
  });
});

/** 지난 A·B 주소를 부른 적이 있는지(없어야 한다). */
function touchCalls() {
  return (vi.mocked(fetch).mock.calls as [RequestInfo | URL][]).map(([u]) => String(u)).filter((u) => u.includes("touch-points"));
}

describe("설정 4단계: 트윈에서 시작 자리와 방향 고르기", () => {
  type Start = { position: [number, number]; yaw_deg: number; label: string; facing_label: string };
  /** 위에서 보는 정사영 카메라: 캔버스 400×400 px가 평면 x 0~4, y 0~4(아래로 커짐). 픽셀 (u, v) = 평면 (u/100, v/100). */
  function topCamera() {
    const cam = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 100);
    cam.position.set(2, 10, 2);
    cam.up.set(0, 0, -1);
    cam.lookAt(2, 0, 2);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    return cam;
  }

  /**
   * 3D 트윈 iframe에 가짜 뷰어(three 카메라와 캔버스)를 붙인다. click(u, v)는 캔버스를 그 픽셀에서 짧게 누른다.
   * 저장한 시작 위치는 가짜 서버에 남고, 이름 미리 보기는 자리 → 「방 시작 위치」, 보는 쪽은 yaw가 0이면 「TV」.
   */
  async function withViewer(routes: Record<string, (body: any) => [number, unknown]> = {}, saved0: Start | null = null) {
    let saved = saved0;
    const names = (b: { yaw_deg: number }) => ({ label: "방 시작 위치", facing_label: Math.round(b.yaw_deg) === 0 ? "TV" : "" });
    const opened = open("#position", setupView({ position: { start: true, layout: false, phone_urls: [] } }), {
      "HEAD /twin/viewer/": () => [200, null],
      "GET /api/phone/start-pose": () => [200, { ok: true, start: saved }],
      "POST /api/phone/start-pose/preview": (b: Start) => [200, { ok: true, start: { position: b.position, yaw_deg: b.yaw_deg, ...names(b) } }],
      "POST /api/phone/start-pose": (b: Start) => {
        const n = names(b);
        saved = { position: b.position, yaw_deg: b.yaw_deg, label: b.label || n.label, facing_label: b.facing_label || n.facing_label };
        return [200, { ok: true, start: saved }];
      },
      "POST /api/phone/start-pose/clear": () => {
        saved = null;
        return [200, { ok: true, start: null }];
      },
      ...routes,
    });
    const frame = (await screen.findByTitle("3D 집 트윈")) as HTMLIFrameElement;
    const canvas = frame.contentDocument!.createElement("canvas");
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 400, right: 400, bottom: 400, x: 0, y: 0, toJSON: () => ({}) });
    const camera = topCamera();
    const viewer = {
      THREE, camera, cctvCamera: camera, renderer: { domElement: canvas }, view: { cctv: false },
      ready: Promise.resolve(), loading: false, results: { mode: "scene" }, setBadges: vi.fn(), setWallMode: vi.fn(),
    };
    (frame.contentWindow as unknown as { aptViewer: typeof viewer }).aptViewer = viewer;
    act(() => { frame.dispatchEvent(new Event("load")); });
    const start = await screen.findByRole("region", { name: "시작 위치" });
    await waitFor(() => expect(viewer.setBadges).toHaveBeenCalledWith(false));
    const press = async (down: [number, number], up: [number, number] = down) => {
      await act(async () => {
        canvas.dispatchEvent(new MouseEvent("pointerdown", { clientX: down[0], clientY: down[1], bubbles: true }));
        canvas.dispatchEvent(new MouseEvent("pointerup", { clientX: up[0], clientY: up[1], bubbles: true }));
      });
    };
    return { ...opened, start, viewer, canvas, click: (u: number, v: number) => press([u, v]), press, saved: () => saved };
  }

  it("바닥을 누르면 그 자리에 시작 핀, 이름은 서버가 채우고, 다른 곳을 누르면 그쪽을 본다. 저장은 자리·방향과 고치지 않은 이름(빈 글)을 보낸다", async () => {
    const { api, user, start, click } = await withViewer();
    expect(within(start).getByRole("status")).toHaveTextContent("트윈 바닥을 눌러 폰을 켤 자리를 고르세요.");
    await click(150, 250);
    await waitFor(() => expect(within(start).getByRole("textbox", { name: "시작 자리 이름" })).toHaveValue("방 시작 위치"));
    expect(api.posts("/api/phone/start-pose/preview").at(-1)!.body).toEqual({ home: "oneroom", position: [1.5, 2.5], yaw_deg: 0 });
    expect(within(start).getByRole("textbox", { name: "보는 쪽 이름" })).toHaveValue("TV");
    expect(within(start).getByRole("status")).toHaveTextContent("볼 쪽을 누르거나 화살표 끝을 끌어 방향을 정하고 저장하세요.");
    await waitFor(() => expect(document.querySelector("[data-start-spot]")).not.toBeNull());
    // 위쪽(평면 y가 작은 쪽)을 누르면 그쪽을 본다: 270°
    await click(150, 50);
    await waitFor(() => expect(api.posts("/api/phone/start-pose/preview").at(-1)!.body).toEqual({ home: "oneroom", position: [1.5, 2.5], yaw_deg: 270 }));
    await waitFor(() => expect(within(start).getByRole("textbox", { name: "보는 쪽 이름" })).toHaveValue(""));
    expect(screen.getByRole("button", { name: "완료하고 대시보드로" })).toBeDisabled();
    await user.click(within(start).getByRole("button", { name: "저장" }));
    expect(api.posts("/api/phone/start-pose").at(-1)!.body).toEqual({ home: "oneroom", position: [1.5, 2.5], yaw_deg: 270, label: "", facing_label: "" });
    await waitFor(() => expect(within(start).getByRole("status")).toHaveTextContent("저장했어요. 폰에서 이 자리에 서서 「여기서 시작」을 하세요."));
    expect(screen.getByRole("button", { name: "완료하고 대시보드로" })).toBeEnabled();
  });

  it("끌면(카메라 돌리기) 자리를 고르지 않는다. 자리 30cm 안을 누르면 방향을 바꾸지 않는다", async () => {
    const { api, start, click, press } = await withViewer();
    await press([100, 100], [180, 160]);
    expect(api.posts("/api/phone/start-pose/preview")).toEqual([]);
    expect(within(start).queryByRole("textbox", { name: "시작 자리 이름" })).toBeNull();
    await click(150, 250);
    await waitFor(() => expect(api.posts("/api/phone/start-pose/preview")).toHaveLength(1));
    await click(160, 255);
    expect(api.posts("/api/phone/start-pose/preview")).toHaveLength(1);
  });

  it("방 바닥이 아니면 서버가 거절한 까닭을 안내 줄에 띄운다", async () => {
    const { start, click } = await withViewer({
      "POST /api/phone/start-pose/preview": () => [400, { ok: false, error: "방 바닥을 눌러 주세요. 벽이나 집 밖은 시작 위치가 될 수 없어요" }],
    });
    await click(10, 10);
    await waitFor(() => expect(within(start).getByRole("status")).toHaveTextContent("방 바닥을 눌러 주세요. 벽이나 집 밖은 시작 위치가 될 수 없어요"));
  });

  it("돌리기 단추는 15°씩, 화면에서 그 방향으로 돈다(평면 각이 늘면 이 카메라에서는 시계 방향)", async () => {
    const { api, user, start, click } = await withViewer();
    await click(150, 250);
    await waitFor(() => expect(document.querySelector("[data-start-knob]")).not.toBeNull());
    await user.click(within(start).getByRole("button", { name: "시계 방향으로 15° 돌리기" }));
    await waitFor(() => expect(api.posts("/api/phone/start-pose/preview").at(-1)!.body).toMatchObject({ yaw_deg: 15 }));
    await user.click(within(start).getByRole("button", { name: "반시계 방향으로 15° 돌리기" }));
    await user.click(within(start).getByRole("button", { name: "반시계 방향으로 15° 돌리기" }));
    await waitFor(() => expect(api.posts("/api/phone/start-pose/preview").at(-1)!.body).toMatchObject({ yaw_deg: 345 }));
  });

  it("화살표 끝 손잡이를 끌면 끈 쪽을 본다", async () => {
    const { api, click } = await withViewer();
    await click(150, 250);
    const knob = await waitFor(() => {
      const k = document.querySelector<HTMLElement>("[data-start-knob]");
      expect(k).not.toBeNull();
      return k!;
    });
    // 화살표 끝: 자리(1.5, 2.5)에서 +x로 1.2m = 픽셀 (270, 250)
    expect(knob.style.left).toBe("270px");
    expect(knob.style.top).toBe("250px");
    await act(async () => {
      knob.dispatchEvent(new MouseEvent("pointerdown", { clientX: 270, clientY: 250, bubbles: true }));
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 150, clientY: 130 }));
      window.dispatchEvent(new MouseEvent("pointerup", { clientX: 150, clientY: 130 }));
    });
    await waitFor(() => expect(api.posts("/api/phone/start-pose/preview").at(-1)!.body).toMatchObject({ yaw_deg: 270 }));
  });

  it("고친 이름은 저장에 그대로 보내고, 방향을 바꿔도 덮지 않는다. 다시 고르기는 다음 누름을 새 자리로 쓴다", async () => {
    const { api, user, start, click } = await withViewer();
    await click(150, 250);
    const name = await within(start).findByRole("textbox", { name: "시작 자리 이름" });
    await waitFor(() => expect(name).toHaveValue("방 시작 위치"));
    await user.clear(name);
    await user.type(name, "현관 앞 매트");
    await click(350, 250);
    await waitFor(() => expect(api.posts("/api/phone/start-pose/preview")).toHaveLength(2));
    expect(name).toHaveValue("현관 앞 매트");
    await user.click(within(start).getByRole("button", { name: "시작 자리 다시 고르기" }));
    expect(within(start).getByRole("status")).toHaveTextContent("트윈 바닥을 눌러 새 자리를 고르세요.");
    await click(250, 150);
    await waitFor(() => expect(api.posts("/api/phone/start-pose/preview").at(-1)!.body).toMatchObject({ position: [2.5, 1.5] }));
    await user.click(within(start).getByRole("button", { name: "저장" }));
    expect(api.posts("/api/phone/start-pose").at(-1)!.body).toMatchObject({ position: [2.5, 1.5], label: "현관 앞 매트", facing_label: "" });
  });

  it("저장한 시작 위치를 불러오면 이름·안내 줄이 저장한 상태이고 완료를 누를 수 있다. 지우면 다시 고르고, 완료는 막힌다", async () => {
    const { user, start, saved } = await withViewer({}, { position: [1, 1], yaw_deg: 0, label: "소파 앞", facing_label: "TV" });
    await waitFor(() => expect(within(start).getByRole("textbox", { name: "시작 자리 이름" })).toHaveValue("소파 앞"));
    expect(within(start).getByRole("textbox", { name: "보는 쪽 이름" })).toHaveValue("TV");
    expect(within(start).getByRole("status")).toHaveTextContent("저장했어요. 폰에서 이 자리에 서서 「여기서 시작」을 하세요.");
    expect(screen.getByRole("button", { name: "완료하고 대시보드로" })).toBeEnabled();
    expect(within(start).getByRole("button", { name: "저장" })).toBeDisabled();
    await user.click(within(start).getByRole("button", { name: "지우기" }));
    await waitFor(() => expect(within(start).getByRole("status")).toHaveTextContent("지웠어요. 트윈 바닥을 눌러 다시 고르세요."));
    expect(saved()).toBeNull();
    expect(within(start).queryByRole("textbox", { name: "시작 자리 이름" })).toBeNull();
    expect(screen.getByRole("button", { name: "완료하고 대시보드로" })).toBeDisabled();
  });
});

describe("설정 4단계: 3D 트윈 보기", () => {
  type Loading = {
    ready: Promise<void>; loading: boolean; results: Record<string, unknown>;
    setBadges: ReturnType<typeof vi.fn>; setWallMode: ReturnType<typeof vi.fn>;
  };

  it("뷰어 위 막대를 숨기고, 집을 다 불러오면 배지를 끄고 캔버스를 다시 맞춘다. 벽은 낮추지 않는다", async () => {
    open("#position", setupView({ position: { start: true, layout: false, phone_urls: [] } }), {
      "HEAD /twin/viewer/": () => [200, null],
      "GET /api/phone/start-pose": () => [200, { ok: true, start: { position: [1, 1], yaw_deg: 0, label: "소파 앞", facing_label: "" } }],
    });
    const frame = (await screen.findByTitle("3D 집 트윈")) as HTMLIFrameElement;
    expect(frame.getAttribute("src")).toBe("/twin/viewer/?live=auto&embed=1&home=oneroom");
    await waitFor(() => expect(screen.getByRole("textbox", { name: "시작 자리 이름" })).toHaveValue("소파 앞"));
    const doc = frame.contentDocument!;
    doc.open();
    doc.write('<!doctype html><html><head></head><body><header class="bar">벽</header><main class="stage"></main></body></html>');
    doc.close();
    const resized = vi.fn();
    frame.contentWindow!.addEventListener("resize", resized);
    let finish!: () => void;
    const viewer: Loading = { ready: new Promise<void>((r) => { finish = r; }), loading: true, results: {}, setBadges: vi.fn(), setWallMode: vi.fn() };
    (frame.contentWindow as unknown as { aptViewer: Loading }).aptViewer = viewer;
    act(() => { frame.dispatchEvent(new Event("load")); });
    expect(frame.contentDocument!.getElementById("twin-home-embed")?.textContent).toMatch(/\.bar\s*\{\s*display:\s*none/);
    const atLoad = resized.mock.calls.length;
    expect(atLoad).toBeGreaterThan(0);
    expect(viewer.setBadges).not.toHaveBeenCalled();
    viewer.results.mode = "scene";
    viewer.loading = false;
    finish();
    await waitFor(() => expect(viewer.setBadges).toHaveBeenCalledWith(false));
    expect(resized.mock.calls.length).toBeGreaterThan(atLoad);
    expect(viewer.setWallMode).not.toHaveBeenCalled();
  });

  const openTwin = async () => {
    open("#position", setupView({ position: { start: true, layout: false, phone_urls: [] } }), {
      "HEAD /twin/viewer/": () => [200, null],
      "GET /api/phone/start-pose": () => [200, { ok: true, start: null }],
    });
    return (await screen.findByTitle("3D 집 트윈")) as HTMLIFrameElement;
  };
  /** 3D를 가리는 동안: 트윈은 숨겨 뒤의 뷰어 막대·패널이 비치지 않고, 덮개 글이 보이고 마우스를 막는다. */
  const expectCover = (text: string) => {
    const cover = screen.getByText(text);
    expect(screen.getByTitle("3D 집 트윈")).toHaveClass("invisible");
    expect(cover.closest(".pointer-events-none")).toBeNull();
  };

  it("뷰어가 집을 다 불러오고 막대를 숨기고 배지를 끌 때까지 불투명한 덮개로 가리고, 그 뒤에 걷는다", async () => {
    const frame = await openTwin();
    expectCover("3D 트윈 불러오는 중…");
    const covered = () => screen.queryByText("3D 트윈 불러오는 중…") !== null;
    const refits: boolean[] = [];
    frame.contentWindow!.addEventListener("resize", () => refits.push(covered()));
    let finish!: () => void;
    let badgesCovered: boolean | null = null;
    const viewer: Loading = {
      ready: new Promise<void>((r) => { finish = r; }), loading: true, results: {},
      setBadges: vi.fn(() => { badgesCovered = covered(); }), setWallMode: vi.fn(),
    };
    (frame.contentWindow as unknown as { aptViewer: Loading }).aptViewer = viewer;
    act(() => { frame.dispatchEvent(new Event("load")); });
    await act(async () => { await new Promise((r) => setTimeout(r, 250)); });
    expectCover("3D 트윈 불러오는 중…");
    viewer.results.mode = "scene";
    viewer.loading = false;
    finish();
    await waitFor(() => expect(screen.queryByText("3D 트윈 불러오는 중…")).not.toBeInTheDocument());
    expect(badgesCovered).toBe(true);
    expect(refits.length).toBeGreaterThan(1);
    expect(refits.at(-1)).toBe(true);
    expect(screen.queryByText("3D 트윈을 불러오지 못했어요.")).not.toBeInTheDocument();
  });

  it("뷰어가 집을 불러오지 못하면 덮개에 못 불러왔다고 띄운다", async () => {
    const frame = await openTwin();
    const viewer: Loading = { ready: Promise.resolve(), loading: false, results: { error: "scene.json 없음" }, setBadges: vi.fn(), setWallMode: vi.fn() };
    (frame.contentWindow as unknown as { aptViewer: Loading }).aptViewer = viewer;
    act(() => { frame.dispatchEvent(new Event("load")); });
    await waitFor(() => expectCover("3D 트윈을 불러오지 못했어요."));
    expect(screen.queryByText("3D 트윈 불러오는 중…")).not.toBeInTheDocument();
    expect(viewer.setBadges).not.toHaveBeenCalled();
  });
});

describe("다른 화면에서 집을 바꾸면", () => {
  it("알리고 1단계로 돌아간다", async () => {
    open("#devices");
    await screen.findByRole("heading", { name: "어떤 가전의 상태를 읽을까요?" });
    act(() => FakeWebSocket.instances.at(-1)!.emit({ type: "hello", devices: 3, provider: null, hub: "memory", home: "apartment" }));
    expect(await screen.findByText("다른 화면에서 집을 바꿨어요. 처음 단계부터 다시 볼게요.")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "어느 집을 쓸까요?" })).toBeInTheDocument();
  });
});

describe("설정 화면 배치: 마스코트가 묻고 말풍선에서 고른다", () => {
  const bubble = () => {
    const b = document.querySelector<HTMLElement>("[data-slot=message-bubble]");
    expect(b).not.toBeNull();
    return b!;
  };

  it("큰 마스코트 그림은 말풍선 밖에 있고, 1단계 카드의 작은 마스코트는 없다", async () => {
    open();
    await screen.findByRole("heading", { name: "어느 집을 쓸까요?" });
    const mascot = document.querySelector('img[src="/brand/mascot.png"]');
    expect(mascot).not.toBeNull();
    expect(bubble().contains(mascot)).toBe(false);
    expect(document.querySelector('img[src="/brand/mascot@1x.webp"]')).toBeNull();
  });

  it.each([
    ["", "어느 집을 쓸까요?", ["다음"]],
    ["#devices", "어떤 가전의 상태를 읽을까요?", ["이전", "다음"]],
    ["#mode", "가전을 어떻게 다룰까요?", ["이전", "다음"]],
    ["#position", "폰과 트윈의 위치를 맞춰요", ["이전", "완료하고 대시보드로"]],
  ])("주소 「%s」: 단계 질문이 말풍선 제목이고 단계 단추가 말풍선 안에 있다", async (hash, question, buttons) => {
    open(hash);
    const title = await screen.findByRole("heading", { name: question });
    expect(within(bubble()).getAllByRole("heading")[0]).toBe(title);
    for (const name of buttons) expect(within(bubble()).getByRole("button", { name })).toBeInTheDocument();
  });

  it("알림 줄은 말풍선 안, 제목 바로 아래에 있다", async () => {
    const { user } = open();
    await user.click(await screen.findByRole("radio", { name: /마곡 아파트/ }));
    await user.click(screen.getByRole("button", { name: "다음" }));
    const title = await screen.findByRole("heading", { name: "어떤 가전의 상태를 읽을까요?" });
    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent("마곡 아파트(으)로 바꿨어요.");
    expect(bubble().contains(notice)).toBe(true);
    expect(title.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(notice.compareDocumentPosition(screen.getByRole("searchbox", { name: "가전 검색" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("설정 화면: 상반신 마스코트와 생각 말풍선", () => {
  it("마스코트는 머리부터 LG 표시 바로 아래까지(상반신)만 보이고, LG 표시는 작은 여백을 두고 다 보인다", async () => {
    open();
    await screen.findByRole("heading", { name: "어느 집을 쓸까요?" });
    const logoBottom = MASCOT.logo.center[1] + MASCOT.logo.r;
    expect(UPPER_BODY.top).toBeLessThan(MASCOT.headTop[1]);
    expect(UPPER_BODY.cut - logoBottom).toBeGreaterThanOrEqual(8);
    expect(UPPER_BODY.cut - logoBottom).toBeLessThanOrEqual(40);
    const box = document.querySelector('img[src="/brand/mascot.png"]')!.parentElement!;
    expect(box.style.height).toBe(`calc(${UPPER_BODY.cut - UPPER_BODY.top} * var(--s))`);
  });

  it("마스코트 크기는 전의 2/3: 큰 화면은 (화면 높이 3/4·너비 34% 중 작은 쪽)의 2/3, 좁은 화면은 160px의 2/3", async () => {
    open();
    await screen.findByRole("heading", { name: "어느 집을 쓸까요?" });
    const shown = UPPER_BODY.cut - UPPER_BODY.top;
    const boxW = MASCOT.x1 - MASCOT.x0;
    const main = document.querySelector<HTMLElement>("main")!;
    expect(main.style.getPropertyValue("--s-wide")).toBe(`calc(min(75dvh / ${shown}, 34vw / ${boxW}) * 2 / 3)`);
    expect(main.style.getPropertyValue("--s-narrow")).toBe(`calc(160px / ${shown} * 2 / 3)`);
  });

  it("말풍선 밖에 빈 동그라미 셋(점점 작아짐)이 마스코트 쪽으로 이어진다", async () => {
    open();
    await screen.findByRole("heading", { name: "어느 집을 쓸까요?" });
    const main = document.querySelector<HTMLElement>("[data-slot=message-bubble][data-shape=bubble]")!;
    expect(within(main).getByRole("heading", { name: "어느 집을 쓸까요?" })).toBeInTheDocument();
    const dots = [...document.querySelectorAll<HTMLElement>("[data-slot=message-bubble][data-shape=dot]")];
    expect(dots).toHaveLength(3);
    for (const d of dots) {
      expect(main.contains(d)).toBe(false);
      expect(d.textContent).toBe("");
      expect(d.closest("[aria-hidden=true]")).not.toBeNull();
    }
    expect(dots.map((d) => d.dataset.size)).toEqual(["lg", "md", "sm"]);
    // 화면 바탕 위에서 보이게 테두리 input-line 토큰(canvas 대비 3.27:1)
    for (const d of dots) expect(d.className.split(/\s+/)).toContain("border-input-line");
  });
});

describe("설정 1단계: 집 이름", () => {
  it("집 이름은 괄호 덧붙임을 뺀 앞 이름으로 보인다", async () => {
    const homes = [{ id: "oneroom", name: "원룸 예시 (테스트용)" }, { id: "mokryeon_180b", name: "한양목련 180B (도면 기준 · 방 4·욕실 3)" }];
    open("", setupView({ home: homes[0]!, homes }));
    expect(await screen.findByRole("radio", { name: /한양목련 180B/ })).toBeInTheDocument();
    expect(screen.queryByText(/도면 기준/)).toBeNull();
    expect(screen.queryByText(/테스트용/)).toBeNull();
  });
});

describe("설정 1~3단계 큰 글(사용자 2026-11-09 「1,2,3 글씨 더 키워도될거같고」)", () => {
  const cls = (el: Element | null) => (el?.className ?? "").toString().split(/\s+/);
  it.each([
    ["", "어느 집을 쓸까요?", "다음"],
    ["#devices", "어떤 가전의 상태를 읽을까요?", "다음"],
    ["#mode", "가전을 어떻게 다룰까요?", "다음"],
  ])("주소 「%s」: 제목은 text-3xl, 이전·다음 단추는 text-lg", async (hash, question, next) => {
    open(hash);
    const title = await screen.findByRole("heading", { name: question });
    expect(cls(title)).toContain("text-3xl");
    expect(cls(screen.getByRole("button", { name: next }))).toContain("text-lg");
  });

  it("1단계 집 카드 이름은 text-lg, 설명 칩은 text-base", async () => {
    open();
    await screen.findByRole("heading", { name: "어느 집을 쓸까요?" });
    expect(cls(screen.getByText("원룸").closest("label"))).toContain("text-lg");
    expect(cls(screen.getByText("지금 띄운 집").closest("[data-slot=status]") ?? screen.getByText("지금 띄운 집"))).toContain("text-base");
  });

  it("알림 줄은 text-lg", async () => {
    const { user } = open();
    await user.click(await screen.findByRole("radio", { name: /마곡 아파트/ }));
    await user.click(screen.getByRole("button", { name: "다음" }));
    await screen.findByRole("heading", { name: "어떤 가전의 상태를 읽을까요?" });
    expect(cls(screen.getByRole("status"))).toContain("text-lg");
  });

  it("2단계 검색칸·검색 결과 줄·추가한 가전 배지는 text-base", async () => {
    const { user } = open("#devices");
    const box = await screen.findByRole("searchbox", { name: "가전 검색" });
    expect(cls(box)).toContain("text-base");
    await user.type(box, "거실");
    const row = within(screen.getByRole("list", { name: "검색 결과" })).getAllByRole("button", { pressed: false })[0]!;
    expect(row.closest("[data-slot=item]") ?? row).toHaveAttribute("data-size", "setup");
    await user.click(row);
    const badge = within(screen.getByRole("list", { name: "추가한 가전" })).getAllByRole("listitem")[0]!;
    expect(cls(badge)).toContain("text-base");
  });

  it("4단계는 그대로: 제목 title, 단추에 text-base 없음", async () => {
    open("#position");
    const title = await screen.findByRole("heading", { name: "폰과 트윈의 위치를 맞춰요" });
    expect(cls(title)).toContain("text-title");
    expect(cls(title)).not.toContain("text-headline");
    expect(cls(screen.getByRole("button", { name: "완료하고 대시보드로" }))).not.toContain("text-lg");
  });
});
