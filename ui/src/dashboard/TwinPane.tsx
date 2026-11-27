import { MapPin, WifiOff } from "lucide-react";
import type { ReactNode } from "react";
import { Status } from "../components/ui/status";
import { WORDS } from "./words";

/** 연결을 읽는 동안에도 같은 지도를 유지해 돌아왔을 때 모델을 다시 받지 않는다.
 *  트윈 칸에는 날짜·시간 칩을 두지 않는다(2026-11-27 사용자 결정): 날짜와 하루 마치기 상태는 설정 창 날짜 줄에서만 보인다. */
export function TwinPane({ robotKnown, connected, map, chipsRight, tiled = false }: {
  robotKnown: boolean;
  /** 서버와 실시간 연결: 끊김 false, 모름 null. */
  connected: boolean | null;
  map: ReactNode;
  /** 칩을 트윈 오른쪽 끝에서 띄우는 만큼(px): 미니맵 왼쪽. */
  chipsRight: number;
  tiled?: boolean;
}) {
  const offline = connected === false;
  return (
    <section aria-label="트윈" data-twin className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <div data-map className="absolute inset-0 overflow-hidden">{map}</div>
      <div data-chips className={tiled ? "pointer-events-none absolute bottom-2 flex flex-wrap justify-end gap-1" : "pointer-events-none absolute top-4 flex flex-col items-end gap-2"} style={{ right: chipsRight }}>
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
