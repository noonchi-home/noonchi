import { describe,it,expect } from "vitest";
import { BusNode,MemoryBus,realClock } from "../src/bus/index.js";
import { settle } from "../src/record/replay.js";
import { managerRoutes } from "../src/manage/node.js";
import { goalRoutes } from "../src/goal/node.js";
import { RoomWatch,selectSearchStation,type WatchInput } from "../src/goal/room-watch.js";
import type { GoalIntent } from "../src/contract/machines.js";
import type { Station,StationMap } from "../src/contract/stations.js";
import type { TriggerFacts } from "../src/goal/triggers.js";
const station=(id:string,x:number,z:number,room="living"):Station=>({id,name:id,room,roles:["standby","observe"],position:[x,z],look_at:[x,z+1],rooms:[room],surfaces:[],observes_zone_ids:[]});
const map:StationMap={version:1,kitchen_entry:"entry",meal_watch:"meal",zones:[],surface_fronts:[],
  stations:[station("sofa",4,0),station("entry",1,5,"kitchen"),{...station("meal",0,0),roles:["observe"]}]};
const portals=[{rooms:["living","kitchen"] as [string,string],point:[1,3] as [number,number]}];
it.each(["timeout","failed","unknown","cancelled","cancelAtDeadline","window"] as const)("첫 방문 %s 뒤 남은 자리와 확인 기한을 지킨다",why=>{
  const s=setup(), checking={id:"g",since:0,until:300000};
  const facts:TriggerFacts={trail:[trail(0,0,0),trail(1,0,100)],read:()=>evidence(false,100),mealSeated:evidence(false,100),observes:()=>false};
  const tick=(at:number)=>s.tick(at,{checking,facts,cupSeen:true});
  tick(200);const first=s.offers()[0]!;
  expect(first.target_id).toBe("sofa");
  if(why==="timeout") tick(first.until_ms);
  else if(why==="window") { tick(checking.until);expect(s.sent.at(-1)).toMatchObject({op:"withdraw",id:first.id}); }
  else s.w.result({id:first.id,at_ms:why==="cancelAtDeadline"?first.until_ms:500,evidence_rev:first.rev,target_id:first.target_id,outcome:why==="cancelAtDeadline"?"cancelled":why});
  tick(why==="window"?checking.until+1:31000);
  expect(s.offers().map(x=>x.target_id)).toEqual(why==="cancelled" || why==="cancelAtDeadline" || why==="window"?["sofa"]:["sofa","entry"]);
});
const trail=(x:number,z:number,at:number)=>({room:"living",position:[x,z] as [number,number],at_ms:at});
const evidence=(value:boolean, time:number)=>({value,observed_ms:time,rev:time});
function setup(){
  const sent:GoalIntent[]=[];
  const w=new RoomWatch(i=>{sent.push(i);},portals);
  const tick=(at:number,over:Partial<WatchInput>={},edge=false,meal=false)=>{
    const facts:TriggerFacts={trail:[],read:()=>evidence(edge,at),mealSeated:evidence(meal,at),observes:()=>false};
    w.tick({now:at,rev:at,map,facts,checking:null,personSeen:false,cupSeen:false,...over});
  };
  return {w,tick,sent,offers:()=>sent.filter(s=>s.op==="offer")};
}
const checking={id:"goal",since:0,until:300000};
describe("집 안 관찰",()=>{
  it("냉장고 사건은 집 통로에서 goal과 manager를 거쳐 act에 방문 하나로 닿는다",async()=>{
    const bus=new MemoryBus(), epoch={boot:"boot",home:"home:1"};
    const goal=new BusNode({bus,epoch,name:"goal"}),manager=new BusNode({bus,epoch,name:"manager"}),act=new BusNode({bus,epoch,name:"act"});
    const rooms:RoomWatch=new RoomWatch(i=>out.push("/goal/intent",i),portals);
    const out=goalRoutes(goal,realClock,undefined,rooms);
    managerRoutes(manager,realClock);
    const reached:string[]=[];
    act.on("/manager/directive",async d=>{
      if(d.op!=="grant")return;
      reached.push(d.target_id);
      await act.publish("/act/directive_result",{id:d.id,target_id:d.target_id,evidence_rev:d.rev,at_ms:Date.now(),outcome:"arrived"});
    });
    const nodes=[goal,manager,act];
    try{
      for(const n of nodes)await n.prepare();
      for(const n of nodes)n.start();
      await act.publish("/act/work",{active:false,activeAction:null,docking:false,emergency:false,goal:null,handling:null,requested:false,
        at_ms:Date.now(),mode:"noonchi",tasks:[],plan:null});
      await settle(bus,nodes);
      const now=Date.now(), facts:TriggerFacts={trail:[],read:()=>evidence(true,now),mealSeated:evidence(false,now),observes:()=>false};
      const input={now,rev:7,map,facts,checking:null,personSeen:false,cupSeen:false};
      rooms.tick(input);rooms.tick(input);
      await settle(bus,nodes);expect(reached).toEqual(["entry"]);
    }finally{for(const n of nodes)await n.stop();await bus.close();}
  });
  it("새 문 열림과 식사 착석에서만 한 번씩 방문한다",()=>{
    const r=setup();r.tick(0);r.tick(1,{},true);r.tick(2);
    expect(r.offers().map(x=>x.target_id)).toEqual(["entry"]);
    r.tick(4,{},false,true);r.tick(4,{},false,true);
    expect(r.offers().map(x=>x.target_id)).toEqual(["entry","meal"]);
  });
  it("뚜렷한 동선은 자리 선택 없이 바로 방문한다. 재등장하면 방문을 거둔다",()=>{
    const r=setup();
    const facts:TriggerFacts={trail:[trail(0,0,100),trail(1,0,300)],read:()=>evidence(false,300),mealSeated:evidence(false,300),observes:()=>false};
    r.tick(3100,{checking,facts});
    expect(r.offers().map(o=>[o.kind,o.target_id])).toEqual([["visit","sofa"]]);
    r.tick(3200,{checking,personSeen:true,facts});
    expect(r.sent.at(-1)?.op).toBe("withdraw");
    r.tick(3300,{checking,personSeen:false,cupSeen:true,facts});
    expect(r.offers()).toHaveLength(2);
  });
  it("식탁에서 소파로 향하는 실제 두 발자리가 있으면 같은 방 대기 자리를 고른다",()=>{
    expect(selectSearchStation([trail(0,0,10),trail(1,0,20)],map,[],portals)).toEqual({kind:"one",id:"sofa"});
    expect(selectSearchStation([trail(1,0,10),trail(1,0,20)],map,[],portals).kind).toBe("ambiguous");
  });
  it("떠난 직후 컵 사진을 기다리고 갈림길에서 한 번만 선택을 요청한다",()=>{
    const r=setup();r.tick(0,{checking});r.tick(2999,{checking});expect(r.sent).toEqual([]);
    r.tick(3000,{checking});r.tick(3001,{checking});
    const choice=r.offers()[0]!;
    expect(choice.kind).toBe("choose_station");expect(r.offers()).toHaveLength(1);
    r.w.result({id:choice.id,evidence_rev:choice.rev,target_id:"not-in-map",at_ms:3002,outcome:"selected"});
    r.tick(3003,{checking});expect(r.offers()).toHaveLength(1);
  });
  it("취소 뒤 답·다른 근거 rev의 답은 다음 방문을 만들지 않는다",()=>{
    const r=setup();r.tick(4000,{checking,cupSeen:true});
    const c=r.offers()[0]!;
    const result={id:c.id,evidence_rev:c.rev+1,target_id:"sofa",at_ms:4001,outcome:"selected" as const};
    r.w.result(result);expect(r.offers()).toHaveLength(1);
    r.w.interrupt(); // 그만 또는 높은 우선순위의 요청
    expect(r.sent.at(-1)).toMatchObject({op:"withdraw",id:c.id});
    r.w.result({...result,evidence_rev:c.rev});r.tick(4100,{checking});
    expect(r.offers()).toHaveLength(1);
  });
  it.each([true,false])("도착 뒤 빈 자리를 확인하거나 방문 기한이 지나면 다음 자리로 간다 (사진 %s)",fresh=>{
    const r=setup();r.tick(2000,{checking,cupSeen:true});
    const c=r.offers()[0]!;
    r.w.result({id:c.id,evidence_rev:c.rev,target_id:"sofa",at_ms:2010,outcome:"selected"});
    r.tick(2011,{checking});const visit=r.offers()[1]!;
    expect(visit).toMatchObject({kind:"visit",target_id:"sofa",goal_id:"goal"});
    r.w.result({id:visit.id,evidence_rev:2020,target_id:"sofa",at_ms:2020,outcome:"arrived"});
    r.tick(2100,{checking});expect(r.offers()).toHaveLength(2);
    const facts:TriggerFacts={trail:[],read:()=>evidence(false,3000),mealSeated:evidence(false,3000),observes:(id,after)=>id==="sofa" && after===2020};
    if (fresh) r.tick(3100,{checking,facts});
    else r.tick(visit.until_ms,{checking});
    expect(r.offers().map(o=>o.target_id)).toEqual(["sofa","sofa","entry"]);
  });
});
