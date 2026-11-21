// start.ts — 목표 노드. World State 구독 노드(startWorldMirror, 이름 "goal")로 /world/state를 받고, 그 가장 새 World State로 목표 판단을 돌린다.
// 250ms 타이머와 새 rev마다: 조건 사실(GoalTriggers) → TV 규칙(TvWatch) → 사용자 찾기(RoomWatch) → afterTick(목표 갱신).
// 같은 rev에 새 집 사진(새 VLM 답)만 오면 끄고 켤 TV가 있을 때 조건 사실과 TV 규칙만 돈다(TV 끄기 5초). 새 사진마다 전부 돌리면
// 같은 상태를 받는 대시보드 world 발행이 늦는다(tests/latency-world.test.ts p95 26~60ms). 요청은 /goal/intent로 낸다.
// 서버(src/server/home/observe.ts)와 시험 재생(tests/helpers/scenario1-replay.ts)이 이 함수 하나를 쓴다.
import type { Bus, BusNode, Clock, Outbox } from "../bus/index.js";
import type { StationMap } from "../contract/stations.js";
import { startWorldMirror, type WorldMirror } from "../world/index.js";
import { goalRoutes } from "./node.js";
import { RoomWatch, type CheckingVisit } from "./room-watch.js";
import type { GoalTriggers, TriggerFacts } from "./triggers.js";
import { TvWatch, viewerAt } from "./tv-watch.js";

type AfterRev = Parameters<NonNullable<Parameters<typeof startWorldMirror>[0]["routes"]>>[1];

export interface GoalNode { mirror: WorldMirror; out: Outbox; rooms: RoomWatch; tv: TvWatch }

/** 목표 노드를 준비한다(구독까지, 시작은 띄우는 곳이 모든 노드를 준비한 뒤). */
export async function startGoalNode(o: {
  bus: Bus; epoch: { boot: string; home: string }; clock: Clock; log?: (s: string) => void;
  triggers: GoalTriggers;
  /** 방 사이 문(사용자 찾기 자리 고르기). */
  portals: ConstructorParameters<typeof RoomWatch>[1];
  map: () => StationMap | null;
  /** 끄고 켤 수 있는 TV(시청 전원 종류) 기기 id들. */
  viewers: () => readonly string[];
  /** 지금 확인 중인 목표의 사용자 찾기 창과 그 컵·면. 없으면 null. */
  checking: () => (CheckingVisit & { cup: string; surface: string }) | null;
  closed?: () => boolean;
  /** 새로 매긴 조건 사실(실행 추적·TV 허락이 읽는다). */
  onFacts?: (facts: TriggerFacts) => void;
  /** 250ms 타이머·새 rev 판단의 끝(목표 갱신). */
  afterTick?: () => void;
  /** 목표 노드에 더 붙일 구독. */
  routes?: (node: BusNode, afterRev: AfterRev, out: Outbox) => void;
}): Promise<GoalNode> {
  let out: Outbox | null = null, mirror: WorldMirror | null = null;
  let evaluateGoals: (() => void) | null = null, evaluateTv: (() => void) | null = null;
  const rooms = new RoomWatch((intent) => out?.push("/goal/intent", intent), o.portals);
  const tv = new TvWatch((intent) => out?.push("/goal/intent", intent));
  mirror = await startWorldMirror({
    bus: o.bus, epoch: o.epoch, name: "goal", clock: o.clock, log: o.log,
    onView: () => evaluateGoals?.(),
    onPhoto: () => { if (tv.armed()) evaluateTv?.(); },
    routes: (node, afterRev) => {
      const goalOut = out = goalRoutes(node, o.clock, o.triggers, rooms, tv);
      o.routes?.(node, afterRev, goalOut);
      // 조건 사실을 새로 매기고 TV 규칙을 돌린다. 새 집 사진마다는 이것만 돈다(사용자 찾기·목표 갱신은 250ms 타이머와 새 rev에)
      const facts = () => {
        const view = mirror?.view(), rev = mirror?.rev();
        if (o.closed?.() || !view || rev == null) return null;
        const map = o.map(), now = o.clock.now();
        const goalFacts = o.triggers.evaluateTriggers(view, rev, map, now);
        o.onFacts?.(goalFacts);
        for (const id of o.viewers()) tv.tick(id, viewerAt(goalFacts, id, now), rev, now);
        return { view, rev, map, now, goalFacts };
      };
      evaluateTv = () => { facts(); };
      node.every(250, evaluateGoals = () => {
        const f = facts();
        if (!f) return;
        const { view, rev, map, now, goalFacts } = f;
        const checking = o.checking();
        const cup = checking && view.objects.find((x) => x.id === checking.cup);
        rooms.tick({ now, rev, map, facts: goalFacts, checking,
          personSeen: view.person.visible || !!(checking && view.household_photo?.proof &&
            view.household_photo.at_ms >= checking.since && view.household_photo.proof.person_count > 0),
          cupSeen: !!(checking && cup?.status === "present" && cup.surface === checking.surface &&
            cup.last_seen_ms >= checking.since && !cup.carried && cup.facts.place?.certainty === "confirmed" && cup.facts.place.value !== "in_hand") });
        o.afterTick?.();
      });
    },
  });
  return { mirror, out: out!, rooms, tv };
}
