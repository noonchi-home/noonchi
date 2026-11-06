import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { HealthView } from "../../src/contract/events.ts";
import { StatusPill } from "../src/panels/StatusPill";

const health: HealthView = {
  ok: true, devices: 65, hub: "memory", transport: null, provider: "mock", model: "rules-ko", twin: true, eye: true,
  home: { id: "apartment", name: "마곡 아파트" }, phone_urls: [], brain: false,
  mode: "test",
};

describe("StatusPill", () => {
  it("연결 상태 글: 처음·연결됨·끊김", () => {
    const { rerender } = render(<StatusPill connected={null} health={null} />);
    expect(screen.getByRole("status")).toHaveTextContent("연결 중…");
    rerender(<StatusPill connected health={health} />);
    expect(screen.getByRole("status")).toHaveTextContent("실시간 연결됨");
    rerender(<StatusPill connected={false} health={health} />);
    expect(screen.getByRole("status")).toHaveTextContent("연결 끊김 · 다시 연결 중");
  });

  it("집·허브·에이전트 배지와 설정 다시 하기 링크", () => {
    render(<StatusPill connected health={{ ...health, hub: "matter", transport: "udp" }} />);
    expect(screen.getByText("집 마곡 아파트")).toBeInTheDocument();
    expect(screen.getByText("허브 matter · udp")).toBeInTheDocument();
    expect(screen.getByText("에이전트 mock · rules-ko")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "설정 다시 하기" })).toHaveAttribute("href", "/setup/");
    expect(screen.queryByText("3D 트윈 없음")).toBeNull();
  });

  it("상태를 받기 전에는 -, 트윈이 없으면 알린다", () => {
    const { rerender } = render(<StatusPill connected={null} health={null} />);
    expect(screen.getByText("집 -")).toBeInTheDocument();
    expect(screen.getByText("허브 -")).toBeInTheDocument();
    expect(screen.getByText("에이전트 -")).toBeInTheDocument();
    rerender(<StatusPill connected health={{ ...health, twin: false, provider: null, model: null }} />);
    expect(screen.getByText("3D 트윈 없음")).toBeInTheDocument();
    expect(screen.getByText("에이전트 없음")).toBeInTheDocument();
  });

  it("운영 모드를 보인다: 시험 모드·실제 모드", () => {
    const pill = (h: HealthView | null) => <StatusPill connected health={h} />;
    const { rerender } = render(pill(null));
    expect(screen.queryByText(/시험 모드|실제 모드/)).toBeNull();
    rerender(pill(health));
    expect(screen.getByRole("region", { name: "집 상태" })).toHaveTextContent("시험 모드");
    expect(screen.queryByText("실제 모드")).toBeNull();
    rerender(pill({ ...health, mode: "live" }));
    expect(screen.getByText("실제 모드")).toBeInTheDocument();
    expect(screen.queryByText("시험 모드")).toBeNull();
  });
});
