// 적외선 리모컨 등록 상수. 허브(src/server/ir-setup.ts)와 Android 앱(apps/android/ir-remotes.ts)이 같이 쓴다.
// 모양(타입)은 계약 src/contract/ir.ts에 있다. 계약은 타입만 두므로 값은 여기 둔다.
import type { IrPreset, RemoteRole } from "../contract/ir.js";

/** 전원 단추 뜻(RemoteRole에서 null을 뺀 것). */
export const REMOTE_ROLES = ["on", "off", "toggle"] as const satisfies readonly NonNullable<RemoteRole>[];

export const IR_PRESETS = ["lg_tv_power"] as const satisfies readonly IrPreset[];

export const IR_LABEL_MAX = 20;
export const IR_LEARN_MS = 30_000;

export const IR_PATHS = {
  view: "/api/setup/ir",
  ports: "/api/setup/ir/ports",
  port: "/api/setup/ir/port",
  remote: "/api/setup/ir/remote",
  remoteDelete: "/api/setup/ir/remote/delete",
  learn: "/api/setup/ir/learn",
  learnCancel: "/api/setup/ir/learn/cancel",
  buttonDelete: "/api/setup/ir/button/delete",
  test: "/api/setup/ir/test",
  preset: "/api/setup/ir/preset",
} as const;
