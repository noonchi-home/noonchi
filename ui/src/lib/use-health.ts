import { useEffect, useState } from "react";
import type { HealthView } from "../../../src/contract/events.ts";
import { api } from "./api";

/** GET /api/health. 처음 한 번, 그리고 epoch가 바뀔 때마다(대시보드는 서버에 다시 붙은 hello마다) 다시 묻는다.
 *  못 받으면 앞 값 그대로(처음이면 null, 배지는 -로 보인다). */
export function useHealth(epoch: unknown = 0) {
  const [health, setHealth] = useState<HealthView | null>(null);
  useEffect(() => {
    let live = true;
    api<HealthView>("/api/health")
      .then((r) => { if (live && r.ok && r.json?.ok) setHealth(r.json); })
      .catch(() => {});
    return () => { live = false; };
  }, [epoch]);
  return health;
}
