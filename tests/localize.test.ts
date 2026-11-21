import { BusNode, MemoryBus } from "../src/bus/index.js";
import type { FrameHeader } from "../src/phone/index.js";
import { PhoneSession } from "../src/phone/session.js";
import { agrees, PhotoLocalizer, resultFor } from "../src/localize/index.js";
import type { EngineFrame } from "../src/contract/observe.js";
import type { HouseholdPhoto } from "../src/contract/world.js";
import { PHOTO_GAP_M, PHOTO_GAP_DEG, PHOTO_MAX_RMS_PX, PHOTO_MIN_MATCHES } from "../src/shared/photo-alignment.js";
import { stationSeen } from "../src/act/robot/station-arrival.js";
import type { TrackCore } from "../src/act/track/core.js";
import { describe, expect, it } from "vitest";
import { TOPICS } from "../src/bus/topics.js";
import { resolveHome } from "../src/layout/homes.js";
import { loadScene } from "../src/layout/scene.js";
import { homeShotViews } from "../scripts/twin3d/home-shot-views.js";
import { customViews } from "../scripts/twin3d/home-shots.js";

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
    expect(agrees({...result,ar_gap_m:PHOTO_GAP_M,ar_gap_deg:PHOTO_GAP_DEG})).toBe(true);
    expect(agrees({...result,ar_gap_m:PHOTO_GAP_M+.001})).toBe(false);
    expect(agrees({...result,ar_gap_deg:PHOTO_GAP_DEG+.01})).toBe(false);
    expect(schema.safeParse({...result,matches:PHOTO_MIN_MATCHES,rms_px:PHOTO_MAX_RMS_PX}).success).toBe(true);
    expect(schema.safeParse({...result,matches:PHOTO_MIN_MATCHES-1}).success).toBe(false);
    expect(schema.safeParse({...result,rms_px:PHOTO_MAX_RMS_PX+.001}).success).toBe(false);
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
      // 밀린 요청은 「모름」으로 끝난다(AR 자세로 본다)
      expect(await requests[1]).toEqual({position:null,conflict:false});
      unblock();
      expect(await Promise.all(requests)).toEqual([{position:fit.position,conflict:false},{position:null,conflict:false},{position:fit.position,conflict:false}]);
      expect(seen).toEqual(["f1","f3"]);
    } finally {unblock();await localizer.close();await phone.stop();await perception.stop();await bus.close();}
  });
  it("관찰 자리 도착은 사진 근거에 더해, 그 사진의 위치 찾기 결과가 있으면 자리 반경 안이어야 한다",()=>{
    const target={id:"s",position:[5,0,8] as [number,number,number],look:{position:[5,0.6,6] as [number,number,number]}};
    const map={version:1,stations:[{id:"s",name:"자리",room:"living",roles:["observe"],position:[5,8],look_at:[5,6],rooms:["living"],surfaces:[],observes_zone_ids:[]}],
      zones:[],surface_fronts:[],kitchen_entry:null,meal_watch:null};
    const core=(localized:[number,number,number]|undefined)=>{
      const photo:HouseholdPhoto={id:"p",at_ms:1100,serial:1,proof:{camera:frame(1).view!,...(localized?{localized_position:localized,localized_fixtures:[]}:{}),
        person_count:0,dining_food:"unknown",seats:"unknown",person:null}};
      return {o:{state:{view:()=>({household_photo:photo,devices:[],fixtures:[]})},layout:{floor:()=>({objects:new Map()})},
        stations:{map:()=>map}}} as unknown as TrackCore;
    };
    expect(stationSeen(core([5,1.15,8]),target,0.5,1400)).toBe(true);
    // 사진으로 찾은 위치가 자리에서 반경보다 멀면 도착이 아니다
    expect(stationSeen(core([5.8,1.15,8]),target,0.5,1400)).toBe(false);
    // 위치를 모르는 사진(지도 없음·특징점 부족)은 사진 근거만 본다. AR 자세와 다른 사진은 근거(proof)가 없어 여기 오지 않는다
    expect(stationSeen(core(undefined),target,0.5,1400)).toBe(true);
  });
  it("관찰 자리·면 앞 장면의 서는 곳과 바라볼 곳은 집 자료(stations.json) 값 그대로다", () => {
    const home = resolveHome("twin", "mokryeon_180b");
    const scene = loadScene(home)!;
    const map = scene.stations;
    const spot = (id: string) => {
      const s = map.stations.find(s => s.id === id);
      if (s) return { stand: s.position, look: s.look_at };
      const f = map.surface_fronts.find(f => f.surface_id === FRONTS[id]);
      return f ? { stand: f.position, look: f.look_at } : null;
    };
    const FRONTS: Record<string,string> = { table_front: "dining_table_978b20c7", sink_front: "sink_counter_kitchen",
      sofa_front: "sofa_a848b595", desk_front: "desk_small_ce7e768b" };
    const views = homeShotViews(home, scene).filter(v => v.view === "C");
    const checked = views.filter(v => spot(v.station_id));
    expect(checked.map(v => v.station_id).sort()).toEqual(
      ["desk_front","desk_watch","kitchen_entry","living_standby","meal_watch","sink_front","sofa_front","table_front"]);
    for (const v of checked) {
      const s = spot(v.station_id)!;
      expect([v.position[0], v.position[2]], v.station_id).toEqual(s.stand);
      expect(v.look, v.station_id).toEqual(s.look);
    }
    // 옛 거실 대기 자리는 기준 사진 범위를 지키려고 「거실 TV 옆」으로 남는다
    expect(views.find(v => v.station_id === "living_tv_side")).toMatchObject({ position: [10.5,1.15,9], look: [7.4,9.8] });
  });
  it("깊이 기준 81장과 독립 평가 81장이 같은 장면에서 서로 다른 카메라를 쓴다", () => {
    const home = resolveHome("twin", "mokryeon_180b");
    const scene = loadScene(home)!;
    const references = homeShotViews(home, scene);
    const queries = homeShotViews(home, scene, true);
    expect(queries).toHaveLength(81);
    queries.forEach((q,i) => {
      const ref = references[i]!;
      expect(q.position).not.toEqual(ref.position);
      expect(q.yaw_deg).not.toBe(ref.yaw_deg);
      expect(q.doors).toEqual(ref.doors);
    });
  });
  it("--views 카메라 줄은 장면 크기로 채우고, 카메라 값이 빠진 줄은 찍기 전에 거절한다", () => {
    const [start] = customViews([{ id: "start_C", position: [8.4612, 1.15, 3.9242], yaw_deg: 0, pitch_deg: -10, vfov_deg: 40 }]);
    expect(start).toMatchObject({ id: "start_C", file: "start_C.png", width: 1920, height: 1080, doors: {} });
    expect(() => customViews([{ id: "x", position: [1, 1], yaw_deg: 0, pitch_deg: 0, vfov_deg: 40 }])).toThrow("--views 0번 줄");
    expect(() => customViews([])).toThrow("--views");
  });
  it("위치 찾기 결과는 사진을 포함하지 않는 신뢰 토픽이다", () => {
    expect(TOPICS["/perception/localize"]).toMatchObject({qos:{kind:"reliable"},from:["perception"]});
    expect(TOPICS["/perception/localized"]).toMatchObject({qos:{kind:"reliable"},from:["localize"]});
  });
});
