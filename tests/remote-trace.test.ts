// tests/remote-trace.test.ts
import { expect, it } from "vitest";
import type { TraceRow } from "../src/contract/trace.js";
import { kindEntry } from "../src/devices/kinds.js";
import { HomeTrace } from "../src/server/home/trace.js";

it("허브가 쏜 단추는 TOOL 리모컨 신호, 사람이 누른 단추는 OBSERVATION 리모컨 누름이고 단추 이름은 싣지 않는다", () => {
  const rows = new Map<string, TraceRow>();
  const trace = new HomeTrace("b:h#1", () => 1000, (m) => { for (const r of m.rows) rows.set(r.id, r); });
  trace.remote({ kind: "sent", device: "tv_1", remote: "r_0000000a", button: "b_00000002", role: null, at_ms: 1000, command_id: "cmd-1" }, "tv");
  trace.remote({ kind: "pressed", device: "tv_1", remote: "r_0000000a", button: "b_00000008", role: "toggle", at_ms: 1000, command_id: null }, "tv");
  const got = [...rows.values()].map((r) => ({ kind: r.kind, name: r.name, input: r.input, output: r.output, object: r.refs.object_id }));
  expect(got).toEqual([
    { kind: "TOOL", name: "리모컨 신호", input: kindEntry("tv")!.label, output: "신호 보냄", object: "tv_1" },
    { kind: "OBSERVATION", name: "리모컨 누름", input: kindEntry("tv")!.label, output: "단추 누름 확인", object: "tv_1" },
  ]);
  expect(JSON.stringify([...rows.values()])).not.toContain("b_0000");
});
