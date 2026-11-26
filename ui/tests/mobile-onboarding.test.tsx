import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileApp } from "../src/mobile/MobileApp";
import { setupView } from "./helpers/setup-api";

const home = { id: "mokryeon_180b", name: "한양목련 180B" };
const legacyHome = { id: "oneroom", name: "원룸" };
const phone = "https://eyes.example.test/";
const scene = { plan: { rooms: [{ id: "living", label: "거실", polygon: [[0, 0], [3, 0], [3, 2], [0, 2]] }], walls: [] } };
const catalog = "/api/homes/mokryeon_180b/scenes";
const shots = "/api/homes/mokryeon_180b/shots";
const postcodeScript = "https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js";
const bounds = { width: 1920, height: 1080 };
const ref = (id: string, spot_name: string) => ({ id, spot_name, view: "C", ...bounds,
  image_url: "/home-scenes/mokryeon_180b/" + id + ".png" });
const signed = { home: home.id, scene_id: "table_front_C",
  photo: { url: "https://shots.example.test/photo", content_type: "image/jpeg" },
  label: { url: "https://shots.example.test/label", content_type: "application/json" } };
const savedStart = { position: [1, 2], yaw_deg: 35, label: "식탁", facing_label: "문" };

function open(options: { sceneReady?: boolean; sceneWait?: Promise<void>; cloud?: boolean; homeId?: string;
  hubScenes?: boolean; phoneUrls?: string[]; xrSupported?: boolean; portalCamera?: boolean;
  start?: typeof savedStart | null; startStatus?: number; startWait?: Promise<void> } = {}) {
  let current = options.homeId === home.id ? home : legacyHome;
  let saved = options.start ?? null;
  let online = true;
  let setupStatus = 200;
  const requestSession = vi.fn(async () => { throw new DOMException("permission denied", "NotAllowedError"); });
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("navigator", Object.create(navigator, {
    onLine: { get: () => online },
    xr: { value: { isSessionSupported: async () => options.xrSupported !== false, requestSession } },
  }));
  const records = new Map<string, "phone" | "server">();
  const store = {
    list: vi.fn(async () => Object.fromEntries(records)),
    put: vi.fn(async (_home: string, id: string, where: "phone" | "server", _photo?: Blob) => { records.set(id, where); }),
  };
  const capturePhoto = vi.fn(async (_file: File, _aspect: { width: number; height: number }) => ({
    blob: new Blob(["prepared"], { type: "image/jpeg" }), width: 1920, height: 1080,
  }));
  let ready = options.sceneReady !== false;
  const view = () => setupView({ home: current, homes: [legacyHome, home] });
  const fetch = vi.fn(async (path: string, init?: RequestInit): Promise<Response> => {
    if (init?.method === "PUT") return new Response(null, { status: 200 });
    let value: unknown;
    let status = 200;
    if (path === "/api/setup") {
      status = setupStatus;
      value = status === 200 ? view() : { ok: false };
    } else if (path === "/api/phone/start-pose") {
      await options.startWait;
      status = options.startStatus ?? 200;
      value = status === 200 ? { ok: true, start: saved } : { ok: false };
    } else if (path === "/api/setup/home") {
      const body = JSON.parse(String(init?.body));
      if (body.home !== home.id) throw new Error("unexpected home");
      current = home;
      value = view();
    } else if (path === "/api/health") {
      const phoneUrls = options.phoneUrls ?? [phone];
      value = { ok: true, home: current, phone_urls: phoneUrls, portal_camera: options.portalCamera ?? phoneUrls.length > 0 };
    }
    else if (path === "/api/scene" && ready) {
      await options.sceneWait;
      value = { ok: true, scene };
    }
    else if (path === catalog && options.hubScenes !== false) value = { home: home.id, scenes: [ref("table_front_C", "식탁 앞"), ref("sink_front_C", "싱크대 앞")] };
    else if (path === "https://home-shots.vercel.app/scenes/manifest.json") value = [{ ...ref("desk_front_C", "책상 옆"), file: "desk_front_C.jpg" },
      { ...ref("external_C", "다른 집"), file: "https://outside.example.test/scene.jpg" }];
    else if (path === shots && options.cloud) value = signed;
    else { status = path === shots ? 503 : 404; value = {}; }
    return new Response(JSON.stringify(value), { status });
  });
  vi.stubGlobal("fetch", fetch);
  const mount = () => render(<MobileApp store={store} capturePhoto={capturePhoto} />);
  return { fetch, user: userEvent.setup(), mount, capturePhoto, requestSession, store, makeSceneReady: () => { ready = true; },
    useDifferentHome: () => { current = legacyHome; },
    useMokryeonHome: () => { current = home; },
    clearStart: () => { saved = null; },
    setOnline: (next: boolean) => { online = next; fireEvent(window, new Event(next ? "online" : "offline")); },
    setSetupStatus: (status: number) => { setupStatus = status; },
    posts: () => fetch.mock.calls.filter(([path, init]) => path === "/api/setup/home" && init?.method === "POST") };
}

beforeEach(() => {
  history.replaceState(null, "", "/mobile/");
  localStorage.clear();
  sessionStorage.clear();
  sessionStorage.setItem("noonchi-mobile-launched", "1");
  vi.stubGlobal("URL", Object.assign(class extends URL {}, {
    createObjectURL: vi.fn(() => "blob:https://hub.example.test/capture"), revokeObjectURL: vi.fn(),
  }));
});
afterEach(() => {
  cleanup();
  document.querySelector(`script[src="${postcodeScript}"]`)?.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function findAddress(user: ReturnType<typeof userEvent.setup>) {
  const register = screen.queryByRole("button", { name: "우리 집 등록하기" });
  if (register) await user.click(register);
  return screen.findByRole("searchbox", { name: "단지명 또는 도로명 주소" });
}

async function pick(user: ReturnType<typeof userEvent.setup>, query = "산본로432번길 25") {
  await user.type(await findAddress(user), query);
  await user.click(screen.getByRole("button", { name: /한양목련 180B/ }));
}

async function approve(user: ReturnType<typeof userEvent.setup>, wait = true) {
  fireEvent.load(screen.getByRole("img", { name: "한양목련 180B 공개 평면도" }));
  const button = screen.getByRole("button", { name: "이 도면이 맞아요" });
  if (!wait) { await user.click(button); return; }
  vi.useFakeTimers();
  try {
    fireEvent.click(button);
    await finishPreview();
  } finally { vi.useRealTimers(); }
}

async function finishPreview() {
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  fireEvent.load(screen.getByRole("img", { name: "한양목련 180B 트윈 조감도" }));
  fireEvent.click(screen.getByRole("button", { name: "확인" }));
  await act(async () => {});
}

async function readyCamera() {
  const button = await screen.findByRole("button", { name: "클로이드 켜기" });
  await waitFor(() => expect(button).toBeEnabled());
  return button;
}

async function skipScanToHome() {
  fireEvent.click(await screen.findByRole("button", { name: "건너뛰기" }));
  fireEvent.click(screen.getByRole("link", { name: "홈" }));
}

describe("폰 집 등록", () => {
  it("등록 때 5초 동안 제작만 보여 주고 목련 트윈을 확인한 뒤에 촬영으로 간다", async () => {
    const { mount, user, fetch } = open();
    mount();
    await pick(user);
    fireEvent.load(screen.getByRole("img", { name: "한양목련 180B 공개 평면도" }));
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "이 도면이 맞아요" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(4999); });
    expect(screen.getByRole("heading", { name: "트윈 제작 중" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "확인" })).not.toBeInTheDocument();
    expect(fetch.mock.calls.some(([path]) => path === catalog)).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    const preview = screen.getByRole("img", { name: "한양목련 180B 트윈 조감도" });
    expect(preview).toHaveAttribute("src", "/brand/mokryeon-twin-overview.webp");
    expect(screen.getByRole("button", { name: "확인" })).toBeDisabled();
    fireEvent.load(preview);
    fireEvent.click(screen.getByRole("button", { name: "확인" }));
    await act(async () => {});
    expect(screen.getByRole("img", { name: "식탁 앞 기준 뷰" })).toBeInTheDocument();
  });

  it("저장된 장면은 같은 줄에 다시 찍기와 완료가 있고 위에서 건너뛸 수 있다", async () => {
    localStorage.setItem("noonchi-mobile-home", JSON.stringify({ home: home.id, stage: "scan", sceneId: "sink_front_C" }));
    const { mount, store } = open({ homeId: home.id });
    await store.put(home.id, "sink_front_C", "phone");
    mount();
    const capture = await screen.findByRole("region", { name: "기준 사진 촬영" });
    const actions = within(capture).getByRole("group", { name: "저장한 장면" });
    expect(within(actions).getByRole("button", { name: "다시 찍기" })).toBeInTheDocument();
    expect(within(actions).getByRole("button", { name: "완료" })).toBeEnabled();
    expect(within(capture).getByRole("button", { name: "건너뛰기" })).toBeEnabled();
    expect(within(capture).getByRole("status").textContent).toBe("저장 완료");
    expect(within(capture).getAllByRole("button").map(button => button.textContent)).toEqual(["건너뛰기", "다시 찍기", "완료"]);
  });

  it("등록과 평면도 다시 보기에서 대체 그림에는 간략 평면도만 표시한다", async () => {
    const { mount, user } = open({ homeId: home.id });
    const first = mount();
    await pick(user);
    fireEvent.error(screen.getByRole("img", { name: "한양목련 180B 공개 평면도" }));
    expect(screen.getByText("간략 평면도")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "KB부동산 공개 도면 출처" })).not.toBeInTheDocument();
    first.unmount();
    localStorage.setItem("noonchi-mobile-home", JSON.stringify({ home: home.id, stage: "home" }));
    history.replaceState(null, "", "/mobile/?tab=house");
    mount();
    await user.click(await screen.findByRole("button", { name: "평면도 보기" }));
    const official = screen.getByRole("img", { name: "한양목련 180B 공개 평면도" });
    fireEvent.load(official);
    expect(screen.getByRole("link", { name: "KB부동산 공개 도면 출처" })).toBeInTheDocument();
    fireEvent.error(official);
    expect(screen.getByText("간략 평면도")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "KB부동산 공개 도면 출처" })).not.toBeInTheDocument();
  });
  it("미등록 홈은 상태 카드에서 등록을 시작하고 뒤로 가면 홈으로 돌아온다", async () => {
    const { mount, user, posts, requestSession } = open();
    mount();
    expect(screen.getByRole("link", { name: "홈" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("등록한 집이 없어요");
    await user.click(screen.getByRole("button", { name: "우리 집 등록하기" }));
    expect(location.search).toBe("?tab=house");
    expect(screen.getByRole("link", { name: "집 관리" })).toHaveAttribute("aria-current", "page");
    const address = screen.getByRole("searchbox", { name: "단지명 또는 도로명 주소" });
    await user.type(address, "한양목련");
    history.back();
    await screen.findByRole("button", { name: "우리 집 등록하기" });
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "집 관리" }));
    expect(screen.getByRole("searchbox")).toHaveValue("한양목련");
    await user.click(screen.getByRole("link", { name: "홈" }));
    expect(screen.getByRole("button", { name: "우리 집 등록하기" })).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
    expect(requestSession).not.toHaveBeenCalled();
  });

  it("설정과 새 탭에서 쓰는 우리 집 링크는 등록 요약을 열고 기존 스캔 링크는 촬영을 연다", async () => {
    localStorage.setItem("noonchi-mobile-home", JSON.stringify({ home: home.id, stage: "home", sceneId: "sink_front_C" }));
    const { mount, posts } = open({ homeId: home.id });
    const portal = mount();
    const houseHref = screen.getByRole("link", { name: "집 관리" }).getAttribute("href")!;
    portal.unmount();
    history.replaceState(null, "", houseHref);
    const summary = mount();
    expect(await screen.findByRole("button", { name: "평면도 보기" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "집 스캔" })).not.toBeInTheDocument();
    summary.unmount();
    history.replaceState(null, "", "/mobile/?tab=scan");
    mount();
    expect(await screen.findByRole("img", { name: "싱크대 앞 기준 뷰" })).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });

  it("이전 버전의 검색 기록이 남은 기본 주소도 미등록 홈을 연다", async () => {
    history.replaceState({ noonchiMobile: "search" }, "", "/mobile/");
    const { mount } = open();
    mount();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "우리 집 등록하기" })).toBeInTheDocument();
  });

  it.each([
    { phoneUrls: [phone] },
    { phoneUrls: [] },
  ])("홈은 카메라 지원과 별개로 확인한 허브 연결을 표시한다: $phoneUrls", async ({ phoneUrls }) => {
    localStorage.setItem("noonchi-mobile-home", JSON.stringify({ home: home.id, stage: "home" }));
    const { mount, fetch } = open({ homeId: home.id, phoneUrls });
    mount();
    expect(await screen.findByRole("heading", { name: home.name })).toBeInTheDocument();
    const main = screen.getByRole("main");
    const status = await within(main).findByText("연결됨");
    expect(within(main).getByText("대시보드 연결")).toBeVisible();
    expect(status.closest('[role="status"]')?.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
    expect(status.closest("a, button")).toBeNull();
    expect(screen.queryByText("클로이드를 켤 수 있어요.")).not.toBeInTheDocument();
    const page = main.parentElement;
    expect(page).toHaveClass("phone-portal-page--home");
    const start = screen.getAllByRole("button", { name: "클로이드 켜기" });
    expect(start).toHaveLength(1);
    expect(main).toContainElement(start[0]);
    const peek = page?.querySelector(":scope > .phone-home-peek");
    expect(peek).toHaveAttribute("aria-hidden", "true");
    expect(peek?.querySelector("img")).toHaveAttribute("src", "/brand/mascot-large.webp");
    expect(peek).not.toContainElement(start[0]);
    if (phoneUrls.length) await readyCamera();
    else {
      expect(await screen.findByText("카메라 연결 주소가 아직 없어요.")).toBeVisible();
      expect(start[0]).toBeDisabled();
    }
    expect(within(main).queryByRole("img", { name: /평면도|도면/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "기준 사진 이어 찍기" })).not.toBeInTheDocument();
    expect(fetch.mock.calls.some(([path]) => path === phone)).toBe(false);
  });

  it("등록된 집의 저장 상태를 읽고 시작 위치 편집으로 바로 연결하며, 뒤로 돌아오면 최신 값을 읽는다", async () => {
    localStorage.setItem("noonchi-mobile-home", JSON.stringify({ home: home.id, stage: "home" }));
    const { mount, fetch, clearStart } = open({ homeId: home.id, start: savedStart });
    mount();
    const link = await screen.findByRole("link", { name: "시작 위치 설정" });
    expect(link).toHaveAttribute("href", "/mobile/settings/?positionHome=mokryeon_180b#position");
    await waitFor(() => expect(link).toHaveAccessibleDescription("설정됨"));
    expect(link).not.toHaveTextContent("식탁");
    clearStart();
    const back = new Event("pageshow");
    Object.defineProperty(back, "persisted", { value: true });
    fireEvent(window, back);
    await waitFor(() => expect(screen.getByRole("link", { name: "시작 위치 설정" })).toHaveAccessibleDescription("미설정"));
    expect(fetch.mock.calls.filter(([path]) => path === "/api/phone/start-pose")).toHaveLength(2);
    expect(await readyCamera()).toBeEnabled();
  });

  it("시작 위치 조회가 실패하면 미설정으로 단정하지 않고 카메라는 계속 열 수 있다", async () => {
    localStorage.setItem("noonchi-mobile-home", JSON.stringify({ home: home.id, stage: "home" }));
    const { mount } = open({ homeId: home.id, startStatus: 404 });
    mount();
    const link = await screen.findByRole("link", { name: "시작 위치 설정" });
    await waitFor(() => expect(link).toHaveAccessibleDescription("확인 못함"));
    expect(await screen.findByText("연결됨")).toBeVisible();
    expect(await readyCamera()).toBeEnabled();
  });

  it("홈을 연 채 브라우저가 오프라인이 되면 초록 표시를 지우고 온라인에서 허브를 다시 확인한다", async () => {
    localStorage.setItem("noonchi-mobile-home", JSON.stringify({ home: home.id, stage: "home" }));
    const { mount, fetch, setOnline } = open({ homeId: home.id });
    mount();
    const status = within(await screen.findByRole("list", { name: "집 상태" })).getByRole("status");
    expect(status).toHaveTextContent("연결됨");
    setOnline(false);
    expect(status).toHaveTextContent("연결 끊김");
    expect(status.querySelector('[aria-hidden="true"]')).toBeNull();
    expect(screen.getByRole("heading", { name: home.name })).toBeVisible();
    const callsBefore = fetch.mock.calls.filter(([path]) => path === "/api/setup").length;
    setOnline(true);
    await waitFor(() => expect(status).toHaveTextContent("연결됨"));
    expect(fetch.mock.calls.filter(([path]) => path === "/api/setup").length).toBeGreaterThan(callsBefore);
    expect(status.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
  });

  it("화면에 돌아왔을 때 허브 조회 실패로 연결 표시를 내리고 다음 확인 성공으로 회복한다", async () => {
    localStorage.setItem("noonchi-mobile-home", JSON.stringify({ home: home.id, stage: "home" }));
    const { mount, setSetupStatus } = open({ homeId: home.id, start: savedStart });
    mount();
    const details = within(await screen.findByRole("list", { name: "집 상태" }));
    const link = details.getByRole("link", { name: "시작 위치 설정" });
    const status = details.getByRole("status");
    await waitFor(() => expect(link).toHaveAccessibleDescription("설정됨"));
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    try {
      setSetupStatus(503);
      fireEvent(document, new Event("visibilitychange"));
      await waitFor(() => expect(status).toHaveTextContent("연결 끊김"));
      expect(link).toHaveAccessibleDescription("확인 못함");
      expect(status.querySelector('[aria-hidden="true"]')).toBeNull();
      setSetupStatus(200);
      fireEvent(document, new Event("visibilitychange"));
      await waitFor(() => expect(status).toHaveTextContent("연결됨"));
      await waitFor(() => expect(link).toHaveAccessibleDescription("설정됨"));
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("시작 위치를 읽는 동안 허브 집이 바뀌면 그 응답을 등록된 집의 상태로 표시하지 않는다", async () => {
    localStorage.setItem("noonchi-mobile-home", JSON.stringify({ home: home.id, stage: "home" }));
    let release = () => {};
    const startWait = new Promise<void>(resolve => { release = resolve; });
    const { mount, fetch, useDifferentHome } = open({ homeId: home.id, start: savedStart, startWait });
    mount();
    await waitFor(() => expect(fetch.mock.calls.some(([path]) => path === "/api/phone/start-pose")).toBe(true));
    useDifferentHome();
    release();
    await waitFor(() => expect(screen.getByRole("link", { name: "시작 위치 설정" })).toHaveAccessibleDescription("확인 못함"));
  });

  it("홈 버튼의 첫 클릭이 현재 문서에서 XR을 바로 요청하고 거절 뒤 권한 안내와 재시도를 제공한다", async () => {
    localStorage.setItem("noonchi-mobile-home", JSON.stringify({ home: home.id, stage: "home" }));
    const { mount, requestSession } = open({ homeId: home.id });
    mount();
    const button = await readyCamera();
    expect(requestSession).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(requestSession).toHaveBeenCalledExactlyOnceWith("immersive-ar", expect.objectContaining({
      domOverlay: { root: document.querySelector("[data-phone-overlay]") },
    }));
    expect(location.pathname).toBe("/mobile/");
    expect(await screen.findByText(/브라우저에서 카메라 권한을 확인/)).toBeInTheDocument();
    expect(button).toBeEnabled();
  });

  it("AR을 지원하지 않는 브라우저는 사용 가능한 주소가 있어도 홈에서 이용 방법을 안내한다", async () => {
    localStorage.setItem("noonchi-mobile-home", JSON.stringify({ home: home.id, stage: "home" }));
    const { mount, requestSession } = open({ homeId: home.id, xrSupported: false });
    mount();
    expect(await screen.findByText(/안드로이드 크롬/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "클로이드 켜기" })).toBeDisabled();
    expect(requestSession).not.toHaveBeenCalled();
  });

  it("집 찾기, 평면도 확인, 집 스캔 단계를 실제 등록 흐름과 함께 표시한다", async () => {
    let release = () => {};
    const sceneWait = new Promise<void>((resolve) => { release = resolve; });
    const { mount, user } = open({ sceneWait });
    mount();
    function step(name: string) {
      const steps = screen.getByRole("list", { name: "집 등록 단계" });
      expect(screen.getByRole("main").parentElement).not.toHaveClass("phone-portal-page--home");
      expect(Array.from(steps.querySelectorAll("li"), (item) => item.textContent)).toEqual(["집 찾기", "평면도 확인", "집 스캔"]);
      expect(steps).not.toHaveTextContent("%");
      expect(steps.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
      expect(steps.querySelector('[aria-current="step"]')?.textContent).toBe(name);
    }
    await findAddress(user);
    step("집 찾기");
    await pick(user);
    step("평면도 확인");
    await approve(user, false);
    expect(await screen.findByRole("heading", { name: "트윈 제작 중" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "집 등록 단계" })).not.toBeInTheDocument();
    vi.useFakeTimers();
    release();
    await finishPreview();
    vi.useRealTimers();
    step("집 스캔");
  });

  it("실제 기준 뷰와 찍은 사진을 같은 비율로 비교하고 터치와 키로 나눔선을 움직인다", async () => {
    const { mount, user, store } = open();
    mount();
    await pick(user);
    await approve(user);
    const file = await screen.findByLabelText("기준 사진 파일");
    const reference = screen.getByRole("img", { name: "식탁 앞 기준 뷰" });
    const original = reference.getAttribute("src");
    fireEvent.load(reference);
    const capture = new File(["image"], "capture.jpg", { type: "image/jpeg" });
    await user.upload(file, capture);
    const slider = await screen.findByRole("slider", { name: "기준 뷰와 찍은 사진 비교" });
    expect(slider.style.aspectRatio).toBe("1920 / 1080");
    expect(slider).toHaveAttribute("aria-valuenow", "50");
    const before = screen.getByRole("img", { name: "식탁 앞 기준 뷰" });
    const after = screen.getByRole("img", { name: "찍은 사진" });
    expect(before).toHaveAttribute("src", original);
    expect(after).toHaveAttribute("src", "blob:https://hub.example.test/capture");
    expect(URL.createObjectURL).toHaveBeenCalledWith(capture);
    expect(before.className + after.className).not.toMatch(/grayscale|saturate-0/);
    const measure = vi.spyOn(slider, "getBoundingClientRect")
      .mockReturnValue(new DOMRect(35, 100, 300, 168.75));
    fireEvent.pointerDown(slider, { pointerType: "touch", pointerId: 7, clientX: 110, button: 0 });
    fireEvent.pointerMove(slider, { pointerType: "touch", pointerId: 7, clientX: 260 });
    fireEvent.pointerUp(slider, { pointerType: "touch", pointerId: 7, clientX: 260 });
    expect(slider).toHaveAttribute("aria-valuenow", "75");
    slider.focus();
    await user.keyboard("{ArrowRight}{Home}");
    expect(slider).toHaveAttribute("aria-valuenow", "0");
    await user.keyboard("{End}");
    expect(slider).toHaveAttribute("aria-valuenow", "100");
    expect(store.put).not.toHaveBeenCalled();
    measure.mockRestore();
  });

  it("새 탭 세션의 첫 진입에만 시작 화면이 나오고 자동으로 눈을 열지 않는다", async () => {
    sessionStorage.clear();
    const { mount, fetch } = open();
    const view = mount();
    expect(screen.queryByRole("button", { name: "우리 집 등록하기" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "폰 메뉴" })).not.toBeInTheDocument();
    await screen.findByRole("button", { name: "우리 집 등록하기" }, { timeout: 850 });
    expect(screen.getByRole("main").closest(".phone-portal-page")).toContainElement(screen.getByRole("navigation", { name: "폰 메뉴" }));
    expect(sessionStorage.getItem("noonchi-mobile-launched")).toBe("1");
    expect(fetch.mock.calls.some(([path]) => path === phone)).toBe(false);
    view.unmount();
    mount();
    expect(screen.getByRole("button", { name: "우리 집 등록하기" })).toBeInTheDocument();
  });

  it("미등록 스캔 딥링크는 주소부터 열고 설정에서 돌아와 도면과 검색을 이어간다", async () => {
    history.replaceState(null, "", "/mobile/?tab=scan");
    const { mount, user, posts } = open();
    const view = mount();
    await pick(user);
    expect(screen.getByRole("link", { name: "집 관리" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "설정" })).toHaveAttribute("href", "/mobile/settings/");
    view.unmount();
    history.replaceState(null, "", "/mobile/?tab=scan");
    mount();
    expect(await screen.findByRole("img", { name: "한양목련 180B 공개 평면도" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "다른 주소 찾기" }));
    expect(screen.getByRole("searchbox")).toHaveValue("산본로432번길 25");
    expect(posts()).toHaveLength(0);
  });

  it("설정에서 홈 탭으로 돌아와 새 집을 승인하면 최초에는 집 스캔으로 간다", async () => {
    const { mount, user, posts } = open();
    const initial = mount();
    await pick(user);
    initial.unmount();
    history.replaceState(null, "", "/mobile/?tab=home");
    mount();
    expect(screen.getByRole("button", { name: "우리 집 등록하기" })).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "집 관리" }));
    await screen.findByRole("img", { name: "한양목련 180B 공개 평면도" });
    await approve(user);
    expect(await screen.findByRole("img", { name: "식탁 앞 기준 뷰" })).toBeInTheDocument();
    expect(location.search).toBe("?tab=scan");
    expect(posts()).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "클로이드 켜기" })).not.toBeInTheDocument();
  });

  it("등록한 폰은 지정 탭을 바로 열고 탭 전환과 뒤로가기에서 같은 스캔 장면을 이어간다", async () => {
    localStorage.setItem("noonchi-mobile-home", JSON.stringify({ home: home.id, stage: "scan", sceneId: "sink_front_C" }));
    history.replaceState(null, "", "/mobile/?tab=home");
    const { mount, user, posts } = open({ homeId: home.id });
    const first = mount();
    await readyCamera();
    first.unmount();
    history.replaceState(null, "", "/mobile/?tab=scan");
    mount();
    expect(await screen.findByRole("img", { name: "싱크대 앞 기준 뷰" })).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "홈" }));
    expect(location.search).toBe("?tab=home");
    await readyCamera();
    history.back();
    expect(await screen.findByRole("img", { name: "싱크대 앞 기준 뷰" })).toBeInTheDocument();
    expect(location.search).toBe("?tab=scan");
    expect(posts()).toHaveLength(0);
  });

  it("등록한 우리 집에서 승인 없이 평면도를 보고 스캔을 이어가거나 저장한 사진부터 다시 찍을 수 있다", async () => {
    localStorage.setItem("noonchi-mobile-home", JSON.stringify({ home: home.id, stage: "home", sceneId: "sink_front_C" }));
    history.replaceState(null, "", "/mobile/?tab=house");
    const { mount, user, posts, store } = open({ homeId: home.id });
    await store.put(home.id, "table_front_C", "phone");
    store.put.mockClear();
    mount();
    expect(await screen.findByRole("heading", { name: home.name })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "집 관리" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("button", { name: "클로이드 켜기" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "평면도 보기" }));
    expect(await screen.findByRole("img", { name: "한양목련 180B 공개 평면도" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "이 도면이 맞아요" })).not.toBeInTheDocument();
    history.back();
    await user.click(await screen.findByRole("button", { name: "스캔 이어가기" }));
    expect(await screen.findByRole("img", { name: "싱크대 앞 기준 뷰" })).toBeInTheDocument();
    expect(location.search).toBe("?tab=scan");
    await user.click(screen.getByRole("link", { name: "집 관리" }));
    await user.click(screen.getByRole("button", { name: "기준 사진 다시 찍기" }));
    fireEvent.load(await screen.findByRole("img", { name: "식탁 앞 기준 뷰" }));
    expect(screen.getByRole("button", { name: "다시 찍기" })).toBeEnabled();
    expect(screen.getByText("촬영 1 / 2")).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
    expect(store.put).not.toHaveBeenCalled();
  });

  it("첫 등록의 중간 장면을 건너뛰고 홈을 열면 시작 화면을 한 번 더 보여준다", async () => {
    const { mount, user, requestSession } = open();
    const original = mount();
    await pick(user);
    await approve(user);
    const input = await screen.findByLabelText("기준 사진 파일");
    fireEvent.load(screen.getByRole("img", { name: "식탁 앞 기준 뷰" }));
    await user.upload(input, new File(["image"], "camera.jpg", { type: "image/jpeg" }));
    await user.click(await screen.findByRole("button", { name: "사진 확인" }));
    await screen.findByText("저장 완료");
    original.unmount();
    history.replaceState(null, "", "/mobile/?tab=scan");
    mount();
    await skipScanToHome();
    expect(document.querySelector(".phone-launch-hero")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "폰 메뉴" })).not.toBeInTheDocument();
    await readyCamera();
    expect(location.search).toBe("?tab=home");
    await user.click(screen.getByRole("link", { name: "집 관리" }));
    await user.click(screen.getByRole("button", { name: "스캔 이어가기" }));
    await skipScanToHome();
    await readyCamera();
    expect(document.querySelector(".phone-launch-hero")).not.toBeInTheDocument();
    expect(requestSession).not.toHaveBeenCalled();
  });

  it("첫 등록 뒤 사진을 저장하지 않고 홈 탭을 눌러도 시작 화면을 한 번만 보여준다", async () => {
    const { mount, user, store, requestSession } = open();
    mount();
    await pick(user);
    await approve(user);
    await screen.findByRole("img", { name: "식탁 앞 기준 뷰" });
    expect(screen.queryByRole("button", { name: "촬영 마치기" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: "홈" }));
    expect(document.querySelector(".phone-launch-hero")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "폰 메뉴" })).not.toBeInTheDocument();
    await readyCamera();
    expect(location.search).toBe("?tab=home");
    expect(store.put).not.toHaveBeenCalled();

    await user.click(screen.getByRole("link", { name: "집 관리" }));
    await user.click(screen.getByRole("button", { name: "스캔 이어가기" }));
    await screen.findByRole("img", { name: "식탁 앞 기준 뷰" });
    fireEvent.click(screen.getByRole("link", { name: "홈" }));
    expect(document.querySelector(".phone-launch-hero")).not.toBeInTheDocument();
    await readyCamera();
    expect(requestSession).not.toHaveBeenCalled();
    expect(store.put).not.toHaveBeenCalled();
  });

  it("미확인 사진과 저장 중 사진은 탭을 눌러도 그대로 남는다", async () => {
    const { mount, user, store } = open();
    mount();
    await pick(user);
    await approve(user);
    const input = await screen.findByLabelText("기준 사진 파일");
    fireEvent.load(screen.getByRole("img", { name: "식탁 앞 기준 뷰" }));
    await user.upload(input, new File(["image"], "capture.jpg", { type: "image/jpeg" }));
    await screen.findByRole("img", { name: "찍은 사진" });
    await user.click(screen.getByRole("link", { name: "홈" }));
    expect(screen.getByRole("img", { name: "찍은 사진" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("사진을 확인하거나");

    let release = () => {};
    store.put.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    await user.click(screen.getByRole("button", { name: "사진 확인" }));
    await screen.findByText("사진을 저장하는 중이에요.");
    await user.click(screen.getByRole("link", { name: "설정" }));
    expect(screen.getByRole("alert")).toHaveTextContent("저장이 끝난 뒤");
    expect(screen.getByRole("img", { name: "찍은 사진" })).toBeInTheDocument();
    act(release);
    await screen.findByText("저장 완료");
    await user.click(screen.getByRole("link", { name: "홈" }));
    expect(await screen.findByRole("heading", { name: home.name })).toBeInTheDocument();
  });

  it("미확인 사진을 명시적으로 지우면 다시 찍거나 저장하지 않고 탭을 떠날 수 있다", async () => {
    const { mount, user, store, capturePhoto } = open();
    mount();
    await pick(user);
    await approve(user);
    const input = await screen.findByLabelText("기준 사진 파일");
    fireEvent.load(screen.getByRole("img", { name: "식탁 앞 기준 뷰" }));
    await user.upload(input, new File(["image"], "capture.jpg", { type: "image/jpeg" }));
    await screen.findByRole("img", { name: "찍은 사진" });
    await user.click(screen.getByRole("button", { name: "사진 지우기" }));
    await user.click(screen.getByRole("link", { name: "홈" }));
    expect(await screen.findByRole("heading", { name: home.name })).toBeInTheDocument();
    expect(store.put).not.toHaveBeenCalled();
    expect(capturePhoto).toHaveBeenCalledTimes(1);
  });

  it("지원하는 단지명·도로명만 제안하고 도면 거절은 집을 바꾸지 않는다", async () => {
    const { user, mount, posts } = open();
    mount();
    const box = await findAddress(user);
    await user.type(box, "산본로432번길 250");
    expect(screen.getByText("등록할 수 있는 집을 찾지 못했어요")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /한양목련/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "공식 도로명주소 검색" })).toHaveAttribute("href", "https://www.juso.go.kr/");
    await user.clear(box);
    await pick(user, "한양목련");
    expect(screen.getByText("군포시 산본로432번길 25")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "한양목련 180B 공개 평면도" })).toHaveAttribute("src", "/api/homes/mokryeon_180b/floor-plan.jpg");
    fireEvent.load(screen.getByRole("img", { name: "한양목련 180B 공개 평면도" }));
    expect(screen.getByRole("link", { name: "KB부동산 공개 도면 출처" })).toHaveAttribute("href", "https://kbland.kr/se/c/4809");
    expect(posts()).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "다른 주소 찾기" }));
    expect(screen.getByRole("searchbox", { name: "단지명 또는 도로명 주소" })).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });

  it("공개 평면도 오류 때 실제 목련 도면을 표시하며 확인 전에는 집을 바꾸지 않는다", async () => {
    const { mount, user, posts } = open();
    mount();
    await pick(user);
    expect(screen.getByRole("button", { name: "이 도면이 맞아요" })).toBeDisabled();
    fireEvent.error(screen.getByRole("img", { name: "한양목련 180B 공개 평면도" }));
    expect(screen.getByRole("img", { name: "한양목련 180B 트윈 평면도" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^설정( 열기)?$/ })).toHaveAttribute("href", "/mobile/settings/");
    expect(screen.getByText("간략 평면도")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "이 도면이 맞아요" })).toBeEnabled();
    expect(posts()).toHaveLength(0);
  });

  it("클릭할 때만 Kakao 주소 검색을 열고 선택한 도로명에 해당하는 도면만 제안한다", async () => {
    const { mount, user, posts } = open();
    mount();
    const box = await findAddress(user);
    const sdkScript = () => document.querySelector(`script[src="${postcodeScript}"]`);
    expect(sdkScript()).toBeNull();
    await user.click(screen.getByRole("button", { name: "전국 주소 검색" }));
    expect(sdkScript()).toBeInTheDocument();
    let select: (data: { roadAddress: string }) => void = () => {};
    const embed = vi.fn();
    vi.stubGlobal("kakao", { Postcode: class {
      constructor(options: { oncomplete: typeof select }) { select = options.oncomplete; }
      embed(target: HTMLElement) { embed(target); }
    } });
    fireEvent.load(sdkScript()!);
    await waitFor(() => expect(embed).toHaveBeenCalledWith(expect.any(HTMLElement)));
    act(() => select({ roadAddress: "서울 종로구 세종대로 209" }));
    expect(box).toHaveValue("서울 종로구 세종대로 209");
    expect(screen.getByText("선택한 주소의 도면이 없어요.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /한양목련/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "전국 주소 검색" }));
    await waitFor(() => expect(embed).toHaveBeenCalledTimes(2));
    act(() => select({ roadAddress: "경기 군포시 산본로432번길 25" }));
    expect(await screen.findByRole("button", { name: /한양목련 180B/ })).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });

  it("첫 사진 없이도 설정을 열 수 있고 실제 장면 응답을 기다리는 동안 제작 상태를 표시한다", async () => {
    let release = () => {};
    const sceneWait = new Promise<void>((resolve) => { release = resolve; });
    const { mount, user, posts } = open({ sceneWait });
    mount();
    const settings = () => screen.getByRole("link", { name: /^설정( 열기)?$/ });
    expect(settings()).toHaveAttribute("href", "/mobile/settings/");
    await pick(user);
    expect(posts()).toHaveLength(0);
    await approve(user, false);
    expect(await screen.findByRole("heading", { name: "트윈 제작 중" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^설정( 열기)?$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "집 스캔" })).not.toBeInTheDocument();
    vi.useFakeTimers();
    release();
    await finishPreview();
    vi.useRealTimers();
    expect(settings()).toHaveAttribute("href", "/mobile/settings/");
  });

  it("승인 후 허브에서 실제 트윈을 읽어야 스캔을 열며 트윈만 실패하면 선택을 재전송하지 않는다", async () => {
    const { mount, user, posts, makeSceneReady } = open({ sceneReady: false });
    mount();
    await pick(user);
    await approve(user, false);
    expect(await screen.findByText("트윈을 준비하지 못했어요")).toBeInTheDocument();
    expect(JSON.parse(String(posts()[0]?.[1]?.body))).toEqual({ home: home.id });
    expect(screen.queryByRole("heading", { name: "집 스캔" })).not.toBeInTheDocument();
    makeSceneReady();
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    await finishPreview();
    vi.useRealTimers();
    expect(screen.getByRole("heading", { name: "집 스캔" })).toBeInTheDocument();
    expect(posts()).toHaveLength(1);
    expect(screen.getByRole("img", { name: "식탁 앞 기준 뷰" })).toHaveAttribute("src", "/home-scenes/mokryeon_180b/table_front_C.png");
  });

  it("파일 입력을 화면 배치에서 제외하고 촬영 단추로 열 수 있다", async () => {
    const { mount, user } = open();
    mount();
    await pick(user);
    await approve(user);
    const input = await screen.findByLabelText("기준 사진 파일");
    expect(input).toHaveAttribute("hidden");
    expect(getComputedStyle(input).display).toBe("none");
    expect(input).toHaveAttribute("capture", "environment");
    const click = vi.spyOn(input, "click");
    fireEvent.load(screen.getByRole("img", { name: "식탁 앞 기준 뷰" }));
    await user.click(screen.getByRole("button", { name: "기준 사진 찍기" }));
    expect(click).toHaveBeenCalledOnce();
    click.mockRestore();
  });

  it("촬영·다시 찍기 후 확인한 JPEG만 폰에 저장하고 새로 열면 다음 장면부터 이어간다", async () => {
    const { mount, user, store, capturePhoto, posts } = open();
    const view = mount();
    await pick(user);
    await approve(user);
    const input = await screen.findByLabelText("기준 사진 파일");
    const picture = new File(["image"], "camera.jpg", { type: "image/jpeg" });
    fireEvent.load(screen.getByRole("img", { name: "식탁 앞 기준 뷰" }));
    expect(screen.getByRole("button", { name: "다음 장면" })).toBeDisabled();
    await user.upload(input, picture);
    expect(await screen.findByRole("img", { name: "찍은 사진" })).toBeInTheDocument();
    expect(store.put).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "다시 찍기" }));
    expect(screen.queryByRole("img", { name: "찍은 사진" })).not.toBeInTheDocument();
    await user.upload(screen.getByLabelText("기준 사진 파일"), picture);
    await user.click(await screen.findByRole("button", { name: "사진 확인" }));
    expect(await screen.findByText("저장 완료")).toBeInTheDocument();
    const capture = within(screen.getByRole("region", { name: "기준 사진 촬영" }));
    expect(capture.getAllByRole("button").map(button => button.textContent)).toEqual(["건너뛰기", "다시 찍기", "다음 장면"]);
    expect(store.put).toHaveBeenCalledWith(home.id, "table_front_C", "phone", expect.any(Blob));
    expect(capturePhoto).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole("button", { name: "다음 장면" }));
    view.unmount();
    mount();
    expect(await screen.findByRole("img", { name: "싱크대 앞 기준 뷰" })).toBeInTheDocument();
    expect(screen.getByText("촬영 1 / 2")).toBeInTheDocument();
    await skipScanToHome();
    await readyCamera();
    expect(screen.getByRole("link", { name: /^설정( 열기)?$/ })).toHaveAttribute("href", "/mobile/settings/");
    expect(posts()).toHaveLength(1);
  });

  it("등록을 마친 폰은 새 탭에서 홈으로 가며 다른 집이 열린 상태에서는 자동으로 바꾸지 않는다", async () => {
    const { mount, user, posts, useDifferentHome, useMokryeonHome } = open();
    const first = mount();
    await pick(user);
    await approve(user);
    const input = await screen.findByLabelText("기준 사진 파일");
    fireEvent.load(screen.getByRole("img", { name: "식탁 앞 기준 뷰" }));
    await user.upload(input, new File(["image"], "capture.jpg", { type: "image/jpeg" }));
    await user.click(await screen.findByRole("button", { name: "사진 확인" }));
    await skipScanToHome();
    expect(await screen.findByRole("heading", { name: home.name })).toBeInTheDocument();
    first.unmount();
    history.replaceState(null, "", "/mobile/");
    const revisit = mount();
    await readyCamera();
    revisit.unmount();
    useDifferentHome();
    mount();
    expect(await screen.findByText("트윈을 준비하지 못했어요")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByText("트윈을 준비하지 못했어요")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "클로이드 켜기" })).not.toBeInTheDocument();
    expect(posts()).toHaveLength(1);
    useMokryeonHome();
    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    await user.click(await screen.findByRole("link", { name: "집 관리" }));
    await user.click(screen.getByRole("button", { name: "스캔 이어가기" }));
    expect(await screen.findByText("촬영 1 / 2")).toBeInTheDocument();
    expect(posts()).toHaveLength(1);
  });

  it("서버가 업로드 주소를 주면 사진과 라벨을 함께 저장한다", async () => {
    const { mount, user, fetch, store } = open({ cloud: true });
    mount();
    await pick(user);
    await approve(user);
    const input = await screen.findByLabelText("기준 사진 파일");
    fireEvent.load(screen.getByRole("img", { name: "식탁 앞 기준 뷰" }));
    await user.upload(input, new File(["file"], "capture.jpg", { type: "image/jpeg" }));
    await user.click(await screen.findByRole("button", { name: "사진 확인" }));
    await waitFor(() => expect(store.put).toHaveBeenCalledWith(home.id, "table_front_C", "server"));
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "PUT").map(([path, init]) => [path, init?.headers])).toEqual([
      [signed.photo.url, { "content-type": "image/jpeg" }], [signed.label.url, { "content-type": "application/json" }],
    ]);
  });

  it("목련 데모에서만 배포 목록의 jpg 기준 뷰를 받아 같은 스캔 화면으로 간다", async () => {
    const { mount, user } = open({ hubScenes: false });
    mount();
    await pick(user);
    await approve(user);
    expect(await screen.findByRole("img", { name: "책상 옆 기준 뷰" })).toHaveAttribute("src", "https://home-shots.vercel.app/scenes/desk_front_C.jpg");
    expect(screen.queryByRole("img", { name: "다른 집 기준 뷰" })).not.toBeInTheDocument();
  });

  it("브라우저 뒤로 가기로 도면과 주소로 돌아가며 집 선택을 실행하지 않는다", async () => {
    const { mount, user, posts } = open();
    mount();
    await pick(user);
    history.back();
    expect(await screen.findByRole("searchbox", { name: "단지명 또는 도로명 주소" })).toBeInTheDocument();
    history.forward();
    expect(await screen.findByRole("img", { name: "한양목련 180B 공개 평면도" })).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });
});
