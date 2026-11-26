import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePhoneCommand } from "../../src/dashboard/use-phone-command";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

it("영상 지연이 줄어도 명령과 해제를 수신 순서대로 반영한다", () => {
  const { result } = renderHook(usePhoneCommand);
  const command = (text: string | null) => result.current.onMessage({ type: "phone_command", text });
  act(() => {
    command("식탁으로 가 주세요");
    result.current.onDelay(300);
    command("컵을 들어 주세요");
    result.current.onDelay(0);
    command(null);
    vi.advanceTimersByTime(299);
  });
  expect(result.current.command).toBe("식탁으로 가 주세요");
  act(() => vi.advanceTimersByTime(1));
  expect(result.current.command).toBeNull();
});

it("hello는 보이던 명령과 대기 중인 명령을 지우고 새 세션의 명령을 받는다", () => {
  const { result } = renderHook(usePhoneCommand);
  act(() => {
    result.current.onMessage({ type: "phone_command", text: "컵을 들어 주세요" });
    result.current.onDelay(300);
    result.current.onMessage({ type: "phone_command", text: "싱크대로 가 주세요" });
    result.current.onMessage({ type: "hello", devices: 0, provider: null, hub: "memory", home: "h" });
  });
  expect(result.current.command).toBeNull();
  act(() => {
    result.current.onDelay(40);
    result.current.onMessage({ type: "phone_command", text: "책상으로 가 주세요" });
    vi.advanceTimersByTime(40);
  });
  expect(result.current.command).toBe("책상으로 가 주세요");
  act(() => vi.advanceTimersByTime(300));
  expect(result.current.command).toBe("책상으로 가 주세요");
});
