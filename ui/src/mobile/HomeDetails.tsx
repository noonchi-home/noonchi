import { ChevronRight } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "../components/ui/item";
import { house, readStartPosition } from "./house";
import "./home-details.css";

const disconnected = { connected: false, start: "확인 못함" };

export function HomeDetails() {
  const title = useId();
  const value = `${title}-value`;
  const [status, setStatus] = useState(() => navigator.onLine ? { connected: true, start: "확인 중" } : disconnected);

  useEffect(() => {
    let revision = 0;
    function offline() {
      revision++;
      setStatus(disconnected);
    }
    async function refresh() {
      if (!navigator.onLine) return offline();
      const current = ++revision;
      try {
        const saved = await readStartPosition();
        if (current === revision) setStatus({ connected: true, start: saved === null ? "확인 못함" : saved ? "설정됨" : "미설정" });
      } catch {
        if (current === revision) offline();
      }
    }
    function visible() {
      if (document.visibilityState === "visible") void refresh();
    }
    function restored(event: PageTransitionEvent) {
      if (event.persisted) void refresh();
    }
    void refresh();
    window.addEventListener("offline", offline);
    window.addEventListener("online", refresh);
    window.addEventListener("pageshow", restored);
    document.addEventListener("visibilitychange", visible);
    return () => {
      revision++;
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", refresh);
      window.removeEventListener("pageshow", restored);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);

  const positionHref = `/mobile/settings/?positionHome=${encodeURIComponent(house.id)}#position`;
  return (
    <ItemGroup className="phone-home-details" aria-label="집 상태">
      <Item role="listitem" size="sm" className="phone-home-details__row">
        <ItemContent><ItemTitle>대시보드 연결</ItemTitle></ItemContent>
        <ItemActions role="status">
          {status.connected && <span className="phone-home-details__connected" aria-hidden="true" />}
          <ItemDescription>{status.connected ? "연결됨" : "연결 끊김"}</ItemDescription>
        </ItemActions>
      </Item>
      <div role="listitem">
        <Item asChild size="sm" className="phone-home-details__row">
          <a href={positionHref} aria-labelledby={title} aria-describedby={value}>
            <ItemContent><ItemTitle id={title}>시작 위치 설정</ItemTitle></ItemContent>
            <ItemActions>
              <ItemDescription id={value} aria-live="polite">{status.start}</ItemDescription>
              <ChevronRight size={16} aria-hidden="true" />
            </ItemActions>
          </a>
        </Item>
      </div>
    </ItemGroup>
  );
}
