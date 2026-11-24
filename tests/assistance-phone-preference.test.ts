import { join } from "node:path";
import { expect, it } from "vitest";
import { WATER_ACTION } from "../src/act/tasks.js";
import { CUP_FSM_MEMORY } from "../src/brain/decision.js";
import { HistoryDb } from "../src/brain/index.js";
import { assistanceOutcome } from "../src/shared/assistance-outcome.js";
import { at } from "./fixtures/assistance/evenings.js";
import { residentStudio, seeResident } from "./fixtures/assistance/resident.js";
import { assistanceReplay } from "./helpers/assistance-replay.js";
import { openPhone } from "./helpers/ws.js";

const scope = { home: "oneroom", user: "resident", action: WATER_ACTION, context: JSON.stringify(["state", "watching_tv"]) };
const day = "2026-11-22";
const once = "오늘만 물 가져다줘";
const named = "다음부터 먼저 물 한 잔 가져다줘";
const followup = "다음부터 먼저 해 줘";
const confirmed = "알겠어요. 다음 날부터 같은 상황에서 먼저 도울게요.";

function runtimeWithDeferredWater(runtimeDir: string) {
  const db = HistoryDb.open(join(runtimeDir, "noonchi.db"));
  try {
    for (const date of ["2026-11-20", "2026-11-21"]) {
      const ms = at(date, "20:00:00");
      const key = { boot: date, homeEpoch: "oneroom#1", attemptId: date, gen: 0 };
      db.recordAssistanceOutcome(assistanceOutcome({ ...scope, key, request: "proactive", startedMs: ms - 10 }, "cancelled", ms, [
        { key, home: scope.home, user: scope.user, kind: "explicit_decline", evidence: { source: "phone_answer", subjectId: scope.user, observedMs: ms, originId: date } },
      ]));
    }
    db.saveNight({ day: "2026-11-21", appliesDay: day, robot: CUP_FSM_MEMORY, candidates: {},
      reflection: () => ({ atMs: at("2026-11-21", "23:30:00"), text: "fixture", data: {} }) });
  } finally { db.close(); }
}

it.each([named, followup])("persists only the matching ongoing preference from a phone utterance: %s", async phrase => {
  const studio = residentStudio();
  runtimeWithDeferredWater(studio.runtimeDir);
  const replay = await assistanceReplay({
    home: scope.home, start: at(day, "20:00:00"), ...studio,
    model: {
      respond: body => {
        const turn = Array.isArray(body.input) ? body.input.at(-1) : undefined;
        return turn?.role === "user" && JSON.stringify(turn.content).includes(once)
          ? { calls: [{ name: "request_task", args: { task: WATER_ACTION } }] }
          : { text: "확인했어요." };
      },
      reply: () => JSON.stringify({ observation: "TV 시청", reasoning: "대기", state: "watching_tv", from: null, next_index: -1 }),
    },
  });
  const messages: { type: string; text?: string }[] = [];
  const phone = await openPhone(replay.server.phoneUrls[0]!.replace(/^http/, "ws") + "/phone/events", {
    setup: socket => socket.on("message", data => { messages.push(JSON.parse(String(data))); }),
  });
  try {
    const db = replay.server.history;
    const preferences = () => db.db.prepare("SELECT home, user, action, context FROM intervention_preferences").all();
    const speechRequests = () => replay.output("/manager/request").filter(m => m.body.kind === "speech");
    expect(db.policyFor(scope.home, scope.user, scope, day)).toBe("defer_proactive");
    const say = async (value: string) => {
      const start = messages.length;
      phone.send(JSON.stringify({ type: "say", text: value, at: { kind: "none", pending: [] } }));
      const nextReply = () => messages.slice(start).find(m => m.type === "reply" && m.text);
      await expect.poll(nextReply, { timeout: 3000 }).toBeDefined();
      await replay.barrier();
      return nextReply()?.text;
    };
    for (let i = 0; i < 2; i++) {
      await replay.advance(replay.clock.now() + 2100);
      await seeResident(replay, replay.clock.now() - 1);
    }
    expect(replay.output("/world/state").at(-1)?.body.view.person).toMatchObject({ visible: true, count: 1 });
    expect(replay.output("/brain/decision").map(m => {
      const { status, fsm, error } = m.body.decision;
      return { status, state: fsm?.state, error };
    })).toContainEqual({ status: "valid", state: "watching_tv", error: undefined });
    await say(followup);
    expect(preferences()).toEqual([]);
    await say("다음부터 먼저 하지 마");
    expect(preferences()).toEqual([]);
    expect(speechRequests()).toHaveLength(0);
    if (phrase === followup) {
      await say(once);
      expect(preferences()).toEqual([]);
      expect(speechRequests()).toHaveLength(1);
      expect(speechRequests()[0]?.body).toMatchObject({ input: { decision: { source: "speech", action: WATER_ACTION } } });
    }
    const reply = await say(phrase);
    expect(preferences()).toEqual([scope]);
    expect(reply).toBe(confirmed);
    expect(speechRequests()).toHaveLength(phrase === followup ? 1 : 0);
    expect(db.policyFor(scope.home, scope.user, scope, day)).toBe("defer_proactive");
    expect(replay.network).toEqual([]);
  } finally {
    phone.terminate();
    await replay.close();
  }
}, 15000);
