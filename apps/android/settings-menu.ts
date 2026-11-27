import type { SetupView } from "../../src/contract/setup";

export type SettingsPage = "house" | "appliances" | "devices" | "mode" | "position" | "stations" | "layout";
export type ApplianceSection = "thinq" | "ir" | "matter";

export const pageLabels: Record<SettingsPage, string> = {
  house: "집 고르기", appliances: "가전 연결", devices: "읽을 가전 선택", mode: "모드",
  position: "시작 위치", stations: "자리·구역", layout: "배치 보정",
};

/**
 * 시연에서 보이는 설정. 숨긴 쪽·칸은 목록에 다시 넣으면 보인다(그리는 코드는 ConnectedSettings.tsx에 있다).
 * 숨김: 배치 보정(layout), LG ThinQ(thinq), Matter 글(matter), 서버 주소 글(serverOrigin).
 */
export const demoSettings: { pages: readonly SettingsPage[]; appliances: readonly ApplianceSection[]; serverOrigin: boolean } = {
  pages: ["house", "appliances", "mode", "position", "stations"],
  appliances: ["ir"],
  serverOrigin: false,
};

/** 설정 목록 줄. 집 고르기는 집을 고르기 전에만, 읽을 가전 선택은 가전 연결 안에서만 연다. */
export function listedPages(hasHome: boolean, shown: readonly SettingsPage[] = demoSettings.pages): SettingsPage[] {
  return shown.filter(page => page !== "devices" && (page !== "house" || !hasHome));
}

/** 돌아가기: 읽을 가전 선택 → 가전 연결, 나머지 → 설정 목록(undefined). */
export function previousPage(page: SettingsPage): SettingsPage | undefined {
  return page === "devices" ? "appliances" : undefined;
}

const remoteLabels: Partial<Record<ApplianceSection, string>> = { ir: "리모컨(IR)", matter: "Matter" };

export function remoteTitle(shown: readonly ApplianceSection[] = demoSettings.appliances): string {
  return shown.flatMap(section => remoteLabels[section] ?? []).join(" · ");
}

export function applianceSummary(setup: Pick<SetupView, "pairs" | "ir">, shown: readonly ApplianceSection[] = demoSettings.appliances): string {
  const paired = Object.keys(setup.pairs).length;
  if (shown.includes("thinq") && paired) return `${paired}개 연결`;
  if (shown.includes("ir") && setup.ir?.ready) return "리모컨 TV";
  return "미연결";
}
