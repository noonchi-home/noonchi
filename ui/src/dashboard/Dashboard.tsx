import { useCallback, useState } from "react";
import type { ServerMessage } from "../../../src/contract/events.ts";
import { BubbleLayer } from "../bubbles/BubbleLayer";
import { useDevices } from "../lib/use-devices";
import { useEvents } from "../lib/use-events";
import { TwinStage } from "../twin/TwinStage";
import { useAnchors } from "../twin/use-anchors";

function Overlay({ devices, focusId }: { devices: ReturnType<typeof useDevices>["devices"]; focusId: string | null }) {
  const points = useAnchors([...devices.keys()]);
  return <BubbleLayer devices={devices} points={points} focusId={focusId} />;
}

export function Dashboard() {
  const { devices, apply } = useDevices();
  const [focusId, setFocusId] = useState<string | null>(null);
  const onMessage = useCallback((m: ServerMessage) => {
    apply(m);
    if (m.type === "agent" && m.event === "action" && m.action.deviceId) setFocusId(m.action.deviceId);
  }, [apply]);
  useEvents(onMessage);
  return (
    <main className="relative h-full w-full overflow-hidden">
      <TwinStage><Overlay devices={devices} focusId={focusId} /></TwinStage>
    </main>
  );
}
