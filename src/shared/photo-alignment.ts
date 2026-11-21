/** Provisional same-exposure tolerances for a calibrated home map. */
export const PHOTO_GAP_M = 0.35;
export const PHOTO_GAP_DEG = 12;

export function photoConflict(meters:number|null, degrees:number|null):boolean {
  return (meters !== null && meters > PHOTO_GAP_M) || (degrees !== null && degrees > PHOTO_GAP_DEG);
}
