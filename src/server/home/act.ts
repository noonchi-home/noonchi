// 집 실행 묶음의 판단·검사·실행 잇기(src/act·src/brain 판단 호출): 클로이드 계획(PlanHub), 실행 설정·수업 기록, 생각 메시지·판단 호출(PAM)·실행 추적, 보기 담당(관찰 모드).
// 판단 → 계획(에이전트 계획 모드) → 실행 전 검사 → 실행 추적이 실제 폰에 명령을 낸다. 생각 메시지는 판단 기록 뒤에 따로 만들어 대시보드로 보내고 기록 DB(thought)에 남긴다.
import { ExecutionTracker, LessonStore, Looker, PlanHub, checkDecision, checkPlan, deviceRunner, lessonsPath, loadActConfig } from "../../act/index.js";
import { lookTargets, taskOf, tasksFor } from "../../act/tasks.js";
import { deviceViews, placesOf, type PlaceInfo } from "../../agent/index.js";
import { Decider, PamClient, ThoughtWriter, lastStoredThoughts, memoryForDay, storeThought, thoughtFeed } from "../../brain/index.js";
import type { BrainLog } from "../../contract/events.js";
import type { PlanView } from "../../contract/plan.js";
import { loadEndpoints } from "../../infer/endpoints.js";
import { createInference } from "../../infer/inference.js";
import { floorPlanFrom, loadScene, type LayoutEditor, type PlaceNames } from "../../layout/index.js";
import { Trigger, loadTriggerConfig, type PlaneSurface } from "../../world/index.js";
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
  const world = core.world!;
  const now = () => core.nowMs();
  // 판단·계획은 메시지를 기다리지 않는다: 판단 기록을 보낸 뒤 부르고, 새 메시지가 오면 보낸다. 다시 띄우면 이 집의 최근 메시지(10분 안)로 시작한다
  const feed = thoughtFeed({
    writer: new ThoughtWriter({ chat: createInference(env).thought }), send: (m) => core.app?.broadcast(m),
    record: (m) => storeThought(history.db, home.id, m), seed: lastStoredThoughts(history.db, home.id, Date.now()),
  });
  core.thoughts = feed;
  const emit = (event: BrainLog) => {
    if (event.type === "decision") core.lastDecision = event;
    core.app?.broadcast({ type: "brain", event });
    history.brain(event);
    if (event.type === "decision") feed.decision(event);
  };
  // 판단 호출(src/brain/decide.ts): World State 관찰 텍스트 + 기억 + 행동 목록으로 PAM 서비스를 부른다.
  // 기억은 그날 처음 정한 판본(src/brain/history/reflect.ts). 관찰 텍스트 시각은 기록 DB와 같은 시간대
  const pamTimeout = Number(env.PAM_TIMEOUT_MS);
  const decide = new Decider({
    pam: new PamClient({ url: loadEndpoints(env).pamUrl, timeoutMs: Number.isFinite(pamTimeout) && pamTimeout > 0 ? pamTimeout : undefined }),
    world, trigger: new Trigger(loadTriggerConfig(env), now()), tasks: () => tasksFor(core.assist()),
    memory: () => memoryForDay(history.db, history.db.dayOf(now())), emit, offsetMinutes: history.db.offsetMinutes, clock: ctx.brain?.clock,
    // 행동 중 기다리기·기기 단계 동안은 PAM을 부르지 않는다(실행 추적이 조건을 본다)
    hold: () => (core.tracker?.waiting() ?? false) || (core.tracker?.coaching() ?? false),
    keepHeard: () => core.keepHeard,
    // 판단 → 계획 → 실행 전 검사 → 실행 추적(src/act/)
    onDecision: (d) => core.tracker?.onDecision(d),
  });
  core.decider = decide;
  // 실행 전 검사(src/act/check.ts): 시험 모드에서는 짝지은 실제 가전 단계를 막는다
  const deviceSteps = (p: PlanView) => p.steps.flatMap((s) => (s.target?.deviceId
    ? [{ deviceId: s.target.deviceId, paired: signals.sources()[s.target.deviceId]?.kind === "thinq" }] : []));
  // 기기 단계(src/act/devices.ts): 말 요청과 같은 기기 도구·정책(위험 목록은 승인 토큰). 보내기 바로 앞에서 그 계획 단계가 아직인지 본다
  const devices = deviceRunner(signals, policy, twin.rooms);
  // 명령 대상 자리는 배치(면이면 윗면 가운데, 싱크볼이 있으면 싱크볼)에서
  const placeAt = placeLocator(layout?.editor, core.surfaces);
  core.tracker = new ExecutionTracker({
    plans, floor: () => plans.floor(), world: () => world.view(now()), emit, clock: ctx.brain?.clock, approvals, devices, offsetMinutes: history.db.offsetMinutes,
    // 계획 전 검사(LLM 없음) → 에이전트 계획 모드 한 번. 손 자리는 맞춘 눈(PlanHub 평면도의 로봇 자리)
    // 실행 추적이 놓기 단계를 끝낸 물건(placed)도 이미 치운 것으로 본다
    precheck: (d) => checkDecision({ decision: d, tasks: d.tasks ?? tasksFor(core.assist()), world: world.view(now()), nowMs: now(), placed: core.tracker?.placed() }),
    // 계획 입력·제출 검사도 이미 치운 물건(placed, 이 계획을 만들 때 것)을 안다: 입력 줄에 「이미 치움」, 그 물건을 대상으로 한 계획은 버린다
    planner: (d, signal) => {
      const task = taskOf(d.action);
      if (!task) return { ok: false, error: "행동 목록에 없는 행동" };
      return planner.plan({
        decision: d, task, world: world.view(now()), floor: plans.floor(), places: core.places(), names: placeNames, rooms: twin.rooms, devices: deviceViews(signals), nowIso: new Date(now()).toISOString(),
        placed: new Map(core.tracker?.placed() ?? []), ...(task.coach ? { lesson: lessons.get(task.name) } : {}),
      }, signal);
    },
    // 실제 폰 명령(src/contract/phone.ts). 폰 서버가 지금 명령을 기억해 새로 붙은 폰에도 보낸다. 명령 대상 자리는 배치(면이면 윗면 가운데)에서
    toPhone: (m) => {
      if (m.type === "command") core.command = m;
      else if (!m.id || core.command?.id === m.id) core.command = null;
      // 안전 명령(끄기 안내·부탁)은 실제 폰에서 승인 대기 카드보다 먼저 보인다: 가린 동안 승인 시간 제한을 멈춘다
      policy.pause(core.command?.grade === "safety");
      core.phone?.command(m);
      if (m.type === "command") core.speak();
    },
    locate: placeAt, names: placeNames,
    check: (d, p) => checkPlan({
      decision: d, tasks: d.tasks ?? tasksFor(core.assist()), plan: p, world: world.view(now()), nowMs: now(), staleMs: core.act.staleMs, mode: ctx.mode?.() ?? "test", deviceSteps: deviceSteps(p),
      placed: core.tracker?.placed(),
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
    guardObject: (id, on) => world.guard(id, now(), on),
    focusObject: (id, f) => world.focus(id, f ?? null),
    linkObject: (from, to) => world.relink(from, to, now()),
    // 따르기 단계 동안 그 컵의 창(그 뒤 사진만, 다 이어진 값이 확인 값을 바꿈)
    contentsAction: (id, on) => { world.contentsAction(id, now(), on); },
    // 실제 폰의 승인 대기와 폰 대화 사용(실행 추적이 그동안 사람을 움직이게 하지 않는다)
    approvalsWaiting: () => core.agent.pending(PHONE_SESSION).length > 0,
    talking: () => core.talk.inflight > 0 || now() - core.talk.at < TALK_QUIET_MS,
    // 이번 판단에 보내는 행동 목록
    tasks: () => tasksFor(core.assist()),
    // 코치 계획 중 다른 행동을 본 것 같으면 보기 담당(관찰 모드 계기 off_track)에 알린다
    strayed: (s) => core.looker?.strayed(s) ?? false,
  });
  return emit;
}

/** 보기 담당(src/act/look.ts): 멈춘 단계(A)와 판단 전 보기(B)에 관찰 모드를 한 번에 하나 부르고 고른 도구를 실행한다. 관찰 흐름을 연 뒤 부른다. */
export function startLooker(core: HomeCore, emit: (event: BrainLog) => void): void {
  const { ctx, observer } = core;
  const world = core.world!;
  const observed = core.pipeline!;
  const tracking = core.tracker!;
  const now = () => core.nowMs();
  core.looker = new Looker({
    observer, closer: (spot, signal, sinceMs) => observed.closer(spot, signal, sinceMs), topLook: (spot, sinceMs, signal) => observed.topLook(spot, sinceMs, signal),
    // B가 잘라 본 컵: 실행 추적이 계획 밖으로 가까이 가서 볼지 본다
    looked: (id) => tracking.lookedIdle(id),
    frame: () => observed.latest(), world: () => world.view(now()),
    askPerson: (planId, stepId, spot) => tracking.askCloser(planId, stepId, spot), tell: (planId, stepId, mode) => tracking.tell(planId, stepId, mode), emit, targets: lookTargets, placed: () => tracking.placed(), clock: ctx.brain?.clock,
    onLook: (spot) => {
      core.lookSay = { place: spot.label, atMs: Date.now() };
      core.speak();
    },
  });
}
