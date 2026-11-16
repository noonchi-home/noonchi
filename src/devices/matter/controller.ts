// matter.js 컨트롤러: 브리지를 커미셔닝하고(페어링 코드), 이후 같은 패브릭으로 다시 연결한다.
// 커미셔닝 정보는 컨트롤러 저장 폴더에 남아 재시작 때 다시 쓴다.

import { ControllerBehavior, Millis, NetworkClient, Seconds, ServerNode, type ClientNode, type Endpoint } from "@matter/main";
import { nodeEnvironment } from "./environment.js";

export const CONTROLLER_DEFAULTS = {
  id: "twin-home-controller",
  fabricLabel: "twin-home",
} as const;

export type DiscoveryMode = "address" | "mdns";

export interface ControllerOptions {
  /** 저장 폴더. 컨트롤러 노드 저장소는 <storageDir>/<id>에 생긴다. */
  storageDir: string;
  /** 컨트롤러가 듣는 UDP 포트. 브리지가 저장한 구독을 재시작 후에도 되살릴 수 있게 고정 포트를 권장한다. */
  port: number;
  id?: string;
  fabricLabel?: string;
}

/**
 * 연결 시도 간격. matter.js 기본값(다음 주소까지 45초)은 주소 하나가 막히면 오래 기다린다.
 * Windows + Tailscale 같은 가상 어댑터에서는 영역(zone) 없는 링크 로컬 IPv6 주소(fe80::…%)가 광고되어 실패하므로
 * 다음 주소로 빨리 넘어가게 한다.
 */
const FAST_TIMING = { delayBeforeNextAddress: Seconds(1), delayAfterNetworkError: Seconds(2) };

export async function createController(opts: ControllerOptions): Promise<ServerNode> {
  const id = opts.id ?? CONTROLLER_DEFAULTS.id;
  return await ServerNode.create(ServerNode.RootEndpoint.with(ControllerBehavior), {
    id,
    environment: nodeEnvironment(id, opts.storageDir),
    network: { port: opts.port, timing: FAST_TIMING },
    controller: { adminFabricLabel: opts.fabricLabel ?? CONTROLLER_DEFAULTS.fabricLabel, ble: false },
    basicInformation: {
      vendorName: "twin-home",
      productName: "twin-home Controller",
      productLabel: "Virtual Home Controller",
      nodeLabel: "twin-home controller",
      hardwareVersion: 1,
      softwareVersion: 1,
    },
  });
}

/** 커미셔닝이 끝난 피어(브리지). 하나만 쓴다. */
export function commissionedPeer(controller: ServerNode): ClientNode | undefined {
  return [...controller.peers].find((p) => p.lifecycle.isCommissioned);
}

export interface CommissionOptions {
  pairingCode: string;
  /** "address": 알려진 주소로 바로(같은 PC의 브리지), "mdns": mDNS로 커미셔닝 가능 기기를 찾는다. */
  discovery: DiscoveryMode;
  /** discovery "address"일 때 브리지 주소. */
  address?: { ip: string; port: number };
  /** 브리지의 long discriminator(페어링 코드에는 짧은 값만 있다). */
  discriminator?: number;
  timeoutMs: number;
}

export class TimeoutError extends Error {
  override name = "TimeoutError";
}

export async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  // 시간 초과로 진 쪽이 나중에 실패해도 처리되지 않은 거부로 남지 않게 한다
  promise.catch(() => {});
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(message)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** 브리지를 커미셔닝한다(PASE → 인증서 발급 → CASE). */
export async function commissionBridge(controller: ServerNode, opts: CommissionOptions): Promise<ClientNode> {
  const timing = { caseConnectionTiming: { delayBeforeNextAddress: Seconds(1) } };
  if (opts.discovery === "mdns") {
    return await withTimeout(
      controller.peers.commission({ id: "bridge", pairingCode: opts.pairingCode, timeout: Millis(opts.timeoutMs), ...timing }),
      opts.timeoutMs,
      `커미셔닝 시간 초과(${opts.timeoutMs}ms, mDNS 검색)`,
    );
  }
  if (!opts.address) throw new Error("discovery 'address'에는 브리지 주소가 필요합니다");
  const peer = await controller.peers.forDescriptor({
    addresses: [{ type: "udp", ip: opts.address.ip, port: opts.address.port }],
    ...(opts.discriminator !== undefined ? { discriminator: opts.discriminator } : {}),
  });
  await withTimeout(
    peer.commission({ pairingCode: opts.pairingCode, ...timing }),
    opts.timeoutMs,
    `커미셔닝 시간 초과(${opts.timeoutMs}ms, ${opts.address.ip}:${opts.address.port})`,
  );
  return peer;
}

/** 재시작 때 먼저 시도할 주소(마지막으로 알려진 주소 대신 같은 PC의 브리지 주소). 컨트롤러 시작 전에 부른다. */
export async function setPeerAddress(peer: ClientNode, address: { ip: string; port: number }): Promise<void> {
  await peer.act((agent) => {
    agent.commissioning.state.addresses = [{ type: "udp", ip: address.ip, port: address.port }];
  });
}

/**
 * 컨트롤러의 자동 구독(전체 속성)이 설 때까지 기다린다. 서면 true, 시간이 지나면 false.
 * 구독이 서기 전에 노드를 닫으면 브리지가 보내던 첫 보고가 재전송 한도까지 남아 종료가 10초 넘게 걸린다.
 */
export async function waitForSubscription(peer: ClientNode, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  for (;;) {
    const active = await peer.act((agent) => agent.get(NetworkClient).subscriptionActive);
    if (active) return true;
    if (Date.now() - start > timeoutMs) return false;
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** 피어에서 브리지 기기 엔드포인트를 BridgedDeviceBasicInformation.uniqueId(= 기기 id)로 찾는다. */
export function bridgedEndpoints(peer: ClientNode): Map<string, Endpoint> {
  const found = new Map<string, Endpoint>();
  for (const endpoint of peer.endpoints) {
    const info = (endpoint.state as unknown as Record<string, Record<string, unknown> | undefined>).bridgedDeviceBasicInformation;
    const uniqueId = info?.uniqueId;
    if (typeof uniqueId === "string") found.set(uniqueId, endpoint);
  }
  return found;
}

/** 기다렸다가 모든 기기 엔드포인트를 찾는다(커미셔닝 직후 구조가 늦게 올 수 있다). 브리지가 32바이트로 자른 id도 맞춘다. */
export async function waitForBridgedEndpoints(peer: ClientNode, ids: string[], timeoutMs: number): Promise<Map<string, Endpoint>> {
  const start = Date.now();
  for (;;) {
    const found = bridgedEndpoints(peer);
    const result = new Map<string, Endpoint>();
    for (const id of ids) {
      const ep = found.get(id) ?? found.get(id.slice(0, 32));
      if (ep) result.set(id, ep);
    }
    if (result.size === ids.length) return result;
    if (Date.now() - start > timeoutMs) {
      const missing = ids.filter((id) => !result.has(id));
      throw new TimeoutError(`컨트롤러에서 브리지 기기를 찾지 못했습니다(${missing.length}개): ${missing.slice(0, 5).join(", ")}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}
