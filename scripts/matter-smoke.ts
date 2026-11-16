// Matter 연기 시험: twin-studio 기기로 브리지를 띄우고, 컨트롤러가 네트워크로 커미셔닝(또는 저장된 커미셔닝 재사용)한 뒤
// 거실 TV·거실 천장등을 토글하고 상태를 출력한다.
//   npx tsx scripts/matter-smoke.ts            (기본: network, 저장 폴더 .matter/, 포트 5540·5541)
//   MATTER_TRANSPORT=local npx tsx scripts/matter-smoke.ts
//   MATTER_STORAGE_DIR=... MATTER_PORT=... 로 바꿀 수 있다.

import "dotenv/config";
import type { DeviceState } from "../src/contract/devices.js";
import { MatterHub } from "../src/devices/matter/matterHub.js";
import { loadTwin } from "../src/devices/devices.js";

const TARGETS = ["tv_living", "light_living"];

function show(s: DeviceState | undefined): string {
  if (!s) return "(없음)";
  return `twin=${JSON.stringify(s.twin)} matter=${JSON.stringify(s.matter)}`;
}

async function main(): Promise<number> {
  const twin = loadTwin();
  const transport = process.env.MATTER_TRANSPORT === "local" ? "local" : "network";
  console.log(`[smoke] twin-studio: ${twin.dir} (${twin.source}), 기기 ${twin.devices.length}개, 전송 ${transport}`);

  const hub = MatterHub.fromTwin(twin, { transport });
  const t0 = Date.now();
  await hub.start();
  const info = hub.info;
  console.log(`[smoke] 시작 ${Date.now() - t0}ms, 커미셔닝: ${info.commissioning}, 저장 폴더: ${info.storageDir}`);

  try {
    console.log("\n[smoke] 기기 목록");
    for (const d of hub.list()) {
      const s = hub.get(d.id);
      console.log(`  ${d.id.padEnd(18)} ${d.kind.padEnd(10)} ${d.matterDeviceType.padEnd(26)} ${d.label} ${JSON.stringify(s?.twin)}`);
    }

    const events: DeviceState[] = [];
    hub.subscribe((s) => {
      if (TARGETS.includes(s.id)) events.push(s);
    });

    console.log("\n[smoke] 토글");
    let failed = 0;
    for (const id of TARGETS) {
      const before = hub.get(id);
      const on = before?.twin.power === "on";
      const t = Date.now();
      const r = await hub.command(id, { type: on ? "off" : "on" });
      const matterOnOff = (hub.bridgeEndpoint(id)?.state as { onOff?: { onOff?: boolean } } | undefined)?.onOff?.onOff;
      console.log(`  ${id}: ${on ? "on → off" : "off → on"} ${r.ok ? "성공" : `실패: ${r.error}`} (${Date.now() - t}ms)`);
      console.log(`    허브 상태:   ${show(r.state)}`);
      console.log(`    브리지 속성: OnOff.onOff = ${String(matterOnOff)}`);
      if (!r.ok || r.state?.matter.onOff !== !on || matterOnOff !== !on) failed++;
    }
    await new Promise((r) => setTimeout(r, Number(process.env.SMOKE_WAIT_MS ?? 300)));
    console.log(`\n[smoke] 구독 이벤트 ${events.length}개: ${events.map((e) => `${e.id}=${String(e.twin.power)}`).join(", ")}`);
    console.log(failed === 0 ? "[smoke] 통과" : `[smoke] 실패 ${failed}건`);
    return failed === 0 ? 0 : 1;
  } finally {
    const t = Date.now();
    await hub.stop();
    console.log(`[smoke] 종료 ${Date.now() - t}ms`);
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(`[smoke] 오류: ${(e as Error).message}`);
    process.exit(1);
  });
