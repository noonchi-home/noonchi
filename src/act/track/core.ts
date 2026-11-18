// 실행 추적(src/act/track/)의 안쪽 공유 객체 TrackCore와 부분이 함께 쓰는 계획 실행 상태(Run)·도우미.
// TrackCore는 상태(지금 계획·만드는 계획·멈춤·폰 눈·조용한 때)와 실행 기록(emit)·실제 폰 길(o.toPhone)을 든다. 부분(start·steps·approval·safety·answers·coach)은
// 이 객체를 받는 작은 클래스(Part)이고, 서로를 이 객체의 칸으로 부른다. 부분끼리는 값 import가 없다(ExecutionTracker가 만들어 잇는다, tracker.ts).
// 켠 위험 가전 추적 상태(hot·끄기 안내·회차·풀린 가전)는 여기 두지 않는다: SafetyTracker(safety.ts)의 # 비공개 칸이다.
import type { DecisionRecord, ExecState } from "../../contract/events.js";
import type { PlannedCommand } from "../../contract/phone.js";
import type { XZ } from "../../contract/plan.js";
import type { WorldView } from "../../contract/world.js";
import { placeName } from "../../layout/index.js";
import type { ConditionWatch } from "../../world/index.js";
import { HUMAN_KINDS, type AgentPlan, type AgentStep } from "../../agent/index.js";
import { DEVICE_UNKNOWN, EXEC_TEXT } from "../labels.js";
import type { StepOutcome } from "../lessons.js";
import { AGAIN, APPROVE, STEP_DONE, type ActionChoice } from "../prompts.js";
import type { Answers } from "./answers.js";
import type { Approvals, Asking } from "./approval.js";
import type { Coach } from "./coach.js";
import type { ContentsHold, Hold, IdlePeek } from "./contents.js";
import type { Find, Finder, FindSlot } from "./find.js";
import type { Cycle, CycleEnd, SafetyTracker } from "./safety.js";
import type { UseWatch } from "./use.js";
import type { Dock, DockSlot } from "./dock.js";
import type { Starter } from "./start.js";
import type { Steps } from "./steps.js";
import type { TrackerOptions } from "./tracker.js";

/** at: 지금 단계 번호(실행 전 -1). sent: 실제 폰에 띄운 지금 명령. others: 계획 물건 id → 계획을 받을 때 있던 같은 종류의 다른 물건.
 *  alias: 계획 물건 id → 지금 그 물건으로 보는 World State id(옮겨서 새 id가 붙으면 이어 간다). carried: 집기 단계를 마친(사람이 든) 계획 물건.
 *  device: 기기 단계 실행 상태(sent는 보냈지만 적용을 확인하지 못함). gen: 단계가 바뀔 때마다 올라 늦게 온 기기 결과를 버린다.
 *  deadline: 이 단계 시간 한도(계속이면 한 번 늘어난다). again: 이 단계에서 시간 초과로 한 번 다시 물었다.
 *  looks·lookAt: 이 단계에서 받아 센 멈춘 단계 부름 수(돌려받은 것은 뺌)와 마지막으로 받은 시각. stepEnd: 이 단계가 끝나면 끊는 신호(멈춘 단계 알림). */
export interface Run {
  plan: AgentPlan; decision: DecisionRecord; state: ExecState; since: number;
  at: number; stepAt: number; spokeAt: number; visionAt: number; sent: PlannedCommand | null;
  asking: Asking | null; askAt: number; watch: ConditionWatch | null; others: Map<string, Set<string>>; alias: Map<string, string>; carried: Set<string>;
  /** 평면도 물건의 평면 자리(따라가기 거리). */
  placeAt: (id: string | null) => XZ | null;
  deadline: number; again: boolean; device: "idle" | "running" | "done" | "sent"; gen: number;
  looks: number; lookAt: number; stepEnd: AbortController | null;
  /** 같은 행동 다시 계획 간격을 세려고 적은 시각(Job.at). */
  gapAt: number;
  /** 켜라고 한 가전과 지금 켜기 회차(추적을 풀어도 지우지 않는다. 다시 걸면 새 회차로 바뀐다). 읽기 전용 복사본이고 회차 값은 SafetyTracker의 #cycles만 바꾼다. */
  onAt: Map<string, Readonly<Cycle>>;
  /** 이 계획이 켠 가전마다 지금 회차가 풀린 근거(회차 번호·근거 촬영 시각·판정 길·푼 시각). 가전 이력(최근 몇 줄만 남음)에 기대지 않고 끄기 do 단계가 읽는다.
   *  회차가 바뀌거나 계획이 닫히면 지우고, 푼 뒤 rearmMs가 지나면 지운다(그 가전의 끄기 do 단계가 열려 있는 동안은 두고). */
  ends: Map<string, { cycle: number; seenAt: number; how: CycleEnd["via"]; at: number }>;
  /** 끄기 do 단계의 보이게 해 달라는 부탁을 보낸 단계 세대(단계마다 한 번). deferred: 끄기 안내 때문에 시작을 미룬다고 기록했다. */
  offAsked: number; deferred: boolean;
  /** 판본이 맞는 폰이 없어 시작을 미룬다고 기록했다. phone: 폰이 필요한 계획(needsPhone, 시작할 때 정한다). 폰 명령 줄을 쓰는 동안 끄기 안내는 기다린다. */
  phoneWait: boolean; phone: boolean;
  /** 이 단계에서 받은 다른 행동 알림 수와 마지막으로 부른 시각, 폰이 가까이 간 다른 자리(그 자리마다 한 번). */
  strays: number; strayAt: number; strayNear: string | null;
  /** tell로 바꿔 띄운 글: 되돌릴 원래 명령 글과 되돌릴 시각. */
  told: { text: string; until: number } | null;
  /** 이 단계에서 도움을 받았다(다시 읽기·다시 알리기·가까이 비춰 달라는 부탁·조용한 단계 힌트·시간 초과 질문): 혼자 해낸 단계로 세지 않는다. */
  helped: boolean;
  /** 조용히 띄울 단계 이름(지난 수업에서 이어서 혼자 해낸 단계). quietOn: 지금 단계를 조용히 띄웠고 아직 힌트를 읽지 않았다. */
  quiet: Set<string>; quietOn: boolean;
  /** 끝낸 사람 단계의 결과(수업 기록에 남길 것). */
  outcomes: StepOutcome[];
  /** 내용물 보류(실행 전 검사가 컵 안을 몰라 막음, src/act/track/contents.ts). 없으면 null. */
  hold: Hold | null;
  /** 내용물 보류로 붙잡은 컵 id(보류에서 풀려 첫 명령을 보낼 때 폰 대화·승인 대기를 보고, 그 컵 내용물은 「가까이 본 뒤 다시 판단」에서 뺀다).
   *  busyAt: 폰 대화·승인 대기 때문에 첫 명령을 미루기 시작한 시각. */
  heldIds: Set<string>; busyAt: number | null;
  /** 따르기 창을 연 물건(World State id, src/act/track/steps.ts window). 없으면 null. */
  window: string | null;
  /** 실행 전 찾기(실행 전 검사가 대상이 안 보여 막은 계획, src/act/track/find.ts). 없으면 null. findHeld: 찾기로 붙잡은 적이 있다(풀린 첫 명령을 폰 대화·승인 대기 동안 미룬다). */
  find: Find | null; findHeld: boolean;
  /** 사람이 계획 대상을 쓰는 중이라 첫 명령을 미루기 시작한 시각(src/act/track/use.ts waits). 아니면 null.
   *  useHeld: 쓰는 중이라 미룬 적이 있다(풀린 첫 명령을 폰 대화·승인 대기 동안 미룬다). */
  usedAt: number | null; useHeld: boolean;
}

/** at: 같은 행동 다시 계획 간격(planGapMs)을 세려고 적은 시각. */
export interface Job { decision: DecisionRecord; gen: number; abort: AbortController; at: number }

export const OPEN = new Set<ExecState>(["planned", "running", "verifying"]);
export const clsOf = (w: WorldView, id: string) => w.objects.find((o) => o.id === id)?.cls ?? id.replace(/_\d+$/, "");

/** 시간 값(TRACK_DEFAULTS 칸마다 받은 값 또는 기본값). */
export interface TrackConfig {
  repeatMs: number; visionMs: number; recheckMs: number; askMs: number; planGapMs: number; leftGapMs: number; stallMs: number; stallMax: number; offHoldMs: number; strayGapMs: number; strayMax: number;
  tellHoldMs: number; rearmMs: number; showAskMs: number;
}

/** 실행 추적의 안쪽 공유 객체: 상태와 기록·실제 폰 길, 부분(ExecutionTracker가 단다). */
export class TrackCore {
  run: Run | null = null;
  planning: Job | null = null;
  /** 계획 밖 가까이 가서 보기(판단 전 보기 B 뒤에도 모를 때, src/act/track/contents.ts idle): 명령 id peek:<번호>와 그 상태. 없으면 null. */
  idlePeek: IdlePeek | null = null;
  /** 계획 전 찾기(계획 전 검사가 대상이 안 보여 막은 판단, src/act/track/find.ts): 명령 id find:<번호>와 그 상태. 없으면 null. */
  finding: FindSlot | null = null;
  /** 계획 전 찾기에서 찾은 뒤 다시 판단 받기로 넘긴 판단 id: 그 판단으로 만든 계획은 찾기로 붙잡았던 것으로 본다(Run.findHeld). */
  foundFor: string | null = null;
  /** 계획이 끝난 뒤 충전 자리 돌아가기(src/act/track/dock.ts): 명령 id dock:<번호>와 그 상태. 없으면 null. */
  docking: DockSlot | null = null;
  /** 마지막으로 받은 판단 id(쓰는 중 지킴의 상태 줄이 붙는 판단). 없으면 null. */
  lastDecision: string | null = null;
  /** 마지막으로 기다리기·기기 단계가 시작된 시각. 그 전에 보낸 다른 행동 판단은 쓰지 않는다. */
  quietFrom = -Infinity;
  stopped = false;
  eye: { position: XZ; at: number } | null = null;
  /** 마지막으로 추정 눈(맞추기 전·다시 맞추는 중)을 받은 시각. 이보다 앞선 맞춘 눈은 지금 맞춘 것이 아니다. */
  eyeLostAt = Number.NEGATIVE_INFINITY;
  start!: Starter;
  steps!: Steps;
  approval!: Approvals;
  safety!: SafetyTracker;
  answers!: Answers;
  coach!: Coach;
  contents!: ContentsHold;
  finder!: Finder;
  use!: UseWatch;
  dock!: Dock;

  constructor(readonly o: TrackerOptions, readonly clock: { now(): number }, readonly cfg: TrackConfig) {}

  open(): Run | null {
    return this.run && OPEN.has(this.run.state) ? this.run : null;
  }

  stepOf(r: Run): AgentStep | undefined {
    return r.plan.steps[r.at];
  }

  /** 손대는 단계인가: 진행 중 계획의 집기·내려놓기 단계이거나 집은 물건을 들고 가는 중(2026-11-18 wide-mug q3). 이때 보이는 사람은 폰을 든 사람일 수 있다. */
  touching(r: Run | null = this.open()): boolean {
    if (this.stopped || !r || r.state !== "running") return false;
    const kind = this.stepOf(r)?.kind;
    return kind === "pick" || kind === "place" || r.carried.size > 0;
  }

  /** 실제 폰에 명령·질문을 띄운 계획: 진행 중이거나 승인 답을 기다리는 중. */
  shown(): (Run & { sent: PlannedCommand }) | null {
    const r = this.run;
    return !this.stopped && r && r.sent && (r.state === "running" || (r.state === "planned" && (r.asking || r.hold?.peek?.sent || r.find?.sent))) ? (r as Run & { sent: PlannedCommand }) : null;
  }

  /** 행동 중 기다리기·기기 단계인가: 그동안 판단(PAM)을 멈추고 다른 행동으로 바꾸지 않는다(src/brain/decide.ts hold). */
  waiting(): boolean {
    const r = this.run;
    const kind = r && r.state === "running" ? this.stepOf(r)?.kind : undefined;
    return !this.stopped && (kind === "wait" || kind === "device");
  }

  /** 그 계획의 그 단계가 아직 진행 중인가(늦게 온 기기 결과를 버린다). */
  live(r: Run, gen: number): boolean {
    return !this.stopped && this.run === r && r.gen === gen && r.state === "running";
  }

  /** 평면도 물건·가전을 부르는 이름(src/layout/names.ts placeName, 계획 단계 글과 같은 차례). 없으면 null(id를 사람 글에 쓰지 않는다). */
  nameOf(id: string): string | null {
    const names = this.o.names ?? {};
    return placeName(id, this.o.floor().objects.get(id)?.type, {
      ...names, layoutName: names.layoutName ?? ((x) => this.o.locate?.(x)?.label), deviceKind: names.deviceKind ?? ((x) => this.o.handDevices?.().find((d) => d.id === x)?.kind),
    });
  }

  /** 손으로 다루는 가전 이름(묻는 글·끄기 안내): 같은 이름 찾기(src/layout/names.ts)로 그 가전, 없으면 단계 대상 자리. 둘 다 없으면 「가전」. */
  handLabel(deviceId: string, target: string | null = null): string {
    return this.nameOf(deviceId) ?? (target ? this.nameOf(target) : null) ?? DEVICE_UNKNOWN;
  }

  step(r: Run, state: ExecState, text?: string): void {
    r.state = state;
    r.since = this.clock.now();
    this.emit(r.plan.view.id, state, text);
  }

  emit(planId: string, state: ExecState, text?: string, reason?: string): void {
    if (this.stopped) return;
    this.o.emit({ type: "execution", at_ms: this.clock.now(), plan_id: planId, state, text: text ?? EXEC_TEXT[state], ...(reason ? { reason } : {}) });
  }
}

/** 부분: TrackCore를 받는 작은 클래스. o·clock·cfg는 TrackCore의 것이다. */
export abstract class Part {
  constructor(protected readonly core: TrackCore) {}
  protected get o(): TrackerOptions {
    return this.core.o;
  }
  protected get clock(): { now(): number } {
    return this.core.clock;
  }
  protected get cfg(): TrackConfig {
    return this.core.cfg;
  }
}

/** 승인 질문은 승인·거절, 다시 묻기는 계속·그만, 사람 단계는 「완료」 하나, 질문은 그 답들, 알림·기다리기·기기는 없음. */
export function choicesOf(r: Run, step: AgentStep | undefined): ActionChoice[] {
  if (r.asking?.why === "again") return AGAIN;
  if (r.asking) return APPROVE;
  if (!step) return [];
  if (step.kind === "ask") return step.prompt?.choices ?? [];
  return HUMAN_KINDS.includes(step.kind) ? [STEP_DONE] : [];
}
