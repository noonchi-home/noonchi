// 가짜 ir_bridge 보드: 시험과 IR_FAKE=1(키트 없이 앱 흐름 보기)에서 쓴다.
import type { IrDecoded } from "../../contract/ir.js";
import type { IrPort } from "./ir.js";

export function necTicks(address: number, command: number): number[] {
  const bytes = address > 0xff ? [address & 0xff, address >> 8, command, ~command & 0xff] : [address, ~address & 0xff, command, ~command & 0xff];
  const out = [180, 90];
  for (const byte of bytes) for (let i = 0; i < 8; i++) out.push(11, (byte >> i) & 1 ? 34 : 11);
  out.push(11);
  return out;
}

export interface FakeBoard {
  port: IrPort;
  written: string[];
  press(decoded: IrDecoded | "overflow", ticks?: number[]): void;
  unplug(): void;
  readonly opens: number;
}

export function fakeBoard(o: { firmware?: "ir_bridge" | "ir_tv" | "silent"; bootMs?: number; autoPressMs?: number } = {}): FakeBoard {
  const firmware = o.firmware ?? "ir_bridge";
  const written: string[] = [];
  let opens = 0;
  let current: { say(line: string): void; lost(): void; open: boolean } | null = null;
  let raw = false, session = 0;
  let auto: ReturnType<typeof setInterval> | undefined;
  const say = (line: string) => { const c = current; setTimeout(() => { if (c?.open) c.say(line); }, 0); };
  const press = (decoded: IrDecoded | "overflow", ticks?: number[]) => {
    if (decoded === "overflow") { say("RXOVF"); return; }
    if (raw) { const t = ticks ?? necTicks(decoded.address, decoded.command); say(`RXRAW ${t.length} ${t.join(" ")}`); }
    if (decoded.protocol !== "UNKNOWN") say(`RX ${decoded.protocol} 0x${decoded.address.toString(16).toUpperCase()} 0x${decoded.command.toString(16).toUpperCase()}`);
  };
  const answer = (line: string) => {
    if (firmware !== "ir_bridge") return;
    const nec = /^NEC (0x[0-9A-F]+) (0x[0-9A-F]+)/i.exec(line);
    if (line === "PING") say("ok pong");
    else if (line === "RAWON") {
      raw = true; session++; say("ok raw on");
      clearInterval(auto);
      if (o.autoPressMs) { const s = session; auto = setInterval(() => press({ protocol: "NEC", address: 0x10, command: 0x20 + s }), o.autoPressMs); }
    } else if (line === "RAWOFF") { raw = false; clearInterval(auto); say("ok raw off"); }
    else if (nec) {
      const [a, c] = [parseInt(nec[1]!, 16), parseInt(nec[2]!, 16)];
      say(`ok sent NEC 0x${a.toString(16).toUpperCase()} 0x${c.toString(16).toUpperCase()}`);
      say(`RX NEC 0x${a.toString(16).toUpperCase()} 0x${c.toString(16).toUpperCase()}`);
    } else if (/^RAW \d+ \d+/.test(line)) say(`ok sent RAW ${line.split(" ")[2]}`);
    else say("err unknown");
  };
  const port: IrPort = (_name, received, lost) => {
    opens++;
    if (current) current.open = false;
    raw = false; clearInterval(auto);
    const me = { say: received, lost, open: true };
    current = me;
    setTimeout(() => {
      if (!me.open) return;
      if (firmware === "ir_bridge") me.say("ready ir_bridge raw=750");
      if (firmware === "ir_tv") { me.say("boot"); me.say("ready"); }
    }, o.bootMs ?? 50);
    return { send: (line) => { if (!me.open) throw new Error("closed"); written.push(line); answer(line); }, close: () => { me.open = false; clearInterval(auto); } };
  };
  return {
    port, written, press,
    unplug: () => { const c = current; if (c?.open) { c.open = false; clearInterval(auto); c.lost(); } },
    get opens() { return opens; },
  };
}
