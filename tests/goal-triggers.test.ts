import { describe, expect, it } from "vitest";
import { viewerAt } from "../src/goal/tv-watch.js";
import { GoalTriggers } from "../src/goal/triggers.js";
import { WorldState } from "../src/world/index.js";
import { locateZone } from "../src/layout/index.js";
import { parseScene } from "../src/observe/scene.js";
import type { CameraView, SceneLookInput, SceneObservation } from "../src/contract/observe.js";
import type { StationMap } from "../src/contract/stations.js";
import type { DecisionRecord } from "../src/contract/events.js";
import type { WorldDevice } from "../src/contract/world.js";

const map: StationMap = { version: 1, kitchen_entry: null, meal_watch: "table_view", surface_fronts: [],
  zones: [{id:"seats",name:"소파",room:"living",polygon:[[-1,-4],[1,-4],[1,-2],[-1,-2]]}],
  stations: [{id:"table_view",name:"자리",room:"living",roles:["observe"],position:[0,0],look_at:[0,-3],
    rooms:["living"],surfaces:["table","screen"],observes_zone_ids:["seats"]}] };
const camera: CameraView = {origin:[0,1,0],orientation:[0,0,0,1],theta:0,projection:[1,0,0,0,0,1,0,0,0,0,-1.0002,-1,0,0,-0.020002,0]};
const empty = {seats:"clear", people:[], dining_food:"unknown"} as const;
const tv = {id:"screen",kind:"tv",status:"켜짐",state:["on"],changed_ms:50,history:[]} as unknown as WorldDevice;
function rig(cadence = 2000) {
  const w = new WorldState({ surfaces:()=>[], floorAt:()=>0, roomAt:()=>({id:"living",label:"거실"}), devices:()=>[] });
  const triggers = new GoalTriggers(locateZone, () => 0, cadence);
  let rev = 0;
  function tick(now: number) { return triggers.evaluateTriggers({...w.view(now), devices:[tv]}, rev, map, now); }
  function photo(at: number, override:Partial<SceneLookInput> = {}, household:SceneObservation["household"] = {...empty,people:[]}, observations:SceneObservation["observations"] = [], id=String(at)) {
    const look: SceneLookInput = {view:camera,width:100,height:100,fresh:true,person_ids:[],...override};
    const scene = parseScene(JSON.stringify({scene:"living",summary:"",observations,household}),new Set(look.person_ids));
    w.applyScene(id,at,scene,new Map(look.person_ids?.map(p=>[p,"person"])),look);
    rev++;
    return tick(at);
  }
  return {w,triggers,photo,tick};
}
const absence = {kind:"noViewer",room:"living",ms:4000} as const;
const seated = {kind:"postureAttention",posture:"seated",target:"screen"} as const;

describe("관찰 계기",()=>{
  it.each([true,false])("상한으로 한 장 빠져도 다음 실제 촬영에서 부재를 확인한다 (중간 tick %s)", intermediate => {
    const r=rig();
    r.photo(0); r.w.applyMissing("cap",2000,{vlm:"cap"});
    if (intermediate) expect(r.tick(2000).read(absence).value).toBe("unknown");
    expect(r.photo(4000).read(absence).value).toBe(true);
  });
  it("사람 없음(seesNobody)은 그 때 뒤에 찍혀 아직 유효한 사진에 사람이 하나도 없을 때만이다",()=>{
    const r=rig();
    expect(r.tick(0).seesNobody(-1)).toBe(false);
    const f=r.photo(1000);
    expect(f.seesNobody(999)).toBe(true);
    expect(f.seesNobody(1000)).toBe(false);
    expect(r.tick(4001).seesNobody(999)).toBe(false);
    expect(r.photo(5000,{person_ids:["p1"]},{...empty,people:[{id:"p1",attention:"unknown"}]}).seesNobody(999)).toBe(false);
  });
  it("설정 간격의 1.5배가 지나면 새 관찰을 기다린다",()=>{
    const r=rig(1000);r.photo(0);
    expect(r.tick(1500).read(absence).value).toBe(false);
    expect(r.tick(1501).read(absence).value).toBe("unknown");
  });
  it("두 장 건너뛰거나 붙잡은 장면이면 부재를 확정하지 않는다",()=>{
    const r=rig();r.photo(0);r.w.applyMissing("a",1500,{vlm:"cap"});r.w.applyMissing("b",3000,{vlm:"cap"});
    expect(r.photo(4500).read(absence).value).toBe(false);
    const s=rig();s.photo(0);s.w.applyMissing("a",2000,{vlm:"cap"});
    expect(s.photo(4000,{fresh:false}).read(absence).value).toBe("unknown");
  });
  it("서로 다른 세 촬영의 4초만 부재로 확인한다. 같은 사진의 tick은 시간을 채우지 않는다",()=>{
    const r=rig();
    expect(r.photo(0).read(absence).value).toBe(false);
    r.photo(2000);
    expect(r.tick(4000).read(absence).value).toBe(false);
    expect(r.photo(4000).read(absence)).toMatchObject({value:true,observed_ms:4000,rev:3});
    expect(r.tick(7001).read(absence).value).toBe("unknown");
  });
  it.each(["held","opposite","occluded","no answer","gap","duplicate"])("%s 사진은 부재 창을 채우지 않는다",why=>{
    const r=rig();r.photo(0);r.photo(2000);
    if(why==="no answer"){r.w.applyMissing("3",4000,{vlm:"format"});expect(r.tick(4000).read(absence).value).toBe("unknown");return;}
    const f=why==="held"?r.photo(4000,{fresh:false}):why==="opposite"?r.photo(4000,{view:{...camera,orientation:[0,1,0,0]}}):
      why==="occluded"?r.photo(4000,{}, {seats:"obscured",people:[],dining_food:"unknown"}):
      why==="duplicate"?r.photo(4000,{}, {...empty,people:[]},[],"2000"):r.photo(5001);
    expect(f.read(absence).value).not.toBe(true);
  });
  it("모르는 사람·다른 시선·두 사람 중 한 명이 남은 사진으로 시청 중이나 시청자 없음이 되지 않는다",()=>{
    const r=rig();r.photo(0);r.photo(2000);
    const person = {id:"d1",box:[40,37,20,30] as [number,number,number,number]};
    const look = {person_ids:["d1"],dets:[person]};
    const scene = (id:string|null,attention:"toward_tv"|"elsewhere")=>({seats:"clear" as const,people:[{id,attention}],dining_food:"unknown" as const});
    const sit=[{object_id:"d1",state:"sitting" as const}];
    expect(r.photo(4000,look,scene("d1","elsewhere"),sit).read(seated).value).toBe(false);
    expect(r.tick(4000).read(absence).value).not.toBe(true);
    expect(r.photo(4100,look,scene(null,"toward_tv"),sit).read(seated).value).toBe("unknown");
    expect(r.photo(4200,look,scene("d1","toward_tv"),sit).read(seated).value).toBe(true);
    expect(r.photo(4300,{...look,person_ids:["d1","d2"]},scene("d1","toward_tv"),sit).read(seated).value).toBe("unknown");
  });
  it("전원 전송 직전에 사진 기한이 지났으면 다음 tick 전에도 꺼지지 않는다",()=>{
    const r=rig(2000);
    r.photo(0); r.photo(2000);
    const snapshot=r.photo(4000);
    expect(viewerAt(snapshot,"screen",7000).empty).toBe(true);
    expect(viewerAt(snapshot,"screen",7001).empty).toBe(false);
  });
  it("늦게 도착한 사진은 새 사진의 사실·시각을 되돌리지 않는다",()=>{
    const r=rig();r.photo(4000,{}, {seats:"obscured",people:[],dining_food:"unknown"});r.photo(3000);
    expect(r.tick(4000).read(absence)).toMatchObject({value:"unknown",observed_ms:4000});
  });
  it("부재 창 가운데 사람이 있던 답이 늦게 오면 이어진 빈자리로 세지 않는다",()=>{
    const r=rig(); r.photo(0); r.photo(2000);
    r.photo(1000, {}, {seats:"clear",people:[{id:null,attention:"unknown"}],dining_food:"unknown"});
    expect(r.photo(4000).read(absence).value).not.toBe(true);
  });
  it("냉장고 최초 열린 상태와 실제 닫힘→열림, 같은 열림 재전송을 구별한다",()=>{
    const r=rig(), view=r.w.view(0);
    const edge = {kind:"device",deviceKind:"fridge",attr:"door",value:"open",mode:"edge"} as const;
    const level = {...edge,mode:"level"} as const;
    const fridge: WorldDevice = {...tv,id:"cold",kind:"fridge",state:["door_open"],history:[]};
    const tick = (at:number)=>r.triggers.evaluateTriggers({...view,devices:[fridge]},at,map,at);
    expect(tick(1).read(edge).value).toBe(false);
    expect(tick(2).read(level).value).toBe(true);
    fridge.history.push({attr:"door",from:"open",to:"closed",at_ms:3});
    fridge.state=["door_closed"]; expect(tick(3).read(edge).value).toBe(false);
    fridge.history.push({attr:"door",from:"closed",to:"open",at_ms:4});
    fridge.state=["door_open"]; expect(tick(4).read(edge)).toMatchObject({value:true,observed_ms:4});
    expect(tick(5).read(edge).value).toBe(false);
  });
  it("음식과 식탁 위 컵을 먼저 본 뒤 같은 구역에 앉은 촬영만 식사 준비 끝이다",()=>{
    const r=rig(), view=r.w.view(0);
    const person={position:[0,-3] as [number,number],room:"living",seated:false,attention:"elsewhere" as const};
    function meal(at:number, food:"yes"|"no"|"unknown", cup:boolean, sitting:boolean, lastSeen=at) {
      const v={...view,household_photo:{id:String(at),at_ms:at,serial:at,proof:{camera,seats:"unknown" as const,person_count:1,dining_food:food,person:{...person,seated:sitting}}}};
      if(cup) v.objects=[{id:"mug",cls:"cup",status:"present",surface:"table",last_seen_ms:lastSeen,facts:{}} as typeof view.objects[number]];
      return r.triggers.evaluateTriggers(v,at,map,at).mealSeated.value;
    }
    expect(meal(1,"no",true,true)).toBe(false);
    expect(meal(2,"yes",false,true)).toBe(false);
    expect(meal(3,"yes",true,false)).toBe(false);
    expect(meal(4,"unknown",true,true,3)).toBe(true);
    expect(meal(5,"yes",true,true)).toBe(false);
  });
  it("PAM 요청 당시 rev에서 새로 들어간 상태만 받는다",()=>{
    const r=rig();
    const answer=(seq:number,state:string,rev:number,extra:Partial<DecisionRecord>={})=>({seq,request_rev:rev,status:"valid",atMs:seq*100,fsm:{state},...extra} as DecisionRecord);
    r.triggers.decision(answer(2,"away",0));r.triggers.decision(answer(3,"watching_tv",1));r.photo(400);
    const t={kind:"entered",state:"watching_tv"} as const;
    expect(r.tick(400).read(t)).toMatchObject({value:true,rev:1,observed_ms:300});
    r.triggers.decision(answer(1,"drinking",0));r.triggers.decision(answer(4,"away",1,{late:true}));
    expect(r.tick(500).read(t).value).toBe(true);
    r.triggers.decision(answer(5,"watching_tv",1));expect(r.tick(600).read(t).value).toBe(false);
  });
});
