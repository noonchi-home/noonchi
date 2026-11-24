import { createHash, randomUUID } from "node:crypto";
import type { ClaimKind } from "../../phone/index.js";
import type { PlannedCommandMessage } from "../../contract/phone.js";
import { captionOf } from "./act.js";
// 집 실행 묶음의 실제 폰 잇기(src/phone): 눈 화면(사진)·폰 위치 맞추기 준비(시작 위치·물건 기준점·벽 모양), 실제 폰 서버와 그 답(말·단추·승인), 들은 말.
// 실제 폰은 늘 듣는다: 지금 명령의 답이 아닌 말은 관찰 텍스트 한 줄로 판단 호출에 넘기고, 영상 모드 영상 폴더(phoneVideoDir)는 저장소 뿌리 기준이다.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PROGRESS_MS } from "../../act/index.js";
import { REQUEST_TASK } from "../../agent/index.js";
import type { Body } from "../../bus/index.js";
import { APPROVE } from "../../act/prompts.js";
import { EXEC_TEXT } from "../../act/labels.js";
import { matchChoice } from "../../act/tasks.js";
import { FEEDBACK_TEXT, PHOTO_TEXT } from "../../brain/index.js";
import type { ApprovalAnswer } from "../../contract/phone.js";
import { eyeHeightOf, floorLookup, homeBounds, readScenePlan } from "../../layout/index.js";
import { EyeFeed, StartStore, createPhoneServer, describeStart, estimateViewpoint, orderPhoneUrls, readStartPose, startPosePath, twinLandmarks, wallSegments, type StartPose } from "../../phone/index.js";
import { androidTwaStatements } from "../../phone/index.js";
import { repoPath } from "../../shared/paths.js";
import { PHONE_SESSION, TALK_QUIET_MS, type HomeCore } from "./core.js";

/** 영상 모드 영상 공용 폴더(저장소 runtime/videos). 시연 폴더(RUNTIME_DIR=runtime/demo/day1·week)로 띄워도 여기서 읽는다:
 *  영상은 커서 시연 폴더마다 복사하지 않고, 시연 폴더를 지우는 준비 명령(demo-setup --fresh)이 이은 폴더를 따라 지우지 않게 정션도 쓰지 않는다. */
const SHARED_VIDEO_DIR = repoPath("runtime/videos/");
/** 영상 모드 영상 폴더: PHONE_VIDEO_DIR, 없으면 공용 runtime/videos(RUNTIME_DIR와 상관없다). */
export function phoneVideoDir(env: Record<string, string | undefined>): string {
  return env.PHONE_VIDEO_DIR?.trim() || SHARED_VIDEO_DIR;
}

/** 실제 폰 입력 준비(앱보다 먼저): 눈 화면 사진 줄, 폰 눈 높이, 방·벽, 시작 위치 저장소, 물건 기준점. 폰 서버는 앱을 연 뒤 startPhone이 연다. */
export function preparePhone(core: HomeCore): void {
  const { ctx, twin, layout } = core;
  const { env, log, runtimeDir, history } = ctx;
  const { home } = twin;
  const phoneOn = Boolean(env.PHONE_PORT?.trim());
  // 사진 이벤트는 본 서버 /events로 나간다. 앱보다 먼저 만들어 /api/eye/*를 앱에 넘기므로 broadcast는 나중에 잇는다
  const feed = phoneOn
    ? new EyeFeed({
      photoDir: env.PHONE_PHOTO_DIR?.trim() || join(runtimeDir, "photos"), broadcast: (m) => core.app?.broadcast(m),
      // 사진 찍기 사진은 보관 기간이 지나면 지운다(src/brain/history/retention.ts)
      onSaved: (p) => {
        history.db.addPhoto({ ...p, origin: "photo" });
        history.db.add("photo", p.atMs, PHOTO_TEXT.saved, { subject: p.id });
      },
    })
    : undefined;
  // 폰 위치 맞추기(src/phone/sync): 시작 위치(설정 4단계에서 자리·방향) + 물건 기준점(엔진 프레임 YOLO) + 벽 모양(hit 벽 점)
  const eyeHeightM = eyeHeightOf(env.PHONE_EYE_HEIGHT_M);
  // 방·벽(시작 위치 범위·방 검사, 방 바닥 높이, 벽 모양 짝). scene.json이 없거나 깨졌으면 빈 목록
  const plan = readScenePlan(home.scenePath);
  const bounds = homeBounds(plan.rooms);
  const startPath = startPosePath(runtimeDir, home.id);
  let savedStart: StartPose | null = null;
  try {
    savedStart = readStartPose(startPath);
  } catch (e) {
    log(`[경고] ${(e as Error).message}. 시작 위치 없이 시작합니다.`);
  }
  const twinObjects = () => layout?.editor.objects() ?? [];
  const startStore = existsSync(home.scenePath)
    ? new StartStore(startPath, bounds, (p, yaw) => describeStart(twinObjects(), plan.rooms, p, yaw), (s) => core.phone?.setStart(s), savedStart, plan.rooms)
    : undefined;
  const landmarksNow = () => (layout ? twinLandmarks(layout.editor.objects(), layout.catalog) : []);
  // 「냉장고 여기로」처럼 배치를 고치면 기준점 자리도 바꾼다
  layout?.editor.subscribe(() => core.phone?.setLandmarks(landmarksNow()));
  core.phoneOn = phoneOn;
  core.feed = feed;
  core.eyeHeightM = eyeHeightM;
  core.plan = plan;
  core.startStore = startStore;
  core.landmarksNow = landmarksNow;
}

/** 실제 폰 세션의 지금 승인 대기 목록(폰에 보내는 모양). */
function phonePending(core: HomeCore) {
  return core.agent.pending(PHONE_SESSION).map((p) => ({ token: p.token, deviceLabel: p.deviceLabel, reason: p.reason, choices: p.choices }));
}

/** 승인 토큰 자체는 통로로 보내지 않는다. 실제 폰에서 보이는 첫 카드만 시간을 센다. */
export function syncPhoneClaims(core: HomeCore): void {
  if (!core.out.phone || core.closed) return;
  const now = core.nowMs();
  const next = new Map<string, ClaimKind>();
  const tokens = phonePending(core);
  for (const p of tokens) next.set("approval:" + createHash("sha256").update(p.token).digest("hex"), "approval");
  if (core.talk.inflight || now - core.talk.at < TALK_QUIET_MS) next.set("dialog", "dialog");
  const cmd = core.command;
  if (cmd) {
    const kind = cmd.grade === "safety" ? "safety" : /^(peek|find|visit):/.test(cmd.id) ? "peek" : "plan";
    next.set("command:" + cmd.id + ":" + cmd.step, kind);
  }
  core.policy.visibleApprovals(tokens.map((p) => p.token), cmd?.grade === "safety" ? null : tokens[0]?.token ?? null, cmd?.grade === "safety");
  for (const [id, kind] of next) {
    if (core.phoneClaims.get(id) === kind) continue;
    // 같은 ms에 생긴 승인도 실제 폰 카드에 추가된 차례를 지킨다.
    core.claimStamp = Math.max(now, core.claimStamp + 0.01);
    core.out.phone.push("/phone/claim", { claim_id: id, kind, since_ms: core.claimStamp });
  }
  for (const id of core.phoneClaims.keys()) {
    if (!next.has(id)) core.out.phone.push("/phone/claim", { claim_id: id, kind: null, since_ms: now });
  }
  core.phoneClaims = next;
}

/** 실제 폰이 들은 말 가운데 지금 명령의 답이 아닌 말: 관찰 텍스트 한 줄로 판단 호출에 넘긴다(눈치 모드에서도).
 *  그 말 자체는 기록하지 않는다: 기록·대시보드에는 내용 없는 표시(HEARD_MARK)만 남긴다. KEEP_HEARD_TEXT=1이면 그대로 남긴다(기본 꺼짐) */
function heardSpeech(core: HomeCore, text: string): void {
  if (!core.out.phone || !core.decider) return;
  // 집 상태 노드가 heard 변화로 넣고, 거울이 판단에 넘기고 기록에는 표시만 남긴다(src/server/home/observe.ts routeWorldChanges). 차례대로, 실패하면 같은 봉투로 다시
  core.out.phone.push("/phone/heard", { text, observed_ms: core.nowMs() });
}

/** 버튼과 말의 답은 실행 노드가 지금 명령과 다시 대조한다. 승인 토큰은 폰 세션 밖으로 보내지 않는다. */
export function applyPhoneProgress(core: HomeCore, b: Body<"/phone/progress">): Body<"/act/progress_result"> {
  const req = b.req;
  const tracker = core.tracker;
  if (core.closed || !tracker) return { req, status: "stale" };
  const preferenceReply = b.kind === "voice" ? core.resumeProactive?.(b.text, req) : null;
  if (preferenceReply) return { req, status: "answer", reply: preferenceReply };
  const open = tracker.openCommand();
  const at = b.kind === "voice" && b.at ? { ...b.at, pending: [] } : undefined;
  const before = core.speechOrder;
  const heard = b.kind === "voice" ? tracker.onHeard(b.text, at) : null;
  const button = b.kind === "button" && open ? open.choices.find((c) => c.id === b.choice) : undefined;
  const picked = b.kind === "button"
    ? (button && tracker.onAnswer(b.plan_id, b.step, b.choice) ? button : null)
    : (heard?.kind === "answer" ? heard.choice : null);
  if (!picked) return { req, status: heard?.kind === "stale" || b.kind === "button" ? "stale" : "passed" };
  if (open) {
    const data = { choice: picked.id, via: b.kind };
    // 원문 보관을 끈 집에는 실제 답과 정확히 같은 등록 문구만 남긴다.
    const answer = b.kind === "button" ? picked.label : core.keepHeard ? b.text : picked.words.find((word) => word === b.text) ?? picked.label;
    const text = FEEDBACK_TEXT.answer(answer, open.kind, open.text);
    const feedback = { type: "feedback" as const, at_ms: core.nowMs(), subject: open.planId, text, data };
    if (core.speechOrder && before !== core.speechOrder) core.followupFeedback.set(core.speechOrder, feedback);
    else core.out.act?.push("/act/log", feedback);
  }
  return { req, status: "answer", reply: picked.reply, choice_id: picked.id };
}

async function phoneProgress(core: HomeCore, data:
  { kind: "button"; plan_id: string; step: string; choice: string } |
  { kind: "voice"; text: string; at?: Extract<Body<"/phone/progress">, { kind: "voice" }>["at"] }
): Promise<Body<"/act/progress_result">> {
  const req = randomUUID();
  if (!core.out.phone || core.closed) return { req, status: core.closed ? "stale" : "passed" };
  const waiting = core.progress.wait(req);
  if (!core.out.phone.push("/phone/progress", { ...data, req, expires_ms: core.nowMs() + PROGRESS_MS })) {
    core.progress.receive({ req, status: "stale" });
  }
  return waiting;
}

/** 실제 폰 서버를 열고(PHONE_PORT가 있을 때) 말·단추·승인 답을 실행 추적·에이전트에 잇는다. 폰 주소와 잡은 포트를 남긴다. 앱을 연 뒤 부른다. */
export async function startPhone(core: HomeCore): Promise<void> {
  const { ctx, twin, layout, agent, plans, feed, startStore } = core;
  const { env, log, history } = ctx;
  const { home } = twin;
  const appNow = core.app!;
  const observe = core.pipeline;
  const { engineHeaders } = core;
  // 맞추기 전에도 원뿔이 보이게: 창가 고정 위치 + 폰 방향(추정, 사진에는 쓰지 않음)
  const fallback = estimateViewpoint(JSON.parse(readFileSync(home.scenePath, "utf8").replace(/^﻿/, "")));
  const phone = createPhoneServer({
    eyeHeightM: core.eyeHeightM, feed, log, fallback, floorAt: floorLookup(core.plan.rooms), videoDir: phoneVideoDir(env),
    androidAssetLinks: androidTwaStatements(env.ANDROID_TWA_SHA256_FINGERPRINTS),
    sync: { landmarks: core.landmarksNow(), walls: wallSegments(core.plan), start: startStore?.get() ?? null },
    onReady: (ready) => { core.out.phone?.push("/phone/link", { ready }); },
    onNavigationPose:p=>{ if(!core.closed) core.out.phone?.push("/phone/pose",p); },
    onEye: (eye) => {
      appNow.broadcast({ type: "eye", eye });
      plans.onEye([eye.position[0], eye.position[1]], eye.estimated === true);
      core.tracker?.onEye([eye.position[0], eye.position[1]], eye.estimated === true);
    },
    // 실제 폰은 늘 듣는다: 주변 말로 가전 승인을 확정하지 않게 말 전체가 승인·거절 답일 때만 받는다(src/act/prompts.ts APPROVE)
    onSay: async (text) => {
      // 코치 계획의 사람 단계 중 들은 말(명령의 답이 아님): 관찰 모드가 지금 할 일을 다시 알리거나(told) 답하지 않으면(waited) 말 요청 에이전트를 부르지 않는다.
      // 이 일과 상관없는 말(passed)이거나 관찰 모드가 바쁘면 지금처럼 말 요청 에이전트로 넘긴다
      const at = core.tracker?.coachStep() ?? null;
      const looker = core.looker;
      if (at && looker && (await looker.heard(at.planId, at.stepId, text, at)) !== "passed") return { reply: "", pending: [] };
      // 대화를 쓰는 동안(끝난 뒤 TALK_QUIET_MS까지) 실행 추적이 끼어들지 않는다(talking)
      core.talk.inflight++;
      syncPhoneClaims(core);
      try {
        const remember = core.captureProactiveRequest?.();
        const r = await agent.chat(PHONE_SESSION, text, { heard: true });
        if (remember) {
          const tasks = new Set(r.actions.flatMap(a => a.ok && a.tool === REQUEST_TASK && typeof a.args.task === "string" ? [a.args.task] : []));
          if (tasks.size === 1) remember([...tasks][0]!);
        }
        return { reply: r.reply, pending: r.pendingConfirmations.map((p) => ({ token: p.token, deviceLabel: p.deviceLabel, reason: p.reason, choices: p.choices })) };
      } finally {
        core.talk.inflight--;
        core.talk.at = core.nowMs();
        syncPhoneClaims(core);
      }
    },
    // 승인 답(승인·거절): 위험 목록이라 둘 다 이번만이고 기억하지 않는다
    onConfirm: async (token, choice) => ({ reply: (await agent.confirm(token, choice)).reply }),
    onCancel: async (token) => ({ reply: agent.cancel(token).reply }),
    // 실제 폰 명령·질문의 답(「완료」·질문 답 단추, 말 「완료」「다 했어」「그만」). 답으로 맞은 것만 반성 피드백으로 남긴다(늘 듣기의 주변 말은 남기지 않는다)
    onChoice: (id, step, choice) => { void phoneProgress(core, { kind: "button", plan_id: id, step, choice }); },
    // 들은 말을 에이전트보다 먼저 본다(at: 말할 때 폰에 떠 있던 명령·보인 승인 대기). 「그만」은 실제 폰 명령이 없는 단계(기다리기·기기)에도 계획을 그만둔다.
    // 지금 명령의 답이고 at이 그 명령이면 그 답으로 받는다. 말할 때와 다른 명령에 온 답(늦은 답·옛 탭)이면 버린다: 들은 말로만 남기고 에이전트로 보내지 않는다.
    // 말 전체가 승인·거절 답이면 말할 때 보인 승인 대기 token이 하나이고 지금도 대기일 때만 그 하나에 답한다(agent.answerToken). 그 밖에는 버린다(answerAll 없음)
    onAnswer: async (text, at) => {
      const tracker = core.tracker;
      const open = tracker?.openCommand();
      const stale = () => {
        heardSpeech(core, text);
        history.db.add("execution", core.nowMs(), EXEC_TEXT.staleAnswer, { subject: open?.planId ?? (at?.kind === "command" ? at.id : PHONE_SESSION) });
        return { handled: true, reply: "" };
      };
      // 말로 한 승인·거절: 말할 때 보인 승인 대기 token이 하나이고 지금도 대기일 때 그 하나에만 답한다.
      // at에 승인 token이 있으면 명령(실행 추적)의 답으로 보내지 않는다(뒤에 숨은 명령 승인으로 가지 않게)
      const approval = matchChoice(text, APPROVE);
      // 답한 뒤(버린 때도) 지금 승인 대기 목록을 같이 보낸다: 단추 답처럼 끝난 질문이 폰에 남지 않게
      const byToken = async () => {
        const live = new Set(agent.pending(PHONE_SESSION).map((p) => p.token));
        const token = at?.pending.length === 1 && live.has(at.pending[0]!) ? at.pending[0]! : null;
        const reply = token ? (await agent.answerToken(token, approval!.id as ApprovalAnswer)).reply : stale().reply;
        return { handled: true, reply, pending: phonePending(core) };
      };
      if (approval && at && at.pending.length > 0) return byToken();
      const source = at?.kind === "command" ? { kind: at.kind, id: at.id, step: at.step } : at ? { kind: "none" as const } : undefined;
      const heard = await phoneProgress(core, { kind: "voice", text, at: source });
      if (heard.status === "answer") return { handled: true, reply: heard.reply };
      if (heard.status === "stale") return stale();
      if (approval) return byToken();
      heardSpeech(core, text);
      return { handled: false };
    },
    // 폰이 판본 hello로 정상이 되면 지금 승인 대기 목록을 다시 받는다
    pending: () => phonePending(core),
    ...(observe ? {
      engineMs: observe.config.engineMs,
      onEngine: (jpeg, h, eye, view, at) => {
        engineHeaders.set(jpeg, h);
        observe.onEngine(jpeg, h, eye, view, at);
      },
    } : {}),
  });
  core.phone = phone;
  layout?.editor.setHere(() => phone.here());
  const wantedPhone = ctx.phonePort ?? Number(env.PHONE_PORT);
  const listened = await phone.listen(Number.isInteger(wantedPhone) && wantedPhone >= 0 ? wantedPhone : 8210, env.PHONE_HOST?.trim() || "127.0.0.1");
  // 폰 주소: PHONE_URL → tailscale serve https → 이 PC(루프백) 주소(대시보드 QR은 맨 앞 주소)
  const served = await (ctx.servedPhoneUrls?.(listened.port) ?? Promise.resolve([])).catch(() => []);
  core.phoneUrls = orderPhoneUrls(listened.urls, served, env.PHONE_URL);
  core.phonePort = (phone.server.address() as { port: number } | null)?.port;
}

/** 로봇이 보낸 명령을 이 집의 실제 폰과 대시보드 자막에 반영한다. */
export function showPhoneCommand(core: HomeCore, m: PlannedCommandMessage): void {
  const shown = captionOf(core.command);
  if (m.type === "command") core.command = m;
  else if (!m.id || core.command?.id === m.id) core.command = null;
  // 대시보드 비전 미니맵 자막: 명령 글이 바뀔 때만(지우면 null). 승인 흐름 질문(승인·거절, 계속·그만)은 싣지 않는다(대시보드에는 승인을 보이지 않는다)
  const text = captionOf(core.command);
  if (text !== shown) core.app?.broadcast({ type: "phone_command", text });
  // 안전 명령(끄기 안내·부탁)은 실제 폰에서 승인 대기 카드보다 먼저 보인다: 가린 동안 승인 시간 제한을 멈춘다
  syncPhoneClaims(core);
  core.phone?.command(m);
  if (m.type === "command") core.speak();
}
