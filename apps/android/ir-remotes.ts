// 앱 리모컨 등록: 허브 설정 API(/api/setup/ir*) 부르기, 단추 배우기 기다리기, 화면 글.
// 본문은 계약 src/contract/ir.ts, 경로·이름 길이는 src/shared/ir.ts 그대로다. 둘 다 타입만 가져온다(Node 시험이 확장자 없는 경로의 값을 읽지 못한다).
import type { IR_LABEL_MAX, IR_PATHS } from "../../src/shared/ir";
import type {
  IrButtonBody, IrFirmware, IrHomeBody, IrLearnBody, IrLearnView, IrPortBody, IrPortState, IrPortsView, IrPresetBody,
  IrRemoteBody, IrRemoteDeleteBody, IrRemoteView, IrTestBody, IrTestView, IrView, RemoteRole,
} from "../../src/contract/ir";
import type { ConnectedHub } from "./connected-hub";

export const PATHS: typeof IR_PATHS = {
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
};
/** 배우는 동안 허브를 다시 읽는 간격. */
export const POLL_MS = 500;
export const LABEL_MAX: typeof IR_LABEL_MAX = 20;
/** 단추 배우기에서 고르는 뜻(켜기·끄기·전원·그 밖). */
export const ROLE_CHOICES: readonly RemoteRole[] = ["on", "off", "toggle", null];

export function readIr(hub: ConnectedHub, home: string, signal?: AbortSignal): Promise<IrView> {
  return hub.get<IrView>(`${PATHS.view}?home=${encodeURIComponent(home)}`, signal);
}

export function readPorts(hub: ConnectedHub, signal?: AbortSignal): Promise<IrPortsView> {
  return hub.get<IrPortsView>(PATHS.ports, signal);
}

export function choosePort(hub: ConnectedHub, home: string, port: string): Promise<IrView> {
  const body: IrPortBody = { home, port };
  return hub.write<IrView>(PATHS.port, body);
}

/** id가 없으면 새 리모컨, 있으면 그 리모컨의 이름·가전을 바꾼다. */
export function saveRemote(hub: ConnectedHub, home: string, label: string, device: string, id?: string): Promise<IrView> {
  const body: IrRemoteBody = id ? { home, id, label, device } : { home, label, device };
  return hub.write<IrView>(PATHS.remote, body);
}

export function deleteRemote(hub: ConnectedHub, home: string, id: string): Promise<IrView> {
  const body: IrRemoteDeleteBody = { home, id };
  return hub.write<IrView>(PATHS.remoteDelete, body);
}

export function startLearn(hub: ConnectedHub, home: string, remote: string, label: string, role: RemoteRole): Promise<IrView> {
  const body: IrLearnBody = { home, remote, label, role };
  return hub.write<IrView>(PATHS.learn, body);
}

export function cancelLearn(hub: ConnectedHub, home: string): Promise<IrView> {
  const body: IrHomeBody = { home };
  return hub.write<IrView>(PATHS.learnCancel, body);
}

export function deleteButton(hub: ConnectedHub, home: string, remote: string, button: string): Promise<IrView> {
  const body: IrButtonBody = { home, remote, button };
  return hub.write<IrView>(PATHS.buttonDelete, body);
}

/** 그 단추 신호를 실제로 쏜다. 앱이 확인 창을 띄운 뒤에만 부른다. */
export function testButton(hub: ConnectedHub, home: string, remote: string, button: string): Promise<IrTestView> {
  const body: IrTestBody = { home, remote, button, confirm: true };
  return hub.write<IrTestView>(PATHS.test, body);
}

/** TV 리모컨에 LG TV 켜기·끄기 신호를 넣는다. */
export function addPreset(hub: ConnectedHub, home: string, remote: string): Promise<IrView> {
  const body: IrPresetBody = { home, remote, preset: "lg_tv_power" };
  return hub.write<IrView>(PATHS.preset, body);
}

/** 배우기가 끝날 때까지 POLL_MS마다 읽는다. signal이 멈추면 더 읽지 않고 reject. */
export async function waitLearn(hub: ConnectedHub, home: string, o: {
  signal: AbortSignal; sleep?: (ms: number) => Promise<void>; onView?: (view: IrView) => void;
}): Promise<IrView> {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  for (;;) {
    const view = await readIr(hub, home, o.signal);
    o.onView?.(view);
    if (view.learning?.state !== "waiting") return view;
    await sleep(POLL_MS);
    if (o.signal.aborted) throw new Error("aborted");
  }
}

const PORT_STATES: Record<Exclude<IrPortState, "none">, string> = {
  connecting: "연결 중", connected: "연결됨", wrong_firmware: "다른 펌웨어", silent: "답 없음",
  missing: "USB 장치 없음", busy: "다른 프로그램이 사용 중", lost: "연결 끊김",
};

export function portLine(port: IrView["port"]): string {
  if (port.state === "none") return "적외선 장치 · 포트 고르기 전";
  return ["적외선 장치", port.name, PORT_STATES[port.state]].filter(Boolean).join(" · ");
}

const FIRMWARE: Record<IrFirmware, string> = { ir_bridge: "적외선 장치", other: "다른 펌웨어", silent: "답 없음", in_use: "다른 프로그램이 사용 중" };

export function firmwareLabel(firmware: IrFirmware): string {
  return FIRMWARE[firmware];
}

export function roleLabel(role: RemoteRole): string {
  return role === "on" ? "켜기" : role === "off" ? "끄기" : role === "toggle" ? "전원" : "그 밖";
}

export function remoteValue(remote: IrRemoteView): string {
  return `${remote.roomLabel} · ${remote.deviceLabel} · 단추 ${remote.buttons.length}개`;
}

export function learnLines(view: IrLearnView): { copy: string[]; failure: string } {
  switch (view.state) {
    case "waiting": return {
      copy: [`리모컨을 수신기에 대고 「${view.label}」 단추를 두 번 누르세요.`, `남은 시간 ${Math.ceil(view.left_ms / 1000)}초 · ${view.presses}번 받음`],
      failure: "",
    };
    case "saved": return { copy: [`「${view.label}」 저장됨`], failure: "" };
    case "cancelled": return { copy: ["배우기를 멈췄어요."], failure: "" };
    case "timeout": return { copy: [], failure: "30초 안에 같은 신호를 두 번 받지 못했어요." };
    case "duplicate": return { copy: [], failure: `「${view.duplicate_of ?? ""}」 단추와 같은 신호예요.` };
    case "overflow": return { copy: [], failure: "신호가 너무 길어요. 단추를 짧게 눌러 주세요." };
    case "lost": return { copy: [], failure: "적외선 장치 연결이 끊겼어요." };
  }
}

export function buttonNameProblem(label: string): string {
  const name = label.trim();
  if (!name) return "단추 이름을 넣어 주세요.";
  return name.length > LABEL_MAX ? `단추 이름은 ${LABEL_MAX}자까지예요.` : "";
}

/** LG TV 켜기·끄기 신호 넣기는 켜기·끄기 뜻 단추가 없는 TV 리모컨에만 보인다. */
export function canPreset(remote: IrRemoteView): boolean {
  return remote.deviceKind === "tv" && !remote.buttons.some(button => button.role === "on" || button.role === "off");
}
