// 매핑이 만든 Matter 동작(MatterOp)을 엔드포인트에서 실행하고, 엔드포인트 상태를 읽고, 변화를 지켜본다.
// 같은 코드가 브리지 쪽 서버 엔드포인트(local 전송)와 컨트롤러 쪽 클라이언트 엔드포인트(network 전송)에 모두 쓰인다:
//   - 서버 엔드포인트: 명령 = 같은 프로세스의 behavior 메서드 호출, 속성 쓰기 = 로컬 상태 변경
//   - 클라이언트 엔드포인트: 명령 = Matter Invoke, 속성 쓰기 = Matter Write, get() = Matter Read

import type { Endpoint } from "@matter/main";
import type { MatterClusters, MatterOp } from "../mapping.js";

/** 매핑 요약에 쓰는 클러스터 → 속성. 이 속성이 바뀌면 상태를 다시 계산한다. */
export const WATCHED_ATTRIBUTES: Record<string, string[]> = {
  onOff: ["onOff"],
  levelControl: ["currentLevel"],
  thermostat: ["systemMode", "occupiedCoolingSetpoint", "occupiedHeatingSetpoint"],
  fanControl: ["fanMode"],
  operationalState: ["operationalState"],
  rvcRunMode: ["currentMode"],
  rvcOperationalState: ["operationalState"],
  windowCovering: ["currentPositionLiftPercent100ths"],
  doorLock: ["lockState"],
  valveConfigurationAndControl: ["currentState"],
  booleanState: ["stateValue"],
};

export class MatterOpError extends Error {
  override name = "MatterOpError";
}

function clustersOf(endpoint: Endpoint): string[] {
  return Object.keys(endpoint.behaviors.supported);
}

/** 명령 응답의 오류(동작 상태 계열 errorStateId, 모드 계열 status). */
function responseError(op: MatterOp, response: unknown): string | undefined {
  if (!response || typeof response !== "object") return undefined;
  const r = response as { commandResponseState?: { errorStateId?: number }; status?: number; statusText?: string };
  const errorStateId = r.commandResponseState?.errorStateId;
  if (typeof errorStateId === "number" && errorStateId !== 0) return `${opName(op)} 실패(errorStateId ${errorStateId})`;
  if ((op.cluster.endsWith("Mode") || op.cluster.endsWith("mode")) && typeof r.status === "number" && r.status !== 0) {
    return `${opName(op)} 실패(status ${r.status}${r.statusText ? `: ${r.statusText}` : ""})`;
  }
  return undefined;
}

function opName(op: MatterOp): string {
  return "command" in op ? `${op.cluster}.${op.command}` : `${op.cluster}.${op.attribute}`;
}

/** Matter 동작을 차례로 실행한다. 실패하면 MatterOpError. */
export async function runOps(endpoint: Endpoint, ops: MatterOp[]): Promise<void> {
  const supported = clustersOf(endpoint);
  for (const op of ops) {
    if (!supported.includes(op.cluster)) throw new MatterOpError(`엔드포인트에 ${op.cluster} 클러스터가 없습니다`);
    try {
      if ("command" in op) {
        const command = endpoint.commandsOf(op.cluster)[op.command];
        if (typeof command !== "function") throw new MatterOpError(`${opName(op)} 명령이 없습니다`);
        const response = await command(op.args as never);
        const error = responseError(op, response);
        if (error) throw new MatterOpError(error);
      } else {
        await endpoint.setStateOf(op.cluster, { [op.attribute]: op.value });
      }
    } catch (e) {
      if (e instanceof MatterOpError) throw e;
      throw new MatterOpError(`${opName(op)}: ${(e as Error).message}`, { cause: e });
    }
  }
}

/** 엔드포인트의 현재 상태(클러스터 → 속성). 클라이언트 엔드포인트면 마지막으로 받은 값(캐시)이다. */
export function clusterState(endpoint: Endpoint): MatterClusters {
  return endpoint.state as unknown as MatterClusters;
}

/** 지켜보는 속성 중 이 엔드포인트에 있는 것만 고른 읽기 선택자(기능에 따라 없는 속성은 읽으면 오류). */
export function watchedSelector(endpoint: Endpoint): Record<string, string[]> {
  const selector: Record<string, string[]> = {};
  const state = clusterState(endpoint);
  for (const cluster of clustersOf(endpoint)) {
    const attrs = (WATCHED_ATTRIBUTES[cluster] ?? []).filter((a) => state[cluster]?.[a] !== undefined);
    if (attrs.length > 0) selector[cluster] = attrs;
  }
  return selector;
}

/** 클라이언트 엔드포인트: 지켜보는 속성을 Matter Read로 새로 읽어 캐시를 갱신한다. */
export async function refreshRemote(endpoint: Endpoint): Promise<void> {
  const selector = watchedSelector(endpoint);
  if (Object.keys(selector).length === 0) return;
  await endpoint.get(selector as never);
}

interface ObservableLike {
  on(listener: (...args: unknown[]) => void): unknown;
  off(listener: (...args: unknown[]) => void): unknown;
}

/** 지켜보는 속성이 바뀌면 onChange를 부른다. 돌려준 함수로 그만 듣는다. */
export function watchEndpoint(endpoint: Endpoint, onChange: () => void): () => void {
  const subscriptions: [ObservableLike, () => void][] = [];
  const events = endpoint.events as unknown as Record<string, Record<string, ObservableLike | undefined> | undefined>;
  for (const cluster of clustersOf(endpoint)) {
    for (const attr of WATCHED_ATTRIBUTES[cluster] ?? []) {
      const observable = events[cluster]?.[`${attr}$Changed`];
      if (!observable) continue;
      const listener = () => onChange();
      observable.on(listener);
      subscriptions.push([observable, listener]);
    }
  }
  return () => {
    for (const [observable, listener] of subscriptions) observable.off(listener);
    subscriptions.length = 0;
  };
}
