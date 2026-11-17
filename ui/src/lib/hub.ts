// 대시보드 설정 창에 보이는 허브 상태: /api/health 모양에서 화면에 쓰는 것만 고른다.
import type { HealthView } from "../../../src/contract/events.ts";
import type { AssistMode } from "../../../src/contract/setup.ts";
import { pickPhoneUrl } from "./phone-url";

export interface HubState {
  /** 허브 화면이 서버와 실시간으로 이어져 있는가. */
  connected: boolean;
  /** 운영 모드: test 시험(트윈만), live 실제 제어. 바꾸는 일은 설정 화면에서 한다. */
  mode: "test" | "live";
  /** 돕는 방식(대시보드 메시지 상자 머리). health 전이면 눈치 모드. */
  assist: AssistMode;
  /** 허브 종류와 연결 방식. */
  hub: string;
  /** 에이전트 공급자와 모델. */
  agent: string;
  /** 지금 집 이름. */
  home: string;
  /** 폰에서 열 주소(폰 연결 QR). 없으면 빈 글. */
  phoneUrl: string;
  /** 집을 다시 설정하는 화면 주소. */
  setupHref: string;
}

/** 화면에 보일 집 이름: 괄호 덧붙임(「(도면 기준 · 방 4·욕실 3)」)을 뺀 앞 이름. 이름은 twin/homes.json(twin-studio 복사본)에서 온다. */
export const shortName = (name: string) => name.replace(/\s*[(（].*$/, "").trim() || name;

/** health(아직 없으면 null)와 실시간 연결(모르면 null) → 설정 창 허브 상태. */
export function hubOf(h: HealthView | null, connected: boolean | null): HubState {
  const join = (...v: (string | null | undefined)[]) => v.filter(Boolean).join(" · ");
  return {
    connected: connected === true, mode: h?.mode === "live" ? "live" : "test", assist: h?.assist ?? "noonchi", hub: h ? join(h.hub, h.transport) : "",
    agent: h ? join(h.provider, h.model) : "", home: shortName(h?.home?.name ?? ""), phoneUrl: pickPhoneUrl(h?.phone_urls ?? []).best ?? "", setupHref: "/setup/",
  };
}
