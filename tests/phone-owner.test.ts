import { describe, expect, it } from "vitest";
import { PhoneClaims } from "../src/phone/owner.js";
import { TOPICS } from "../src/bus/topics.js";
import { Policy } from "../src/agent/policy.js";

describe("폰 한 자리", () => {
  it("같은 차례면 먼저 낸 쪽을 지키고, 높은 쪽을 거두면 바로 아래 일로 돌아온다", () => {
    const claims = new PhoneClaims();
    for (const [id, kind] of [["cup", "peek"], ["plan", "plan"], ["speech", "dialog"], ["a", "approval"], ["b", "approval"], ["off", "safety"]] as const) {
      claims.set(id, kind);
    }
    expect(claims.owner()).toEqual({ claim_id: "off", kind: "safety" });
    claims.set("off", null);
    claims.set("a", "approval");
    for (const id of ["a", "b", "speech", "plan", "cup"]) {
      expect(claims.owner()?.claim_id).toBe(id);
      claims.set(id, null);
    }
    expect(claims.owner()).toBeNull();
  });
  it("폰 명령·사용권·답의 몸에서 틀린 값, 사진, 승인 비밀 칸을 거절한다", () => {
    expect(TOPICS["/act/phone_command"].body.safeParse({ cmd: { type: "command_clear", id: "p" } }).success).toBe(true);
    expect(TOPICS["/act/phone_command"].body.safeParse({ cmd: { type: "command_clear", id: "p", jpeg: "x" } }).success).toBe(false);
    expect(TOPICS["/phone/claim"].body.safeParse({ claim_id: "p", kind: "always" }).success).toBe(false);
    expect(TOPICS["/phone/progress"].body.safeParse({ req: "p:1", kind: "button", plan_id: "p", step: "1", choice: "done", token: "secret" }).success).toBe(false);
  });
  it("가려진 승인만 남은 시간을 보존하고, 가린 동안 새로 생긴 승인도 보여 준 때부터 센다", () => {
    let t = 0;
    const policy = new Policy({ ttlMs: 100, now: () => t });
    const a = policy.issue("a", { type: "on" }, "승인 A");
    const b = policy.issue("b", { type: "on" }, "승인 B");
    policy.visibleApprovals([a.token, b.token], a.token);
    t = 80;
    policy.pause(true);
    t = 160;
    const c = policy.issue("c", { type: "on" }, "승인 C");
    policy.visibleApprovals([a.token, b.token, c.token], null);
    t = 200;
    policy.visibleApprovals([a.token, b.token, c.token], a.token);
    policy.pause(false);
    t = 221;
    expect(policy.pending().map((p) => p.token)).toEqual([b.token, c.token]);
    policy.visibleApprovals([b.token, c.token], b.token);
    t = 322;
    expect(policy.pending().map((p) => p.token)).toEqual([c.token]);
  });
});
