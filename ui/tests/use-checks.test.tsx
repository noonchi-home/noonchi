import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerMessage } from "../../src/contract/events.ts";
import { useChecks } from "../src/checks/use-checks";

const presence: ServerMessage = {
  type: "brain", event: { type: "presence", at_ms: 0, evidence_age_ms: 0, person: "yes", cup: "yes", table: "unknown", scores: { person: 0, cup: 0 }, summary: "" },
};

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(100_000); });
afterEach(() => { vi.useRealTimers(); });

describe("useChecks", () => {
  it("두뇌 줄은 마지막 메시지 뒤 30초가 지나면 저절로 사라진다", () => {
    const { result } = renderHook(() => useChecks());
    act(() => result.current.onMessage(presence));
    expect(result.current.checks.brain).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(29_000); });
    expect(result.current.checks.brain).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(2_000); });
    expect(result.current.checks.brain).toHaveLength(0);
  });
});
