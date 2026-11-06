import { useCallback, useMemo, useState } from "react";
import type { ServerMessage } from "../../../src/contract/events.ts";
import { BubbleLayer } from "../bubbles/BubbleLayer";
import { DecisionLog, type LogView } from "../chat/DecisionLog";
import { checkList, type ChecksState } from "../checks/checks";
import { useChecks } from "../checks/use-checks";
import { useLog } from "../chat/use-log";
import { GlassFilter } from "../components/ui/liquid-glass";
import { useDevices } from "../lib/use-devices";
import { useEvents } from "../lib/use-events";
import { useHealth } from "../lib/use-health";
import { LookContext, lookOf } from "../look/look";
import { EyeBody, EyeWindow } from "../panels/EyeWindow";
import { StatusPill } from "../panels/StatusPill";
import { TwinStage } from "../twin/TwinStage";
import { useAnchors } from "../twin/use-anchors";
import { useViewer } from "../twin/viewer";

/** 확인 목록만 말풍선으로. 두뇌 줄은 장면의 식탁(dining_table)에 붙는다. 자리는 확인한 것만 센다. */
function Overlay({ devices, checks, focusId }: { devices: ReturnType<typeof useDevices>["devices"]; checks: ChecksState; focusId: string | null }) {
  const v = useViewer();
  const table = useMemo(() => v?.objects().find((o) => o.type === "dining_table") ?? null, [v]);
  const list = useMemo(() => checkList(checks, table?.id ?? null), [checks, table]);
  const objects = useMemo(() => new Map<string, string>(table ? [[table.id, table.name ?? "식탁"]] : []), [table]);
  const points = useAnchors(list.map((c) => c.deviceId ?? c.objectId!));
  return <BubbleLayer checks={list} devices={devices} objects={objects} points={points} focusId={focusId} />;
}

/**
 * A 구조: 3D 트윈이 화면 전체 배경, 그 위에 패널(위 가운데 상태 알약, 왼쪽 위 눈 창, 오른쪽 판단 기록)이 떠 있다.
 * 대시보드에는 입력이 없다: 요청·승인은 폰에서 음성으로 오고, 판단 기록은 서버 메시지로만 쌓인다.
 * 판단 기록의 「폰 화면」 탭을 고르면 폰 화면을 오른쪽 패널에 크게 띄우고 왼쪽 위 눈 창은 숨긴다.
 * 모양은 주소의 ?look=로 고른다: parts(기본, 밝은 카드)와 glass(Liquid Glass). [data-look]가 토큰 값을 바꾼다.
 * 패널은 덮개 층의 바로 아래 자식(눈 창·판단 기록은 그 아래 쌓기 상자의 자식)이라 패널 밖 빈 곳의 마우스는 3D로 간다.
 */
export function Dashboard() {
  const look = useMemo(() => lookOf(location.search), []);
  const { devices, apply } = useDevices();
  const health = useHealth();
  const { turns, onMessage: toLog } = useLog();
  const { checks, onMessage: toChecks } = useChecks();
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
    toChecks(m);
    if (m.type === "agent" && m.event === "action" && m.action.deviceId) setFocusId(m.action.deviceId);
  }, [apply, toLog, toChecks, homeId]);
  useEvents(onMessage, setConnected);
  return (
    <LookContext.Provider value={look}>
      <main data-look={look} className="relative h-full w-full overflow-hidden">
        {look === "glass" && <GlassFilter />}
        <TwinStage>
          <Overlay devices={devices} checks={checks} focusId={focusId} />
          <StatusPill connected={connected} health={health} />
          {/* 640px보다 좁으면 눈 창 아래에 판단 기록을 쌓는다(나란히 두면 판단 기록이 눈 창 접기 단추를 덮는다). 넓으면 상자 없이 각자 자리에 뜬다. */}
          <div className="contents *:pointer-events-auto max-sm:pointer-events-none! max-sm:absolute max-sm:inset-x-3 max-sm:top-16 max-sm:bottom-3 max-sm:flex max-sm:flex-col max-sm:items-end max-sm:gap-3">
            {view === "log" && <EyeWindow health={health} connected={connected} />}
            <DecisionLog turns={turns} view={view} onView={setView} phone={<EyeBody health={health} connected={connected} large />} />
          </div>
        </TwinStage>
      </main>
    </LookContext.Provider>
  );
}
