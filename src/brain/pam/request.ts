// pam-predict/3·pam-reflect/2 요청 모양(zod). 모르는 칸(사진 칸 포함)은 거절한다. 글 길이는 Python처럼 코드 포인트로 센다.
// 시각은 Python datetime.isoformat() 꼴로 바꿔 둔다: 메시지의 시각 줄이 Python과 같아야 한다.
import { z } from "zod";
import { ContractError, validateMemory, validateTasks } from "../decision.js";
import { PamRequestError } from "./errors.js";

const ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6})\d*)?)?(?:(Z)|([+-])(\d{2}):(\d{2}))$/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

const realDay = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(2000, m - 1, d));
  return y >= 1 && m >= 1 && m <= 12 && t.getUTCMonth() === m - 1 && t.getUTCDate() === d && (m !== 2 || d !== 29 || (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)));
};

/** 시간대 있는 ISO 시각 → Python isoformat 꼴. 아니면 null. */
export function pyIsoformat(s: string): string | null {
  const m = ISO.exec(s);
  if (!m) return null;
  const [, y, mo, d, h, mi, sec = "00", frac = "", z, sign, oh, om] = m;
  if (!realDay(+y!, +mo!, +d!) || +h! > 23 || +mi! > 59 || +sec > 59) return null;
  if (!z && (+oh! > 23 || +om! > 59)) return null;
  const off = z || (+oh! === 0 && +om! === 0) ? "+00:00" : `${sign}${oh}:${om}`;
  const micro = frac.padEnd(6, "0");
  return `${y}-${mo}-${d}T${h}:${mi}:${sec}${micro === "000000" ? "" : `.${micro}`}${off}`;
}

const cp = (s: string) => [...s].length;
const text = (min: number, max: number) => z.string().refine((s) => cp(s) >= min && cp(s) <= max, { message: `${min}~${max}자여야 합니다` });
const kind = z.enum(["list", "fsm"]);
const memory = z.record(z.string(), z.unknown());

const PredictSchema = z.strictObject({
  contract: z.literal("pam-predict/3"),
  final_time: z.string().transform((s, ctx) => pyIsoformat(s) ?? (ctx.addIssue({ code: "custom", message: "시간대가 있는 ISO 시각이어야 합니다" }), z.NEVER)),
  observation_text: text(1, 20_000),
  memory_kind: kind,
  memory,
  tasks: z.array(z.string()).min(1),
  last_state: z.string().min(1).nullable(),
});
const ReflectSchema = z.strictObject({
  contract: z.literal("pam-reflect/2"),
  day: z.string().refine((s) => { const m = DAY.exec(s); return !!m && realDay(+m[1]!, +m[2]!, +m[3]!); }, { message: "YYYY-MM-DD여야 합니다" }),
  memory_kind: kind,
  memory,
  observation_text: text(1, 100_000),
  action_summary: text(1, 50_000),
  feedback: text(0, 8_000).nullable().default(null),
});
export type PredictRequest = z.infer<typeof PredictSchema>;
export type ReflectRequest = z.infer<typeof ReflectSchema>;

function parse<T>(schema: z.ZodType<T>, body: unknown, check: (r: T) => void): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new PamRequestError(`PAM 요청이 계약에 맞지 않음: ${z.prettifyError(r.error)}`);
  try {
    check(r.data);
  } catch (e) {
    if (e instanceof ContractError) throw new PamRequestError(`PAM 요청이 계약에 맞지 않음: ${e.message}`);
    throw e;
  }
  return r.data;
}

/** 판단 요청: 모양 → 행동 목록 → 기억(Python build_predict_messages와 같은 차례). */
export const predictRequest = (body: unknown): PredictRequest =>
  parse(PredictSchema, body, (r) => { validateTasks(r.tasks); validateMemory(r.memory, r.memory_kind); });
/** 반성 요청: 모양 → 기억. */
export const reflectRequest = (body: unknown): ReflectRequest =>
  parse(ReflectSchema, body, (r) => { validateMemory(r.memory, r.memory_kind); });
