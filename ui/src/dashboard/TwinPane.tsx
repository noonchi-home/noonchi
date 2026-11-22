import { Clock, MapPin, WifiOff } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Status } from "../components/ui/status";
import { clockText, untilNextMinute } from "./clock";
import { WORDS } from "./words";

/** 브라우저 시간대(분, 동쪽이 +). */
const browserTz = (ms: number) => -new Date(ms).getTimezoneOffset();

/**
 * 날짜·시간 칩(Status): 「11월 17일 (화) 01:30」. 시각은 브라우저 시계, 시간대는 서버 기록 시간대(tzMinutes, 모르면 브라우저 시간대)다(clock.ts).
 * 분이 바뀔 때만 이 칩만 다시 그린다(트윈 칸·지도는 다시 그리지 않는다).
 */
function ClockChip({ tzMinutes }: { tzMinutes: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setTimeout(() => setNow(Date.now()), untilNextMinute(now));
    return () => window.clearTimeout(id);
  }, [now]);
  return (
    <Status data-clock>
      <Clock className="size-3.5" aria-hidden="true" />
      {clockText(now, tzMinutes ?? browserTz(now))}
    </Status>
  );
}

/** 연결을 읽는 동안에도 같은 지도를 유지해 돌아왔을 때 모델을 다시 받지 않는다. */
export function TwinPane({ robotKnown, connected, map, chipsRight, tzMinutes = null, tiled = false }: {
  robotKnown: boolean;
  /** 서버와 실시간 연결: 끊김 false, 모름 null. */
  connected: boolean | null;
  map: ReactNode;
  /** 칩을 트윈 오른쪽 끝에서 띄우는 만큼(px): 미니맵 왼쪽. */
  chipsRight: number;
  /** 서버 기록 시간대(분). 모르면 null(브라우저 시간대). */
  tzMinutes?: number | null;
  tiled?: boolean;
}) {
  const offline = connected === false;
  return (
    <section aria-label="트윈" data-twin className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <div data-map className="absolute inset-0 overflow-hidden">{map}</div>
      <div data-chips className={tiled ? "pointer-events-none absolute bottom-2 flex flex-wrap justify-end gap-1" : "pointer-events-none absolute top-4 flex flex-col items-end gap-2"} style={{ right: chipsRight }}>
            <ClockChip tzMinutes={tzMinutes} />
        {!robotKnown && (
            <Status>
              <MapPin className="size-3.5" aria-hidden="true" />
              {WORDS.noRobot}
            </Status>
          )}
        {offline && (
          <Status variant="error" role="status" aria-live="polite">
            <WifiOff className="size-3.5" aria-hidden="true" />
            {WORDS.offline}
          </Status>
        )}
      </div>
    </section>
  );
}
