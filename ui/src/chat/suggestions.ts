import type { DeviceView } from "../../../src/contract/events.ts";

/** 추천 요청: 고른 집의 기기 이름으로 만든다(web/app.js suggestions). */
export function suggestions(devices: Pick<DeviceView, "kind" | "label">[]): string[] {
  const pick = (kind: string) => devices.find((d) => d.kind === kind);
  const out: string[] = [];
  const light = pick("light");
  if (light) out.push(`${light.label} 켜줘`);
  const tv = pick("tv");
  if (tv) out.push(`${tv.label} 켜줘`);
  const ac = pick("aircon");
  if (ac) out.push(`${ac.label} 24도로 맞춰줘`);
  const lock = pick("lock");
  if (lock) out.push(`${lock.label} 상태 알려줘`);
  const vacuum = pick("vacuum");
  if (vacuum && out.length < 4) out.push(`${vacuum.label} 시작해줘`);
  return out.slice(0, 4);
}
