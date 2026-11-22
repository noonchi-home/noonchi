import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { StationMap } from "../src/contract/stations.js";
import { returnTarget } from "../src/act/robot/dock.js";
import { repoPath } from "../src/shared/paths.js";

const map:StationMap = JSON.parse(readFileSync(repoPath("twin/data/homes/mokryeon_180b/stations.json"),"utf8"));
const dock:[number,number,number]=[2,0,2];
const day={batteryLow:null,night:false,userRoom:"living"};
describe("복귀 목적지",()=>{
  it("낮에는 사용자가 있는 방의 대기 자리만 고른다",()=>{
    expect(returnTarget(day,map,dock)).toEqual({kind:"station",id:"living_standby"});
    expect(returnTarget({...day,userRoom:null},map,dock)).toBeNull();
    expect(returnTarget(day,null,dock)).toBeNull();
  });
  it("밤 또는 실제 저전력은 충전 자리가 있을 때만 이동한다",()=>{
    for(const ctx of [{...day,night:true},{...day,batteryLow:true}]) {
      expect(returnTarget(ctx,map,dock)).toEqual({kind:"dock",position:dock});
      expect(returnTarget(ctx,map,null)).toBeNull();
    }
  });
});
