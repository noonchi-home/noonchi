// 집 실행 묶음의 에이전트 잇기(src/agent): 승인 기억·정책(가전 명령)·공급자·배치 보정·외부 연락·말 요청 에이전트·계획 모드·관찰 모드, 에이전트가 다룬 물건 초점.
// 승인 기억(runtime/homes/<집>/approvals.json, src/agent/approval.ts)은 집마다 하나이고 정책(가전 명령)과 실행 추적(PAM 계획)이 같이 쓴다.
// 외부 연락(call_service)은 받는 이 등록부·다시 보내기 id 파일과 함께 에이전트에 붙고, 결과는 기록 DB service 줄과 말풍선 카드(serviceSaid)에 남는다.
import { Agent, ApprovalStore, Observer, Planner, Policy, approvalsPath, createProvider, planRoundLine, planRoundText, type LlmProvider } from "../../agent/index.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { ServiceRetryStore, contactsPath, loadContacts, serviceRecord, serviceRetryPath, serviceSay } from "../../agent/index.js";
import type { TraceEvent, TraceRefs } from "../../contract/trace.js";
import { callServiceFrom } from "../../infer/call-service.js";
import type { ServiceResult } from "../../contract/service.js";
import { FOCUS_TTL_MS, focusFromActions, loadLayout, type Focus } from "../../layout/index.js";
import type { HomeCore } from "./core.js";
import { measuredTrace } from "../../shared/trace.js";

const contexts = new AsyncLocalStorage<TraceRefs>();
export const inTraceContext = <T>(refs: TraceRefs, run: () => Promise<T>): Promise<T> => contexts.run(refs, run);

function traceProvider(core: HomeCore, source: LlmProvider, event: TraceEvent): LlmProvider {
  return {
    name: source.name, model: source.model,
    createState: () => source.createState(),
    addUserMessage: (state, text) => source.addUserMessage(state, text),
    addToolResults: (state, results) => source.addToolResults(state, results),
    ...(source.addExchange ? { addExchange: (state: unknown, user: string, assistant: string) => source.addExchange!(state, user, assistant) } : {}),
    step: (state, options) => measuredTrace(core.trace, event, contexts.getStore() ?? {}, options.signal,
      () => source.step(state, options), () => "model_answer"),
  };
}

/** 정책·공급자·배치 보정을 만들고 말 요청 에이전트(외부 연락 포함)·계획 모드·관찰 모드를 잇는다. */
export function startAgent(core: HomeCore): void {
  const { ctx, twin, signals } = core;
  const { env, log, runtimeDir, history } = ctx;
  const { home } = twin;
  const approvals = new ApprovalStore(approvalsPath(runtimeDir, home.id));
  const policy = new Policy({ approvals });
  const { provider, warning } = createProvider(env);
  if (warning) log(`[경고] ${warning}`);
  // 배치 보정: 말 요청 에이전트의 배치 도구가 받는다(앱·폰 위치 맞추기·World State·계획도 같은 것을 쓴다)
  const layout = loadLayout(home, { runtimeDir, log });
  if (!layout) log(`[경고] ${home.scenePath}이 없어 배치 보정을 끕니다(twin-studio에서 집을 먼저 빌드하세요).`);
  // 들은 말(실제 폰이 들은 말 가운데 명령의 답이 아닌 말)을 기록·방송에 그대로 남길지(KEEP_HEARD_TEXT=1, 기본 꺼짐: 「들은 말 있음」만)
  const keepHeard = /^(1|true|on)$/i.test(env.KEEP_HEARD_TEXT?.trim() ?? "");
  // 외부 연락(call_service: AS센터 전화·보호자 연락): 받는 이는 등록부(runtime/homes/<집>/contacts.json)에서 정하고, 승인되면 CALL_SERVICE_URL로 보낸다.
  // 주소가 없으면 통로가 없어 부르지 않는다(연결 없음). 결과는 기록 DB service 줄(KEEP_HEARD_TEXT가 꺼져 있으면 받는 이·내용은 가림)과
  // 대시보드 말풍선 카드(SAY_DONE_MS 동안 안전 알림 다음 차례, 거절은 승인 답이라 보이지 않음)에 남긴다
  const service = callServiceFrom(env, { id: home.id, name: home.name });
  const { contacts, warning: contactsWarning } = loadContacts(contactsPath(runtimeDir, home.id));
  if (contactsWarning) log(`[경고] ${contactsWarning}`);
  const onService = (r: ServiceResult) => {
    const row = serviceRecord(r, keepHeard);
    history.write.add("service", r.atMs, row.text, { subject: row.subject, data: row.data }).catch((e: Error) => log(`[경고] 외부 연락 기록을 쓰지 못했어요: ${e.message}`));
    const text = serviceSay(r);
    if (text === null) return;
    core.serviceSaid = { text, atMs: Date.now() };
    core.speak();
  };
  // 외부 연락 id 기억(보내기 전에 남기고, 접수가 확인될 때까지 같은 내용은 같은 id로 다시 보낸다): runtime/homes/<집>/service-retry.json.
  // 다시 띄우거나 집을 바꿔도 남고, 일마다 파일을 다시 읽어 쓴다. 읽을 수 없으면 외부 연락을 막는다
  const retries = new ServiceRetryStore(serviceRetryPath(runtimeDir, home.id));
  const retriesProblem = retries.problem();
  if (retriesProblem) log(`[경고] ${retriesProblem}. 고칠 때까지 외부 연락을 하지 않습니다.`);
  // 할 일 부탁(request_task): 말 요청 에이전트가 받은 부탁을 실행 추적의 말 부탁 길로 넘긴다(afterSeq는 그때까지 보낸 마지막 PAM 요청 번호)
  const onRequest = (task: string, heard: string) => {
    const tracker = core.tracker;
    if (!tracker) return { ok: false, error: "판단·실행을 켜지 않아 할 일 부탁을 받지 못해요." };
    tracker.onRequest({ task, heard, atMs: core.nowMs(), afterSeq: core.decider?.sentSeq() ?? 0 });
    return { ok: true, message: "부탁을 받았어요. 짧게 답하세요." };
  };
  const agent = new Agent({ hub: signals, policy, rooms: twin.rooms, provider: traceProvider(core, provider, "dialog"), layout, keepHeard, service, onService, contacts, retries, onRequest });
  // 에이전트 계획 모드(src/agent/planner.ts): PAM이 고른 행동 하나를 단계 계획으로. 말 요청 에이전트와 같은 공급자.
  // 차례마다(모델 호출 하나) 시간·토큰·낸 단계·계획 검사가 버린 까닭을 서버 로그와 기록 DB(planner)에 남긴다
  const planner = new Planner({
    provider: traceProvider(core, provider, "planner"),
    onRound: (r) => {
      log(planRoundLine(r));
      history.write.add("planner", core.nowMs(), planRoundText(r), { subject: r.plan, data: r }).catch((e: Error) => log(`[경고] 계획 차례 기록을 쓰지 못했어요: ${e.message}`));
    },
  });
  // 에이전트 관찰 모드(src/agent/observer.ts): 잘 못 볼 때 가까이 보기·사람 부탁·기다리기 중 하나를 고른다. 말 요청·계획 모드와 같은 공급자
  const observer = new Observer({ provider: traceProvider(core, provider, "observer") });
  core.approvals = approvals;
  core.policy = policy;
  core.layout = layout;
  core.keepHeard = keepHeard;
  core.agent = agent;
  core.planner = planner;
  core.observer = observer;
}

/** 초점: 에이전트가 다룬 물건을 대시보드와 폰에 알린다(표시 전용). 기본으로 끈다(사용자 요청). FOCUS=1일 때만 대시보드·폰·3D에 보낸다. 앱·폰 서버를 연 뒤 부른다. */
export function watchFocus(core: HomeCore): void {
  const { env } = core.ctx;
  const appNow = core.app!;
  const sendFocus = (targets: Focus["targets"]) => {
    if (targets.length === 0) return;
    const focus: Focus = { targets, at: new Date().toISOString(), ttl_ms: FOCUS_TTL_MS };
    appNow.broadcast({ type: "focus", focus });
    core.phone?.sendFocus(targets, FOCUS_TTL_MS);
  };
  const locate = (id: string) => core.layout?.editor.center(id);
  const focusOn = /^(1|true|on)$/i.test(env.FOCUS?.trim() ?? "");
  core.unsubFocus = !focusOn ? () => {} : core.agent.subscribe((e) => {
    if (e.event === "reply") sendFocus(focusFromActions(e.actions, locate));
    else if (e.event === "confirmed" && e.ok && e.deviceId) sendFocus(focusFromActions([{ tool: "confirm", args: {}, ok: true, deviceId: e.deviceId, at: "" }], locate));
  });
}
