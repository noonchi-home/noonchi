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

  close(): void {
    this.closed = true;
    this.intents.length = 0;
    this.current = null;
  }
}

/** 명령을 보내는 곳은 로봇 하나다. 운영 중에는 같은 봉투를 다시 보내는 발행 줄을 쓴다. */
export function emitRobotCommand(out: Pick<Outbox, "push"> | Pick<BusNode, "publish">, cmd: PlannedCommandMessage) {
  return "push" in out ? out.push("/act/phone_command", { cmd }) : out.publish("/act/phone_command", { cmd });
}
