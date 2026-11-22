// 시연 2번 간추린 실험 실행(2026-11-22): 합성 기록 21일을 기록 DB에 쓰고 밤마다 반성·채택 검사(runNight)를 돌려, 맥락 규칙이 몇째 밤에 처음 생기는지 본다.
//   npx tsx scripts/beer-experiment.ts --fake      가짜 AI가 정답처럼 답한다(돈 0). 호출 종류별 요청 크기(입력량)를 재서 실제 AI 비용을 미리 어림한다.
// 실제 AI(OpenAI gpt-5.4-mini 등)로 돌리는 모드는 비용·잔액 확인 뒤에 붙인다(아직 없다). 열쇠는 환경변수로만 받고 출력하지 않는다.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HistoryDb } from "../src/brain/history/db.js";
import { runNight, type NightResult } from "../src/brain/history/night.js";
import { BEER_CANDIDATES, beerRecords, fakeChunk, fakeMark } from "./beer-experiment-records.js";
import { pamClientFor, startFakePamLlm } from "../tests/helpers/pam.js";

const text = (m: { content: string | { text?: string }[] }) => (typeof m.content === "string" ? m.content : m.content.map((c) => c.text ?? "").join(""));
const HANGUL = /[가-힣]/g;

async function main(): Promise<void> {
  if (!process.argv.includes("--fake")) {
    console.error("지금은 --fake(가짜 AI 시운전)만 됩니다. 실제 AI는 비용·잔액을 확인한 뒤에 붙입니다.");
    process.exit(2);
  }
  const pam = await startFakePamLlm({ chunk: fakeChunk, reflect: () => BEER_CANDIDATES, check: () => ({ ok: true, items: [] }), mark: fakeMark });
  try {
    const db = HistoryDb.open(":memory:");
    const stats = beerRecords(db);
    const total = Object.values(stats.linesByDay).reduce((a, b) => a + b, 0);
    console.log(`기록: ${stats.days.length}일 ${total}줄 (하루 평균 ${Math.round(total / stats.days.length)}줄), 토요일 ${stats.saturdays.length}번, 낮 TV 토요일 ${stats.daytimeSaturdays.length}번`);
    const dir = mkdtempSync(join(tmpdir(), "beer-exp-"));
    const first: string[] = [];
    for (const day of stats.days) {
      const res = await runNight(db, pamClientFor(pam), day, { dir });
      if (!res.ok) { console.log(`${day}: 반성 실패 ${JSON.stringify(res)}`); continue; }
      const r = res as Extract<NightResult, { ok: true }>;
      if (r.learned.length) first.push(`${day} (새 화살표 ${r.learned.length}개)`);
    }
    console.log(`규칙이 새로 생긴 밤: ${first.join(", ") || "없음"}`);
    // 호출 종류별 요청 크기(실제로 보낸 요청 본문: 시스템 프롬프트 포함)
    const by = new Map<string, { calls: number; hangul: number; other: number }>();
    pam.requests.forEach((req, i) => {
      const role = pam.calls[i] ?? "?";
      const joined = (req.messages as { content: string | { text?: string }[] }[]).map(text).join("\n");
      const h = (joined.match(HANGUL) ?? []).length;
      const cur = by.get(role) ?? { calls: 0, hangul: 0, other: 0 };
      by.set(role, { calls: cur.calls + 1, hangul: cur.hangul + h, other: cur.other + joined.length - h });
    });
    // 토큰 어림: 한글 1자 0.6~1.2토큰, 그 밖(영어·숫자·기호) 1자 0.22~0.3토큰(토크나이저를 직접 재지 않은 가정)
    let lo = 0, hi = 0;
    console.log("호출 종류 | 호출 수 | 한글 글자 | 그 밖 글자 | 입력 토큰 어림(낮~높)");
    for (const [role, v] of [...by.entries()].sort()) {
      const a = Math.round(v.hangul * 0.6 + v.other * 0.22), b = Math.round(v.hangul * 1.2 + v.other * 0.3);
      lo += a; hi += b;
      console.log(`${role} | ${v.calls} | ${v.hangul} | ${v.other} | ${a.toLocaleString()} ~ ${b.toLocaleString()}`);
    }
    console.log(`합계 입력 토큰 어림: ${lo.toLocaleString()} ~ ${hi.toLocaleString()}`);
  } finally {
    await pam.close();
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
