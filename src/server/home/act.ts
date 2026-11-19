// 집 실행 묶음의 판단·검사·실행 잇기(src/act·src/brain 판단 호출): 클로이드 계획(PlanHub), 실행 설정·수업 기록, 생각 메시지·판단 호출(PAM)·실행 추적, 보기 담당(관찰 모드).
// 판단 → 계획(에이전트 계획 모드) → 실행 전 검사 → 실행 추적이 실제 폰에 명령을 낸다. 생각 메시지는 판단 기록 뒤에 따로 만들어 대시보드로 보내고 기록 DB(thought)에 남긴다.
import { ExecutionTracker, LessonStore, Looker, PlanHub, checkDecision, checkPlan, deviceRunner, lessonsPath, loadActConfig, pamTasks } from "../../act/index.js";
import { lookTargets, taskOf, type TaskSpec } from "../../act/tasks.js";
import { deviceViews, placesOf, resubmit, type PlaceInfo, type PlanAhead, type PlanContext } from "../../agent/index.js";
import { Decider, PamClient, PersonLane, habitView, lastStoredThoughts, memoryForDay, pamSettings, storeThought, thoughtFeed, type FsmMemory } from "../../brain/index.js";
import type { BrainLog, DecisionRecord } from "../../contract/events.js";
import type { PendingGoal } from "../../contract/goal.js";
import type { HabitFsm } from "../../contract/habit.js";
import { GOAL_LOG } from "../../act/labels.js";
import type { HistoryDb } from "../../brain/index.js";
import type { WorldInput, WorldView } from "../../contract/world.js";
import type { SignalHub } from "../../devices/index.js";
import type { PlanView } from "../../contract/plan.js";
import { floorPlanFrom, loadScene, type LayoutEditor, type PlaceNames } from "../../layout/index.js";
import { Trigger, canRelink, deviceStateKeys, deviceStatus, loadTriggerConfig, type PlaneSurface } from "../../world/index.js";
import { DEVICE_STATES } from "../../world/vocab.js";
import { PHONE_SESSION, TALK_QUIET_MS, type HomeCore } from "./core.js";

/** 명령 대상·가까이 볼 자리(이름과 트윈 자리 [x, 높이, y]): 면(식탁·싱크대처럼 윗면이 있는 배치)이면 윗면 가운데(싱크볼이 있으면 윗면 높이의 싱크볼 가운데),
 *  그 밖은 배치 가운데. 배치 가운데는 싱크대면 높이 약 0.45m라, 대상을 겨눈 폰 사진에서 윗면(컵이 놓이는 곳)보다 한참 아래다.
 *  컵은 싱크볼에 넣으므로 폰 고리·가까이 보기·영상 모드 폰이 보는 곳은 조리대 가운데가 아니라 싱크볼이다. */
function placeLocator(editor: LayoutEditor | undefined, surfaces: () => PlaneSurface[]) {
  return (id: string): { label: string; position: [number, number, number] } | undefined => {
    const c = editor?.center(id);
    if (!c) return undefined;
    const top = surfaces().find((s) => s.id === id);
    const at = top?.basin?.center ?? top?.center;
    return { label: c.label, position: top && at ? [at[0], top.top, at[1]] : c.position };
  };
}

/** 가전의 지금 상태(state·status·active)는 같은 프로세스의 허브 값으로 맞춘 집 상태 보기(이력·카메라 근거는 거울 그대로).
 *  거울은 가전 노드 → 집 상태 노드를 지나 몇 ms 늦다: 켠 직후 「그만」 같은 판단이 지난 상태(꺼짐)를 보지 않게 한다. 묶음 5에서 /device/state로 바꾼다. */
function liveDevices(v: WorldView, hub: SignalHub): WorldView {
  return {
    ...v,
    devices: v.devices.map((d) => {
      const s = hub.get(d.id);
      if (!s || s.signal === "none") return d;
      const state = deviceStateKeys(d.kind, s.twin);
      return { ...d, state, status: deviceStatus(d.kind, s.twin), active: state.some((k) => DEVICE_STATES[k].active) };
    }),
  };
}

/** 실행 추적이 World State에 넣는 것(보기 지킴·따르기 창)은 /world/input으로 낸다(거울 노드 act, 집 상태 노드가 넣는다). */
function worldInput(core: HomeCore, i: WorldInput): void {
  core.out.act?.push("/world/input", i);   // 차례대로, 실패하면 같은 봉투로 다시(src/bus/outbox.ts)
}

/** 미리 세운 목표(src/act/track/goal.ts)를 보낸다: 전환은 /brain/goal_changes(RELIABLE, 녹화·재생에 하나하나), 최신 보기는 /brain/goal(STATE, 늦게 붙은 노드),
 *  대시보드에는 {type:"goal"}. 접속한 대시보드에 다시 보내려고 마지막 것을 둔다. 거울 노드(act)의 차례대로 보내기 줄로 낸다(src/bus/outbox.ts). */
export function publishGoal(core: Pick<HomeCore, "out" | "app" | "goal">, g: PendingGoal): void {
  core.goal = g;
  core.out.act?.push("/brain/goal_changes", { goal: g });
  core.out.act?.push("/brain/goal", { goal: g });
  core.app?.broadcast({ type: "goal", goal: g });
}

/** 습관 FSM 그림 자료(src/brain/habit.ts)를 보낸다: 판본이 바뀔 때만 대시보드로 {type:"habit"}을 보내고, 접속한 대시보드에 다시 보내려고 마지막 것을 둔다. */
export function publishHabit(core: { app?: { broadcast(m: unknown): void } | null; habit: HabitFsm | null }, h: HabitFsm): void {
  if (core.habit?.version === h.version) return;
  core.habit = h;
  core.app?.broadcast({ type: "habit", habit: h });
}

/** 목표 전환 한 줄: 바로 앞 상태(같은 목표)와 견줘 무엇이 바뀌었는지(세움·미리 만들기·사람 떠남·씀·버림). */
function goalLine(prev: PendingGoal | null, g: PendingGoal): string {
  if (g.status === "dropped") return g.error ? GOAL_LOG.dropPlan(g.error) : GOAL_LOG.dropped(GOAL_LOG.why[g.reason ?? "stale"]);
  if (g.status === "used") return GOAL_LOG.used;
  if (!prev) return GOAL_LOG.armed(g.action);
  if (g.status === "fired" && prev.status !== "fired") return GOAL_LOG.fired;
  if (g.prep !== prev.prep && g.prep !== "waiting") return g.prep === "failed" && g.error ? GOAL_LOG.failedWhy(g.error) : GOAL_LOG[g.prep];
  return GOAL_LOG.armed(g.action);
}

/** 미리 세운 목표 전환을 기록 DB goal 줄로 남기는 것(영상 판정 시각표 「목표」 줄, 반성 입력이 아니다).
 *  data: 상태·미리 만들기·버린 종류(drop)·물건과, 까닭 글이 있으면 reason(실행 기록 「계획이 맞지 않아 버림」의 reason과 같은 칸). */
export function goalRecorder(db: Pick<HistoryDb, "add">): (g: PendingGoal, atMs: number) => void {
  let last: PendingGoal | null = null;
  return (g, atMs) => {
    const prev = last?.id === g.id ? last : null;
    last = g;
    db.add("goal", atMs, goalLine(prev, g), { subject: g.id, data: { status: g.status, prep: g.prep, drop: g.reason, object: g.object, ...(g.error ? { reason: g.error } : {}) } });
  };
}

/** 클로이드 계획(src/act/hub.ts): 장면·평면도·부르는 이름과 계획 묶음(PlanHub). 계획 방송은 대시보드·기록·말풍선 카드로 간다. */
export function startPlans(core: HomeCore): void {
  const { ctx, twin, layout } = core;
  const { history } = ctx;
  const { home } = twin;
  // 클로이드 계획(src/act/hub.ts): 에이전트 기기 행동·맞춘 눈 → 계획을 /events로. 경로는 서버 장면(scene.json + 도면 설비)으로 찾는다
  const scene = loadScene(home);
  const floorPlan = floorPlanFrom(scene ?? {});
  // 계획 입력의 평면도 물건(벽·바닥·문·창은 뺀다): 배치 이름과 부를 짧은 이름(종류 짧은 이름 → 카탈로그 종류 이름 → 배치 이름)
  // 부르는 이름 자료(src/layout/names.ts): 카탈로그 종류 이름과 배치 이름. 계획 단계·실행 추적·비전 상태 줄이 같은 것을 쓴다
  const placeNames: PlaceNames = { typeLabel: (t) => layout?.editor.typeLabel(t), layoutName: (id) => layout?.editor.center(id)?.label };
  const places = (): PlaceInfo[] => placesOf(floorPlan, placeNames);
  // 대시보드 말풍선 카드(src/act/say.ts): 계획 방송·실제 폰 명령·World State 바뀜·판단 타이머 뒤에 다시 보고, 글이 바뀔 때만 보낸다
  const plans = new PlanHub(floorPlan, (m) => {
    core.app?.broadcast(m);
    if (m.type === "plan" && m.plan) history.plan(m.plan);
    core.speak();
  });
  core.scene = scene;
  core.floorPlan = floorPlan;
  core.placeNames = placeNames;
  core.places = places;
  core.plans = plans;
}

/** 실행 설정(STALE_MS, 틀린 값이면 시작을 막는다)과 수업 기록(코치 계획의 잘한 단계 말 줄이기, runtime/homes/<집>/lessons.json). */
export function prepareAct(core: HomeCore): void {
  const { env, runtimeDir } = core.ctx;
  core.act = loadActConfig(env);
  core.lessons = new LessonStore(lessonsPath(runtimeDir, core.twin.home.id));
}

/** 생각 메시지·판단 호출(PAM)·실행 추적을 잇는다(관찰 흐름이 있을 때). 판단·실행 기록을 보내는 emit을 돌려준다. */
export function startAct(core: HomeCore): (event: BrainLog) => void {
  const { ctx, twin, signals, policy, approvals, planner, plans, lessons, placeNames, layout } = core;
  const { env, history } = ctx;
  const { home } = twin;
  const now = () => core.nowMs();
  // 집 상태는 거울(가장 새 /world/state)로 읽고 가전 지금 상태는 허브 값으로 맞춘다. 노드는 실행 추적을 만든 뒤 띄우고 첫 상태를 받은 뒤에 판단·실행이 돈다
  const view = () => liveDevices(core.view()!, signals);
  // 메시지 상자 문장은 모델 없이 판단 기록의 사실로만 만든다(src/brain/thought.ts). 다시 띄우면 이 집의 최근 메시지(10분 안)로 시작한다
  const feed = thoughtFeed({
    send: (m) => core.app?.broadcast(m),
    record: (m) => storeThought(history.db, home.id, m), seed: lastStoredThoughts(history.db, home.id, Date.now()),
  });
  core.thoughts = feed;
  const emit = (event: BrainLog) => {
    if (event.type === "decision") core.lastDecision = event;
    // 판단이 PAM에 보낸 기억(판본)의 습관 FSM 그림: 판단 기록보다 먼저, 판본이 바뀔 때만
    const habit = event.type === "decision" ? core.decider?.habit() : null;
    if (habit && habit.kind === "fsm" && "states" in habit.memory) publishHabit(core, habitView(habit.memory, habit.version));
    core.app?.broadcast({ type: "brain", event });
    history.brain(event);
    if (event.type === "decision") feed.decision(event);
    // 실행 기록: 기다리던 화살표의 행동이 시작되면 판단의 직전 상태를 넘긴다(src/brain/decide.ts onExecution)
    if (event.type === "execution") core.decider?.onExecution(event.plan_id, event.state);
  };
  // 판단 호출(src/brain/decide.ts): World State 관찰 텍스트 + 기억 + 행동 목록으로 PAM(src/brain/pam/)을 부른다.
  // 기억은 그날 처음 정한 판본(src/brain/history/reflect.ts). 관찰 텍스트 시각은 기록 DB와 같은 시간대
  const pamTimeout = Number(env.PAM_TIMEOUT_MS);
  const decide = new Decider({
    pam: new PamClient({ settings: pamSettings(env), timeoutMs: Number.isFinite(pamTimeout) && pamTimeout > 0 ? pamTimeout : undefined }),
    // 행동 목록은 지금 모드를 따르고(들은 말이 있으면 말로 부탁한 코치 행동도), 판단 기록의 모드는 그 판단 뒤의 지금 모드다(src/act/mode.ts)
    world: { view }, trigger: new Trigger(loadTriggerConfig(env), now()), tasks: (heard) => pamTasks(core.mode(), heard), mode: (action) => core.mode(action),
    memory: () => memoryForDay(history.db, history.db.dayOf(now()), { log: ctx.log }), emit, offsetMinutes: history.db.offsetMinutes, clock: ctx.brain?.clock,
    // 행동 중 기다리기·기기 단계 동안은 PAM을 부르지 않는다(실행 추적이 조건을 본다)
    hold: () => (core.tracker?.waiting() ?? false) || (core.tracker?.coaching() ?? false),
    keepHeard: () => core.keepHeard,
    // 판단 → 시간 줄 사람 줄 → 계획 → 실행 전 검사 → 실행 추적(src/act/)
    onDecision: (d) => {
      core.person?.onDecision(d);
      core.tracker?.onDecision(d);
    },
  });
  core.decider = decide;
  // 시간 줄 사람 줄(src/brain/person.ts): 판단의 PAM 답 상태와 판단 사이 World State 하는 일(판단이 쓰는 기억으로)로 지금 사람 상태를 갖고 바뀔 때만 대시보드로 보낸다
  core.person = new PersonLane({
    emit: (m) => core.app?.broadcast(m),
    memory: () => {
      const h = decide.habit();
      return h && h.kind === "fsm" && "states" in h.memory ? (h.memory as FsmMemory) : null;
    },
  });
  // 실행 전 검사(src/act/check.ts): 시험 모드에서는 짝지은 실제 가전 단계를 막는다
  const deviceSteps = (p: PlanView) => p.steps.flatMap((s) => (s.target?.deviceId
    ? [{ deviceId: s.target.deviceId, paired: signals.sources()[s.target.deviceId]?.kind === "thinq" }] : []));
  // 기기 단계(src/act/devices.ts): 말 요청과 같은 기기 도구·정책(위험 목록은 승인 토큰). 보내기 바로 앞에서 그 계획 단계가 아직인지 본다
  const devices = deviceRunner(signals, policy, twin.rooms);
  // 명령 대상 자리는 배치(면이면 윗면 가운데, 싱크볼이 있으면 싱크볼)에서
  const placeAt = placeLocator(layout?.editor, core.surfaces);
  const recordGoal = goalRecorder(history.db);
  // 계획 입력: 계획 모드·미리 만든 계획 다시 내기가 같은 맥락을 쓴다(이미 치운 물건 placed는 그때 것)
  const planCtx = (d: DecisionRecord, task: TaskSpec, ahead?: PlanAhead): PlanContext => ({
    decision: d, task, world: view(), floor: plans.floor(), places: core.places(), names: placeNames, rooms: twin.rooms, devices: deviceViews(signals), nowIso: new Date(now()).toISOString(),
    placed: new Map(core.tracker?.placed() ?? []), ...(task.coach ? { lesson: lessons.get(task.name) } : {}), ...(ahead ? { ahead } : {}),
  });
  core.tracker = new ExecutionTracker({
    plans, floor: () => plans.floor(), world: view, emit, clock: ctx.brain?.clock, approvals, devices, offsetMinutes: history.db.offsetMinutes,
    // 말 부탁(request_task·묻기 답): 그때까지 보낸 마지막 PAM 요청 번호로 앞선 PAM 판단을 가르고, 만든 판단은 판단 기록으로 남긴다
    sentSeq: () => decide.sentSeq(), onSpeech: (d) => decide.logSpeech(d), onRefused: (planId) => decide.onRefused(planId),
    // 계획 전 검사(LLM 없음) → 에이전트 계획 모드 한 번. 손 자리는 맞춘 눈(PlanHub 평면도의 로봇 자리)
    // 실행 추적이 놓기 단계를 끝낸 물건(placed)도 이미 치운 것으로 본다
    precheck: (d) => checkDecision({ decision: d, tasks: d.tasks ?? pamTasks(core.mode(), false), world: view(), nowMs: now(), placed: core.tracker?.placed() }),
    // 계획 입력·제출 검사도 이미 치운 물건(placed, 이 계획을 만들 때 것)을 안다: 입력 줄에 「이미 치움」, 그 물건을 대상으로 한 계획은 버린다
    planner: (d, signal, ahead) => {
      const task = taskOf(d.action);
      if (!task) return { ok: false, error: "행동 목록에 없는 행동" };
      return planner.plan(planCtx(d, task, ahead), signal);
    },
    // 미리 세운 목표(src/act/track/goal.ts): PAM이 쓰는 습관 기억(마지막 판단 때 판본)과 마지막으로 맞은 상태로 목표를 세우고, 미리 만든 계획은 PAM 판단으로 다시 검사해 쓴다.
    // 목표는 /brain/goal_changes·/brain/goal과 대시보드로 보내고, 사람이 떠나면 판단을 다음 타이머(250ms)에 바로 부른다
    habit: () => decide.habit(),
    reuse: (d, plan, rename) => {
      const task = taskOf(d.action);
      return task ? resubmit(plan, planCtx(d, task), rename) : { ok: false, error: "행동 목록에 없는 행동" };
    },
    // 컵이 놓이기 전 미리 만들 때 사람 곁 면을 다 쓰고 둘 자리로 본다(goal.ts useSpot)
    surfaces: core.surfaces,
    onGoal: (g) => {
      publishGoal(core, g);
      recordGoal(g, now());
    },
    nudge: () => decide.nudge(),
    // 실제 폰 명령(src/contract/phone.ts). 폰 서버가 지금 명령을 기억해 새로 붙은 폰에도 보낸다. 명령 대상 자리는 배치(면이면 윗면 가운데)에서
    toPhone: (m) => {
      const shown = core.command?.text ?? null;
      if (m.type === "command") core.command = m;
      else if (!m.id || core.command?.id === m.id) core.command = null;
      // 대시보드 비전 미니맵 자막: 명령 글이 바뀔 때만(지우면 null)
      const text = core.command?.text ?? null;
      if (text !== shown) core.app?.broadcast({ type: "phone_command", text });
      // 안전 명령(끄기 안내·부탁)은 실제 폰에서 승인 대기 카드보다 먼저 보인다: 가린 동안 승인 시간 제한을 멈춘다
      policy.pause(core.command?.grade === "safety");
      core.phone?.command(m);
      if (m.type === "command") core.speak();
    },
    locate: placeAt, names: placeNames,
    // 계획 검사에서 버린 계획의 까닭 등은 서버 로그에도 남긴다
    log: ctx.log,
    // 처음 하는 일 묻기: 시험이 켜 볼 때만 넘긴다(기본 src/agent/approval.ts ASK_FIRST_TIME 끔)
    askFirst: ctx.askFirst,
    // 계획이 끝나면 사용자 위치를 확인하고 이 집의 충전 자리(장면과 함께 읽은 dock.json)로 돌아간다
    dock: () => core.scene?.dock ?? null,
    check: (d, p, seenSince) => checkPlan({
      decision: d, tasks: d.tasks ?? pamTasks(core.mode(), false), plan: p, world: view(), nowMs: now(), staleMs: core.act.staleMs, mode: ctx.mode?.() ?? "test", deviceSteps: deviceSteps(p),
      placed: core.tracker?.placed(), ...(seenSince !== undefined ? { seenSince } : {}),
    }),
    lessons,
    // 손으로 켜는 단계가 위험 목록 가전인지(켜기 전에 묻는다)와 묻는 글의 가전 이름
    handDevices: () => deviceViews(signals),
    // 판본이 맞는 실제 폰이 붙어 있는가: 폰이 필요한 계획만 그때 시작한다(폰 서버를 켜지 않았으면 늘 붙어 있다고 본다)
    phoneReady: () => core.phone?.ready() ?? true,
    // 다른 계획이 도는 동안 줄에서 기다리는 끄기 안내: 명령 줄을 바꾸지 않고 붙은 폰에 소리로만 알린다
    sayAloud: (text) => core.phone?.reply(text, "safety"),
    // 멈춘 집기·놓기 단계는 보기 담당(관찰 모드 A)에 알린다
    stalled: (s) => core.looker?.stalled(s) ?? false,
    // 내용물 보류(src/act/track/contents.ts): 가까이 보기는 보기 담당이 한 번에 하나
    lookContents: (h) => core.looker?.contents(h) ?? false,
    // 가까이 가서 보기: 위에서 비추기가 끝났는가(관찰 흐름), 위에서 비추는 동안 그 컵의 보기 지킴(World State)
    topReady: (id, sinceMs) => core.pipeline?.topReady(id, sinceMs) ?? false,
    // 찾기(src/act/track/find.ts): 비추기가 끝났는가(가까이 보기와 같은 프레임 고르기), 실행 전 찾기의 신선도는 실행 전 검사의 낡음 기준
    spotReady: (at, sinceMs) => core.pipeline?.spotReady(at, sinceMs) ?? false, staleMs: core.act.staleMs,
    // 찾기 상태 줄은 생각 말풍선에 모델 없이 바로 올린다
    thought: (text, decisionId) => feed.note(text, decisionId),
    guardObject: (id, on) => worldInput(core, { kind: "guard", id, on, at_ms: now() }),
    // 지금 단계가 보는 물건(집기·놓기·들고 감): 집 상태 노드가 VLM 식별에 쓴다(/world/input focus)
    focusObject: (id, f) => worldInput(core, { kind: "focus", id, focus: f ?? null, at_ms: now() }),
    // 찾기가 겨눈 자리의 같은 무리 물건을 계획 대상으로 잇는다(/world/input link). 잇는지는 집 상태와 같은 규칙(canRelink)으로 지금 보기에서 바로 답한다
    linkObject: (from, to) => {
      const objects = view().objects;
      if (!canRelink(objects.find((o) => o.id === from), objects.find((o) => o.id === to))) return false;
      worldInput(core, { kind: "link", from, to, at_ms: now() });
      return true;
    },
    // 따르기 단계 동안 그 컵의 창(그 뒤 사진만, 다 이어진 값이 확인 값을 바꿈)
    contentsAction: (id, on) => worldInput(core, { kind: "contents", id, on, at_ms: now() }),
    // 실제 폰의 승인 대기와 폰 대화 사용(실행 추적이 그동안 사람을 움직이게 하지 않는다)
    approvalsWaiting: () => core.agent.pending(PHONE_SESSION).length > 0,
    talking: () => core.talk.inflight > 0 || now() - core.talk.at < TALK_QUIET_MS,
    // 지금 모드의 행동 목록(쓰는 중 지킴·내용물 보류가 볼 행동)
    tasks: () => pamTasks(core.mode(), false),
    // 코치 계획 중 다른 행동을 본 것 같으면 보기 담당(관찰 모드 계기 off_track)에 알린다
    strayed: (s) => core.looker?.strayed(s) ?? false,
  });
  return emit;
}

/** 보기 담당(src/act/look.ts): 멈춘 단계(A)와 판단 전 보기(B)에 관찰 모드를 한 번에 하나 부르고 고른 도구를 실행한다. 관찰 흐름을 연 뒤 부른다. */
export function startLooker(core: HomeCore, emit: (event: BrainLog) => void): void {
  const { ctx, observer } = core;
  const observed = core.pipeline!;
  const tracking = core.tracker!;
  const now = () => core.nowMs();
  core.looker = new Looker({
    observer, closer: (spot, signal, sinceMs) => observed.closer(spot, signal, sinceMs), topLook: (spot, sinceMs, signal) => observed.topLook(spot, sinceMs, signal),
    // B가 잘라 본 컵: 실행 추적이 계획 밖으로 가까이 가서 볼지 본다
    looked: (id) => tracking.lookedIdle(id),
    frame: () => observed.latest(), world: () => liveDevices(core.view()!, core.signals),
    tell: (planId, stepId, mode) => tracking.tell(planId, stepId, mode), emit, targets: lookTargets, placed: () => tracking.placed(), clock: ctx.brain?.clock,
    onLook: (spot) => {
      core.lookSay = { place: spot.label, atMs: Date.now() };
      core.speak();
    },
  });
}
