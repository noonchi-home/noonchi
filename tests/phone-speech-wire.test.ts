import { afterEach, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { emitRobotCommand } from "../src/act/robot/phone.js";
import { BusNode, MemoryBus, Outbox, realClock } from "../src/bus/index.js";
import type { PhoneCommand, PlannedCommand } from "../src/contract/phone.js";
import { phoneCommandRoutes } from "../src/phone/node.js";
import { createPhoneServer } from "../src/phone/server.js";

// Vitest loads the production client while the root server typecheck stays on its Node libraries.
type PhoneClient = { view(): { command: Pick<PlannedCommand, "text" | "vision"> | null }; close(): void };
const controllerPath = "../ui/src/phone/controller.ts";
const { createPhoneController } = await import(/* @vite-ignore */ controllerPath) as {
  createPhoneController(deps: {
    location: { protocol: string; host: string; search: string };
    Socket: new (url: string) => WebSocket;
    Recognition: null; secure: false; xr: null;
  }): PhoneClient;
};

afterEach(() => { vi.unstubAllGlobals(); });

it("reads each announced phone instruction in Korean and restores the current step silently on reconnect", async () => {
  const played: Array<{ text: string; lang: string }> = [];
  class Utterance {
    lang = "";
    onend?: () => void;
    constructor(readonly text: string) {}
  }
  vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
  vi.stubGlobal("speechSynthesis", {
    cancel() {},
    speak(message: Utterance) { played.push({ text: message.text, lang: message.lang }); message.onend?.(); },
  });
  const server = createPhoneServer({ sync: { landmarks: [], walls: [], start: null }, onEye: () => {}, log: () => {} });
  const bus = new MemoryBus(), epoch = { boot: "speech", home: "mokryeon#1" };
  const act = new BusNode({ name: "act", bus, epoch });
  const bridge = new BusNode({ name: "phone", bus, epoch });
  const out = new Outbox(act, { clock: realClock, log: () => {} });
  const publish = (command: PlannedCommand) => { expect(emitRobotCommand(out, command)).toBe(true); };
  let delivered: PlannedCommand | undefined;
  const lastDeliveredCommand = () => delivered;
  phoneCommandRoutes(bridge, message => {
    if (message.type === "command") delivered = message;
    server.command(message);
  });
  const sockets: WebSocket[] = [];
  const wireCommands: PhoneCommand[] = [];
  class PhoneSocket extends WebSocket {
    constructor(url: string) {
      super(url);
      sockets.push(this);
      this.on("message", (data, binary) => {
        if (binary) return;
        const message = JSON.parse(String(data));
        if (message.type === "command") wireCommands.push(message as PhoneCommand);
      });
    }
  }
  let phone: PhoneClient | undefined;
  const text = "싱크대로 가 주세요";
  const base: PlannedCommand = {
    type: "command", id: "plan:1", step: "plan:1:1", text, target: null, choices: [], vision: null, speak: true,
  };
  const firstLine = { text, lang: "ko-KR" };
  const poll = { timeout: 4_000 };
  const speechId = (revision: number) => ({ boot: epoch.boot, homeEpoch: epoch.home, publisher: act.inst, revision });
  try {
    await act.prepare();
    await bridge.prepare();
    act.start();
    bridge.start();
    const { port } = await server.listen(0, "127.0.0.1");
    phone = createPhoneController({
      location: { protocol: "http:", host: `127.0.0.1:${port}`, search: "" },
      Socket: PhoneSocket, Recognition: null, secure: false, xr: null,
    });
    await expect.poll(() => server.ready(), poll).toBe(true);

    publish(base);
    await expect.poll(() => phone?.view().command?.text, poll).toBe(text);
    expect(played).toEqual([firstLine]);
    const duplicate = lastDeliveredCommand();
    if (!duplicate?.speech_id) throw new Error("The phone bridge did not attach the publication identity.");
    expect(duplicate).toEqual({ ...base, speech_id: speechId(1) });
    expect(wireCommands).toEqual([{ ...base, speech_id: speechId(1) }]);
    expect(out.push("/act/phone_changes", { cmd: base, revision: duplicate.speech_id.revision })).toBe(true);
    server.command(duplicate);
    publish({ ...base, vision: "싱크대까지 1m", speak: false });
    await expect.poll(() => phone?.view().command?.vision, poll).toBe("싱크대까지 1m");
    expect(wireCommands.filter((m) => m.speak)).toEqual([
      { ...base, speech_id: speechId(1) },
      { ...base, speech_id: speechId(1) },
    ]);
    expect(wireCommands.at(-1)).toEqual({ ...base, vision: "싱크대까지 1m", speak: false, speech_id: speechId(2) });
    expect(played).toEqual([firstLine]);

    sockets[0]!.terminate();
    await expect.poll(() => server.ready(), poll).toBe(false);
    // This publication asks to speak. A reconnect may restore its text but must turn speech off.
    publish({ ...base, vision: "싱크대까지 80cm" });
    await expect.poll(() => sockets.length, poll).toBe(2);
    await expect.poll(() => phone?.view().command?.vision, poll).toBe("싱크대까지 80cm");
    expect(lastDeliveredCommand()).toEqual({ ...base, vision: "싱크대까지 80cm", speech_id: speechId(3) });
    expect(wireCommands.at(-1)).toEqual({ ...base, vision: "싱크대까지 80cm", speak: false, speech_id: speechId(3) });
    expect(played).toEqual([firstLine]);

    publish(base);
    await expect.poll(() => played, poll).toEqual([firstLine, firstLine]);
    expect(wireCommands.at(-1)).toEqual({ ...base, speech_id: speechId(4) });
    const final = "컵을 싱크대에 놓아 주세요";
    publish({ ...base, step: "plan:1:2", text: final });
    await expect.poll(() => played, poll).toEqual([firstLine, firstLine, { text: final, lang: "ko-KR" }]);
    expect(wireCommands.at(-1)).toEqual({ ...base, step: "plan:1:2", text: final, speech_id: speechId(5) });
  } finally {
    phone?.close();
    await Promise.all([server.close(), bridge.stop(), act.stop()]).finally(() => bus.close());
  }
}, 12_000);
