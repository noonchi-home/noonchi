import { afterEach, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type TwinHomeApp } from "../src/server/app.js";
import { makeHome } from "./helpers/home.js";

let app:TwinHomeApp|undefined, runtime:string;
afterEach(async()=>{ await app?.close(); if(runtime) rmSync(runtime,{recursive:true,force:true}); });
async function open(){
  runtime=mkdtempSync(join(tmpdir(),"home-scenes-"));
  const dir=join(runtime,"homes","one","scenes");
  mkdirSync(dir,{recursive:true});
  writeFileSync(join(dir,"manifest.json"),JSON.stringify([{home:"one",id:"kitchen_C",file:"kitchen_C.png",yaw_deg:17}]));
  writeFileSync(join(dir,"kitchen_C.png"),Buffer.from([137,80,78,71]));
  writeFileSync(join(dir,"private.png"),"other");
  const signed:string[][]=[];
  app=createApp({hub:makeHome().hub,home:{id:"one",name:"집"},homes:[{id:"one",name:"집"}],
    localizeStatus:()=>({map_rev:"m",references:2,last:{confidence:.85}}),
    sceneRuntimeDir:runtime,signShot:async(home,scene)=>{signed.push([home,scene]);return {photo:{url:"photo"},label:{url:"label"},expires_in:600};}});
  const {url}=await app.listen(0,"127.0.0.1");return {url,signed};
}
it("집의 장면 목록에 실제 PNG 주소를 붙이고 목록에 없는 파일과 다른 집은 내주지 않는다",async()=>{
  const {url}=await open();
  const status=await fetch(url+"/api/localize");
  expect(await status.json()).toMatchObject({localize:{map_rev:"m",references:2,last:{confidence:.85}}});
  const response=await fetch(url+"/api/homes/one/scenes");expect(response.status).toBe(200);
  const {scenes}=await response.json() as {scenes:{id:string; yaw_deg:number; image_url:string}[]};
  expect(scenes).toHaveLength(1);expect(scenes[0]).toMatchObject({id:"kitchen_C",yaw_deg:17});
  const img=await fetch(url+scenes[0].image_url);
  expect(img.headers.get("content-type")).toBe("image/png");expect((await img.arrayBuffer()).byteLength).toBe(4);
  expect((await fetch(url+scenes[0].image_url.replace("kitchen_C","private"))).status).toBe(404);
  expect((await fetch(url+"/api/homes/other/scenes")).status).toBe(404);
});
it("등록된 장면 하나의 JPEG와 라벨 업로드 주소를 요청한다",async()=>{
  const {url,signed}=await open();
  const post=(home:string,scene:string)=>fetch(url+"/api/homes/"+home+"/shots",{method:"POST",body:JSON.stringify({scene_id:scene})});
  const res=await post("one","kitchen_C");expect(res.status).toBe(200);expect(await res.json()).toMatchObject({expires_in:600});
  expect((await post("one","other")).status).toBe(404);expect((await post("wrong","kitchen_C")).status).toBe(404);
  expect(signed).toEqual([["one","kitchen_C"]]);
});
