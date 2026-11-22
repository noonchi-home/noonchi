export interface BeerScope { home: string; user: string; device: string }
type BeerStamp = BeerScope & { originId: string; atMs: number };
export type BeerTvEdge = "tv_on" | "tv_off";
export type BeerEvent = BeerStamp & (
  { kind: BeerTvEdge } | { kind: "beer_taken" | "can_put_away"; object: string; provenance: "resident" | "assistance" }
);
export interface BeerContext { weekday: number | null; hour: number | null }
export type BeerAction = "맥주 가져다주기" | "맥주 캔 치우기";
export interface BeerRule extends BeerContext, BeerScope {
  action: BeerAction;
  trigger: BeerTvEdge;
  seen: number;
  matched: number;
  baseline: number;
  p: number;
}
