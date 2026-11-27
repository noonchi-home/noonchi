// 실행 추적의 기기 단계 실행(src/act/track/tracker.ts DeviceRunner): 말 요청과 같은 기기 도구(src/agent/tools.ts)와 정책(src/agent/policy.ts, 위험 목록은 승인 토큰).
// 보내기 바로 앞(정책 → 허브)에서 그 계획 단계가 아직 진행 중인지(live) 다시 보고, 아니면 보내지 않는다. 승인 토큰을 버릴 때는 consume한다.
import type { Policy } from "../agent/index.js";
import { AGENT_TOOLS, isRemoteHub, localBackend, runTool, type ToolBackend } from "../agent/index.js";
import type { DeviceHub, RoomSpec } from "../contract/devices.js";
import type { DeviceRunner } from "./track/tracker.js";

const SKIPPED = "계획이 바뀌어 보내지 않았어요.";

export function deviceRunner(hub: DeviceHub, policy: Policy, rooms?: RoomSpec[]): DeviceRunner {
  return {
    run: (tool, deviceId, args, live, commandId) => {
      const base = localBackend(hub, policy, rooms);
      const backend: ToolBackend = { ...base, command: (id, cmd, token) => (live() ? policy.guard(hub,id,cmd,token,commandId) : Promise.resolve({ ok: false, error: SKIPPED })),
        ...(isRemoteHub(hub) ? { remote: { press: (id: string, b: string) => (live() ? hub.press(id, b, commandId) : Promise.resolve({ ok: false as const, error: SKIPPED })) } } : {}) };
      return runTool(tool, { ...args, device_id: deviceId }, backend, AGENT_TOOLS);
    },
    confirm: async (token, live) => {
      if (!live()) {
        policy.consume(token);
        return { ok: false, error: SKIPPED };
      }
      const r = await policy.confirm(hub, token);
      return { ok: r.ok, error: r.error, ...(r.outcome === "unverified" ? { unverified: true as const } : {}), ...(r.state?.signal === "none" ? { state: "모름" as const } : {}) };
    },
    cancel: (token) => { policy.consume(token); },
  };
}
