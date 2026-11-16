// 수업 기록(코치 모드): 코치 행동 계획을 끝낼 때마다 사람 단계마다 「도움 없이 이어서 해낸 횟수」를 남긴다(실행 추적 src/act/track/steps.ts finish가 적는다).
// 이어서 QUIET_AFTER번 혼자 해낸 단계는 다음 판부터 명령을 소리로 읽지 않고 글만 띄운다(조용한 단계). QUIET_HINT_MS 안에 안 끝나면 한 번 읽는다.
// 단계는 이름(label)으로 맞춘다. 이름이 지난번에 없던 단계는 0에서 시작하고, 이번 판에 없는 단계는 버린다. 도움을 받은 단계는 0으로 돌아간다.
// 계획이 done으로 끝날 때만 기록한다(취소·실패는 기록하지 않는다). 파일은 runtime/homes/<집>/lessons.json(승인 기억과 같은 쓰기 방식).
// 들은 말이나 관찰 글은 여기에 남기지 않는다: 행동 이름·단계 이름·횟수·시각뿐이다.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Lesson } from "../contract/plan.js";

/** 이번 판의 사람 단계 하나: 도움(다시 읽기·다시 알리기·부탁·힌트·시간 초과 질문) 없이 끝냈는가. */
export interface StepOutcome { label: string; alone: boolean }
export interface LessonBook { get(task: string): Lesson | null; record(task: string, outcomes: StepOutcome[], at: string): void }

/** 이어서 이만큼 혼자 해낸 단계는 다음부터 소리로 읽지 않는다. */
export const QUIET_AFTER = 2;
/** 조용한 단계가 이만큼(ms) 안 끝나면 한 번 읽는다. */
export const QUIET_HINT_MS = 20_000;

/** 다음 판에 조용히 띄울 단계 이름. */
export const quietLabels = (l: Lesson | null): Set<string> => new Set((l?.steps ?? []).filter((s) => s.alone >= QUIET_AFTER).map((s) => s.label));

/** 기록 파일 자리. */
export const lessonsPath = (runtimeDir: string, homeId: string) => join(runtimeDir, "homes", homeId, "lessons.json");

type Lessons = Record<string, Lesson>;

/** 이번 판을 더한 새 기록. */
function next(prev: Lesson | null, task: string, outcomes: StepOutcome[], at: string): Lesson {
  const before = new Map((prev?.steps ?? []).map((s) => [s.label, s.alone]));
  const steps = new Map<string, number>();
  // 같은 이름 단계가 한 판에 여러 번이면 하나라도 도움을 받았으면 0
  for (const o of outcomes) steps.set(o.label, o.alone && steps.get(o.label) !== 0 ? (before.get(o.label) ?? 0) + 1 : 0);
  return { task, runs: (prev?.runs ?? 0) + 1, steps: [...steps].map(([label, alone]) => ({ label, alone })), updatedAt: at };
}

const isLesson = (v: unknown): v is Lesson => {
  const l = v as Lesson | null;
  return !!l && typeof l === "object" && typeof l.task === "string" && Number.isInteger(l.runs) && typeof l.updatedAt === "string" && Array.isArray(l.steps)
    && l.steps.every((s) => !!s && typeof s.label === "string" && Number.isInteger(s.alone));
};

function read(path: string): Lessons {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, "")) as { lessons?: unknown } | null;
    const all = raw?.lessons && typeof raw.lessons === "object" ? Object.entries(raw.lessons as Record<string, unknown>) : [];
    return Object.fromEntries(all.filter((e): e is [string, Lesson] => isLesson(e[1])));
  } catch {
    return {};
  }
}

/** 파일에 남는 수업 기록. 폴더가 없으면 만들고, 임시 파일에 쓴 뒤 이름을 바꾼다. 파일이 없거나 깨졌으면 빈 기록으로 시작한다. */
export class LessonStore implements LessonBook {
  private all: Lessons;

  constructor(private readonly path: string) {
    this.all = read(path);
  }

  get(task: string): Lesson | null {
    return Object.hasOwn(this.all, task) ? structuredClone(this.all[task]!) : null;
  }

  record(task: string, outcomes: StepOutcome[], at: string): void {
    this.all = { ...this.all, [task]: next(this.get(task), task, outcomes, at) };
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({ version: 1, lessons: this.all }, null, 2)}\n`);
    renameSync(tmp, this.path);
  }
}

/** 파일 없이 이 프로세스 안에서만 기억한다(시험). */
export function memoryLessons(): LessonBook {
  let all: Lessons = {};
  return {
    get: (task) => (Object.hasOwn(all, task) ? structuredClone(all[task]!) : null),
    record: (task, outcomes, at) => { all = { ...all, [task]: next(Object.hasOwn(all, task) ? all[task]! : null, task, outcomes, at) }; },
  };
}
