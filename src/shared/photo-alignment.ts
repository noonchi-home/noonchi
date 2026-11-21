import limits from "./photo-limits.json" with { type: "json" };

export const PHOTO_GAP_M = limits.ar_gap_m;
export const PHOTO_GAP_DEG = limits.ar_gap_deg;
export const PHOTO_MIN_MATCHES = limits.min_matches;
export const PHOTO_MAX_RMS_PX = limits.max_rms_px;

export function photoConflict(meters:number|null, degrees:number|null):boolean {
  return (meters !== null && meters > PHOTO_GAP_M) || (degrees !== null && degrees > PHOTO_GAP_DEG);
}
