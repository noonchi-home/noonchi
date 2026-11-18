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

/**
 * 트윈 칸(화면 전체, 여백 안): 칸을 꽉 채운 지도 자리(map)와 그 위 위쪽 미니맵 왼쪽 칩 줄(오른쪽 끝에서 chipsRight만큼 띄운다):
 * 맨 위 날짜·시간 칩(늘), 그 아래 클로이드 위치를 모를 때·연결이 끊겼을 때만 그 칩. 할 일 진행도 알약은 없다(계획은 트윈 위 번호 길, MapOverlay).
 * 비전 미니맵·메시지 상자·마스코트도 지도 위에 얹힌다. 칸은 늘 같은 자리·크기다.
 */
export function TwinPane({ robotKnown, connected, map, chipsRight, tzMinutes = null }: {
  robotKnown: boolean;
  /** 서버와 실시간 연결: 끊김 false, 모름 null. */
  connected: boolean | null;
  map: ReactNode;
  /** 칩을 트윈 오른쪽 끝에서 띄우는 만큼(px): 미니맵 왼쪽. */
  chipsRight: number;
  /** 서버 기록 시간대(분). 모르면 null(브라우저 시간대). */
  tzMinutes?: number | null;
}) {
  const offline = connected === false;
  return (
    <section aria-label="트윈" data-twin className="relative h-full min-h-0 min-w-0 flex-1">
      <div data-map className="absolute inset-0 overflow-hidden">{map}</div>
      <div data-chips className="pointer-events-none absolute top-4 flex flex-col items-end gap-2" style={{ right: chipsRight }}>
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
