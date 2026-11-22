import type { BusNode, Outbox } from "../../bus/index.js";
import type { PlannedCommand, PlannedCommandMessage } from "../../contract/phone.js";
import { talkGrade } from "../talk-grade.js";

/** 하나뿐인 명령 줄. 전송 중 들어온 명령도 먼저 받은 명령 뒤에 보낸다. */
export class RobotPhone {
  private current: string | null = null;
  private sending = false;
  private closed = false;
  private readonly intents: PlannedCommandMessage[] = [];

  constructor(private readonly toPhone: (msg: PlannedCommandMessage) => void,
    private readonly turnsOff: (command: PlannedCommand) => boolean) {}

  show(command: PlannedCommand): void { this.accept(command); }
  clear(id: string): void { this.accept({ type: "command_clear", id }); }

  private accept(intent: PlannedCommandMessage): void {
    if (this.closed) return;
    this.intents.push(intent);
    if (this.sending) return;
    this.sending = true;
    try {
      while (this.intents.length) {
        const next = this.intents.shift()!;
        if (next.type === "command_clear") {
          if (next.id && next.id !== this.current) continue;
          this.current = null;
          this.toPhone(next);
        } else {
          const grade = talkGrade(next, this.turnsOff(next));
          this.current = next.id;
          this.toPhone(grade ? { ...next, grade } : next);
        }
      }
    } finally {
      this.sending = false;
    }
  }

  shows(id:string):boolean { return this.current===id; }

  close(): void {
    this.closed = true;
    this.intents.length = 0;
    this.current = null;
  }
}

const revisions = new WeakMap<object, number>();

/** 실제 폰이 받은 차례를 지키고, 늦게 붙는 폰에는 마지막 명령만 되살린다. */
export function emitRobotCommand(out: Pick<Outbox, "push"> | Pick<BusNode, "publish">, cmd: PlannedCommandMessage) {
  const revision = (revisions.get(out) ?? 0) + 1;
  revisions.set(out, revision);
  const body = { cmd, revision };
  if ("push" in out) {
    out.push("/act/phone_changes", body);
    return out.push("/act/phone_command", body);
  }
  return out.publish("/act/phone_changes", body).then(() => out.publish("/act/phone_command", body));
}
