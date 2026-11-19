import type { Body } from "../bus/index.js";

export type ClaimKind = NonNullable<Body<"/phone/claim">["kind"]>;
type Claim = { claim_id: string; kind: ClaimKind; since_ms: number };
const PRIORITY: Record<ClaimKind, number> = { safety: 0, approval: 1, dialog: 2, plan: 3, peek: 4 };

/** 먼저 맡은 권리를 같은 등급의 새 요청이 가리지 않는다. 재접속 때 받은 순서가 달라도 같은 결과다. */
export function phoneOwner(claims: Iterable<Claim>): Body<"/phone/owner">["owner"] {
  let best: Claim | null = null;
  for (const c of claims) {
    if (!best || PRIORITY[c.kind] < PRIORITY[best.kind] || (c.kind === best.kind &&
      (c.since_ms < best.since_ms || (c.since_ms === best.since_ms && c.claim_id < best.claim_id)))) best = c;
  }
  return best ? { claim_id: best.claim_id, kind: best.kind } : null;
}

export class PhoneClaims {
  private readonly claims = new Map<string, Claim>();
  private sequence = 0;

  set(id: string, kind: ClaimKind | null, since = ++this.sequence): void {
    if (!kind) this.claims.delete(id);
    else if (this.claims.get(id)?.kind !== kind) this.claims.set(id, { claim_id: id, kind, since_ms: since });
  }

  owner() { return phoneOwner(this.claims.values()); }
}
