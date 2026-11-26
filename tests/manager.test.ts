import { describe, expect, it } from "vitest";
import { TaskManager, modeNow, pamTasks, type WorkContext } from "../src/manage/index.js";

const freely: WorkContext = { emergency: false, activeAction: "컵 치우기", handling: null, docking: false };
const request = { action: "라면 끓이기 알려 주기", seq: 0, source: "speech" as const, id: "say-1" };
const goal = { action: "물 채우기", seq: 8, id: "pam-8" };

describe("일의 우선순위", () => {
  it("폰 방문과 기기 작업은 따로 허용하고 말 부탁은 둘보다 먼저다",()=>{
    const m=new TaskManager<typeof request>();
    const work={...freely,activeAction:null,phoneBusy:false};
    const event={op:"offer",id:"visit",rev:1,until_ms:1000,kind:"visit",target_id:"entry",goal_id:null} as const;
    m.intent(event); m.intent({...event,id:"tv",kind:"tv_off"});
    expect(m.directives({...work,phoneBusy:true},10).map(d=>[d.op,d.id])).toEqual([["grant","tv"]]);
    expect(m.directives(work,20).map(d=>[d.op,d.id])).toEqual([["grant","visit"]]);
    m.intent(event);
    expect(m.directives(work,21)).toEqual([]);
    expect(m.interruptDirectives().map(d=>d.id).sort()).toEqual(["tv","visit"]);
    m.intent(event);
    expect(m.directives(work,22)).toEqual([]);
  });
  it("안전 중에는 기기 명령도 보내지 않고 만료된 방문은 되살리지 않는다",()=>{
    const m=new TaskManager<typeof request>();
    m.intent({op:"offer",id:"tv",rev:1,until_ms:99,kind:"tv_on",target_id:"screen",goal_id:null});
    expect(m.directives({...freely,emergency:true},30).filter(d=>d.op==="grant")).toEqual([]);
    expect(m.directives(freely,100).filter(d=>d.op==="grant")).toEqual([]);
  });
  it("집기 중 새 말 부탁은 그 단계 뒤 한 번만 넘기고, 비상 동안에는 더 기다린다", () => {
    const manager = new TaskManager<typeof request | typeof goal>();
    expect(manager.offer(request, true, { ...freely, handling: "plan:1/pick" })).toBe("defer");
    expect(manager.take({ ...freely, handling: "plan:1/pick" })).toBeNull();
    expect(manager.take({ ...freely, emergency: true })).toBeNull();
    expect(manager.take({ ...freely, handling: "plan:1/go" })).toBe(request);
    expect(manager.take(freely)).toBeNull();
  });
  it("충전 복귀 중 자동 판단은 미루고 말 부탁은 바로 받으며, 그만이면 기다리던 부탁도 지운다", () => {
    const manager = new TaskManager<typeof request | typeof goal>();
    expect(manager.offer(goal, false, { ...freely, docking: true })).toBe("dock");
    expect(manager.offer(request, true, { ...freely, docking: true })).toBe("take");
    expect(manager.offer(request, true, { ...freely, emergency: true })).toBe("defer");
    manager.cancel();
    expect(manager.take(freely)).toBeNull();
  });
  it("코치 계획은 끝날 때까지 코치 모드로 두고, 평소에는 들은 말이 있을 때만 코치 행동을 더한다", () => {
    const facts = { world: null, offNotices: [], coaching: false };
    expect(modeNow({ ...facts, plan: { status: "running", goal: request.action } })).toBe("coach");
    expect(modeNow({ ...facts, plan: { status: "done", goal: request.action } })).toBe("noonchi");
    expect(pamTasks("noonchi", false)).not.toContain(request.action);
    expect(pamTasks("noonchi", true)).toContain(request.action);
  });
  it("말 부탁이 진행되는 동안 다른 자동 판단이 덮지 못한다", () => {
    const manager = new TaskManager<typeof goal>();
    expect(manager.offer(goal, false, { ...freely, requested: true })).toBe("request");
    expect(manager.offer(goal, false, freely)).toBe("take");
  });
});
