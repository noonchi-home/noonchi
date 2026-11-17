// 집 실행 묶음의 실제 폰 잇기(src/phone): 눈 화면(사진)·폰 위치 맞추기 준비(시작 위치·물건 기준점·벽 모양), 실제 폰 서버와 그 답(말·단추·승인), 들은 말.
// 실제 폰은 늘 듣는다: 지금 명령의 답이 아닌 말은 관찰 텍스트 한 줄로 판단 호출에 넘기고, 영상 모드 영상 폴더(phoneVideoDir)는 저장소 뿌리 기준이다.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { APPROVE } from "../../act/prompts.js";
import { EXEC_TEXT } from "../../act/labels.js";
import { matchChoice } from "../../act/tasks.js";
import { FEEDBACK_TEXT, PHOTO_TEXT, recordFeedback } from "../../brain/index.js";
import type { BrainLog } from "../../contract/events.js";
import type { ApprovalAnswer } from "../../contract/phone.js";
import { eyeHeightOf, floorLookup, homeBounds, readScenePlan } from "../../layout/index.js";
import { EyeFeed, StartStore, createPhoneServer, describeStart, estimateViewpoint, orderPhoneUrls, readStartPose, startPosePath, twinLandmarks, wallSegments, type StartPose } from "../../phone/index.js";
import { repoPath } from "../../shared/paths.js";
import { HEARD_MARK } from "../../world/labels.js";
import { PHONE_SESSION, type HomeCore } from "./core.js";

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

/** 실제 폰이 들은 말 가운데 지금 명령의 답이 아닌 말: 관찰 텍스트 한 줄로 판단 호출에 넘긴다(눈치 모드에서도).
 *  그 말 자체는 기록하지 않는다: 기록·대시보드에는 내용 없는 표시(HEARD_MARK)만 남긴다. KEEP_HEARD_TEXT=1이면 그대로 남긴다(기본 꺼짐) */
function heardSpeech(core: HomeCore, text: string): void {
  const { world, decider } = core;
  if (!world || !decider) return;
  const changes = world.heard(text, core.nowMs());
  if (!changes.length) return;
  decider.onChanges(changes);
  const event: BrainLog = { type: "world_change", at_ms: core.nowMs(), kind: "heard", text: core.keepHeard ? changes[0]!.text : HEARD_MARK };
  core.app?.broadcast({ type: "brain", event });
  core.ctx.history.brain(event);
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
    sync: { landmarks: core.landmarksNow(), walls: wallSegments(core.plan), start: startStore?.get() ?? null },
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
      try {
        const r = await agent.chat(PHONE_SESSION, text, { heard: true });
        return { reply: r.reply, pending: r.pendingConfirmations.map((p) => ({ token: p.token, deviceLabel: p.deviceLabel, reason: p.reason, choices: p.choices })) };
      } finally {
        core.talk.inflight--;
        core.talk.at = core.nowMs();
      }
    },
    // 승인 답(승인·거절): 위험 목록이라 둘 다 이번만이고 기억하지 않는다
    onConfirm: async (token, choice) => ({ reply: (await agent.confirm(token, choice)).reply }),
    onCancel: async (token) => ({ reply: agent.cancel(token).reply }),
    // 실제 폰 명령·질문의 답(「완료」·질문 답 단추, 말 「완료」「다 했어」「그만」). 답으로 맞은 것만 반성 피드백으로 남긴다(늘 듣기의 주변 말은 남기지 않는다)
    onChoice: (id, step, choice) => {
      const tracker = core.tracker;
      const open = tracker?.openCommand();
      const picked = open?.choices.find((c) => c.id === choice);
      if (open && picked && tracker?.onAnswer(id, step, choice)) {
        recordFeedback(history.db, { type: "feedback", at_ms: core.nowMs(), subject: id, text: FEEDBACK_TEXT.answer(picked.label, open.kind, open.text), data: { choice, via: "button" } });
      }
    },
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
      const heard = tracker?.onHeard(text, at) ?? null;
      if (heard?.kind === "answer") {
        if (open) recordFeedback(history.db, { type: "feedback", at_ms: core.nowMs(), subject: open.planId, text: FEEDBACK_TEXT.answer(text, open.kind, open.text), data: { choice: heard.choice.id, via: "voice" } });
        return { handled: true, reply: heard.choice.reply };
      }
      if (heard?.kind === "stale") return stale();
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
  const listened = await phone.listen(Number.isInteger(wantedPhone) && wantedPhone >= 0 ? wantedPhone : 8210, env.PHONE_HOST?.trim() || "0.0.0.0");
  // 폰 주소: PHONE_URL → tailscale serve https → 와이파이(대시보드 QR은 맨 앞 주소).
  // PHONE_LAN_URLS=0(compose)이면 이 기계 네트워크 주소를 넣지 않는다: 컨테이너 안 주소는 밖에서 열 수 없다
  const served = await (ctx.servedPhoneUrls?.(listened.port) ?? Promise.resolve([])).catch(() => []);
  const lanOff = /^(0|false|off)$/i.test(env.PHONE_LAN_URLS?.trim() ?? "");
  core.phoneUrls = orderPhoneUrls(lanOff ? [] : listened.urls, served, env.PHONE_URL);
  core.phonePort = (phone.server.address() as { port: number } | null)?.port;
}
