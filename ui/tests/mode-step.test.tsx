import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SetupView, ThinqDeviceView } from "../../src/contract/setup.ts";
import { SetupApp } from "../src/setup/SetupApp";
import { FakeWebSocket, fakeSetupApi, setupView } from "./helpers/setup-api";

const THINQ: ThinqDeviceView[] = [
  { id: "thinq-ac-1", type: "DEVICE_AIR_CONDITIONER", name: "거실 에어컨", model: "FQ18", kind: "aircon" },
  { id: "thinq-fridge-1", type: "DEVICE_REFRIGERATOR", name: "주방 냉장고", model: "M874", kind: "fridge" },
];

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** 실제 모드·ThinQ 목록·짝 저장까지 답하는 가짜 서버로 #mode를 연다. */
function open(view: SetupView = setupView(), extra: Record<string, (b: any) => [number, unknown]> = {}) {
  history.replaceState(null, "", "/setup/#mode");
  let api: ReturnType<typeof fakeSetupApi>;
  api = fakeSetupApi(view, {
    "POST /api/setup/mode": (b) => { api.setView({ ...api.view(), mode: b.mode }); return [200, api.view()]; },
    "GET /api/setup/thinq": () => [200, { ok: true, devices: THINQ }],
    "POST /api/setup/pairs": (b) => {
      const pairs = { ...api.view().pairs };
      for (const [id, v] of Object.entries(b.pairs as Record<string, string | null>)) { if (v === null) delete pairs[id]; else pairs[id] = v; }
      api.setView({ ...api.view(), pairs });
      return [200, api.view()];
    },
    ...extra,
  });
  vi.stubGlobal("fetch", api.fetchMock);
  render(<SetupApp navigate={vi.fn()} />);
  return { api, user: userEvent.setup() };
}

describe("설정: 운영 모드", () => {
  it("시험 모드가 골라져 있고, ThinQ 목록을 부르지 않는다", async () => {
    const { api } = open();
    expect(await screen.findByRole("heading", { name: "가전을 어떻게 다룰까요?" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /시험 모드/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /실제 모드/ })).not.toBeChecked();
    expect(screen.queryByRole("region", { name: "ThinQ 짝" })).toBeNull();
    expect(api.calls.some((c) => c.path === "/api/setup/thinq")).toBe(false);
  });

  it("실제 모드를 누르면 화면 안에서 한 번 더 묻고, 그 전에는 바꾸지 않는다. 취소면 그대로", async () => {
    const confirm = vi.spyOn(window, "confirm");
    const { api, user } = open();
    await user.click(await screen.findByRole("radio", { name: /실제 모드/ }));
    const dialog = screen.getByRole("alertdialog", { name: "실제 모드로 바꿀까요?" });
    expect(within(dialog).getByText("실제 가전이 움직여요.")).toBeInTheDocument();
    expect(api.posts("/api/setup/mode")).toHaveLength(0);
    await user.click(within(dialog).getByRole("button", { name: "취소" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("radio", { name: /시험 모드/ })).toBeChecked();
    expect(api.posts("/api/setup/mode")).toHaveLength(0);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("확인하면 실제 모드로 바꾸고, ThinQ 기기를 불러와 에어컨·냉장고와 짝짓는다", async () => {
    const confirm = vi.spyOn(window, "confirm");
    const alert = vi.spyOn(window, "alert");
    const { api, user } = open();
    await user.click(await screen.findByRole("radio", { name: /실제 모드/ }));
    await user.click(screen.getByRole("button", { name: "실제 모드로 바꾸기" }));
    await waitFor(() => expect(api.posts("/api/setup/mode")).toHaveLength(1));
    expect(api.posts("/api/setup/mode")[0]!.body).toEqual({ mode: "live", confirm: true });
    const pairs = await screen.findByRole("region", { name: "ThinQ 짝" });
    expect(screen.getByRole("radio", { name: /실제 모드/ })).toBeChecked();
    const ac = await within(pairs).findByRole("combobox", { name: "거실 에어컨 ThinQ 기기" });
    expect(within(ac).getAllByRole("option").map((o) => o.textContent)).toEqual(["짝 없음", "거실 에어컨"]);
    const fridge = within(pairs).getByRole("combobox", { name: "냉장고 ThinQ 기기" });
    expect(within(fridge).getAllByRole("option").map((o) => o.textContent)).toEqual(["짝 없음", "주방 냉장고"]);
    expect(within(pairs).queryByRole("combobox", { name: /거실 TV/ })).toBeNull();
    await user.selectOptions(ac, "thinq-ac-1");
    await waitFor(() => expect(api.posts("/api/setup/pairs")).toHaveLength(1));
    expect(api.posts("/api/setup/pairs")[0]!.body).toEqual({ home: "oneroom", pairs: { ac_living: "thinq-ac-1" } });
    expect(ac).toHaveValue("thinq-ac-1");
    await user.selectOptions(ac, "");
    await waitFor(() => expect(api.posts("/api/setup/pairs")).toHaveLength(2));
    expect(api.posts("/api/setup/pairs")[1]!.body).toEqual({ home: "oneroom", pairs: { ac_living: null } });
    expect(confirm).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
  });

  it("토큰이 없으면 실제 모드를 고를 수 없다", async () => {
    open(setupView({ thinq: { ready: false } }));
    expect(await screen.findByRole("radio", { name: /실제 모드/ })).toBeDisabled();
    expect(screen.getByText("ThinQ 토큰이 없어요.")).toBeInTheDocument();
  });

  it("실제 모드에서 시험 모드로는 묻지 않고 바로 바꾼다", async () => {
    const { api, user } = open(setupView({ mode: "live", pairs: { ac_living: "thinq-ac-1" } }));
    const ac = await screen.findByRole("combobox", { name: "거실 에어컨 ThinQ 기기" });
    await waitFor(() => expect(ac).toHaveValue("thinq-ac-1"));
    await user.click(screen.getByRole("radio", { name: /시험 모드/ }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() => expect(api.posts("/api/setup/mode")).toHaveLength(1));
    expect(api.posts("/api/setup/mode")[0]!.body).toEqual({ mode: "test" });
    await waitFor(() => expect(screen.queryByRole("region", { name: "ThinQ 짝" })).toBeNull());
  });

  it("바꾸지 못하면 이유를 보이고 시험 모드 그대로", async () => {
    const { user } = open(setupView(), { "POST /api/setup/mode": () => [400, { ok: false, error: "ThinQ 토큰이 없어요. 실제 모드로 바꿀 수 없어요." }] });
    await user.click(await screen.findByRole("radio", { name: /실제 모드/ }));
    await user.click(screen.getByRole("button", { name: "실제 모드로 바꾸기" }));
    expect(await screen.findByText("ThinQ 토큰이 없어요. 실제 모드로 바꿀 수 없어요.")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /시험 모드/ })).toBeChecked();
  });

  it("ThinQ 목록을 못 받으면 이유와 다시 불러오기", async () => {
    let fail = true;
    const { user } = open(setupView({ mode: "live" }), {
      "GET /api/setup/thinq": () => (fail ? [502, { ok: false, error: "ThinQ 기기 목록을 받지 못했어요." }] : [200, { ok: true, devices: THINQ }]),
    });
    expect(await screen.findByText("ThinQ 기기 목록을 받지 못했어요.")).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole("button", { name: "다시 불러오기" }));
    expect(await screen.findByRole("combobox", { name: "거실 에어컨 ThinQ 기기" })).toBeInTheDocument();
  });

  it("이전·다음으로 가전 선택·위치 동기화로 간다", async () => {
    const { user } = open();
    await user.click(await screen.findByRole("button", { name: "다음" }));
    expect(await screen.findByRole("heading", { name: "폰과 트윈의 위치를 맞춰요" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "이전" }));
    expect(await screen.findByRole("heading", { name: "가전을 어떻게 다룰까요?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "이전" }));
    expect(await screen.findByRole("heading", { name: "어떤 가전의 상태를 읽을까요?" })).toBeInTheDocument();
  });
});
