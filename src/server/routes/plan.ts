// API 경로: 클로이드 계획(docs/plan-contract.md) 보기·보내기·단계 상태.
import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { z } from "zod";
import type { PlanView } from "../../contract/plan.js";
import { HttpError, KO_ERRORS, readJson, type RouteKit } from "./kit.js";

// 클로이드 계획(docs/plan-contract.md). 글은 화면에 그대로 나가므로 화면 글 규칙(60자 아래, 화살표·괄호 없음)을 여기서도 본다
const PlanCopy = z.string().max(60).refine((t) => !/→|⇒|->|=>|[()]/.test(t), { error: "화살표·괄호 없이 지금 상태나 할 일만 써 주세요" });
const XZSchema = z.tuple([z.number(), z.number()]);
const PlanSchema = z.object({
  id: z.string().min(1).max(200),
  revision: z.number().int().min(1),
  supersedes: z.string().min(1).max(200).optional(),
  origin: z.enum(["live", "mock"]).optional(),
  source: z.enum(["brain", "agent", "planner"]),
  goal: PlanCopy.min(1),
  judgment: PlanCopy,
  dryRun: z.boolean(),
  robot: z.object({ position: XZSchema.nullable(), room: z.string().nullable() }),
  path: z.array(XZSchema).max(1000),
  legs: z.array(z.object({ stepId: z.string(), end: z.number().int().min(0) })),
  steps: z.array(z.object({
    id: z.string().min(1).max(200),
    kind: z.enum(["move", "act", "ask", "device", "wait"]),
    label: PlanCopy.min(1),
    target: z.object({ objectId: z.string().optional(), deviceId: z.string().optional(), room: z.string().optional(), position: XZSchema.optional() }).optional(),
    status: z.enum(["pending", "active", "done", "failed", "skipped"]),
  })).min(1).max(50),
  status: z.enum(["planned", "running", "done", "cancelled", "failed"]),
  updatedAt: z.string().max(64),
}).superRefine((p, ctx) => {
  if (p.robot.position === null && p.path.length > 0) ctx.addIssue({ code: "custom", path: ["path"], message: "로봇 위치를 모르면 path는 []" });
  const moves = new Set(p.steps.filter((s) => s.kind === "move").map((s) => s.id));
  p.legs.forEach((l, i) => {
    if (!moves.has(l.stepId)) ctx.addIssue({ code: "custom", path: ["legs", i, "stepId"], message: "move 단계 id가 아님" });
    if (l.end >= p.path.length) ctx.addIssue({ code: "custom", path: ["legs", i, "end"], message: "path 밖 점 번호" });
  });
});
const StepStatusSchema = PlanSchema.shape.steps.element.shape.status;

function parsePlan(raw: unknown): PlanView {
  const r = PlanSchema.safeParse(raw, { error: KO_ERRORS });
  if (!r.success) {
    const issues = r.error.issues.map((i) => `${i.path.join(".") || "plan"}: ${i.message}`).join("; ");
    throw new HttpError(400, `계획 형식이 올바르지 않습니다: ${issues}`);
  }
  return r.data as PlanView;
}

/** 같은 PC에서 온 요청인가(127.0.0.1·::1). */
export const isLoopback = (address: string | undefined): boolean => !!address && /^(127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+)$/.test(address);

const digest = (s: string) => createHash("sha256").update(s).digest();

/** 계획을 보낼 수 있는가: 같은 PC 주소이거나, PLAN_TOKEN이 있고 Authorization: Bearer <토큰>이 맞다.
 *  compose로 띄우면 호스트·tailscale serve에서 온 요청도 컨테이너에는 Docker 브리지 주소로 보이므로 토큰을 쓴다. */
export function canSendPlan(address: string | undefined, authorization: string | undefined, token: string | undefined): boolean {
  if (isLoopback(address)) return true;
  const got = /^Bearer\s+(.+)$/i.exec(authorization?.trim() ?? "")?.[1];
  return !!token && !!got && timingSafeEqual(digest(got), digest(token));
}

export function planRoutes({ route, opts, closed }: RouteKit): void {
  // ── 클로이드 계획 ──

  route("GET", /^\/api\/plan$/, async () => ({ ok: true, plan: opts.plan?.current() ?? null, off: opts.offTrack?.() ?? null }));
  const requirePlan = (req: IncomingMessage) => {
    if (!opts.plan) throw new HttpError(404, "계획을 받을 수 없습니다(집이 아직 없음).");
    if (!canSendPlan(req.socket.remoteAddress, req.headers.authorization, opts.planToken)) throw new HttpError(403, "계획은 서버와 같은 PC에서 보내거나 PLAN_TOKEN을 붙여 보내야 합니다.");
    if (closed()) throw new HttpError(503, "집을 바꾸는 중이에요. 잠시 뒤 다시 해 주세요.");
    return opts.plan;
  };
  route("POST", /^\/api\/plan$/, async (req) => {
    const plans = requirePlan(req);
    plans.put(parsePlan((await readJson(req)).plan));
    return { ok: true, plan: plans.current() };
  });
  route("POST", /^\/api\/plan\/([^/]+)\/steps\/([^/]+)$/, async (req, _url, [id, stepId]) => {
    const plans = requirePlan(req);
    const r = StepStatusSchema.safeParse((await readJson(req)).status);
    if (!r.success) throw new HttpError(400, "status는 pending·active·done·failed·skipped 중 하나여야 합니다.");
    if (!plans.setStep(id!, stepId!, r.data)) throw new HttpError(404, `지금 계획에 없는 단계입니다: ${id} ${stepId}`);
    return { ok: true, plan: plans.current() };
  });
}
