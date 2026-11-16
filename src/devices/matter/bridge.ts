// matter.js 브리지: ServerNode 하나 + Aggregator + 가전마다 Bridged 엔드포인트.
// 같은 LAN의 실제 Matter 컨트롤러(Home Assistant·SmartThings·Google Home)도 페어링 코드로 붙일 수 있다.

import { Endpoint, ServerNode, VendorId } from "@matter/main";
import { AdministratorCommissioningServer } from "@matter/main/behaviors/administrator-commissioning";
import { AggregatorEndpoint } from "@matter/main/endpoints/aggregator";
import { QrCode } from "@matter/main/types";
import type { DeviceSpec } from "../../contract/devices.js";
import { clustersFromSummary, defaultTwinValue, matterFromTwin } from "../mapping.js";
import { endpointClustersFor, endpointTypeFor } from "./deviceTypes.js";
import { endpointId, nodeEnvironment, truncateUtf8 } from "./environment.js";

export const BRIDGE_DEFAULTS = {
  id: "twin-home-bridge",
  name: "twin-home 브리지",
  port: 5540,
  // 개발용 값(인증받지 않은 기기). 자주 쓰는 20202021/3840과 겹치지 않게 골랐다.
  passcode: 20261011,
  discriminator: 3011,
  vendorId: 0xfff1, // CSA 테스트 vendor
  productId: 0x8000,
} as const;

export interface BridgeOptions {
  /** 저장 폴더. 브리지 노드 저장소는 <storageDir>/<id>에 생긴다. */
  storageDir: string;
  port?: number;
  passcode?: number;
  discriminator?: number;
  vendorId?: number;
  productId?: number;
  id?: string;
  name?: string;
  /** 기기 id → twin 초기 상태. 없으면 attr 기본값. */
  initial?: Record<string, Record<string, unknown>>;
  /** true면 저장소에 남은 마지막 Matter 상태를 이어받는다. 기본(false)은 매번 twin 초기 상태로 맞춘다. */
  keepState?: boolean;
}

export interface PairingInfo {
  manualPairingCode: string;
  qrPairingCode: string;
  passcode: number;
  discriminator: number;
  port: number;
  commissioned: boolean;
  fabrics: number;
}

export class MatterBridge {
  constructor(
    readonly node: ServerNode,
    readonly aggregator: Endpoint,
    /** 기기 id → 브리지 엔드포인트(Matter 기기인 것만). */
    readonly endpoints: Map<string, Endpoint>,
    readonly port: number,
  ) {}

  get isCommissioned(): boolean {
    return this.node.lifecycle.isCommissioned;
  }

  get isOnline(): boolean {
    return this.node.lifecycle.isOnline;
  }

  pairing(): PairingInfo {
    const c = this.node.state.commissioning;
    const codes = c.pairingCodes;
    return {
      manualPairingCode: codes.manualPairingCode,
      qrPairingCode: codes.qrPairingCode,
      passcode: c.passcode,
      discriminator: c.discriminator,
      port: this.port,
      commissioned: this.isCommissioned,
      fabrics: Object.keys(c.fabrics).length,
    };
  }

  /** 네트워크에 올린다(mDNS 광고 + UDP 포트). local 전송에서는 부르지 않는다. */
  async start(): Promise<void> {
    if (!this.isOnline) await this.node.start();
  }

  /**
   * 관리자(컨트롤러) 없이 브리지 쪽에서 직접 커미셔닝 가능 상태로 만든다(원래 passcode).
   * 컨트롤러 저장소를 잃어 브리지에 남은 패브릭을 쓸 수 없을 때 다시 커미셔닝하려고 쓴다.
   * 패브릭에 관리자가 있으면 그 관리자가 AdministratorCommissioning.OpenBasicCommissioningWindow를 부르는 것이
   * Matter 방식이다(MatterHub.openCommissioningWindow).
   */
  async enterCommissionableMode(): Promise<void> {
    await this.node.act((agent) => agent.commissioning.enterCommissionableMode());
  }

  async close(): Promise<void> {
    await this.node.close();
  }
}

function initialTwin(spec: DeviceSpec, initial?: Record<string, unknown>): Record<string, unknown> {
  const twin: Record<string, unknown> = {};
  for (const [attr, values] of Object.entries(spec.twinAttrs)) twin[attr] = initial?.[attr] ?? defaultTwinValue(attr, values);
  return twin;
}

/** 브리지 노드를 만든다(아직 네트워크에 올리지 않음). 초기 속성은 twin 초기 상태 → 매핑으로 정한다. */
export async function createBridge(devices: DeviceSpec[], opts: BridgeOptions): Promise<MatterBridge> {
  const id = opts.id ?? BRIDGE_DEFAULTS.id;
  const name = opts.name ?? BRIDGE_DEFAULTS.name;
  const port = opts.port ?? BRIDGE_DEFAULTS.port;
  // Basic Commissioning 기능: 관리자가 OpenBasicCommissioningWindow로 창을 열면 원래 페어링 코드로 컨트롤러를 더 붙일 수 있다
  const node = await ServerNode.create(ServerNode.RootEndpoint.with(AdministratorCommissioningServer.with("Basic")), {
    id,
    environment: nodeEnvironment(id, opts.storageDir),
    network: { port },
    commissioning: {
      passcode: opts.passcode ?? BRIDGE_DEFAULTS.passcode,
      discriminator: opts.discriminator ?? BRIDGE_DEFAULTS.discriminator,
    },
    productDescription: { name: truncateUtf8(name, 32), deviceType: AggregatorEndpoint.deviceType },
    basicInformation: {
      vendorName: "twin-home",
      vendorId: VendorId(opts.vendorId ?? BRIDGE_DEFAULTS.vendorId),
      productId: opts.productId ?? BRIDGE_DEFAULTS.productId,
      productName: "Virtual Appliance Bridge",
      productLabel: "Virtual Appliance Bridge",
      nodeLabel: truncateUtf8(name, 32),
      serialNumber: truncateUtf8(`SN-${id}`, 32), // uniqueId와 같으면 안 된다(Matter 규칙)
      uniqueId: truncateUtf8(id, 32),
      hardwareVersion: 1,
      hardwareVersionString: "1",
      softwareVersion: 1,
      softwareVersionString: "0.1.0",
    },
  });

  try {
    const aggregator = new Endpoint(AggregatorEndpoint, { id: "aggregator" });
    await node.add(aggregator);
    const endpoints = new Map<string, Endpoint>();
    for (const spec of devices) {
      const type = endpointTypeFor(spec);
      if (!type) continue;
      const summary = matterFromTwin(spec, initialTwin(spec, opts.initial?.[spec.id]));
      const endpoint = new Endpoint(type, {
        id: endpointId(spec.id),
        bridgedDeviceBasicInformation: {
          nodeLabel: truncateUtf8(spec.label, 32),
          productName: truncateUtf8(spec.twinType, 32),
          serialNumber: truncateUtf8(`SN-${spec.id}`, 32),
          uniqueId: truncateUtf8(spec.id, 32),
          reachable: true,
        },
        ...endpointClustersFor(spec, summary),
      });
      try {
        await aggregator.add(endpoint);
      } catch (e) {
        throw new Error(`브리지 엔드포인트를 만들지 못했습니다: ${spec.id} (${spec.matterDeviceType}): ${(e as Error).message}`, { cause: e });
      }
      // 저장소에 이전 상태가 있으면 그것이 먼저 적용되므로 twin 초기 상태로 다시 맞춘다
      if (!opts.keepState) await endpoint.set(clustersFromSummary(spec, summary) as never);
      endpoints.set(spec.id, endpoint);
    }
    return new MatterBridge(node, aggregator, endpoints, port);
  } catch (e) {
    await node.close().catch(() => {});
    throw e;
  }
}

/** 페어링 안내 문구(한국어). qr이면 터미널용 QR 그림을 붙인다. */
export function formatPairingInfo(info: PairingInfo, opts: { qr?: boolean } = {}): string {
  const lines = [
    `[Matter 브리지] UDP 포트 ${info.port}, 커미셔닝 ${info.commissioned ? `됨(패브릭 ${info.fabrics}개)` : "안 됨"}`,
    `  수동 페어링 코드: ${info.manualPairingCode}`,
    `  QR 페이로드:     ${info.qrPairingCode}`,
    info.commissioned
      ? `  (passcode ${info.passcode}, discriminator ${info.discriminator}) 이미 커미셔닝됨: 같은 LAN의 다른 컨트롤러(Home Assistant 등)는 먼저 페어링 창을 연 뒤(POST /api/matter/commissioning-window) 이 코드로 추가한다.`
      : `  (passcode ${info.passcode}, discriminator ${info.discriminator}) 같은 LAN의 Matter 컨트롤러 앱에서 이 코드로 추가할 수 있다.`,
  ];
  if (opts.qr) lines.push(QrCode.get(info.qrPairingCode));
  return lines.join("\n");
}
