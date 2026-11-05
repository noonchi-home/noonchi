import { useCallback, useState } from "react";
import type { ServerMessage } from "../../../src/contract/events.ts";
import { BubbleLayer } from "../bubbles/BubbleLayer";
import { DecisionLog, type LogView } from "../chat/DecisionLog";
import { useLog } from "../chat/use-log";
import { useDevices } from "../lib/use-devices";
import { useEvents } from "../lib/use-events";
import { useHealth } from "../lib/use-health";
import { EyeBody, EyeWindow } from "../panels/EyeWindow";
import { StatusPill } from "../panels/StatusPill";
import { TwinStage } from "../twin/TwinStage";
import { useAnchors } from "../twin/use-anchors";

function Overlay({ devices, focusId }: { devices: ReturnType<typeof useDevices>["devices"]; focusId: string | null }) {
  const points = useAnchors([...devices.keys()]);
  return <BubbleLayer devices={devices} points={points} focusId={focusId} />;
}

/**
 * A 구조: 3D 트윈이 화면 전체 배경, 그 위에 패널(위 가운데 상태 알약, 왼쪽 위 눈 창, 오른쪽 판단 기록)이 떠 있다.
 * 대시보드에는 입력이 없다: 요청·승인은 폰에서 음성으로 오고, 판단 기록은 서버 메시지로만 쌓인다.
 * 판단 기록의 「폰 화면」 탭을 고르면 폰 화면을 오른쪽 패널에 크게 띄우고 왼쪽 위 눈 창은 숨긴다.
 * 패널은 덮개 층의 바로 아래 자식이라 패널 밖 빈 곳의 마우스는 3D로 간다.
 */
export function Dashboard() {
  const { devices, apply } = useDevices();
  const health = useHealth();
  const { turns, onMessage: toLog } = useLog();
  const [view, setView] = useState<LogView>("log");
  const [connected, setConnected] = useState<boolean | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const homeId = health?.home?.id ?? null;
  const onMessage = useCallback((m: ServerMessage) => {
    if (m.type === "hello" && homeId && m.home && m.home !== homeId) {
      location.reload(); // 설정에서 집을 바꿨다
      return;
    }
    apply(m);
    toLog(m);
    if (m.type === "agent" && m.event === "action" && m.action.deviceId) setFocusId(m.action.deviceId);
  }, [apply, toLog, homeId]);
  useEvents(onMessage, setConnected);
  return (
    <main className="relative h-full w-full overflow-hidden">
      <TwinStage>
        <Overlay devices={devices} focusId={focusId} />
        <StatusPill connected={connected} health={health} />
        {view === "log" && <EyeWindow health={health} connected={connected} />}
        <DecisionLog turns={turns} view={view} onView={setView} phone={<EyeBody health={health} connected={connected} large />} />
      </TwinStage>
    </main>
  );
}
