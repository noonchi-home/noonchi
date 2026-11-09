import { useCallback, useEffect, useMemo, useState } from "react";
import type { ServerMessage } from "../../../src/contract/events.ts";
import { BubbleLayer } from "../bubbles/BubbleLayer";
import { checkList, type ChecksState } from "../checks/checks";
import { useChecks } from "../checks/use-checks";
import { useDevices } from "../lib/use-devices";
import { useEvents } from "../lib/use-events";
import { useHealth } from "../lib/use-health";
import { TwinStage } from "../twin/TwinStage";
import { useAnchors } from "../twin/use-anchors";
import { useViewer } from "../twin/viewer";
import { DashboardScreen } from "./DashboardScreen";
import { hubOf } from "./hub";
import type { PhoneSlot } from "./PhonePane";
import { WORDS } from "./words";

/** 트윈 위에 얹힌 것: 말풍선이 덮지 않을 자리. */
const AVOID = "[data-say-card], [data-mascot], [data-progress], [data-chips]";

/** 확인 목록만 말풍선으로. 두뇌 줄은 장면의 식탁(dining_table)에 붙는다. 자리는 확인한 것만 센다. 말풍선은 트윈 위에 얹힌 것(AVOID)을 비킨다. */
function Overlay({ devices, checks, focusId }: { devices: ReturnType<typeof useDevices>["devices"]; checks: ChecksState; focusId: string | null }) {
  const v = useViewer();
  const table = useMemo(() => v?.objects().find((o) => o.type === "dining_table") ?? null, [v]);
  const list = useMemo(() => checkList(checks, table?.id ?? null), [checks, table]);
  const objects = useMemo(() => new Map<string, string>(table ? [[table.id, table.name ?? "식탁"]] : []), [table]);
  const points = useAnchors(list.map((c) => c.deviceId ?? c.objectId!));
  return <BubbleLayer checks={list} devices={devices} objects={objects} points={points} focusId={focusId} avoid={AVOID} />;
}

/** 3D 트윈을 다 불러왔으면 알린다. */
function MapReady({ onReady }: { onReady: (ready: boolean) => void }) {
  const v = useViewer();
  useEffect(() => { onReady(v !== null); }, [v, onReady]);
  return null;
}

/**
 * 대시보드: 서버에서 받은 것(health·/events·기기·확인 목록)을 화면 틀(DashboardScreen)에 넘긴다.
 * 트윈 칸 지도 자리에는 3D 트윈(iframe)과 그 위 확인 목록 말풍선을 둔다. 대시보드 폰 칸은 폰 서버가 켜져 있으면 실시간 영상, 아니면 연결 QR이다.
 * 대시보드에는 입력이 없다: 요청·승인은 폰에서 음성으로 온다. 설정에서 집을 바꾸면 다시 불러온다.
 */
export function Dashboard() {
  const { devices, apply } = useDevices();
  const health = useHealth();
  const { checks, onMessage: toChecks } = useChecks();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [viewerReady, setViewerReady] = useState(false);
  const homeId = health?.home?.id ?? null;
  const onMessage = useCallback((m: ServerMessage) => {
    if (m.type === "hello" && homeId && m.home && m.home !== homeId) {
      location.reload(); // 설정에서 집을 바꿨다
      return;
    }
    apply(m);
    toChecks(m);
    if (m.type === "agent" && m.event === "action" && m.action.deviceId) setFocusId(m.action.deviceId);
  }, [apply, toChecks, homeId]);
  useEvents(onMessage, setConnected);
  const hub = useMemo(() => hubOf(health, connected), [health, connected]);
  const phone: PhoneSlot = health?.eye ? { kind: "live", url: hub.phoneUrl } : { kind: "qr", url: hub.phoneUrl };
  const map = (
    <TwinStage>
      <Overlay devices={devices} checks={checks} focusId={focusId} />
      <MapReady onReady={setViewerReady} />
    </TwinStage>
  );
  // 트윈이 없는 집은 기다리지 않는다
  const mapReady = viewerReady || health?.twin === false;
  return (
    <DashboardScreen
      index={0} plan={null} step={null} robotKnown connected={connected} map={map} mapReady={mapReady}
      phone={phone} boxes={[]} frame={null} observation={null} action={WORDS.wait} say="" facing="video" hub={hub}
    />
  );
}
