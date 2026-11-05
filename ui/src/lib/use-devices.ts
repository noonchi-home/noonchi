import { useCallback, useEffect, useState } from "react";
import type { DeviceView, ServerMessage } from "../../../src/contract/events.ts";
import { api } from "./api";

/** 기기 목록: GET /api/devices(DeviceView 배열)로 시작하고, state 메시지로 그 기기 상태만 바꾼다. */
export function useDevices() {
  const [devices, setDevices] = useState<Map<string, DeviceView>>(() => new Map());
  const load = useCallback(async () => {
    try {
      const r = await api<DeviceView[]>("/api/devices");
      if (Array.isArray(r.json)) setDevices(new Map(r.json.map((d) => [d.id, d])));
    } catch {
      // 서버에 못 붙으면 빈 목록 그대로 둔다(연결 상태는 상태 알약이 보인다)
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const apply = useCallback((m: ServerMessage) => {
    if (m.type !== "state") return;
    setDevices((prev) => {
      const d = prev.get(m.state.id);
      if (!d) return prev;
      const next = new Map(prev);
      next.set(d.id, { ...d, state: m.state });
      return next;
    });
  }, []);
  return { devices, apply, reload: load };
}
