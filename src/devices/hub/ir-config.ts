import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { IrConfig } from "./ir.js";

// Wire format emitted by the Arduino. NEC has an 8-bit command, LG/LG2 a 16-bit command.
const code = z.string().regex(/^(?:NEC:[0-9A-F]{4}:[0-9A-F]{2}|LG2?:00[0-9A-F]{2}:[0-9A-F]{4})$/);
const adc = z.number().int().min(0).max(1023);
export const irSettings = z.strictObject({
  device:z.string().min(1), port:z.string().regex(/^COM[1-9][0-9]*$/),
  codes:z.strictObject({ on:code.optional(), off:code.optional(), toggle:code.optional() }),
  offBelow:adc, onAbove:adc,
  holdMs:z.number().int().min(100).default(600),
  confirmMs:z.number().int().min(200).max(5000).default(4000),
}).refine(s => s.offBelow < s.onAbove && s.holdMs < s.confirmMs, "Check the sensor thresholds and confirmation window")
  .refine(s => {
    const values = Object.values(s.codes);
    return values.length > 0 && new Set(values).size === values.length;
  }, "Each power key needs a distinct learned code");

export function loadIrConfig(runtime: string, home: string): IrConfig | null {
  let raw: string;
  try {
    raw = readFileSync(join(runtime, "homes", home, "ir.json"), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
  return irSettings.parse(JSON.parse(raw));
}
