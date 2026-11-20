import {it, expect} from "vitest";
import { DirectiveRunner } from "../src/act/robot/directive.js";
import type { DirectiveResult } from "../src/contract/machines.js";
const grant={op:"grant",kind:"visit",id:"visit",target_id:"entry",until_ms:5000,rev:1,goal_id:null} as const;
function setup(){
  const sent:string[]=[], results:DirectiveResult[]=[];
  let near=false, blocked=false;
  const runner=new DirectiveRunner({now:()=>1000,rev:()=>2,blocked:()=>blocked,
    visit:(d)=>{sent.push(d.id);return true;},clear:id=>sent.push("clear:"+id),arrived:()=>near,
    result:r=>results.push(r)});
  return {runner,sent,results,arrive:()=>{near=true;runner.tick();},block:()=>{blocked=true;}};
}
it("방문·회수·말 부탁 뒤 늦은 도착과 중복 허용은 명령을 보내지 않는다",()=>{
  const r=setup();r.runner.receive(grant);r.runner.receive(grant);
  r.runner.receive({op:"revoke",id:"visit",rev:1});
  r.sent.push("speech");r.arrive();r.runner.receive(grant);
  expect(r.sent).toEqual(["visit","clear:visit","speech"]);
  expect(r.results.map(v=>v.outcome)).toEqual(["cancelled"]);
});
it("도착은 현재 위치로 확인하고 막히거나 만료된 방문은 보내지 않는다",()=>{
  const r=setup();r.runner.receive(grant);r.arrive();r.arrive();
  expect(r.results.map(v=>v.outcome)).toEqual(["arrived"]);
  r.block();r.runner.receive({...grant,id:"x"});
  expect(r.sent).toEqual(["visit","clear:visit"]);
  const t=setup();t.runner.receive({...grant,until_ms:1000});
  expect(t.sent).toEqual([]);
});
