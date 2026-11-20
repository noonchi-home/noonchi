import { ExecutionTracker, type TrackerOptions } from "../../src/act/track/tracker.js";

/** 시험에서 바꿀 입력만 골라 실제 실행 노드의 포트에 연결한다. */
export type TrackerFixture = Omit<TrackerOptions, "state" | "layout" | "phone" | "brain" | "goals" | "manager" | "observe" | "events" | "appliances"> & {
  world: TrackerOptions["state"]["view"];
  guardObject?: TrackerOptions["state"]["guardObject"];
  focusObject?: TrackerOptions["state"]["focusObject"];
  linkObject?: TrackerOptions["state"]["linkObject"];
  contentsAction?: TrackerOptions["state"]["contentsAction"];
  floor: TrackerOptions["layout"]["floor"];
  walking?: TrackerOptions["layout"]["walking"];
  locate?: TrackerOptions["layout"]["locate"];
  dock?: TrackerOptions["layout"]["dock"];
  surfaces?: TrackerOptions["layout"]["surfaces"];
  names?: TrackerOptions["layout"]["names"];
  toPhone: TrackerOptions["phone"]["toPhone"];
  phoneReady?: TrackerOptions["phone"]["ready"];
  sayAloud?: TrackerOptions["phone"]["sayAloud"];
  approvalsWaiting?: TrackerOptions["phone"]["approvalsWaiting"];
  talking?: TrackerOptions["phone"]["talking"];
  sentSeq?: TrackerOptions["brain"]["sentSeq"];
  onSpeech?: TrackerOptions["brain"]["onSpeech"];
  onRefused?: TrackerOptions["brain"]["onRefused"];
  habit?: TrackerOptions["brain"]["habit"];
  nudge?: TrackerOptions["brain"]["nudge"];
  tasks?: TrackerOptions["brain"]["tasks"];
  meal?: TrackerOptions["goals"]["meal"];
  onGoal?: TrackerOptions["goals"]["publish"];
  goalWorld?: TrackerOptions["goals"]["view"];
  prepareGoal?: TrackerOptions["goals"]["prepare"];
  reuse?: TrackerOptions["goals"]["reuse"];
  goalUpdate?: TrackerOptions["goals"]["update"];
  offerSpeech?: TrackerOptions["manager"]["offerSpeech"];
  cancelSpeech?: TrackerOptions["manager"]["cancelSpeech"];
  strayed?: TrackerOptions["observe"]["strayed"];
  stalled?: TrackerOptions["observe"]["stalled"];
  lookContents?: TrackerOptions["observe"]["lookContents"];
  topReady?: TrackerOptions["observe"]["topReady"];
  spotReady?: TrackerOptions["observe"]["spotReady"];
  log?: TrackerOptions["events"]["log"];
  emit: TrackerOptions["events"]["emit"];
  thought?: TrackerOptions["events"]["thought"];
  handDevices?: TrackerOptions["appliances"]["handDevices"];
  devices?: TrackerOptions["appliances"]["run"];
};

export function testTracker(options: TrackerFixture): ExecutionTracker {
  const {
    world, guardObject, focusObject, linkObject, contentsAction,
    floor, walking, locate, dock, surfaces, names,
    toPhone, phoneReady, sayAloud, approvalsWaiting, talking,
    sentSeq, onSpeech, onRefused, habit, nudge, tasks,
    meal, onGoal, goalWorld, prepareGoal, reuse, goalUpdate,
    offerSpeech, cancelSpeech,
    strayed, stalled, lookContents, topReady, spotReady,
    log, emit, thought,
    handDevices, devices,
    ...optionsOnly
  } = options;
  return new ExecutionTracker({
    ...optionsOnly,
    state: { view: world, guardObject, focusObject, linkObject, contentsAction },
    layout: { floor, walking, locate, dock, surfaces, names },
    phone: { toPhone, ready: phoneReady, sayAloud, approvalsWaiting, talking },
    brain: { sentSeq, onSpeech, onRefused, habit, nudge, tasks },
    goals: { meal, publish: onGoal, view: goalWorld, prepare: prepareGoal, reuse, update: goalUpdate },
    manager: { offerSpeech, cancelSpeech },
    observe: { strayed, stalled, lookContents, topReady, spotReady },
    events: { log, emit, thought },
    appliances: { handDevices, run: devices },
  });
}
