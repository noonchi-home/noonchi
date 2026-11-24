import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { SetupApp } from "../src/setup/SetupApp";
import { fakeSetupApi, FakeWebSocket, setupView } from "./helpers/setup-api";

afterEach(() => { vi.unstubAllGlobals(); history.replaceState(null, "", "/"); });

function open(hash = "", overrides: Parameters<typeof fakeSetupApi>[1] = {}, data: Parameters<typeof setupView>[0] = {}) {
  history.replaceState(null, "", `/mobile/settings/${hash}`);
  const api = fakeSetupApi(setupView({ done: true, position: { start: true, layout: true, phone_urls: [] }, ...data }), overrides);
  vi.stubGlobal("fetch", api.fetchMock);
  vi.stubGlobal("WebSocket", FakeWebSocket);
  const navigate = vi.fn();
  render(<SetupApp navigate={navigate} />);
  return { api, navigate, user: userEvent.setup() };
}

it("목련의 기본 연결은 테스트 모드에서 명시적으로 조회하며 설정됨과 기기 0개를 구분한다", async () => {
  const { api, user } = open("", {
    "GET /api/setup/thinq?home=mokryeon_180b": () => [200, { ok: true, home: "mokryeon_180b", devices: [] }],
  }, { home: { id: "mokryeon_180b", name: "한양목련 180B (도면 기준)" }, mode: "test", devices: [] });
  const menu = within(await screen.findByRole("navigation", { name: "설정 항목" }));
  expect(menu.queryByRole("link", { name: "집 고르기" })).not.toBeInTheDocument();
  expect(menu.getByRole("link", { name: "모드" })).toHaveAccessibleDescription("테스트 모드");
  await user.click(menu.getByRole("link", { name: "가전 연결" }));
  expect(await screen.findByRole("main", { name: "가전 연결" })).toBeInTheDocument();
  expect(screen.getByRole("banner")).toHaveClass("phone-portal-header--centered");
  expect(within(screen.getByRole("banner")).queryByText("설정")).not.toBeInTheDocument();
  expect(await screen.findByText("LG ThinQ API 기본 연결")).toBeInTheDocument();
  expect(screen.getByText("허브에 설정됨 · 조회 전")).toBeInTheDocument();
  expect(api.calls.some(c => c.path.includes("/api/setup/thinq"))).toBe(false);
  await user.click(screen.getByRole("button", { name: "LG ThinQ 기기 확인" }));
  expect(await screen.findByText("조회 성공 · 기기 0개")).toBeInTheDocument();
  expect(screen.getByText("이 집에는 연결할 가전이 없어요.")).toBeInTheDocument();
  expect(api.posts("/api/setup/mode")).toHaveLength(0);
  expect(screen.getByText("Matter")).toBeInTheDocument();
  expect(screen.getByText("적외선 리모컨")).toBeInTheDocument();
});

it("폰에서 가전, 모드, 시작 위치와 자리·구역 및 배치 보정으로 바로 갈 수 있다", async () => {
  open();
  const banner = screen.getByRole("banner");
  const heading = within(banner).getByRole("heading", { name: "NOONCHI" });
  const mark = within(heading).getByRole("img", { name: "NOONCHI" });
  expect(mark).toHaveAttribute("src", "/brand/noonchi-wordmark.svg");
  expect(Array.from(banner.querySelectorAll("img"))).toEqual([mark]);
  expect(within(banner).getByText("설정")).toBeVisible();
  const links = within(await screen.findByRole("navigation", { name: "설정 항목" })).getAllByRole("link");
  expect(links.map(link => link.getAttribute("href"))).toEqual(["#appliances", "#mode", "#position", "#stations", "#layout"]);
  const portal = within(screen.getByRole("navigation", { name: "폰 메뉴" }));
  expect(portal.getByRole("link", { name: "홈" })).toHaveAttribute("href", "/mobile/?tab=home");
  expect(portal.getByRole("link", { name: "집 관리" })).toHaveAttribute("href", "/mobile/?tab=house");
  expect(portal.getByRole("link", { name: "설정" })).toHaveAttribute("aria-current", "page");
  expect(screen.queryByRole("link", { name: "폰 홈으로" })).not.toBeInTheDocument();
});

it("설정은 도면 메타 없이 현재 집과 연결 수, 모드를 표시하고 편집 주소를 연다", async () => {
  const devices = setupView().devices.map((device, index) => ({ ...device, source: { kind: index < 2 ? "virtual" as const : "none" as const } }));
  const { user } = open("", {}, { home: { id: "mokryeon_180b", name: "한양목련 180B (도면 기준 · 방 4·욕실 3)" },
    devices, devices_saved: true, pairs: { ac_living: "pair-ac" }, mode: "live" });
  const menu = within(await screen.findByRole("navigation", { name: "설정 항목" }));
  expect(within(menu.getByRole("list")).getAllByRole("listitem")).toHaveLength(5);
  expect(screen.getByText("한양목련 180B")).toBeVisible();
  expect(screen.queryByText(/도면 기준/)).not.toBeInTheDocument();
  expect(menu.getByRole("link", { name: "가전 연결" })).toHaveAccessibleDescription("1개 연결");
  const mode = menu.getByRole("link", { name: "모드" });
  expect(mode).toHaveAccessibleDescription("운영 모드");
  await user.click(within(mode).getByText("운영 모드"));
  expect(await screen.findByRole("heading", { name: "가전을 어떻게 다룰까요?" })).toBeInTheDocument();
  expect(location.hash).toBe("#mode");
});

it("가전이 저장되기 전에는 기본 선택 수를 표시하지 않고 시작 위치와 배치 여부를 추정하지 않는다", async () => {
  open();
  const menu = within(await screen.findByRole("navigation", { name: "설정 항목" }));
  expect(menu.getByRole("link", { name: "가전 연결" })).toHaveAccessibleDescription("미연결");
  expect(menu.getByRole("link", { name: "모드" })).toHaveAccessibleDescription("테스트 모드");
  for (const name of ["시작 위치", "자리·구역 설정", "배치 보정"]) {
    expect(menu.getByRole("link", { name })).not.toHaveAccessibleDescription();
  }
});

it("기존 기기 저장 요청을 완료한 뒤 폰 홈으로 돌아간다", async () => {
  const { api, navigate, user } = open("#devices");
  await user.type(await screen.findByRole("searchbox", { name: "가전 검색" }), "거실 TV");
  await user.keyboard("{Enter}");
  await user.click(screen.getByRole("button", { name: "저장하고 돌아가기" }));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith("/mobile/"));
  expect(api.posts("/api/setup/devices")[0]?.body).toMatchObject({ home: "oneroom", sources: { tv_living: "virtual" } });
  expect(api.posts("/api/setup/done")).toHaveLength(0);
});

it("집 선택이 서버에 저장되면 폰 홈으로 돌아간다", async () => {
  const { api, navigate, user } = open("#home");
  await user.click(await screen.findByRole("radio", { name: /마곡 아파트/ }));
  await user.click(screen.getByRole("button", { name: "저장하고 돌아가기" }));
  expect(api.view().home?.id).toBe("apartment");
  expect(navigate).toHaveBeenCalledWith("/mobile/");
});

it("운영 모드는 명시 저장과 확인을 거치고 가전 연결은 별도 설정으로 유지한다", async () => {
  const { api, navigate, user } = open("#mode", {
    "POST /api/setup/mode": () => {
      api.setView({ ...api.view(), mode: "live" });
      return [200, api.view()];
    },
    "GET /api/setup/thinq?home=oneroom": () => [200, { ok: true, home: "oneroom", devices: [{ id: "test-pair", name: "시험 에어컨", kind: "aircon" }] }],
    "POST /api/setup/pairs": b => {
      api.setView({ ...api.view(), pairs: b.pairs });
      return [200, api.view()];
    },
  });
  await user.click(await screen.findByRole("radio", { name: /운영 모드/ }));
  expect(api.posts("/api/setup/mode")).toHaveLength(0);
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "모드 저장" }));
  await user.click(screen.getByRole("button", { name: "운영 모드로 바꾸기" }));
  expect(api.posts("/api/setup/mode")[0]?.body).toEqual({ mode: "live", confirm: true });
  expect(api.calls.some(c => c.path.includes("/api/setup/thinq"))).toBe(false);
  await user.click(screen.getByRole("button", { name: "설정 목록" }));
  await user.click(screen.getByRole("link", { name: "가전 연결" }));
  await user.click(screen.getByRole("button", { name: "LG ThinQ 기기 확인" }));
  await user.selectOptions(await screen.findByRole("combobox", { name: "거실 에어컨 ThinQ 기기" }), "test-pair");
  expect(api.view().pairs.ac_living).toBe("test-pair");
  await user.click(screen.getByRole("button", { name: "완료하고 돌아가기" }));
  expect(navigate).toHaveBeenCalledWith("/mobile/");
});

it("기존 시작 위치를 고쳐 저장한 뒤 폰 홈으로 돌아간다", async () => {
  const start = { position: [1, 2], yaw_deg: 35, label: "식탁", facing_label: "문" };
  const { api, navigate, user } = open("#position", {
    "GET /api/phone/start-pose": () => [200, { ok: true, start }],
    "POST /api/phone/start-pose": b => [200, { ok: true, start: { ...start, label: b.label } }],
  });
  const label = await screen.findByRole("textbox", { name: "시작 자리 이름" });
  await user.clear(label);
  await user.type(label, "소파");
  await user.click(within(screen.getByRole("region", { name: "시작 위치" })).getByRole("button", { name: "저장" }));
  expect(api.posts("/api/phone/start-pose")[0]?.body).toMatchObject({ home: "oneroom", position: [1, 2], yaw_deg: 35, label: "소파" });
  expect(navigate).toHaveBeenCalledWith("/mobile/");
});

it("집 홈의 직접 링크에서 시작 위치를 지우면 같은 집의 저장값을 지우고 홈으로 돌아간다", async () => {
  const start = { position: [1, 2], yaw_deg: 35, label: "식탁", facing_label: "문" };
  const { api, navigate, user } = open("?positionHome=oneroom#position", {
    "GET /api/phone/start-pose": () => [200, { ok: true, start }],
    "POST /api/phone/start-pose/clear": () => [200, { ok: true, start: null }],
  });
  const region = await screen.findByRole("region", { name: "시작 위치" });
  await user.click(await within(region).findByRole("button", { name: "지우기" }));
  expect(api.posts("/api/phone/start-pose/clear")[0]?.body).toEqual({ home: "oneroom" });
  expect(navigate).toHaveBeenCalledWith("/mobile/");
});

it("홈의 시작 위치 링크를 연 사이 허브 집이 바뀌면 다른 집의 시작 위치를 열지 않는다", async () => {
  const { api } = open("?positionHome=mokryeon_180b#position");
  const notice = await screen.findByText("허브에 열린 집이 바뀌었어요. 집을 확인해 주세요.");
  expect(notice.closest('[role="status"]')).toBeInTheDocument();
  expect(screen.getByRole("navigation", { name: "설정 항목" })).toBeVisible();
  expect(api.calls.some(({ path }) => path === "/api/phone/start-pose")).toBe(false);
});

it("대기·관찰 자리 지도는 기존 PUT으로 저장하고 폰 홈으로 돌아간다", async () => {
  const map = { version: 1, stations: [{ id: "watch", name: "관찰점", room: "living", roles: ["observe"],
    position: [1, 1], look_at: [2, 2], rooms: ["living"], surfaces: [], observes_zone_ids: [] }],
    zones: [], surface_fronts: [], kitchen_entry: null, meal_watch: "watch" };
  const { api, navigate, user } = open("#stations", {
    "GET /api/setup/stations": () => [200, { ok: true, home: "oneroom", map }],
    "GET /api/scene": () => [200, { ok: true, scene: { plan: { rooms: [{ id: "living", label: "거실" }] }, objects: [] } }],
    "PUT /api/setup/stations": b => [200, { ok: true, ...b }],
  });
  const name = await screen.findByRole("textbox", { name: "이름" });
  await user.clear(name);
  await user.type(name, "식탁 관찰");
  await user.click(within(screen.getByRole("region", { name: "자리·구역 편집" })).getByRole("button", { name: "저장" }));
  expect(api.calls.find(c => c.method === "PUT")).toMatchObject({ path: "/api/setup/stations", body: { home: "oneroom", map: { stations: [{ name: "식탁 관찰" }] } } });
  expect(navigate).toHaveBeenCalledWith("/mobile/");
});

it("배치 보정 목록의 저장 실패에는 남고 저장 성공 뒤 폰 홈으로 돌아간다", async () => {
  let allowed = false;
  const { api, navigate, user } = open("#layout", {
    "GET /api/layout": () => [200, { ok: true, edits: 1, dirty: true, items: [] }],
    "POST /api/layout/save": () => allowed ? [200, { ok: true, count: 1 }] : [400, { ok: false, error: "저장 실패" }],
  });
  const layout = await screen.findByRole("region", { name: "배치 보정" });
  await user.click(await within(layout).findByRole("button", { name: "저장" }));
  expect(await screen.findByText("저장 실패")).toBeInTheDocument();
  expect(navigate).not.toHaveBeenCalled();
  allowed = true;
  await user.click(within(layout).getByRole("button", { name: "저장" }));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith("/mobile/"));
  expect(api.posts("/api/layout/save").map(({ body }) => body)).toEqual([{ home: "oneroom" }, { home: "oneroom" }]);
});
