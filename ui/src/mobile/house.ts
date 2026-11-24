import { api } from "../lib/api";
import type { HealthView } from "../../../src/contract/events";
import type { SetupView } from "../../../src/contract/setup";
import { MOKRYEON_FLOOR_PLAN_PATH } from "../../../src/shared/home-floor-plan";

export const house = {
  id: "mokryeon_180b",
  name: "한양목련 180B",
  address: "군포시 산본로432번길 25",
  kbPage: "https://kbland.kr/se/c/4809",
  kbPlan: MOKRYEON_FLOOR_PLAN_PATH,
};

const compact = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[\s(),·]/g, "");
const names = ["한양목련 180B", "한양목련", "목련한양", "목련2단지", "산본 한양목련"].map(compact);
const addresses = [
  house.address, "경기도 " + house.address, "경기 " + house.address, "산본로432번길 25",
].map(compact);

export function isHouseAddress(address: string): boolean {
  return addresses.includes(compact(address));
}

export function matchesHouse(query: string): boolean {
  const value = compact(query);
  if (value.length < 2) return false;
  if (names.some((name) => name.startsWith(value))) return true;
  if (/번길\d/.test(value)) return isHouseAddress(value);
  return /산본로\d|산본로$/.test(value) && addresses.some((address) => address.startsWith(value));
}

export async function setupHome(approve = false): Promise<SetupView> {
  const result = approve
    ? await api<SetupView>("/api/setup/home", { home: house.id })
    : await api<SetupView>("/api/setup");
  if (!result.ok || !result.json?.ok) throw new Error("설정을 읽지 못했습니다.");
  return result.json;
}

function requireRegisteredHome(setup: SetupView) {
  if (setup.switching || setup.home?.id !== house.id) throw new Error("허브에 열린 집이 바뀌었어요.");
}

export async function readStartPosition(): Promise<boolean | null> {
  // 시작 위치 응답에 집 ID가 없으므로 앞뒤에서 같은 집을 확인한다.
  requireRegisteredHome(await setupHome());
  const pose = await api<{ ok: true; start: unknown }>("/api/phone/start-pose").catch(() => null);
  requireRegisteredHome(await setupHome());
  if (!pose?.ok || pose.json?.ok !== true) return null;
  const start = pose.json.start;
  if (start === null) return false;
  if (typeof start === "object" && "position" in start && Array.isArray(start.position)
      && start.position.length === 2 && start.position.every(Number.isFinite)) return true;
  return null;
}

export async function activeTwin(): Promise<{ phoneUrls: string[]; portalCamera: boolean }> {
  const result = await api<{ ok: true; scene: { plan?: { rooms?: unknown[] } } }>("/api/scene");
  if (!result.ok || !result.json?.ok || !result.json.scene?.plan?.rooms?.length)
    throw new Error("장면을 읽지 못했습니다.");
  const health = await api<HealthView>("/api/health");
  if (!health.ok || !health.json?.ok || health.json.home?.id !== house.id)
    throw new Error("다른 집이 열려 있습니다.");
  return {
    phoneUrls: health.json.phone_urls.filter((url) => /^https?:\/\//i.test(url)),
    portalCamera: health.json.portal_camera === true,
  };
}
