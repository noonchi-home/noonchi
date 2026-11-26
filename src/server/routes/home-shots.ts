import { existsSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { repoPath } from "../../shared/paths.js";
import { HttpError, readJson, type RouteKit } from "./kit.js";
import type { AppOptions } from "../app.js";

const token = /^[A-Za-z0-9_-]+$/;
const manifest = z.array(z.looseObject({id:z.string().regex(token), file:z.string(), home:z.string().optional()}));
const run = promisify(execFile);

export function shotSigner(runtimeDir:string, env:Record<string,string|undefined>):AppOptions["signShot"] {
  const bucket=env.LOCALIZE_BUCKET;
  if(!bucket) return undefined;
  const venv=join(runtimeDir,"localize-venv",process.platform==="win32"?"Scripts/python.exe":"bin/python");
  const python=env.LOCALIZE_PYTHON ?? (existsSync(venv)?venv:"python");
  return async(home,scene)=>{
    try {
      const {stdout}=await run(python,["-B",repoPath("localize/sign_shot.py"),bucket,home,scene],
        {windowsHide:true,timeout:12_000,env:{...process.env,...env}});
      return JSON.parse(stdout);
    } catch {
      throw new HttpError(503,"S3 업로드 주소를 만들 수 없습니다.");
    }
  };
}

function catalog(opts:AppOptions, home:string) {
  const homes=opts.homes ?? (opts.home ? [opts.home] : []);
  if(!token.test(home) || !homes.some(h=>h.id===home) || !opts.sceneRuntimeDir)
    throw new HttpError(404,"이 집의 촬영 장면이 없습니다.");
  const scoped=join(opts.sceneRuntimeDir,"homes",home,"scenes");
  for(const dir of [scoped,join(opts.sceneRuntimeDir,"shots"),join(opts.sceneRuntimeDir,"localize-reference")]) {
    const path=join(dir,"manifest.json");
    if(!existsSync(path)) continue;
    const rows=manifest.parse(JSON.parse(readFileSync(path,"utf8")));
    // A shared capture directory must identify its home in every row.
    if(rows.some(r=>r.home!==home && !(dir===scoped && r.home===undefined))) continue;
    if(rows.some(r=>r.file!==r.id+".png") || new Set(rows.map(r=>r.id)).size!==rows.length)
      throw new Error("트윈 장면 목록의 파일 또는 장면 id가 잘못됐습니다.");
    return {dir, rows};
  }
  throw new HttpError(404,"이 집의 촬영 장면 목록이 없습니다.");
}

export function sceneImage(opts:AppOptions, home:string, id:string) {
  const {dir,rows}=catalog(opts,home);
  return rows.some(row=>row.id===id) ? dir : null;
}

export function shotRoutes({route,opts}:RouteKit) {
  route("GET",/^\/api\/homes\/([^/]+)\/scenes$/,async (_req,_url,[home])=>{
    const {rows}=catalog(opts,home);
    const scenes=rows.map(({depth_file,depth_encoding,...r})=>({...r,image_url:`/home-scenes/${home}/${r.id}.png`}));
    return {home,scenes};
  });
  route("POST",/^\/api\/homes\/([^/]+)\/shots$/,async (req,_url,[home])=>{
    const {rows}=catalog(opts,home);
    const {scene_id}=await readJson(req);
    if(typeof scene_id!=="string" || !token.test(scene_id)) throw new HttpError(400,"장면 id가 필요합니다.");
    if(!rows.some(r=>r.id===scene_id)) throw new HttpError(404,"등록된 장면이 아닙니다.");
    if(!opts.signShot) throw new HttpError(503,"기준 사진 S3 버킷이 설정되지 않았습니다.");
    return {home,scene_id,...await opts.signShot(home,scene_id)};
  });
}
