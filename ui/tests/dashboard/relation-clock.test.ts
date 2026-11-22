import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FACT_FRESH_MS } from "../../../src/world/vocab";
import { EMPTY_DASH, type DashData } from "../../src/dashboard/data";
import { useRelations } from "../../src/dashboard/use-relations";

afterEach(() => vi.useRealTimers());
it("새 사건이 없어도 판단은 만료되고 연결이 끊기면 마지막 자료를 숨긴다", () => {
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
  const decision: DashData["decision"] = {
    type: "decision", id: "pam-1", seq: 1, status: "valid", action: "컵 치우기",
    at_ms: Date.now(), text_sent: "", prediction: null, memory_version: 1,
    world: { objects: [], person_visible: false, yolo_missing: 0, vlm_missing: 0 },
  };
  const dash = { ...EMPTY_DASH, decision };
  const hook = renderHook(({ live }) => useRelations(dash, null, undefined, live), { initialProps: { live: true } });
  expect(hook.result.current.nodes.length).toBeGreaterThan(0);
  hook.rerender({ live: false });
  expect(hook.result.current.nodes).toEqual([]);
  hook.rerender({ live: true });
  act(() => vi.advanceTimersByTime(FACT_FRESH_MS + 1));
  expect(hook.result.current.nodes).toEqual([]);
});
