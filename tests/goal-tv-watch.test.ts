import {describe,it,expect} from "vitest";
import {NO_VIEWER_MS,TvWatch,viewerAt} from "../src/goal/tv-watch.js";
import type {GoalIntent,Trigger,TriggerFact} from "../src/contract/machines.js";
import type {TriggerFacts} from "../src/goal/triggers.js";
import {MemoryHub,SignalHub,describeDevice} from "../src/devices/index.js";
import {Policy} from "../src/agent/index.js";
import {deviceRunner} from "../src/act/devices.js";

const spec={...describeDevice("tv",{power:["off","on"]})!,id:"screen",label:"TV",room:"room",roomLabel:"방",twinType:"tv",twinAttrs:{power:["off","on"]}};
function rig(){
  const offers:GoalIntent[]=[];
  const tv=new TvWatch(x=>offers.push(x));
  let generation=0;
  const note=(power:"on"|"off",command_id:string|null=null)=>tv.observe("screen",{power,generation,command_id});
  note("on");
  const tick=(now:number,empty:boolean,watch=false,seen=true)=>tv.tick("screen",{empty,watch,photo:now,seen},3,now);
  const jobs=()=>offers.filter(x=>x.op==="offer");
  const result=(id:string,at:number,kind:"on"|"off")=>tv.result({id,at_ms:at,target_id:"screen",evidence_rev:3,outcome:"applied",command_id:id,expected_power:kind});
  return {tv,tick,note,jobs,result,manual:()=>{generation++;note("off");}};
}
describe("TV viewer and power ownership",()=>{
  it.each([true,false])("성공과 전원 확인 순서가 달라도 우리가 끈 TV만 다시 켠다 (%s)",echoFirst=>{
    const r=rig();r.tick(0,false,true);r.tick(2000,false);r.tick(4000,false,true);
    expect(r.jobs()).toHaveLength(0);
    r.tick(6000,false);r.tick(8000,false);r.tick(10000,true);r.tick(10250,true);
    const off=r.jobs()[0]!;
    expect(r.jobs().map(x=>x.kind)).toEqual(["tv_off"]);
    if(echoFirst) r.note("off",off.id); else r.result(off.id,10001,"off");
    r.tick(10500,false,true);expect(r.jobs()).toHaveLength(1);
    if(echoFirst) r.result(off.id,10001,"off"); else r.note("off",off.id);
    r.tick(12000,false,true);r.tick(12250,false,true);
    expect(r.jobs().map(x=>x.kind)).toEqual(["tv_off","tv_on"]);
  });
  it("수동 끄기 뒤 늦은 성공·중복 답은 켜기 권한을 주지 않는다",()=>{
    const r=rig();r.tick(4000,true);const off=r.jobs()[0]!;
    r.manual();r.note("off",off.id);r.result(off.id,4010,"off");r.result(off.id,4010,"off");
    r.tick(6000,false,true);expect(r.jobs()).toHaveLength(1);
  });
  it.each(["failed","timeout"])("실패한 요청의 늦은 성공은 다른 TV나 새 시청에 쓰이지 않는다 (%s)",outcome=>{
    const r=rig();r.tick(4000,true);const off=r.jobs()[0]!;
    if (outcome==="failed") r.tv.result({id:off.id,target_id:"screen",evidence_rev:3,at_ms:4200,outcome:"failed"});
    else r.tick(off.until_ms,true);
    const late=off.until_ms+1;
    r.note("off",off.id);r.result(off.id,late,"off");r.tick(late+2000,false,true);
    r.tv.observe("other",{generation:0,power:"off",command_id:off.id});
    r.tv.tick("other",{empty:false,watch:true,photo:late+2000,seen:true},4,late+2000);
    expect(r.jobs()).toHaveLength(1);
  });
  it("실제 정책·허브에서 확인된 자동 변경과 같은 값 수동 요청을 구분한다",async()=>{
    const hub=new SignalHub(new MemoryHub([spec]));
    const intents: string[]=[];
    hub.onPowerIntent=(_id,power,command)=>intents.push(power+" "+(command??"manual"));
    const unsubscribe=hub.subscribe(()=>{});
    try {
      await hub.command("screen",{type:"on"});
      const first=hub.powerStamp("screen")!;
      const run=deviceRunner(hub,new Policy());
      await run.run("turn_off","screen",{},()=>true,"auto1");
      expect(hub.get("screen")?.twin.power).toBe("off");
      expect(hub.powerStamp("screen")).toMatchObject({generation:first.generation,power:"off",command_id:"auto1"});
      await new Policy().guard(hub,"screen",{type:"off"});
      expect(hub.powerStamp("screen")).toMatchObject({generation:first.generation+1,command_id:null});
      expect(intents).toEqual(["on manual","off auto1","off manual"]);
    } finally {unsubscribe();await hub.stop();}
  });
});

// 2026-11-21 사용자 결정: 시청자가 떠난 때부터 5초 안에 끈다. 빈 자리는 2초, TV 규칙이 지켜보는 동안 VLM 사진은 1초 간격.
describe("TV 규칙: 빈 자리 2초와 지켜보는 동안",()=>{
  const facts=(empty:TriggerFact["value"],asked:Trigger[]):TriggerFacts=>({
    photoValidUntil:5000,tvRooms:new Map([["screen","room"]]),
    read:t=>{asked.push(t);return {value:t.kind==="noViewer"?empty:false,observed_ms:3000,rev:3};},
    mealSeated:{value:"unknown",observed_ms:null,rev:null},observes:()=>false,trail:[],
  });
  it("빈 자리는 2초 이어진 사진으로 읽고, 시청 구역이 지금 사진에 보이는지 함께 낸다",()=>{
    const asked:Trigger[]=[];
    expect(NO_VIEWER_MS).toBe(2000);
    expect(viewerAt(facts(true,asked),"screen",4000)).toEqual({empty:true,watch:false,photo:3000,seen:true});
    expect(asked[0]).toEqual({kind:"noViewer",room:"room",ms:2000});
    expect(viewerAt(facts(false,asked),"screen",4000)).toMatchObject({empty:false,seen:true});
    expect(viewerAt(facts("unknown",asked),"screen",4000)).toMatchObject({empty:false,seen:false});
    expect(viewerAt(facts(true,asked),"screen",5001)).toMatchObject({empty:false,seen:false});
  });
  it("시청 구역이 보이고 TV가 켜져 있거나 우리가 끈 TV일 때만 지켜본다",()=>{
    const r=rig();
    expect(r.tv.watching()).toBe(false);
    r.tick(0,false,true);
    expect(r.tv.watching()).toBe(true);
    r.tick(1000,false,false,false);
    expect(r.tv.watching()).toBe(false);
    r.tick(2000,true);const off=r.jobs()[0]!;
    r.result(off.id,2001,"off");r.note("off",off.id);
    r.tick(3000,true);
    expect(r.tv.watching()).toBe(true);
    r.manual();r.tick(4000,true);
    expect(r.tv.watching()).toBe(false);
  });
});
