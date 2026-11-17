// 시연 준비 명령. 서버 밖에서 시연 집 폴더(RUNTIME_DIR)를 만들고, 켜진 서버에 장면 시작 위치를 넣고, 반성을 차례로 부른다.
//   day1  [--dir runtime/demo/day1] [--fresh]          빈 기록 DB·설정·승인·수업 기록·시작 위치(cup)
//   week  [--dir runtime/demo/week] [--end 어제] [--fresh]  day1과 같은 파일(시작 위치 tv) + 합성 7일 관찰만(seedHistory memories none)
//   start <cup|tv|microwave|kitchen> [--api URL]         서버의 지금 집이 한양목련 180B일 때 그 장면 시작 위치를 넣는다
//   reflect --chain [--api URL] [--from 1일차] [--to 6일차]  1~6일을 차례로 반성한다(된 날은 건너뛴다)
//   reflect [--api URL] [--day 어제]                      어제를 반성해 오늘부터 쓰게 한다(폰을 켜기 전에)
//   reflect --scripted [--dir runtime/demo/week]          서버를 끈 채 합성 판본(말없이 에어컨 켜는 습관)을 오늘부터로 넣는다
// 한 폴더 안에서 판본·날 고정을 지우거나 덮지 않는다. 다시 할 때는 서버를 끄고 week --fresh부터 한다.
import { existsSync, mkdirSync, readdirSync, renameSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import dotenv from "dotenv";
import { LessonStore, lessonsPath } from "../src/act/lessons.js";
import { ApprovalStore, approvalsPath } from "../src/agent/approval.js";
import { CUP_FSM_MEMORY, type FsmMemory } from "../src/brain/decision.js";
import { learnedRules } from "../src/brain/history/habits.js";
import { HistoryDb, historyTzMinutes } from "../src/brain/history/db.js";
import { REFLECT_TEXT } from "../src/brain/history/labels.js";
import { isDay } from "../src/brain/history/summary.js";
import { DEFAULT_TWIN_DIR, resolveTwinStudioDir } from "../src/layout/twin-files.js";
import { ServerLockError, acquireServerLock, restoreNeeded, restoreNeededPath, serverLockPath, type HeldServerLock } from "../src/server/lock.js";
import { resolveHome } from "../src/layout/homes.js";
import { loadScene } from "../src/layout/scene.js";
import { TASKS } from "../src/act/tasks.js";
import { describeStart, parseStartPose, startPosePath, type DescribeObject } from "../src/phone/sync/start.js";
import { DEMO_STARTS, startFor, type DemoScene } from "./demo-start.js";
import { seedHistory } from "./seed-history.js";

export const DEMO_HOME = "mokryeon_180b";
const RAMEN = "라면 끓이기 알려 주기";
/** 시연 폴더에 미리 넣는 첫 승인(처음 하는 일 질문을 건너뛴다). */
export const DEMO_APPROVALS = ["컵 치우기", "컵에 물 채워 주기", "에어컨 켜기", RAMEN, "전자레인지로 데우기 알려 주기"];
/** 라면 수업 기록 한 판: 사람 단계(서버 글 이름)마다 혼자 해냈는가. 이동과 냄비 꺼내기는 혼자 해냈다. */
const RAMEN_RUN = [
  { label: "수납장으로 가기", alone: true }, { label: "냄비 꺼내기", alone: true }, { label: "싱크대로 가기", alone: true }, { label: "물 받기", alone: false },
  { label: "인덕션으로 가기", alone: true }, { label: "냄비 올리기", alone: false }, { label: "인덕션 켜기", alone: false }, { label: "면과 스프 넣기", alone: false },
  { label: "인덕션 끄기", alone: false },
];
/** 말없이 에어컨을 켜는 규칙인가: 에어컨 켜기 규칙 가운데 seed 덥다 규칙이 아닌 것. */
const SEED_RULES = CUP_FSM_MEMORY.states.flatMap((s) => s.rules);
export const silentAircon = (r: { trigger: string; action: string }) => r.action === "에어컨 켜기" && !SEED_RULES.some((x) => x.trigger === r.trigger && x.action === r.action);

/** 멈춤: 까닭을 찍고 끝낸다(종료 코드 1). */
export class DemoStop extends Error {}

export interface DemoDeps {
  env: Record<string, string | undefined>;
  log?: (line: string) => void;
  now?: () => number;
  /** 항목 옮기기(기본 renameSync). 시험이 실패를 넣는다. */
  rename?: (from: string, to: string) => void;
  /** --fresh 표시 파일 쓰기(기본 writeFileSync). 시험이 실패를 넣는다. */
  writeMarker?: (path: string, text: string) => void;
}

type RuleLine = { state: string; trigger: string; action: string };
type MemoryDay = { ok: true; day: string; pinned: number | null; uses: { version: number; source: string; appliesDay: string | null; day: string | null } | null; latest: number | null };

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export async function demoSetup(argv: string[], deps: DemoDeps): Promise<void> {
  const log = deps.log ?? console.log;
  const now = deps.now ?? (() => Date.now());
  const rename = deps.rename ?? renameSync;
  const writeMarker = deps.writeMarker ?? ((path: string, text: string) => writeFileSync(path, text));
  const arg = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const has = (k: string) => argv.includes(k);
  const tz = historyTzMinutes(deps.env);
  const today = new Date(now() + tz * 60_000).toISOString().slice(0, 10);
  const api = (arg("--api") ?? "http://127.0.0.1:8200").replace(/\/$/, "");
  const twinDir = resolveTwinStudioDir(deps.env.TWIN_STUDIO_DIR) || DEFAULT_TWIN_DIR;
  const day = (k: string, fallback: string) => {
    const v = arg(k) ?? fallback;
    if (!isDay(v)) throw new DemoStop(`${k}는 YYYY-MM-DD 날짜여야 해요: ${v}`);
    return v;
  };

  const call = async <T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> => {
    let r: Response;
    try {
      r = await fetch(`${api}${path}`, { method, headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) {
      throw new DemoStop(`서버에 닿지 않아요(${api}): ${(e as Error).message}`);
    }
    const json = (await r.json().catch(() => ({}))) as T & { error?: string };
    if (!r.ok) throw new DemoStop(`${method} ${path} 실패(${r.status}): ${json.error ?? ""}`.trim());
    return json;
  };
  // 그 폴더의 서버 잠금(RUNTIME_DIR/server.lock.db, src/server/lock.ts)을 잡는다: 그 폴더를 쓰는 서버가 켜져 있으면(다른 포트여도) 잡지 못해 멈춘다.
  // 잡은 동안에는 서버가 그 폴더로 뜨지 못한다. 일이 끝나면 놓는다
  const holdFolder = (dir: string): HeldServerLock => {
    let held: HeldServerLock;
    try {
      held = acquireServerLock(dir);
    } catch (e) {
      if (e instanceof ServerLockError) throw new DemoStop(`서버를 먼저 끄세요: 이 폴더를 쓰는 서버가 켜져 있어요(${dir})`);
      throw e;
    }
    // 앞 --fresh가 옛 항목을 다 되돌리지 못한 폴더면 멈춘다
    const unfinished = restoreNeeded(dir);
    if (unfinished) {
      held.release();
      throw new DemoStop(unfinished);
    }
    return held;
  };
  // --fresh: 잠금 파일(server.lock.db…)·표시 파일을 뺀 옛 항목을 <dir>.old-<시각>/(그 이름이 이미 있으면 <dir>.old-<시각>-2/…)으로 하나씩 옮긴다.
  // 옮기기 전에 표시 파일(RESTORE_NEEDED.json: 백업 위치·옮길 항목)을 먼저 쓰고, 쓰지 못하면 아무것도 옮기지 않고 멈춘다.
  // 표시 파일은 옮기기와 새로 쓰기가 다 끝났을 때(또는 옮기기가 실패해 다 되돌렸을 때)만 지운다. 그 전에는 서버·준비 명령이 그 폴더로 시작하지 않는다.
  // 하나라도 못 옮기면 옮긴 것을 끝까지 되돌려 보고, 못 돌린 항목은 표시 파일에 적는다. 돌려준 값: 다 끝난 뒤 지울 표시 파일(옮길 것이 없으면 null)
  const moveOldEntries = (dir: string): string | null => {
    const lockFile = basename(serverLockPath(dir));
    const marker = restoreNeededPath(dir);
    const names = readdirSync(dir).filter((n) => !n.startsWith(lockFile) && n !== basename(marker));
    if (!names.length) return null;
    // 백업 폴더는 새로 만들어서 이름을 잡는다: 같은 이름(같은 초)이 이미 있으면 그 폴더는 두고 뒤에 -2, -3…을 붙인다
    const stamp = `${dir}.old-${new Date(now()).toISOString().replace(/[-:]/g, "").replace(/\..*$/, "")}`;
    let old = "";
    for (let n = 1; !old; n++) {
      const name = n === 1 ? stamp : `${stamp}-${n}`;
      try {
        mkdirSync(name);
        old = name;
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code !== "EEXIST" || n >= 100) throw new DemoStop(`백업 폴더를 만들지 못해 옮기지 않았어요(${name}: ${code ?? (e as Error).message})`);
      }
    }
    // 이번 호출이 만든 백업 폴더만, 비어 있을 때만 지운다
    const dropBackup = () => {
      try {
        rmdirSync(old);
      } catch { /* 비어 있지 않으면 둔다 */ }
    };
    const mark = (extra: Record<string, unknown> = {}) =>
      writeMarker(marker, `${JSON.stringify({ version: 1, backup: old, entries: names, at: new Date(now()).toISOString(), ...extra }, null, 2)}\n`);
    try {
      mark();
    } catch (e) {
      rmSync(marker, { force: true });
      dropBackup();
      throw new DemoStop(`표시 파일을 쓰지 못해 옮기지 않았어요(${marker}: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message})`);
    }
    const done: string[] = [];
    try {
      for (const n of names) {
        rename(join(dir, n), join(old, n));
        done.push(n);
      }
    } catch (e) {
      const why = (e as NodeJS.ErrnoException).code ?? (e as Error).message;
      const missing: string[] = [];
      for (const n of done.reverse()) {
        try {
          rename(join(old, n), join(dir, n));
        } catch {
          missing.push(n);
        }
      }
      if (!missing.length) {
        dropBackup();
        rmSync(marker, { force: true });
        throw new DemoStop(`옛 항목을 옮기지 못했어요(${dir}: ${why}). 그 폴더 파일을 연 프로그램을 끈 뒤 다시 하세요`);
      }
      try {
        mark({ missing });
      } catch { /* 먼저 쓴 표시 파일(옮길 항목 전부)이 남아 있다 */ }
      log(`옛 항목을 다 되돌리지 못했어요. 표시 파일: ${marker} (백업 ${old}, 못 돌린 항목 ${missing.join(", ")})`);
      throw new DemoStop(restoreNeeded(dir)!);
    }
    log(`옛 항목을 옮겼어요: ${old}`);
    return marker;
  };
  // --api 주소의 서버도 꺼져 있어야 한다: 연결을 거부할 때(ECONNREFUSED)만 꺼졌다고 본다. 답이 늦거나(시간 초과) 그 밖의 오류면 켜져 있을 수 있어 멈춘다
  const requireServerOff = async () => {
    let why: string;
    try {
      await fetch(`${api}/api/health`, { signal: AbortSignal.timeout(1500) });
      throw new DemoStop("서버를 먼저 끄세요");
    } catch (e) {
      if (e instanceof DemoStop) throw e;
      const cause = (e as { cause?: { code?: string; errors?: { code?: string }[] } }).cause;
      const code = cause?.code ?? cause?.errors?.find((x) => x.code)?.code;
      if (code === "ECONNREFUSED") return;
      why = (e as Error).name === "TimeoutError" ? "1.5초 안에 답이 없음" : code ?? (e as Error).message;
    }
    throw new DemoStop(`서버가 꺼졌는지 알 수 없어요(${api}: ${why}). 서버를 끈 뒤 다시 하세요`);
  };
  const lastReflection = async () => {
    const r = await call<{ rows: { data: { learned?: RuleLine[]; active?: RuleLine[] } | null }[] }>("GET", "/api/history?kinds=reflection&limit=1");
    const data = r.rows.at(-1)?.data ?? {};
    return { learned: data.learned ?? [], active: data.active ?? [] };
  };
  const rulesLine = (rs: RuleLine[]) => (rs.length ? rs.map((x) => `${x.state}: ${x.trigger} → ${x.action}`).join(" / ") : "없음");

  const [cmd, scene] = argv;
  if (cmd === "day1" || cmd === "week") {
    const dir = resolve(arg("--dir") ?? join("runtime", "demo", cmd));
    const fresh = has("--fresh");
    const dbPath = join(dir, "noonchi.db");
    mkdirSync(dir, { recursive: true });
    // 그 폴더 잠금을 끝까지 한 번도 놓지 않는다(그동안 서버가 이 폴더로 뜨지 못한다). --fresh는 폴더를 옮기지 않고 잠금을 쥔 채 옛 항목을 옮긴다
    const folder = holdFolder(dir);
    try {
      let marker: string | null = null;
      if (fresh) {
        await requireServerOff();
        marker = moveOldEntries(dir);
      }
      // 잠금을 잡은 뒤에 본다: 준비 명령 둘이 같은 폴더를 함께 돌려도 뒤쪽은 앞쪽이 만든 DB를 보고 멈춘다
      if (existsSync(dbPath)) throw new DemoStop(`기록 DB가 이미 있어요(${dbPath}). --fresh로 새로 시작하세요`);
      writeFileSync(join(dir, "setup.json"), `${JSON.stringify({ version: 1, home: DEMO_HOME, done: true, mode: "test" }, null, 2)}
`);
      const at = () => new Date(now()).toISOString();
      const approvals = new ApprovalStore(approvalsPath(dir, DEMO_HOME), at);
      for (const name of DEMO_APPROVALS) approvals.answer(`task:${name}`, "approve");
      const lessons = new LessonStore(lessonsPath(dir, DEMO_HOME));
      for (let i = 0; i < 2; i++) lessons.record(RAMEN, RAMEN_RUN, at());
      writeStart(dir, twinDir, cmd === "day1" ? "cup" : "tv");
      const db = HistoryDb.open(dbPath, tz);
      try {
        if (cmd === "week") {
          const end = day("--end", addDays(today, -1));
          const r = seedHistory(db, { home: DEMO_HOME, end, memories: "none", twinDir });
          log(`합성 관찰 7일을 넣었어요: ${r.days[0]} ~ ${r.days.at(-1)}, 기억 판본 ${r.versions.join(", ")}판(seed)`);
        }
      } finally {
        db.close();
      }
      // 옮기기와 새로 쓰기가 다 끝났다: 표시 파일을 지운다
      if (marker) rmSync(marker, { force: true });
      log(`시연 폴더를 만들었어요: ${dir} (RUNTIME_DIR=${dir})`);
    } finally {
      folder.release();
    }
    return;
  }

  if (cmd === "start") {
    if (!scene || !Object.hasOwn(DEMO_STARTS, scene)) throw new DemoStop(`장면은 ${Object.keys(DEMO_STARTS).join("·")} 가운데 하나예요`);
    const homes = await call<{ current: string | null }>("GET", "/api/homes");
    if (homes.current !== DEMO_HOME) throw new DemoStop(`서버의 지금 집이 ${homes.current ?? "없음"}이에요. ${DEMO_HOME}으로 띄우세요`);
    const s = DEMO_STARTS[scene as DemoScene];
    const pose = startFor(sceneOf(twinDir), s.target, s.distanceM);
    const r = await call<{ start: { label: string } }>("POST", "/api/phone/start-pose", { home: DEMO_HOME, ...pose });
    log(`시작 위치를 넣었어요(${scene}): ${r.start.label} [${pose.position.join(", ")}] ${pose.yaw_deg}°`);
    return;
  }

  if (cmd === "reflect" && has("--scripted")) {
    const dir = resolve(arg("--dir") ?? join("runtime", "demo", "week"));
    const dbPath = join(dir, "noonchi.db");
    if (!existsSync(dbPath)) throw new DemoStop(`기록 DB가 없어요(${dbPath}). week부터 하세요`);
    // 그 폴더의 잠금을 쥔 채로 넣는다(그동안 서버가 이 폴더로 뜨지 못한다)
    const folder = holdFolder(dir);
    try {
      await requireServerOff();
      // 잠금을 잡은 뒤에 다시 본다(그 사이 다른 준비 명령이 옛 항목을 옮겼을 수 있다)
      if (!existsSync(dbPath)) throw new DemoStop(`기록 DB가 없어요(${dbPath}). week부터 하세요`);
    } catch (e) {
      folder.release();
      throw e;
    }
    const db = HistoryDb.open(dbPath, tz);
    try {
      if (db.pinnedMemory(today) !== null) throw new DemoStop(`오늘(${today}) 기억이 이미 고정됐어요. 폰을 켜기 전에 넣어야 해요. week --fresh로 다시 시작하세요`);
      // 합성 대본 판본(scripted + habit)의 마지막 판본: 서버와 같은 기록 DB 함수로 만든다
      const yesterday = addDays(today, -1);
      const scratch = HistoryDb.open(":memory:", tz);
      let memory: FsmMemory;
      try {
        const r = seedHistory(scratch, { home: DEMO_HOME, end: yesterday, memories: "scripted", habit: true, twinDir });
        memory = scratch.memoryVersion(r.latest!.version)!.memory as FsmMemory;
      } finally {
        scratch.close();
      }
      const before = (db.memoryFor(today)?.memory as FsmMemory | undefined) ?? CUP_FSM_MEMORY;
      const keep = (rs: RuleLine[]) => rs.filter((x) => !TASKS[x.action]?.coach);
      const learned = keep(learnedRules(before, memory));
      const active = keep(learnedRules(CUP_FSM_MEMORY, memory));
      const version = db.saveMemory({ kind: "fsm", memory, day: yesterday, appliesDay: today, source: "synthetic" });
      db.add("reflection", now(), REFLECT_TEXT.done(version, today), { data: { day: yesterday, ok: true, version, applies_day: today, synthetic: true, learned, active, dropped: [] } });
      log(`합성 판본 ${version}판을 ${today}부터 쓰게 넣었어요. 영상 자막: 합성 기록으로 만든 습관`);
      log(`  쓰는 습관: ${rulesLine(active)}`);
    } finally {
      db.close();
      folder.release();
    }
    return;
  }

  if (cmd === "reflect" && has("--chain")) {
    const from = day("--from", addDays(today, -7));
    const to = day("--to", addDays(today, -2));
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const next = addDays(d, 1);
      const before = await call<MemoryDay>("GET", `/api/memory/day/${next}`);
      if (before.uses?.source === "reflection" && before.uses.day === d && before.uses.appliesDay === next) {
        log(`${d}: 이미 반성했어요(${before.uses.version}판, ${next}부터). 건너뛰어요`);
        continue;
      }
      if (before.pinned !== null) throw new DemoStop(`${d}: 앞 판의 고정이 남아 있어요. 서버를 끄고 week --fresh로 다시 시작하세요`);
      const r = await call<{ version: number; appliesDay: string }>("POST", "/api/reflection/run", { day: d });
      if (r.appliesDay !== next) throw new DemoStop(`${d}: 새 판본이 ${r.appliesDay}부터예요(${next}부터여야 해요)`);
      const after = await call<MemoryDay>("GET", `/api/memory/day/${next}`);
      if (after.uses?.version !== r.version) throw new DemoStop(`${d}: ${next}에 쓸 판본이 ${after.uses?.version ?? "없음"}판이에요(${r.version}판이어야 해요)`);
      const got = await lastReflection();
      log(`${d}: 반성 ${r.version}판, ${next}부터 · 새로 배움 ${rulesLine(got.learned)} · 쓰는 습관 ${rulesLine(got.active)}`);
    }
    return;
  }

  if (cmd === "reflect") {
    const d = day("--day", addDays(today, -1));
    const before = await call<MemoryDay>("GET", `/api/memory/day/${today}`);
    if (before.pinned !== null) throw new DemoStop(`오늘(${today}) 기억이 이미 ${before.pinned}판으로 고정됐어요. 폰을 켜기 전에 반성하세요`);
    const r = await call<{ version: number; appliesDay: string }>("POST", "/api/reflection/run", { day: d });
    if (r.appliesDay !== today) throw new DemoStop(`${d}: 새 판본이 ${r.appliesDay}부터예요(오늘 ${today}부터여야 해요)`);
    const after = await call<MemoryDay>("GET", `/api/memory/day/${today}`);
    if ((after.pinned !== null && after.pinned !== r.version) || after.uses?.version !== r.version) throw new DemoStop("반성 중에 판단이 오늘 기억을 고정했어요");
    const got = await lastReflection();
    log(`${d}: 반성 ${r.version}판, 오늘부터 · 새로 배움 ${rulesLine(got.learned)} · 쓰는 습관 ${rulesLine(got.active)}`);
    if (got.active.some(silentAircon)) log("말없이 에어컨을 켜는 규칙이 있어요");
    else log("말없이 에어컨을 켜는 규칙이 없어요. 서버를 끄고 reflect --scripted를 권해요");
    return;
  }

  throw new DemoStop("쓰는 법: day1 | week | start <cup|tv|microwave|kitchen> | reflect [--chain | --scripted]");
}

function sceneOf(twinDir: string) {
  const scene = loadScene(resolveHome(twinDir, DEMO_HOME));
  if (!scene) throw new DemoStop(`${DEMO_HOME} 장면이 없어요`);
  return scene;
}

/** 장면 시작 위치를 그 집 폴더 phone-start.json에 쓴다(설정 화면 저장과 같은 모양·검사). */
function writeStart(dir: string, twinDir: string, scene: DemoScene): void {
  const s = sceneOf(twinDir);
  const pose = startFor(s, DEMO_STARTS[scene].target, DEMO_STARTS[scene].distanceM);
  const rooms = (s.plan.rooms ?? []) as { label?: string; polygon?: number[][] }[];
  const start = parseStartPose(pose, null, (p, yaw) => describeStart(s.objects as DescribeObject[], rooms, p, yaw), rooms);
  const path = startPosePath(dir, DEMO_HOME);
  mkdirSync(join(dir, "homes", DEMO_HOME), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ version: 1, start }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  dotenv.config({ quiet: true });
  demoSetup(process.argv.slice(2), { env: process.env }).catch((e: unknown) => {
    console.error(e instanceof DemoStop ? e.message : `시연 준비를 하지 못했어요: ${(e as Error).message}`);
    process.exit(1);
  });
}
