// API 경로: 기록·반성·기억 판본·판단(기록 DB, src/brain/history/).
import type { HistoryKind } from "../../contract/history.js";
import { HISTORY_KINDS } from "../../brain/index.js";
import { DAY_TEXT, daySummary, isDay } from "../../brain/index.js";
import { HttpError, readJson, type RouteKit } from "./kit.js";

export function brainRoutes({ route, opts }: RouteKit): void {
  // ── 기록 ──

  const requireHistory = () => {
    if (!opts.history) throw new HttpError(404, "기록 DB가 없습니다.");
    return opts.history;
  };
  const msParam = (url: URL, key: string) => {
    const raw = url.searchParams.get(key)?.trim();
    if (!raw) return undefined;
    const v = Number(raw);
    if (!Number.isFinite(v) || v < 0) throw new HttpError(400, `${key}는 0 이상의 시각(ms)이어야 합니다.`);
    return v;
  };
  const limitParam = (url: URL, fallback: number, max: number) => {
    const raw = url.searchParams.get("limit")?.trim();
    if (!raw) return fallback;
    const v = Number(raw);
    if (!Number.isInteger(v) || v < 1 || v > max) throw new HttpError(400, `limit는 1~${max} 사이 정수여야 합니다.`);
    return v;
  };
  // since가 없으면 최근 limit줄, 있으면 since부터 limit줄(둘 다 시각 순)
  route("GET", /^\/api\/history$/, async (_req, url) => {
    const db = requireHistory();
    const kinds = (url.searchParams.get("kinds") ?? "").split(",").map((k) => k.trim()).filter(Boolean);
    const unknown = kinds.filter((k) => !HISTORY_KINDS.includes(k as HistoryKind));
    if (unknown.length) throw new HttpError(400, `모르는 기록 종류입니다: ${unknown.join(", ")} (있는 종류: ${HISTORY_KINDS.join(", ")})`);
    const since = msParam(url, "since");
    return { ok: true, rows: db.list({ since, until: msParam(url, "until"), kinds: kinds as HistoryKind[], limit: limitParam(url, 500, 5000), latest: since === undefined }) };
  });
  route("GET", /^\/api\/history\/day\/(\d{4}-\d{2}-\d{2})$/, async (_req, _url, [day]) => {
    const db = requireHistory();
    if (!isDay(day!)) throw new HttpError(400, `없는 날짜입니다: ${day}`);
    return { ok: true, ...daySummary(db, day!) };
  });
  // 반성 바로 하기: day(기본 오늘). 그날 기록이 없거나 이미 반성 중이면 409, PAM 실패는 502
  route("POST", /^\/api\/reflection\/run$/, async (req) => {
    const db = requireHistory();
    if (!opts.reflect) throw new HttpError(404, "반성을 쓸 수 없습니다.");
    const body = await readJson(req);
    const day = body.day ?? db.dayOf(Date.now());
    if (typeof day !== "string" || !isDay(day)) throw new HttpError(400, "day는 YYYY-MM-DD 날짜여야 합니다.");
    const r = await opts.reflect(day);
    if (!r.ok) throw new HttpError(r.empty ? 409 : 502, r.error);
    return { ok: true, day, version: r.version, appliesDay: r.appliesDay };
  });
  // 시스템 날짜 상태(하루 마치기로 넘긴 날 수 포함)
  route("GET", /^\/api\/day$/, async () => {
    if (!opts.day) throw new HttpError(404, "기록 DB가 없습니다.");
    return { ok: true, ...opts.day() };
  });
  // 하루 마치기: day는 화면이 본 오늘. 막히면 404·409, 반성 실패는 502(넘기지 않는다)
  route("POST", /^\/api\/day\/finish$/, async (req) => {
    if (!opts.finishDay) throw new HttpError(404, DAY_TEXT.off);
    const body = await readJson(req);
    if (typeof body.day !== "string" || !isDay(body.day)) throw new HttpError(400, "day는 YYYY-MM-DD 날짜여야 합니다.");
    return await opts.finishDay(body.day);
  });
  // 그날 기억 고정 상태(읽기만, 고정하지 않는다): 그날 판단이 고정한 판본, 지금 판단이 부르면 쓸 판본(고정 판본, 없으면 그날 쓸 수 있는 가장 새 판본)과 그 기억 JSON, 가장 새 판본
  route("GET", /^\/api\/memory\/day\/(\d{4}-\d{2}-\d{2})$/, async (_req, _url, [day]) => {
    const db = requireHistory();
    if (!isDay(day!)) throw new HttpError(400, `없는 날짜입니다: ${day}`);
    const pinned = db.pinnedMemory(day!);
    const v = pinned !== null ? db.memoryVersion(pinned) : db.memoryFor(day!);
    return { ok: true, day, pinned, uses: v ? { version: v.version, source: v.source, appliesDay: v.appliesDay, day: v.day, memory: v.memory } : null, latest: db.latestMemoryVersion() };
  });
  route("GET", /^\/api\/decisions$/, async (_req, url) => ({ ok: true, decisions: requireHistory().decisions(limitParam(url, 20, 500)) }));
}
