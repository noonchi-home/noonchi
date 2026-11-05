import { useCallback, useState } from "react";
import type { Focus, ServerMessage } from "../../../src/contract/events.ts";
import { BubbleLayer } from "../bubbles/BubbleLayer";
import { useDevices } from "../lib/use-devices";
import { useEvents } from "../lib/use-events";
import { useHealth } from "../lib/use-health";
import { EyeWindow } from "../panels/EyeWindow";
import { StatusPill } from "../panels/StatusPill";
import { TwinStage } from "../twin/TwinStage";
import { useAnchors } from "../twin/use-anchors";

function Overlay({ devices, focusId }: { devices: ReturnType<typeof useDevices>["devices"]; focusId: string | null }) {
  const points = useAnchors([...devices.keys()]);
  return <BubbleLayer devices={devices} points={points} focusId={focusId} />;
}

/**
 * A 구조: 3D 트윈이 화면 전체 배경, 그 위에 유리 패널(위 가운데 상태 알약, 왼쪽 위 눈 창)이 떠 있다.
 * 패널은 덮개 층의 바로 아래 자식이라 패널 밖 빈 곳의 마우스는 3D로 간다.
 */
export function Dashboard() {
  const { devices, apply } = useDevices();
  const health = useHealth();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [focus, setFocus] = useState<Focus | null>(null);
  const homeId = health?.home?.id ?? null;
  const onMessage = useCallback((m: ServerMessage) => {
    if (m.type === "hello" && homeId && m.home && m.home !== homeId) {
      location.reload(); // 설정에서 집을 바꿨다
      return;
    }
    apply(m);
    if (m.type === "agent" && m.event === "action" && m.action.deviceId) setFocusId(m.action.deviceId);
    if (m.type === "focus") setFocus(m.focus);
  }, [apply, homeId]);
  useEvents(onMessage, setConnected);
  return (
    <main className="relative h-full w-full overflow-hidden">
      <TwinStage>
        <Overlay devices={devices} focusId={focusId} />
        <StatusPill connected={connected} health={health} />
        <EyeWindow health={health} focus={focus} connected={connected} />
      </TwinStage>
    </main>
  );
}
