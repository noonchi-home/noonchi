// 집 실행 묶음의 가전 잇기(src/devices): twin 데이터 → 허브(신호 출처로 감쌈) → 가전 변화 기록, ThinQ 연결 바꾸기.
import { SignalHub, type RelayLink, type ThinqLink } from "../../devices/index.js";
import { loadTwin } from "../../layout/index.js";
import { startHub } from "../hubFactory.js";
import type { HomeCore } from "./core.js";

/** twin 데이터를 읽고 허브를 띄워 신호 출처로 감싼 뒤 가전 변화를 기록에 잇는다. homeId가 없으면 기본 집. 실패하면 그대로 던진다(아직 닫을 것이 없다). */
export async function startDevices(core: HomeCore, homeId: string | undefined): Promise<void> {
  const { ctx } = core;
  const { env, log } = ctx;
  const twin = loadTwin(env.TWIN_STUDIO_DIR, { home: homeId });
  log(`twin 데이터: 집 ${twin.home.id}(${twin.home.name}) · ${twin.source} (${twin.dir}) · 기기 ${twin.devices.length}개 · 방 ${twin.rooms.length}개`);
  for (const w of twin.warnings) log(`[경고] ${w}`);

  const started = await startHub(twin, { env, log, importer: ctx.importer, matter: { log, ...ctx.matter },
    memoryNow: ctx.clock ? () => new Date(core.nowMs()) : undefined });
  const signals = new SignalHub(started.hub, ctx.sources(twin.home.id, twin.devices.map((d) => d.id)));
  const none = Object.keys(signals.sources()).length;
  if (none > 0) log(`신호 출처: 신호 없음 ${none}개(상태를 모름으로 보임)`);
  // 가전 변화 기록: 시작 상태는 기억만 하고, 그 뒤 바뀐 값을 적는다
  const specOf = new Map(twin.devices.map((d) => [d.id, d]));
  const { history } = ctx;
  for (const s of signals.states()) history.device(s, { initial: true, label: specOf.get(s.id)?.label, kind: specOf.get(s.id)?.kind });
  const unsubHistory = signals.subscribe((s) => {
    const spec = specOf.get(s.id);
    history.device(s, { label: spec?.label, kind: spec?.kind });
    core.trace?.device(s, spec?.kind);
  });
  // 리모컨 사건(허브가 쏜 단추·사람이 누른 등록 단추)도 가전 변화처럼 관찰을 켜지 않아도 트레이스에 남긴다
  signals.onRemote = (e) => core.trace?.remote(e, specOf.get(e.device)?.kind);
  core.twin = twin;
  core.started = started;
  core.signals = signals;
  core.specOf = specOf;
  core.unsubHistory = unsubHistory;
}

/** ThinQ 연결을 바꾼다(실제 모드). 이전 연결은 멈추고, 새 연결은 붙인 뒤 읽기를 시작한다. null이거나 닫힌 집이면 뗀다. */
export function setLink(core: HomeCore, next: ThinqLink | null): void {
  core.link?.stop();
  core.link = core.closed ? null : next;
  core.signals.setLink(core.link);
  core.link?.start().catch((e) => core.ctx.log(`[경고] ThinQ 읽기를 시작하지 못했어요: ${(e as Error).message}`));
}

/** TV 중계 연결을 바꾼다(실제 모드). 이전 연결은 멈추고, 새 연결은 붙인 뒤 읽기를 시작한다. null이거나 닫힌 집이면 뗀다.
 *  주소·토큰·짝·읽기 간격이 같은 연결이면 그대로 둔다(설정을 다시 저장할 때마다 새로 읽지 않게). */
export function setRelay(core: HomeCore, next: RelayLink | null): void {
  if (next && core.relay && !core.closed && core.relay.sameAs(next)) return;
  core.relay?.stop();
  core.relay = core.closed ? null : next;
  core.signals.setRelay(core.relay);
  core.relay?.start().catch((e) => core.ctx.log(`[경고] TV 중계 읽기를 시작하지 못했어요: ${(e as Error).message}`));
}
