import { useEffect, useState } from "react";
import type { HealthView } from "../../../src/contract/events.ts";
import { api } from "./api";

/** GET /api/health 한 번. 못 받으면 null 그대로(배지는 -로 보인다). */
export function useHealth() {
  const [health, setHealth] = useState<HealthView | null>(null);
  useEffect(() => {
    let live = true;
    api<HealthView>("/api/health")
      .then((r) => { if (live && r.ok && r.json?.ok) setHealth(r.json); })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  return health;
}
