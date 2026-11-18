// 승인 규칙: 허락 없이 하면 위험할 때(위험 목록, src/agent/policy.ts needsConfirm)는 늘 묻는다. 처음 하는 일이라 전에 승인받은 적 없을 때(PAM 계획) 묻기는
// 한 곳의 설정값 ASK_FIRST_TIME이고 끔이다(2026-11-18 사용자 결정: 알아서 판단해 실행하는 것을 보여 준다, 나중에 다시 정한다). 그 밖에는 묻지 않고 바로 한다.
// 말로 시킨 가전 명령은 그 말이 승인이다.
// 답은 승인·거절 둘(src/act/prompts.ts APPROVE). 승인은 기억해 같은 일은 다음부터 묻지 않고, 거절은 이번만이라 기억하지 않아 다음에 또 묻는다.
// 위험 목록은 늘 묻고 답 둘 다 이번만이다. 기억은 runtime/homes/<집>/approvals.json(재시작에도 남음). 예전 파일의 never(「하지 마」)는 읽지 않는다.
// 대시보드에는 승인을 보이지 않는다.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type { ApprovalAnswer } from "../contract/phone.js";
import type { ApprovalAnswer } from "../contract/phone.js";
/** 왜 묻는가: 위험 목록, 처음 하는 일. */
export type ApprovalWhy = "risky" | "first";
/** device:<기기 id>:<정규화된 명령 type> 또는 task:<행동 이름>. */
export type ApprovalKey = string;
/** 승인을 받은 열쇠마다 답한 때(ISO). */
export interface ApprovalMemory { always: Record<ApprovalKey, string> }
/** 기억을 읽고 답을 남기는 곳(ApprovalStore, 또는 파일 없는 memoryApprovals). */
export interface ApprovalBook { memory(): ApprovalMemory; answer(key: ApprovalKey, a: ApprovalAnswer): void }

export const deviceKey = (deviceId: string, commandType: string): ApprovalKey => `device:${deviceId}:${commandType}`;
export const taskKey = (task: string): ApprovalKey => `task:${task}`;

/** 기억 파일 자리. */
export const approvalsPath = (runtimeDir: string, homeId: string) => join(runtimeDir, "homes", homeId, "approvals.json");

const empty = (): ApprovalMemory => ({ always: {} });

/** 처음 하는 일 묻기(설정값 하나, 2026-11-18 사용자 결정: 끔. 위험 목록은 이 값과 상관없이 늘 묻는다). */
export const ASK_FIRST_TIME = false;

/** 물을지와 그 까닭. 묻지 않으면 null(바로 한다). requested: 사용자가 말로 시킨 일(가전 명령).
 *  askFirst: 처음 하는 일 묻기(없으면 ASK_FIRST_TIME. 시험이 묻는 길을 켜 볼 때만 준다). */
export function approvalNeed(o: { key: ApprovalKey; risky: boolean; requested: boolean; memory: ApprovalMemory; askFirst?: boolean }): ApprovalWhy | null {
  if (o.risky) return "risky";
  if (!(o.askFirst ?? ASK_FIRST_TIME) || o.requested || Object.hasOwn(o.memory.always, o.key)) return null;
  return "first";
}

/** 답을 기억에 넣은 새 기억. 거절은 그대로. */
export function remember(m: ApprovalMemory, key: ApprovalKey, answer: ApprovalAnswer, at: string): ApprovalMemory {
  if (answer !== "approve" || Object.hasOwn(m.always, key)) return m;
  return { always: { ...m.always, [key]: at } };
}

const isStamps = (v: unknown): v is Record<string, string> =>
  !!v && typeof v === "object" && !Array.isArray(v) && Object.values(v).every((x) => typeof x === "string");

function read(path: string): ApprovalMemory {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, "")) as { always?: unknown } | null;
    return raw && isStamps(raw.always) ? { always: { ...raw.always } } : empty();
  } catch {
    return empty();
  }
}

/** 파일에 남는 승인 기억. 폴더가 없으면 만들고, 임시 파일에 쓴 뒤 이름을 바꾼다. 파일이 없거나 깨졌으면 빈 기억으로 시작한다. */
export class ApprovalStore implements ApprovalBook {
  private mem: ApprovalMemory;

  constructor(private readonly path: string, private readonly now: () => string = () => new Date().toISOString()) {
    this.mem = read(path);
  }

  memory(): ApprovalMemory {
    return structuredClone(this.mem);
  }

  answer(key: ApprovalKey, a: ApprovalAnswer): void {
    const next = remember(this.mem, key, a, this.now());
    if (next === this.mem) return;
    this.mem = next;
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
    renameSync(tmp, this.path);
  }
}

/** 파일 없이 이 프로세스 안에서만 기억한다(집 묶음 밖에서 만든 정책). */
export function memoryApprovals(now: () => string = () => new Date().toISOString()): ApprovalBook {
  let mem = empty();
  return {
    memory: () => structuredClone(mem),
    answer: (key, a) => { mem = remember(mem, key, a, now()); },
  };
}
