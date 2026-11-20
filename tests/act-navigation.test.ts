import { expect, it } from "vitest";
import { Navigation } from "../src/act/robot/navigation.js";
import { walkingMap } from "../src/layout/walk-guide.js";
import { floorPlanFrom } from "../src/layout/floor.js";
import type { SceneJson } from "../src/contract/layout.js";
it("never advances through a wall beside a doorway; a new origin needs two fixes",()=>{
  const scene={plan:{rooms:[{id:"a",polygon:[[0,0],[4,0],[4,4],[0,4]]},{id:"b",polygon:[[4,0],[8,0],[8,4],[4,4]]}],
    doors:[{id:"p",position:[4,2],width:0.9,connects:["a","b"]}]},objects:[]} as unknown as SceneJson;
  const nav=new Navigation(), map=walkingMap(floorPlanFrom(scene),scene);
  const sample=(x:number,t:number,gen=1,error_m=0)=>{
    nav.pose({quality:"usable",position:[x,0.7],observed_ms:t,pose_gen:gen,error_m});
    return nav.read("A",map,[4.3,0.7],0.32,true,t);
  };
  sample(3.7,100);expect(sample(3.8,350).guide?.remaining[0].kind).toBe("portal");
  expect(sample(4.1,650).guide).toBeNull();expect(sample(4.25,950).arrived).toBe(false);
  expect(sample(4.25,1200,2).arrived).toBe(false);
  expect(sample(4.25,1400,2,0.2).guide).toBeNull();
  expect(sample(4.25,1700,2).arrived).toBe(false);
  expect(sample(4.25,2000,2).arrived).toBe(true);
});

it("holds on repeated or stale poses, confirms crossing and arrival with distinct fixes", () => {
  const scene = {
    plan: {
      rooms: [
        {
          id: "a",
          polygon: [
            [0, 0],
            [4, 0],
            [4, 4],
            [0, 4],
          ],
        },
        {
          id: "b",
          polygon: [
            [4, 0],
            [8, 0],
            [8, 4],
            [4, 4],
          ],
        },
      ],
      open_edges: [["a", "b"]],
    },
    objects: [],
  } as unknown as SceneJson;
  const map = walkingMap(floorPlanFrom(scene), scene);
  const nav = new Navigation();
  const read = (t: number) => nav.read("go-1", map, [5, 2], 0.32, true, t);
  const eye = (x: number, t: number) => nav.pose({ quality: "usable", position: [x, 2], pose_gen: 1, observed_ms: t });
  eye(3.6, 100);
  eye(3.6, 100);
  expect(read(100).guide).toBeNull();
  expect(read(100).arrived).toBe(false);
  eye(3.7, 200);
  expect(read(200).guide?.remaining[0].kind).toBe("portal");
  eye(4.1, 450);
  expect(read(450).arrived).toBe(false);
  eye(4.2, 650);
  expect(read(650).guide?.remaining[0].kind).toBe("stand");
  eye(4.9, 1050);
  expect(read(1050).arrived).toBe(false);
  eye(5, 1250);
  expect(read(1250).arrived).toBe(true);
  expect(read(3600).guide).toBeNull();
  nav.pose({ quality: "unavailable", position: null, pose_gen: 2, observed_ms: 3700 });
  expect(read(3700).arrived).toBe(false);
});
