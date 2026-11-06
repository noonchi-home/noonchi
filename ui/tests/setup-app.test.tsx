import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SetupApp } from "../src/setup/SetupApp";
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
  it("트윈·폰 서버·기준점이 없으면 상태만 보이고, 건너뛰면 끝내고 대시보드로", async () => {
    const { api, navigate, user } = open("#position");
    expect(await screen.findByText("3D 트윈을 찾을 수 없어요.")).toBeInTheDocument();
    expect(screen.getByText("폰 서버가 꺼져 있어요.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "폰 기준점" })).toBeNull();
    expect(screen.queryByRole("region", { name: "배치 보정" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "건너뛰고 대시보드로" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/"));
    expect(api.posts("/api/setup/done")[0]!.body).toEqual({ home: "oneroom" });
  });

  it("폰 주소·기준점·배치 보정이 있으면 보인다", async () => {
    open("#position", setupView({ position: { touch: true, layout: true, phone_urls: ["https://pc.tail:8210/phone/"] } }), {
      "GET /api/phone/touch-points": () => [200, { ok: true, points: null, mode: "floor", eye_height_m: 1.5, distance_m: null }],
      "GET /api/layout": () => [200, { ok: true, edits: 2, dirty: true }],
    });
    expect(await screen.findByText("https://pc.tail:8210/phone/")).toBeInTheDocument();
    expect(screen.getByText("폰 크롬에서 이 주소를 열고 기준점을 조준해 기록하세요.")).toBeInTheDocument();
    const touch = await screen.findByRole("region", { name: "폰 기준점" });
    expect(within(touch).getAllByRole("button", { name: "3D에서 고르기" })).toHaveLength(2);
    expect(within(touch).getByRole("button", { name: "저장" })).toBeDisabled();
    expect(within(touch).getAllByText("미지정")).toHaveLength(2);
    expect(await screen.findByText("보정 2건 · 저장 안 함")).toBeInTheDocument();
  });
});

describe("설정 4단계: 벽 하나로 A·B 구석 고르기", () => {
  type Hit = { position: [number, number]; room?: string; normal?: [number, number] } | null;
  const A = { id: "A", label: "방 구석", position: [3.9, 0.1] };
  const B = { id: "B", label: "방 맞은편 구석", position: [0.1, 3.94] };

  /** 3D 트윈 iframe에 가짜 뷰어를 붙인다. pick(hit)으로 벽을 누른 것처럼 한다. */
  async function withViewer(auto: (body: any) => [number, unknown]) {
    const opened = open("#position", setupView({ position: { touch: true, layout: false, phone_urls: [] } }), {
      "HEAD /twin/viewer/": () => [200, null],
      "GET /api/phone/touch-points": () => [200, { ok: true, points: null, mode: "floor", eye_height_m: 1.5, distance_m: null }],
      "POST /api/phone/touch-points/auto": auto,
      "POST /api/phone/touch-points": (b: { points: { label: string; position: number[] }[] }) => [200, {
        ok: true, points: b.points.map((p, i) => ({ id: i ? "B" : "A", ...p })), mode: "touch", eye_height_m: 1.5, distance_m: 5.403,
      }],
    });
    let cb: ((hit: Hit) => void) | null = null;
    const viewer = { startPick: vi.fn((fn: (hit: Hit) => void) => { cb = fn; }), cancelPick: vi.fn(), setTouchPoints: vi.fn() };
    const frame = (await screen.findByTitle("3D 집 트윈")) as HTMLIFrameElement;
    (frame.contentWindow as unknown as { aptViewer: typeof viewer }).aptViewer = viewer;
    const touch = await screen.findByRole("region", { name: "폰 기준점" });
    const pick = async (hit: Hit) => { await act(async () => { cb!(hit); }); };
    return { ...opened, viewer, touch, pick };
  }

  it("벽 하나를 누르면 A·B 구석과 이름·거리를 채우고, 저장은 그 두 점을 보낸다", async () => {
    const { api, user, viewer, touch, pick } = await withViewer(() => [200, { ok: true, points: [A, B], distance_m: 5.403 }]);
    await user.click(within(touch).getByRole("button", { name: "벽 하나로 A·B 고르기" }));
    expect(within(touch).getByRole("status")).toHaveTextContent("3D 트윈에서 벽 하나를 누르세요.");
    await pick({ position: [3, 0.1], room: "room", normal: [0, 1] });
    expect(api.posts("/api/phone/touch-points/auto")[0]!.body).toEqual({ home: "oneroom", position: [3, 0.1], room: "room", normal: [0, 1] });
    await waitFor(() => expect(within(touch).getByRole("status")).toHaveTextContent("A–B 수평 거리 5.40m. 저장하면 폰이 이 두 구석으로 맞춰요."));
    expect(within(touch).getByRole("textbox", { name: "A 지점 이름" })).toHaveValue("방 구석");
    expect(within(touch).getByRole("textbox", { name: "B 지점 이름" })).toHaveValue("방 맞은편 구석");
    expect(within(touch).getByText("벽 위치 (3.90, 0.10)m")).toBeInTheDocument();
    expect(viewer.setTouchPoints).toHaveBeenLastCalledWith([
      { id: "A", label: "방 구석", position: [3.9, 0.1] },
      { id: "B", label: "방 맞은편 구석", position: [0.1, 3.94] },
    ]);
    await user.click(within(touch).getByRole("button", { name: "저장" }));
    expect(api.posts("/api/phone/touch-points")[0]!.body).toEqual({
      home: "oneroom", points: [{ label: "방 구석", position: [3.9, 0.1] }, { label: "방 맞은편 구석", position: [0.1, 3.94] }],
    });
  });

  it("A만 오면 B를 비우고 B를 고르라고 한다. B는 손으로 고른다", async () => {
    const { user, touch, pick, api } = await withViewer(() => [200, { ok: true, points: [A], distance_m: null }]);
    await user.click(within(touch).getByRole("button", { name: "벽 하나로 A·B 고르기" }));
    await pick({ position: [3, 0.1], room: "room", normal: [0, 1] });
    await waitFor(() => expect(within(touch).getByRole("status")).toHaveTextContent("A 구석을 골랐어요. B 지점을 고르세요."));
    expect(within(touch).getByRole("textbox", { name: "A 지점 이름" })).toHaveValue("방 구석");
    expect(within(touch).getByRole("textbox", { name: "B 지점 이름" })).toHaveValue("");
    expect(within(touch).getByText("미지정")).toBeInTheDocument();
    expect(within(touch).getByRole("button", { name: "저장" })).toBeDisabled();
    await user.click(within(touch).getAllByRole("button", { name: "3D에서 고르기" })[1]!);
    await pick({ position: [0.1, 3.94], room: "room", normal: [1, 0] });
    await waitFor(() => expect(within(touch).getByRole("status")).toHaveTextContent("A–B 수평 거리 5.40m. 저장하면 폰이 이 두 벽으로 맞춰요."));
    await user.click(within(touch).getByRole("button", { name: "저장" }));
    expect(api.posts("/api/phone/touch-points")[0]!.body).toEqual({
      home: "oneroom", points: [{ label: "방 구석", position: [3.9, 0.1] }, { label: "", position: [0.1, 3.94] }],
    });
  });

  it("구석이 없으면 점을 그대로 두고 알린다", async () => {
    const { user, touch, pick, api } = await withViewer(() => [200, { ok: true, points: [], distance_m: null }]);
    await user.click(within(touch).getByRole("button", { name: "벽 하나로 A·B 고르기" }));
    await pick({ position: [2, 2] });
    expect(api.posts("/api/phone/touch-points/auto")[0]!.body).toEqual({ home: "oneroom", position: [2, 2] });
    await waitFor(() => expect(within(touch).getByRole("status")).toHaveTextContent("이 벽에서 구석을 찾지 못했어요. 다른 벽을 누르거나 A·B를 직접 고르세요."));
    expect(within(touch).getAllByText("미지정")).toHaveLength(2);
  });

  it("고르기를 취소하면 서버에 묻지 않는다", async () => {
    const { user, touch, pick, api } = await withViewer(() => [200, { ok: true, points: [A, B], distance_m: 5.403 }]);
    await user.click(within(touch).getByRole("button", { name: "벽 하나로 A·B 고르기" }));
    await pick(null);
    expect(within(touch).getByRole("status")).toHaveTextContent("고르기를 취소했어요.");
    expect(api.posts("/api/phone/touch-points/auto")).toHaveLength(0);
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
