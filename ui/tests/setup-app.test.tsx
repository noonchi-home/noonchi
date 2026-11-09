import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    const addr = await screen.findByText("https://pc.tail:8210/phone/");
    // 주소는 / 뒤에서만 줄을 바꾼다
    expect(addr.closest("ul")!.className).not.toMatch(/break-all/);
    expect([...addr.childNodes].map((n) => (n.nodeName === "WBR" ? "|" : n.textContent)).join("")).toBe("https://|pc.tail:8210/|phone/|");
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

  /**
   * 3D 트윈 iframe에 가짜 뷰어를 붙인다. pick(hit)으로 벽을 누른 것처럼 한다. 방 묻기는 기본으로 뷰어가 보낸 방을 그대로 답한다.
   * 저장한 점은 가짜 서버에 남고, reopen()은 화면을 닫았다 다시 열어 그 점을 불러온다.
   */
  async function withViewer(auto: (body: any) => [number, unknown], over: Parameters<typeof setupView>[0] = {}, routes: Record<string, (body: any) => [number, unknown]> = {}) {
    let saved: { id: string; label: string; position: number[] }[] | null = null;
    const start = () => open("#position", setupView({ position: { touch: true, layout: false, phone_urls: [] }, ...over }), {
      "HEAD /twin/viewer/": () => [200, null],
      "GET /api/phone/touch-points": () => [200, { ok: true, points: saved, mode: saved ? "touch" : "floor", eye_height_m: 1.5, distance_m: saved ? 5.403 : null }],
      "POST /api/phone/touch-points/auto": auto,
      "POST /api/phone/touch-points/room": (b: { room?: string }) => [200, { ok: true, room: b.room ?? null }],
      "POST /api/phone/touch-points": (b: { points: { label: string; position: number[] }[] }) => {
        saved = b.points.map((p, i) => ({ id: i ? "B" : "A", ...p }));
        return [200, { ok: true, points: saved, mode: "touch", eye_height_m: 1.5, distance_m: 5.403 }];
      },
      ...routes,
    });
    const attach = async (opened: ReturnType<typeof open>) => {
      let cb: ((hit: Hit) => void) | null = null;
      const viewer = { startPick: vi.fn((fn: (hit: Hit) => void) => { cb = fn; }), cancelPick: vi.fn(), setTouchPoints: vi.fn() };
      const frame = (await screen.findByTitle("3D 집 트윈")) as HTMLIFrameElement;
      (frame.contentWindow as unknown as { aptViewer: typeof viewer }).aptViewer = viewer;
      const touch = await screen.findByRole("region", { name: "폰 기준점" });
      const pick = async (hit: Hit) => { await act(async () => { cb!(hit); }); };
      return { ...opened, viewer, touch, pick };
    };
    const first = await attach(start());
    return { ...first, reopen: async () => { cleanup(); return attach(start()); } };
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

  describe("손으로 다시 고른 지점 이름", () => {
    const rooms = { rooms: [{ id: "room", label: "방" }, { id: "bathroom", label: "욕실" }, { id: "living", label: "거실" }, { id: "long", label: "가".repeat(45) }] };
    const both = (): [number, unknown] => [200, { ok: true, points: [A, B], distance_m: 5.403 }];
    const name = (touch: HTMLElement, id: "A" | "B") => within(touch).getByRole("textbox", { name: `${id} 지점 이름` });

    async function steps(routes: Record<string, (body: any) => [number, unknown]> = {}) {
      const first = await withViewer(both, rooms, routes);
      let v: Awaited<ReturnType<typeof first.reopen>> = first;
      /** 화면을 닫았다 다시 연다. 저장한 점을 불러온 뒤 새 화면을 돌려준다. auto·byHand는 새 화면에서 돈다. */
      const reopen = async (id: "A" | "B", label: string) => {
        v = await first.reopen();
        await waitFor(() => expect(name(v.touch, id)).toHaveValue(label));
        return v;
      };
      const save = async () => {
        await v.user.click(within(v.touch).getByRole("button", { name: "저장" }));
        await waitFor(() => expect(within(v.touch).getByRole("status")).toHaveTextContent("저장했어요."));
      };
      const auto = async () => {
        await v.user.click(within(v.touch).getByRole("button", { name: "벽 하나로 A·B 고르기" }));
        await v.pick({ position: [3, 0.1], room: "room", normal: [0, 1] });
        await waitFor(() => expect(name(v.touch, "B")).toHaveValue("방 맞은편 구석"));
      };
      const byHand = async (id: "A" | "B", hit: Hit) => {
        await v.user.click(within(v.touch).getAllByRole("button", { name: "3D에서 고르기" })[id === "A" ? 0 : 1]!);
        await v.pick(hit);
        await waitFor(() => expect(within(v.touch).getByRole("status")).not.toHaveTextContent("지점의 벽을 누르세요."));
      };
      return { ...first, auto, byHand, save, reopen };
    }

    it("구석을 채운 뒤 손으로 다시 고르면 그 방 벽 이름으로 바꾸고, 방 이름을 모르면 비운다", async () => {
      const { api, user, viewer, touch, auto, byHand } = await steps();
      await auto();
      await byHand("B", { position: [2, 3.94], room: "room", normal: [0, -1] });
      expect(name(touch, "B")).toHaveValue("방 벽");
      expect(name(touch, "A")).toHaveValue("방 구석");
      expect(viewer.setTouchPoints).toHaveBeenLastCalledWith([
        { id: "A", label: "방 구석", position: [3.9, 0.1] },
        { id: "B", label: "방 벽", position: [2, 3.94] },
      ]);
      await byHand("A", { position: [0.1, 1], room: "hall", normal: [1, 0] });
      expect(name(touch, "A")).toHaveValue("");
      expect(viewer.setTouchPoints).toHaveBeenLastCalledWith([
        { id: "A", label: "A 지점", position: [0.1, 1] },
        { id: "B", label: "방 벽", position: [2, 3.94] },
      ]);
      await user.click(within(touch).getByRole("button", { name: "저장" }));
      expect(api.posts("/api/phone/touch-points")[0]!.body).toEqual({
        home: "oneroom", points: [{ label: "", position: [0.1, 1] }, { label: "방 벽", position: [2, 3.94] }],
      });
    });

    it("구석 이름을 고친 뒤 손으로 다시 고르면 고친 이름을 둔다", async () => {
      const { user, touch, auto, byHand } = await steps();
      await auto();
      await user.clear(name(touch, "B"));
      await user.type(name(touch, "B"), "창가 쪽 벽");
      await byHand("B", { position: [2, 3.94], room: "room", normal: [0, -1] });
      expect(name(touch, "B")).toHaveValue("창가 쪽 벽");
      expect(within(touch).getByText("벽 위치 (2.00, 3.94)m")).toBeInTheDocument();
      expect(name(touch, "A")).toHaveValue("방 구석");
    });

    it("손으로만 고르면 이름을 그대로 둔다", async () => {
      const { api, user, touch, byHand } = await steps();
      await byHand("A", { position: [3, 0.1], room: "room", normal: [0, 1] });
      expect(name(touch, "A")).toHaveValue("");
      await user.type(name(touch, "B"), "창가 벽");
      await byHand("B", { position: [0.1, 3.94], room: "room", normal: [1, 0] });
      expect(name(touch, "B")).toHaveValue("창가 벽");
      await byHand("A", { position: [2, 0.1], room: "room", normal: [0, 1] });
      expect(name(touch, "A")).toHaveValue("");
      await user.click(within(touch).getByRole("button", { name: "저장" }));
      expect(api.posts("/api/phone/touch-points/auto")).toHaveLength(0);
      expect(api.posts("/api/phone/touch-points/room")).toHaveLength(0);
      expect(api.posts("/api/phone/touch-points")[0]!.body).toEqual({
        home: "oneroom", points: [{ label: "", position: [2, 0.1] }, { label: "창가 벽", position: [0.1, 3.94] }],
      });
    });

    it("같은 쪽을 여러 방이 쓰는 벽은 뷰어가 보낸 방이 아니라 서버가 정한 방 이름을 쓴다", async () => {
      const { api, viewer, touch, auto, byHand } = await steps({ "POST /api/phone/touch-points/room": () => [200, { ok: true, room: "room" }] });
      await auto();
      // 원룸 서쪽 벽 E04: 뷰어는 그 벽의 첫 방(욕실)을 보낸다
      await byHand("A", { position: [0.1, 1.5], room: "bathroom", normal: [1, 0] });
      expect(name(touch, "A")).toHaveValue("방 벽");
      expect(api.posts("/api/phone/touch-points/room")[0]!.body).toEqual({ home: "oneroom", position: [0.1, 1.5], room: "bathroom", normal: [1, 0] });
      expect(within(touch).getByText("벽 위치 (0.10, 1.50)m")).toBeInTheDocument();
      expect(viewer.setTouchPoints).toHaveBeenLastCalledWith([
        { id: "A", label: "방 벽", position: [0.1, 1.5] },
        { id: "B", label: "방 맞은편 구석", position: [0.1, 3.94] },
      ]);
    });

    it("서버가 방을 정하지 못하면 이름을 비운다", async () => {
      const { touch, auto, byHand } = await steps({ "POST /api/phone/touch-points/room": () => [500, { ok: false, error: "실패" }] });
      await auto();
      await byHand("B", { position: [2, 3.94], room: "room", normal: [0, -1] });
      expect(name(touch, "B")).toHaveValue("");
      expect(within(touch).getByText("벽 위치 (2.00, 3.94)m")).toBeInTheDocument();
    });

    it("손으로 고른 뒤 벽 하나로 다시 고르면 두 구석 이름으로 돌아가고, 다시 손으로 고르면 또 바꾼다", async () => {
      const { user, touch, auto, byHand } = await steps();
      await auto();
      await byHand("B", { position: [2, 3.94], room: "room", normal: [0, -1] });
      expect(name(touch, "B")).toHaveValue("방 벽");
      await user.clear(name(touch, "A"));
      await user.type(name(touch, "A"), "내 이름");
      await auto();
      expect(name(touch, "A")).toHaveValue("방 구석");
      expect(name(touch, "B")).toHaveValue("방 맞은편 구석");
      await byHand("A", { position: [3, 2], room: "room", normal: [-1, 0] });
      expect(name(touch, "A")).toHaveValue("방 벽");
      expect(name(touch, "B")).toHaveValue("방 맞은편 구석");
    });

    it("바꾼 벽 이름도 고치지 않았으면 다시 고를 때 또 바꾸고, 40자를 넘지 않는다", async () => {
      const { user, touch, auto, byHand } = await steps();
      await auto();
      await byHand("B", { position: [2, 3.94], room: "room", normal: [0, -1] });
      expect(name(touch, "B")).toHaveValue("방 벽");
      await byHand("B", { position: [5, 1], room: "living", normal: [0, 1] });
      expect(name(touch, "B")).toHaveValue("거실 벽");
      await byHand("B", { position: [6, 1], room: "long", normal: [0, 1] });
      expect(name(touch, "B")).toHaveValue(`${"가".repeat(38)} 벽`);
      await user.clear(name(touch, "B"));
      await user.type(name(touch, "B"), "내 벽");
      await byHand("B", { position: [2, 3.94], room: "room", normal: [0, -1] });
      expect(name(touch, "B")).toHaveValue("내 벽");
    });

    it("저장한 구석·벽 이름을 고치지 않았으면 다시 열어 손으로 고를 때도 그 방 벽 이름으로 바꾼다", async () => {
      const { auto, byHand, save, reopen } = await steps();
      await auto();
      await save();
      let v = await reopen("B", "방 맞은편 구석");
      await byHand("B", { position: [2, 3.94], room: "room", normal: [0, -1] });
      expect(name(v.touch, "B")).toHaveValue("방 벽");
      await byHand("A", { position: [5, 1], room: "living", normal: [0, 1] });
      expect(name(v.touch, "A")).toHaveValue("거실 벽");
      expect(v.viewer.setTouchPoints).toHaveBeenLastCalledWith([
        { id: "A", label: "거실 벽", position: [5, 1] },
        { id: "B", label: "방 벽", position: [2, 3.94] },
      ]);
      await byHand("B", { position: [6, 1], room: "long", normal: [0, 1] });
      await save();
      v = await reopen("B", `${"가".repeat(38)} 벽`);
      await byHand("B", { position: [2, 3.94], room: "room", normal: [0, -1] });
      expect(name(v.touch, "B")).toHaveValue("방 벽");
      await byHand("A", { position: [3, 2], room: "room", normal: [-1, 0] });
      expect(name(v.touch, "A")).toHaveValue("방 벽");
    });

    it("40자로 줄인 긴 방 구석 이름도 다시 열면 앱이 채운 이름으로 본다", async () => {
      const long = "가".repeat(33);
      const { touch, byHand } = await steps({
        "GET /api/phone/touch-points": () => [200, {
          ok: true, mode: "touch", eye_height_m: 1.5, distance_m: 5.403,
          points: [{ id: "A", label: `${long} 구석`, position: [3.9, 0.1] }, { id: "B", label: `${long} 맞은편 구석`, position: [0.1, 3.94] }],
        }],
      });
      await waitFor(() => expect(name(touch, "B")).toHaveValue(`${long} 맞은편 구석`));
      await byHand("A", { position: [3, 2], room: "room", normal: [-1, 0] });
      expect(name(touch, "A")).toHaveValue("방 벽");
      await byHand("B", { position: [2, 3.94], room: "room", normal: [0, -1] });
      expect(name(touch, "B")).toHaveValue("방 벽");
    });

    it("고친 이름은 저장하고 다시 열어도 손으로 다시 고를 때 그대로 둔다", async () => {
      const { user, touch, auto, byHand, save, reopen } = await steps();
      await auto();
      await user.clear(name(touch, "A"));
      await user.type(name(touch, "A"), "창가 쪽 벽");
      // 방 목록에 없는 방 이름은 앱이 채운 꼴이 아니다
      await user.clear(name(touch, "B"));
      await user.type(name(touch, "B"), "부엌 구석");
      await save();
      const v = await reopen("A", "창가 쪽 벽");
      await byHand("A", { position: [3, 2], room: "room", normal: [-1, 0] });
      expect(name(v.touch, "A")).toHaveValue("창가 쪽 벽");
      await byHand("B", { position: [2, 3.94], room: "room", normal: [0, -1] });
      expect(name(v.touch, "B")).toHaveValue("부엌 구석");
      expect(within(v.touch).getByText("벽 위치 (2.00, 3.94)m")).toBeInTheDocument();
      expect(v.api.posts("/api/phone/touch-points/room")).toHaveLength(0);
    });
  });
});

describe("설정 4단계: 3D 트윈 보기", () => {
  type Loading = {
    ready: Promise<void>; loading: boolean; results: Record<string, unknown>;
    setBadges: ReturnType<typeof vi.fn>; setWallMode: ReturnType<typeof vi.fn>; setTouchPoints: ReturnType<typeof vi.fn>;
  };

  it("뷰어 위 막대를 숨기고, 집을 다 불러오면 배지를 끄고 캔버스를 다시 맞춘다. 벽은 낮추지 않고 저장한 핀을 보인다", async () => {
    const saved = [{ id: "A", label: "방 구석", position: [3.9, 0.1] }, { id: "B", label: "방 맞은편 구석", position: [0.1, 3.94] }];
    open("#position", setupView({ position: { touch: true, layout: false, phone_urls: [] } }), {
      "HEAD /twin/viewer/": () => [200, null],
      "GET /api/phone/touch-points": () => [200, { ok: true, points: saved, mode: "touch", eye_height_m: 1.5, distance_m: 5.403 }],
    });
    const frame = (await screen.findByTitle("3D 집 트윈")) as HTMLIFrameElement;
    expect(frame.getAttribute("src")).toBe("/twin/viewer/?live=auto&embed=1&home=oneroom");
    await waitFor(() => expect(screen.getByRole("textbox", { name: "B 지점 이름" })).toHaveValue("방 맞은편 구석"));
    const doc = frame.contentDocument!;
    doc.open();
    doc.write('<!doctype html><html><head></head><body><header class="bar">벽</header><main class="stage"></main></body></html>');
    doc.close();
    const resized = vi.fn();
    frame.contentWindow!.addEventListener("resize", resized);
    let finish!: () => void;
    const viewer: Loading = {
      ready: new Promise<void>((r) => { finish = r; }), loading: true, results: {},
      setBadges: vi.fn(), setWallMode: vi.fn(), setTouchPoints: vi.fn(),
    };
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
    expect(viewer.setTouchPoints).toHaveBeenLastCalledWith([
      { id: "A", label: "방 구석", position: [3.9, 0.1] },
      { id: "B", label: "방 맞은편 구석", position: [0.1, 3.94] },
    ]);
    expect(viewer.setWallMode).not.toHaveBeenCalled();
  });

  const openTwin = async () => {
    open("#position", setupView({ position: { touch: true, layout: false, phone_urls: [] } }), {
      "HEAD /twin/viewer/": () => [200, null],
      "GET /api/phone/touch-points": () => [200, { ok: true, points: null, mode: "floor", eye_height_m: 1.5, distance_m: null }],
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
      setBadges: vi.fn(() => { badgesCovered = covered(); }), setWallMode: vi.fn(), setTouchPoints: vi.fn(),
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
    const viewer: Loading = {
      ready: Promise.resolve(), loading: false, results: { error: "scene.json 없음" },
      setBadges: vi.fn(), setWallMode: vi.fn(), setTouchPoints: vi.fn(),
    };
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
    ["#position", "폰과 트윈의 위치를 맞춰요", ["이전", "건너뛰고 대시보드로"]],
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
