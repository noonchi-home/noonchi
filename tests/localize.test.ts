import { BusNode, MemoryBus } from "../src/bus/index.js";
import type { FrameHeader } from "../src/phone/index.js";
import { PhoneSession } from "../src/phone/session.js";
import { agrees, PhotoLocalizer, resultFor } from "../src/localize/index.js";
import type { EngineFrame } from "../src/contract/observe.js";
import type { HouseholdPhoto } from "../src/contract/world.js";
import { stationPhotoMatches } from "../src/act/robot/directive.js";
import { describe, expect, it } from "vitest";
import { TOPICS } from "../src/bus/topics.js";
import { resolveHome } from "../src/layout/homes.js";
import { loadScene } from "../src/layout/scene.js";
import { homeShotViews } from "../scripts/twin3d/home-shot-views.js";

const projection=[1,0,0,0,0,1,0,0,0,0,-1,-1,0,0,-.02,0];
const header:FrameHeader={kind:"engine",width:480,height:270,projection,position:[0,1.15,0],orientation:[0,0,0,1]};
const fit={position:[5,1.15,8] as [number,number,number],yaw_deg:179,pitch_deg:-10,confidence:.9,rms_px:.3,matches:40};
function frame(n:number):EngineFrame {
  return {id:"f"+n,capturedAtMs:n,latestAtMs:n,jpeg:Buffer.from([n]),sha256:"",width:480,height:270,
    view:{origin:[5,1.15,8],theta:0,projection,orientation:[0,0,0,1]},
    eye:{position:[5,8],height_m:1.15,yaw_deg:-179,pitch_deg:-10}};
}

describe("목련 위치 찾기", () => {
  it("같은 프레임의 AR과 비교하고 모름·불일치는 사진 범위를 보류한다",()=>{
    const result=resultFor(frame(1),fit,"revision");
    expect(agrees(result)).toBe(true);
    expect(result.ar_gap_deg).toBeCloseTo(1.97,1);
    expect(agrees(resultFor(frame(2),{...fit,position:[3,1,3]},"revision"))).toBe(false);
    expect(agrees(resultFor({...frame(3),view:null},fit,"revision"))).toBe(false);
    expect(resultFor(frame(4),null,"revision")).toMatchObject({position:null,confidence:0,matches:0});
    const schema=TOPICS["/perception/localized"].body;
    expect(schema.safeParse({...result,jpeg:"pixels"}).success).toBe(false);
    expect(schema.safeParse({...result,confidence:0}).success).toBe(false);
    expect(schema.safeParse({...result,position:null}).success).toBe(false);
  });
  it("사진 두 장으로 맞추고 충돌하면 어림으로 돌아가며 원점이 바뀐 프레임을 버린다",()=>{
    const phone=new PhoneSession({sync:{landmarks:[],walls:[]}});
    function apply(n:number, conflict=false) {
      const h={...header};phone.markEngine(h);
      return phone.localized(h,{...resultFor(frame(n),fit,"r"),ar_gap_m:conflict?3:null,ar_gap_deg:null});
    }
    expect(apply(1)).toBe(true);expect(phone.aligned).toBe(false);
    expect(apply(2)).toBe(true);expect(phone.aligned).toBe(true);
    expect(apply(3,true)).toBe(true);expect(phone.aligned).toBe(false);
    const old={...header};phone.markEngine(old);phone.handle({type:"reset",epoch:"new"});
    expect(phone.localized(old,resultFor(frame(4),fit,"r"))).toBe(false);
  });
  it("진행 중 한 장과 가장 새 한 장만 처리하고 결과 토픽으로 원 요청을 끝낸다",async()=>{
    const bus=new MemoryBus(), epoch={boot:"test",home:"flat#1"};
    const perception=new BusNode({name:"perception",bus,epoch}), node=new BusNode({name:"localize",bus,epoch});
    const phone=new BusNode({name:"phone",bus,epoch});
    const seen:string[]=[];
    let unblock!:()=>void;
    const first=new Promise<void>(resolve=>{unblock=resolve;});
    const localizer=new PhotoLocalizer(perception,node,{revision:"r",references:2,close:()=>{},
      solve:async item=>{seen.push(item.frame.id);await first;return fit;}},()=>{});
    phone.on("/perception/localized",r=>localizer.receive(r,()=>true));
    for(const n of [phone,node,perception]) {await n.prepare();n.start();}
    try {
      const requests=[1,2,3].map(n=>localizer.request(frame(n),{...header}));
      expect(await requests[1]).toBe(null);
      unblock();
      expect(await Promise.all(requests)).toEqual([fit.position,null,fit.position]);
      expect(seen).toEqual(["f1","f3"]);
    } finally {unblock();await localizer.close();await phone.stop();await perception.stop();await bus.close();}
  });
  it("관찰 자리에는 도착 뒤의 사진·위치·그 사진에서 본 가전이 필요하다",()=>{
    const photo:HouseholdPhoto={id:"p",at_ms:1100,serial:1,proof:{camera:frame(1).view!,localized_position:[5,1.15,8],
      localized_fixtures:["tv"],person_count:0,dining_food:"unknown",seats:"unknown",person:null}};
    const target={position:[5,0,8] as [number,number,number],look:null};
    expect(stationPhotoMatches(photo,1000,1400,target,"tv")).toBe(true);
    expect(stationPhotoMatches(photo,1200,1400,target,"tv")).toBe(false);
    expect(stationPhotoMatches(photo,1000,1400,target,"refrigerator")).toBe(false);
    expect(stationPhotoMatches(photo,1000,1400,{...target,position:[7,0,8]},"tv")).toBe(false);
    expect(stationPhotoMatches({...photo,proof:null},1000,1400,target,"tv")).toBe(false);
  });
  it("깊이 기준 76장과 독립 평가 76장이 같은 장면에서 서로 다른 카메라를 쓴다", () => {
    const home = resolveHome("twin", "mokryeon_180b");
    const scene = loadScene(home)!;
    const references = homeShotViews(home, scene);
    const queries = homeShotViews(home, scene, true);
    expect(queries).toHaveLength(76);
    queries.forEach((q,i) => {
      const ref = references[i]!;
      expect(q.position).not.toEqual(ref.position);
      expect(q.yaw_deg).not.toBe(ref.yaw_deg);
      expect(q.doors).toEqual(ref.doors);
    });
  });
  it("위치 찾기 결과는 사진을 포함하지 않는 신뢰 토픽이다", () => {
    expect(TOPICS["/perception/localized"]?.qos.kind).toBe("reliable");
  });
});
