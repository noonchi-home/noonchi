import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardScreen, type ScreenProps } from "../../src/dashboard/DashboardScreen";
import { screenAt } from "./fixtures";

afterEach(() => vi.restoreAllMocks());

function show(width: number, height: number, phone?: ScreenProps["phone"]) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(DOMRect.fromRect({ width, height }));
  const props = { ...screenAt(2), ...(phone && { phone }), narration: <div>현재 상황</div>, command: "컵을 들어 주세요.", map: <div data-testid="engine" /> };
  return render(<DashboardScreen {...props as ScreenProps} />);
}
function card(name: string, parent = false) {
  const region = screen.getByRole("region", { name });
  const style = (parent ? region.parentElement! : region).style;
  return { x: parseFloat(style.left), y: parseFloat(style.top), w: parseFloat(style.width), h: parseFloat(style.height) };
}
describe("대시보드 벤토", () => {
  it.each([[1440, 900, 1280, 720], [1280, 720, 960, 720], [1920, 1080, 720, 1280]])(
    "%d×%d에서 폰 원본 %d×%d와 트윈은 같은 위·아래 선에 놓이고 폰 그림 위아래에 빈 띠가 없다",
    (width, height, fw, fh) => {
      show(width, height, { kind: "image", src: "/sample.png", width: fw, height: fh });
      const camera = card("폰 카메라"), twin = card("트윈", true);
      expect(screen.getByRole("region", { name: "폰 카메라" }).querySelector("header")).toBeNull();
      expect(screen.getByRole("region", { name: "트윈" }).querySelector("header")).toBeNull();
      expect(camera.y).toBe(twin.y);
      expect(camera.y + camera.h).toBe(twin.y + twin.h);
      const mediaHeight = camera.h;
      expect(mediaHeight).toBeGreaterThan(0);
      expect(mediaHeight).toBeLessThanOrEqual(camera.w * fh / fw + 0.5);
    },
  );
  it("폰을 왼쪽 큰 칸, 트윈을 오른쪽 독립 칸에 두고 단계가 바뀌어도 칸을 유지한다", () => {
    const view = show(1280, 720);
    const camera = card("폰 카메라"), twin = card("트윈", true);
    expect(camera.x + camera.w).toBeLessThan(twin.x);
    expect(camera.w).toBeGreaterThan(twin.w);
    view.rerender(<DashboardScreen {...screenAt(3)} narration={<div>현재 상황</div>} />);
    expect(card("폰 카메라")).toEqual(camera);
  });
  it("폰 명령은 영상 위에, 목선까지 보이는 작은 마스코트는 설명 오른쪽에 둔다", () => {
    show(1440, 900);
    const phone = card("폰 카메라"), mascot = card("마스코트");
    const twin = card("트윈", true);
    const note = card("현재 상황");
    expect(mascot.x).toBeGreaterThanOrEqual(twin.x);
    expect(mascot.x + mascot.w).toBeLessThanOrEqual(twin.x + twin.w);
    expect(note.x + note.w).toBeLessThanOrEqual(mascot.x);
    expect(mascot.y).toBeGreaterThanOrEqual(phone.y + phone.h);
    expect(mascot.w).toBeGreaterThanOrEqual(60);
    expect(mascot.w).toBeLessThanOrEqual(112);
    const picture = screen.getByRole("region", { name: "마스코트" }).querySelector("img")!;
    const bottomInSource = (mascot.h - parseFloat(picture.style.top)) * Number(picture.getAttribute("width")) / parseFloat(picture.style.width);
    expect(bottomInSource).toBeGreaterThan(270);
    expect(bottomInSource).toBeLessThan(435);
    expect(screen.getByText("컵을 들어 주세요.").closest("[data-video]")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "연결" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "설정 열기" }));
    expect(screen.getByRole("dialog")).toBeVisible();
  });
  it("좁은 창에서는 폰과 트윈을 위아래로 두어 화면 밖으로 밀리지 않는다", () => {
    show(390, 740);
    const camera = card("폰 카메라"), twin = card("트윈", true);
    expect(twin.y).toBeGreaterThanOrEqual(camera.y + camera.h);
    expect(twin.x + twin.w).toBeLessThanOrEqual(390);
    const panel = card("현재 상황"), head = card("마스코트");
    expect(panel.x + panel.w).toBeLessThanOrEqual(head.x);
    expect(head.y).toBeGreaterThanOrEqual(panel.y);
  });
});
