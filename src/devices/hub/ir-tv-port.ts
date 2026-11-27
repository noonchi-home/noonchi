// IrTv(ir.ts)가 쓰던 줄(ready·boot·send·sent·remote)을 ir_bridge 연결 위로 옮긴다. 보드 연결은 IrSetup이 갖고, 여기서는 닫지 않는다.
import type { IrSignal } from "../../contract/ir.js";
import type { BridgePress, IrBridge } from "./ir-bridge.js";
import type { IrPort } from "./ir.js";

/**
 * 연결됨이면 ready, 연결됨에서 벗어나면 boot(IrTv는 꺼짐으로 두고 다음 ready를 기다린다), lost·busy일 때만 lost()(IrTv가 닫힌다).
 * ready가 늦게 와 IrBridge가 silent·wrong_firmware를 거쳐 connected로 돌아와도 IrTv는 다시 쓸 수 있다.
 */
export function tvPort(bridge: () => IrBridge | null, signalOfCode: (code: string) => IrSignal | undefined,
  codeOfPress: (p: BridgePress) => string | undefined): IrPort {
  return (_port, received, lost) => {
    const b = bridge();
    if (!b) return { send() { throw new Error("TV 송신기가 연결되지 않았어요."); }, close() {} };
    let open = true;
    /** IrTv에 ready를 알린 뒤 boot를 아직 보내지 않았다. */
    let online = false;
    const offs: (() => void)[] = [];
    const stop = () => { open = false; for (const off of offs.splice(0)) off(); };
    const ready = () => { if (open && !online) { online = true; received("ready"); } };
    offs.push(
      b.onState((s) => {
        if (!open) return;
        if (s === "connected") ready();
        else if (s === "lost" || s === "busy") { stop(); lost(); }
        else if (online) { online = false; received("boot"); }
      }),
      b.onPress((p) => { const code = open ? codeOfPress(p) : undefined; if (code) received("remote " + code); }),
    );
    if (b.state === "connected") queueMicrotask(ready);
    else if (b.state === "lost" || b.state === "busy") queueMicrotask(() => { if (open) { stop(); lost(); } });
    return {
      send(line) {
        const [verb, code, extra] = line.split(" ");
        const signal = verb === "send" && code && extra === undefined ? signalOfCode(code) : undefined;
        if (!open || !signal) throw new Error("TV 송신기가 연결되지 않았어요.");
        b.send(signal).then(() => { if (open) received("sent " + code); }, () => {});
      },
      close: stop,
    };
  };
}
