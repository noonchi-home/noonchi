// 대시보드 설정 창에 보이는 허브 상태: /api/health 모양에서 화면에 쓰는 것만 고른다.
import type { HealthView } from "../../../src/contract/events.ts";
import { useEffect, useState } from "react";
import { api } from "./api";
import { mobileHubUrl } from "./mobile-hub-url";

export { mobileHubUrl } from "./mobile-hub-url";

export interface HubState {
  /** 허브 화면이 서버와 실시간으로 이어져 있는가. */
  connected: boolean;
  /** 운영 모드: test 시험(트윈만), live 실제 제어. 바꾸는 일은 설정 화면에서 한다. */
  mode: "test" | "live";
  /** 허브 종류와 연결 방식. */
  hub: string;
  /** 에이전트 공급자와 모델. */
  agent: string;
  /** 지금 집 이름. */
  home: string;
  /** 허브에서 제공하는 폰 홈 주소. */
  phoneUrl: string;
}

/** Use the current HTTPS hub or discover the HTTPS address from setup. */
export function useMobileUrl(epoch: unknown): string {
  const origin = window.location.origin;
  const [mobileUrls, setMobileUrls] = useState<string[]>([]);
  useEffect(() => {
    if (mobileHubUrl(origin)) return;
    let active = true;
    void api<{ mobile_urls?: string[] }>("/api/setup").then(r => {
      const urls = r.json?.mobile_urls;
      if (active && r.ok) setMobileUrls(Array.isArray(urls) ? urls : []);
    }).catch(() => {});
    return () => { active = false; };
  }, [origin, epoch]);
  return mobileHubUrl(origin, mobileUrls);
}

/** 화면에 보일 집 이름: 괄호 덧붙임(「(도면 기준 · 방 4·욕실 3)」)을 뺀 앞 이름. 이름은 twin/homes.json(twin-studio 복사본)에서 온다. */
export const shortName = (name: string) => name.replace(/\s*[(（].*$/, "").trim() || name;

/** health(아직 없으면 null)와 실시간 연결(모르면 null) → 설정 창 허브 상태. */
export function hubOf(h: HealthView | null, connected: boolean | null, phoneUrl = ""): HubState {
  const join = (...v: (string | null | undefined)[]) => v.filter(Boolean).join(" · ");
  return {
    connected: connected === true, mode: h?.mode === "live" ? "live" : "test", hub: h ? join(h.hub, h.transport) : "",
    agent: h ? join(h.provider, h.model) : "", home: shortName(h?.home?.name ?? ""), phoneUrl,
  };
}
