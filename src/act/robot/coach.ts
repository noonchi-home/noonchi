// 실행 추적의 코치 도움(Coach): 코치 계획의 지금 사람 단계(coachStep), 다른 행동 알림(stray: 의미 있는 변화·폰이 다른 자리로 감, 관찰 모드 계기 off_track),
// 다시 알리기(tell, 그 단계의 명령 글만 바꿔 다시 보냄), 조용한 단계(quietStep). 위험 가전 손 조작 단계에는 바꾼 글을 보내지 않는다.
import type { StepStatus, XZ } from "../../contract/plan.js";
import type { WorldChange, WorldChangeKind } from "../../contract/world.js";
import { PHONE_NEAR_M } from "../../world/vocab.js";
import { HUMAN_KINDS, type AgentStep } from "../../agent/index.js";
import { TELL_TEXT, VISION_TEXT, type TellMode } from "../labels.js";
import { taskOf } from "../tasks.js";
import { Part, type Run } from "../track/core.js";

/** 코치 계획 중 다른 행동을 본 것 같다: 지금 단계(이름·명령·번호 1부터)와 계획 단계 목록, 방금 본 변화 줄(최근 30초, 오래된 것부터, 들은 말은 넣지 않는다).
 *  signal은 이 단계가 끝나면 끊긴다. */
export interface Stray {
  planId: string; stepId: string; label: string; command: string; steps: { label: string; status: StepStatus }[]; at: number;
  changes: string[]; signal: AbortSignal;
}

/** 다른 행동의 계기가 되는 변화: 사람 방, 가전 상태, 가전 설비 상태. */
const STRAY_KINDS: ReadonlySet<WorldChangeKind> = new Set<WorldChangeKind>(["person_room", "device", "fixture"]);
/** 방금 본 변화 줄에 넣지 않는 것: 프레임마다 오는 줄과 들은 말. */
const QUIET_KINDS: ReadonlySet<WorldChangeKind> = new Set<WorldChangeKind>(["vlm", "vlm_missing", "yolo_missing", "heard"]);
/** 방금 본 변화 줄을 두는 시간(ms). */
const STRAY_KEEP_MS = 30_000;

/** 코치 도움: 다른 행동 알림·다시 알리기·조용한 단계. */
export class Coach extends Part {
  /** 방금 본 변화 줄(다른 행동 알림에 넣는다). */
  private seen: { at: number; text: string }[] = [];
  /** 마지막으로 tell을 보낸 시각(Date.now 시계, 대시보드 말풍선 카드). */
  private toldWallAt: number | null = null;

  /** World State 변화 줄을 방금 본 변화 줄에 더한다(프레임마다 오는 줄·들은 말은 빼고 STRAY_KEEP_MS 동안). */
  see(changes: readonly WorldChange[]): void {
    const now = this.clock.now();
    this.seen = [...this.seen, ...changes.filter((c) => !QUIET_KINDS.has(c.kind)).map((c) => ({ at: now, text: c.text }))].filter((c) => now - c.at <= STRAY_KEEP_MS);
  }

  /** 사람 방·가전·가전 설비의 의미 있는 변화가 왔는데 지금 단계가 넘어가지 않았으면 다른 행동 알림을 부른다. */
  strayOn(r: Run, changes: readonly WorldChange[]): void {
    if (changes.some((c) => c.meaningful && STRAY_KINDS.has(c.kind))) this.stray(r);
  }

  /** 코치 계획의 지금 사람 단계(들은 말 돕기, src/act/look.ts heard). 질문 중·사람 단계가 아님·코치가 아닌 계획·닫힌 계획이면 null. */
  coachStep(): Omit<Stray, "changes"> | null {
    const r = this.core.run;
    const step = r ? this.core.stepOf(r) : undefined;
    if (this.core.stopped || !r || r.state !== "running" || r.asking || !r.sent || !r.stepEnd || !step || !HUMAN_KINDS.includes(step.kind)) return null;
    if (taskOf(r.plan.task)?.coach !== true) return null;
    return {
      planId: r.plan.view.id, stepId: step.id, label: step.label, command: step.command ?? r.sent.text, at: r.at + 1,
      steps: (this.o.plans.current()?.id === r.plan.view.id ? this.o.plans.current()!.steps : r.plan.view.steps).map((s) => ({ label: s.label, status: s.status })),
      signal: r.stepEnd.signal,
    };
  }

  /** 다른 행동 알림: 코치 계획의 사람 단계이고 단계마다 strayMax번·strayGapMs에 한 번 안이면 strayed를 부른다. 받은 것만 센다. more는 덧붙일 변화 줄. */
  private stray(r: Run, more: string[] = []): void {
    if (!this.o.observe.strayed || r.strays >= this.cfg.strayMax) return;
    const now = this.clock.now();
    if (now - r.strayAt < this.cfg.strayGapMs) return;
    const at = this.coachStep();
    if (!at) return;
    if (!this.o.observe.strayed({ ...at, changes: [...this.seen.map((c) => c.text), ...more] })) return;
    r.strayAt = now;
    r.strays++;
  }

  /** 폰이 지금 단계 자리를 떠나 다른 평면도 자리 가까이로 갔는가(이동 단계는 보지 않는다). 그 자리마다 한 번 다른 행동 알림을 부른다. */
  strayNear(r: Run, step: AgentStep): void {
    if (!this.o.observe.strayed || step.kind === "go" || !HUMAN_KINDS.includes(step.kind) || r.asking) return;
    const e = this.core.eye;
    const fp = this.o.layout.floor();
    const here = step.target ? fp.objects.get(step.target)?.position ?? null : null;
    if (!e || !here || this.clock.now() - e.at > STRAY_KEEP_MS) return;
    const far = (p: XZ) => Math.hypot(e.position[0] - p[0], e.position[1] - p[1]);
    if (far(here) <= PHONE_NEAR_M) {
      r.strayNear = null;
      return;
    }
    const near = [...fp.objects.values()].filter((o) => o.id !== step.target && this.core.nameOf(o.id) && far(o.position) <= PHONE_NEAR_M).sort((a, b) => far(a.position) - far(b.position))[0];
    if (!near || near.id === r.strayNear) return;
    r.strayNear = near.id;
    this.stray(r, [VISION_TEXT.movedNear(this.core.nameOf(near.id)!)]);
  }

  /** 관찰 모드의 다시 알리기(tell_person): 지금 그 계획의 그 사람 단계면 명령 글을 서버 글 한 줄(지금 명령 그대로, 또는 「먼저」를 붙인 것)로 바꿔 소리로 읽고,
   *  tellHoldMs 뒤 원래 명령으로 되돌린다(되돌릴 때는 읽지 않는다). 단계가 넘어가면 되돌리지 않는다(새 명령이 이미 떴다).
   *  켜기 전 질문 중과 손 조작 단계에는 보내지 않는다. 보낸 글, 못 보냈으면 null. */
  tell(planId: string, stepId: string, mode: TellMode): string | null {
    const r = this.core.run;
    const step = r ? this.core.stepOf(r) : undefined;
    if (this.core.stopped || !r || r.state !== "running" || r.asking || !r.sent || !step || !HUMAN_KINDS.includes(step.kind)) return null;
    if (r.plan.view.id !== planId || step.id !== stepId || r.sent.step !== stepId || !step.command || this.handStep(step) || !Object.hasOwn(TELL_TEXT, mode)) return null;
    const said = TELL_TEXT[mode](step.command);
    const now = this.clock.now();
    r.told = { text: r.told?.text ?? r.sent.text, until: now + this.cfg.tellHoldMs };
    r.spokeAt = now;
    r.helped = true;
    r.quietOn = false;
    r.sent = { ...r.sent, text: said, speak: true };
    this.toldWallAt = Date.now();
    this.core.robot.commands.show(r.sent);
    return said;
  }

  /** 마지막으로 다시 알린(tell) 시각(Date.now 시계). 없으면 null. */
  toldAt(): number | null {
    return this.toldWallAt;
  }

  /** 지금 조용히 띄운 단계 이름(소리로 읽지 않고 지켜보는 중, 대시보드 말풍선 카드). 아니면 null. */
  quietStep(): string | null {
    const r = this.core.run;
    return !this.core.stopped && r?.state === "running" && r.quietOn && !r.asking ? this.core.stepOf(r)?.label ?? null : null;
  }

  /** 손 조작 단계(켜기·끄기·열기·닫기)인가: 그 명령 자리는 켜기 전 질문·승인 뒤 명령만 쓴다(다시 알리기로 바꾸지 않는다). */
  private handStep(step: AgentStep): boolean {
    return step.hand !== null;
  }
}
