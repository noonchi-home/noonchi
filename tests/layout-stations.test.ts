import { describe, expect, it } from "vitest";
import { resolveHome } from "../src/layout/homes.js";
import { loadScene } from "../src/layout/scene.js";
import { standbyFor, validateStations, zoneAt } from "../src/layout/stations.js";
import { DEFAULT_TWIN_DIR } from "../src/layout/twin-files.js";
import type { Station, StationMap } from "../src/contract/stations.js";
import type { SceneJson, Vec2 } from "../src/contract/layout.js";
import { floorPlanFrom, route } from "../src/layout/route.js";

const polygon: Vec2[] = [[0, 0], [8, 0], [8, 8], [0, 8]];
const layout: SceneJson = { plan: { rooms: [{id:"one", polygon}, {id:"two", polygon:[[8,0],[12,0],[12,8],[8,8]]}], walls:[{id:"mid",a:[4,2],b:[4,6],thickness:0.2}] },
  objects: [{id:"desk", room:"one", type:"desk", mount:"floor", plan:{position:[6,4], facing_deg:90, elevation:0}, footprint:[2,1], scale:[1,1,1]}] };
const station: Station = { id:"p", name:"대기", room:"one", roles:["standby","observe"], position:[2,4], look_at:[6,4], rooms:["one"], surfaces:["desk"], observes_zone_ids:["meal"] };
const map: StationMap = { version:1, stations:[station], zones:[{id:"meal",name:"식사",room:"one",polygon:[[1,1],[3,1],[3,3],[1,3]]}],surface_fronts:[],kitchen_entry:null,meal_watch:"p" };

describe("집 자리", () => {
  it("한양목련의 대기·관찰 자리와 세 가구 앞은 걸어갈 수 있고 개수대 앞에서 싱크볼을 바라본다", () => {
    const scene = loadScene(resolveHome(DEFAULT_TWIN_DIR,"mokryeon_180b"))!;
    const m = scene.stations;
    expect(standbyFor(m,"living")?.id).toBe("living_standby");
    expect(m.stations.find(s=>s.id===m.kitchen_entry)?.surfaces).toContain("fridge_bbc363a3");
    expect(m.kitchen_entry).not.toBe(m.meal_watch);
    const floor = floorPlanFrom(scene);
    for (const p of [...m.stations,...m.surface_fronts]) expect(route(floor,[9.5,9],p.position),JSON.stringify(p)).not.toBeNull();
    expect(m.surface_fronts.map(f=>f.surface_id)).toEqual(expect.arrayContaining(["sink_counter_kitchen","dining_table_978b20c7","sofa_a848b595"]));
    const sink = m.surface_fronts.find(f=>f.surface_id==="sink_counter_kitchen")!;
    expect(sink.look_at).toEqual([5.86,0.693]);
    expect(sink.position[0]).toBeGreaterThan(6.2);
  });
  it("구판에 없던 목록은 비어 있고, 방 경계나 두 구역이 겹치는 발 위치는 확정하지 않는다", () => {
    expect(loadScene(resolveHome(DEFAULT_TWIN_DIR,"oneroom"))!.stations.stations).toEqual([]);
    expect(validateStations({version:1,stations:[]},layout).surface_fronts).toEqual([]);
    expect(zoneAt(map,"one",[2,2],0.15)).toBe("meal");
    expect(zoneAt(map,"one",[1.05,2],0.15)).toBeNull();
    expect(zoneAt(map,null,[2,2],0.15)).toBeNull();
    expect(zoneAt({...map,zones:[...map.zones,{...map.zones[0]!,id:"other"}]},"one",[2,2],0.15)).toBeNull();
  });
  it.each([
    {...map, stations:[station,{...station,id:"extra"}]},
    {...map, stations:[{...station,position:[4,3]}]},
    {...map, stations:[{...station,position:[6,4]}]},
    {...map, stations:[{...station,room:"missing"}]},
    {...map, stations:[{...station,surfaces:["gone"]}]},
    {...map, stations:[{...station,look_at:station.position}]},
    {...map, zones:[{...map.zones[0],room:"two",polygon:[[9,1],[11,1],[11,3],[9,3]]}]},
    {...map, zones:[{...map.zones[0],polygon:[[1,1],[3,3],[1,3],[3,1]]}]},
    {...map, surface_fronts:[{surface_id:"desk",room:"one",position:[3.5,4],look_at:[6,4],near_m:0.4}]},
    {...map, surface_fronts:[{surface_id:"desk",room:"one",position:[6,4],look_at:[6,3.9],near_m:0.4}]},
    {...map, surface_fronts:Array(2).fill({surface_id:"desk",room:"one",position:[6,3],look_at:[6,4],near_m:0.4})},
  ])("잘못된 자리·구역·가구 앞 설정을 거절한다 %#", (bad) => { expect(()=>validateStations(bad,layout)).toThrow(); });
});
