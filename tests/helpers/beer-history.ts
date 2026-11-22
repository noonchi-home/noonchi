import { HistoryDb, learnBeerRules, runReflection } from "../../src/brain/index.js";
import { CUP_FSM_MEMORY } from "../../src/brain/decision.js";
import { candidateFsmOf } from "../../src/brain/pam/adopt.js";
import { BusNode, MemoryBus, VirtualClock } from "../../src/bus/index.js";
import type { BeerScope } from "../../src/contract/beer.js";
import { BeerObservation } from "../../src/goal/index.js";
import { historyRoutes } from "../../src/record/index.js";
import { settle } from "../../src/record/replay.js";
import { beerCan, beerEvenings, beerPhoto } from "../fixtures/assistance/beer.js";
import { localTime } from "../fixtures/assistance/learning.js";
import { pamClientFor, pamView } from "./pam.js";

export async function recordBeerHistory(path: string, scope: BeerScope) {
  const db = HistoryDb.open(path);
  const clock = new VirtualClock(localTime("2026-11-20", "23:30:00"));
  const bus = new MemoryBus({ clock });
  const epoch = { boot: "beer-training", home: scope.home + "#1" };
  const act = new BusNode({ name: "act", bus, clock, epoch });
  const recorder = new BusNode({ name: "recorder", bus, clock, epoch });
  historyRoutes(recorder, db, { now: () => clock.now(), machinesOnly: true });
  await recorder.prepare();
  recorder.start();
  const sent: Promise<void>[] = [];
  const watch = new BeerObservation(scope.home, scope.user, event => { sent.push(act.publish("/act/beer_observation", event)); });
  const power = (on: boolean, atMs: number) => ({ device: scope.device, room: "living", on, atMs, originId: "tv-" + atMs });
  const view = (at: number, on: boolean, powerAt: number, data: Parameters<typeof beerPhoto>[1]) =>
    watch.observe(beerPhoto(at, data), power(on, powerAt), false, at + 100);
  const first = localTime("2026-10-24", "13:59:00");
  view(first, false, first - 100, {});
  const min = 60_000;
  try {
    for (const { day, on, off, sawBeer } of beerEvenings()) {
      const id = "can-" + day;
      view(on + 1_000, true, on, { room: "living", seated: true });
      if (sawBeer) {
        view(on + min, true, on, { room: "kitchen", cans: [beerCan(on + min, id, "in_hand", "kitchen", [1, 1, 1], null)] });
        view(on + 2 * min, true, on, { room: "living", cans: [beerCan(on + 2 * min, id, "in_hand", "living", [1, 1, 1], null)] });
        view(off - min, true, on, { room: "living", cans: [beerCan(off - min, id, "on_table", "living", [1, .5, 1], "table")] });
      }
      view(off + 1_000, false, off, { room: "living" });
      if (sawBeer) {
        view(off + min, false, off, { room: "kitchen", cans: [beerCan(off + min, id, "in_hand", "kitchen", [1, 1, 1], null)] });
        view(off + 2 * min, false, off, { room: "kitchen", cans: [beerCan(off + 2 * min, id, "in_sink", "kitchen", [1, .8, 1], "sink")] });
      }
    }
    await Promise.all(sent);
    await settle(bus, [act, recorder]);
    const pam = pamClientFor({ url: "http://beer-night.invalid/v1" }, { fetchImpl: async (input, init) => {
      const req = new Request(input, init);
      if (req.url !== "http://beer-night.invalid/v1/chat/completions") throw new Error("Offline fixture attempted network use");
      const request = pamView(await req.json() as Parameters<typeof pamView>[0]);
      const content = request.role === "check" ? { ok: true, items: [] } : candidateFsmOf(CUP_FSM_MEMORY);
      return Response.json({ model: "beer-fixture", choices: [{ message: { content: JSON.stringify(content) }, finish_reason: "stop" }] });
    } });
    const result = await runReflection(db, pam, "2026-11-20", { now: () => clock.now() });
    if (!result.ok) throw new Error(result.error);
    const counts = learnBeerRules(db.beerEvents("2026-10-24", "2026-11-20"), db.offsetMinutes);
    const next = db.memoryFor("2026-11-21");
    if (next?.version !== result.version || next.appliesDay !== "2026-11-21") throw Error("Missing next-day beer memory");
    return { result, rules: db.beerRules(result.version), counts };
  } finally {
    await recorder.stop();
    await act.stop();
    await bus.close();
    db.close();
  }
}
