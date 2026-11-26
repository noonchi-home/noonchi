import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { IR_DEFAULTS, type IrConfig } from "./ir.js";

// Wire format emitted by the Arduino. NEC has an 8-bit command, LG/LG2 a 16-bit command.
const code = z.string().regex(/^(?:NEC:[0-9A-F]{4}:[0-9A-F]{2}|LG2?:00[0-9A-F]{2}:[0-9A-F]{4})$/);
const adc = z.number().int().min(0).max(1023);
export const irSettings = z.strictObject({
  device:z.string().min(1), port:z.string().regex(/^COM[1-9][0-9]*$/),
  codes:z.strictObject({ on:code.optional(), off:code.optional(), toggle:code.optional() }),
  offBelow:adc.default(IR_DEFAULTS.offBelow), onAbove:adc.default(IR_DEFAULTS.onAbove),
  holdMs:z.number().int().min(100).default(IR_DEFAULTS.holdMs),
  confirmOnMs:z.number().int().min(200).max(15000).default(IR_DEFAULTS.confirmOnMs),
  confirmOffMs:z.number().int().min(200).max(15000).default(IR_DEFAULTS.confirmOffMs),
}).refine(s => s.offBelow < s.onAbove && s.holdMs < s.confirmOnMs && s.holdMs < s.confirmOffMs, "Check the sensor thresholds and confirmation windows")
  .refine(s => {
    const values = Object.values(s.codes);
    return values.length > 0 && new Set(values).size === values.length;
  }, "Each power key needs a distinct learned code");

/** Files saved before on/off had separate windows carry one `confirmMs`. It becomes the off window; on keeps its own default. */
export function withoutLegacyWindow(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || !("confirmMs" in raw)) return raw;
  const { confirmMs, ...rest } = raw as Record<string, unknown>;
  return { confirmOffMs: confirmMs, ...rest };
}

export function loadIrConfig(runtime: string, home: string): IrConfig | null {
  let raw: string;
  try {
    raw = readFileSync(join(runtime, "homes", home, "ir.json"), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
  return irSettings.parse(withoutLegacyWindow(JSON.parse(raw)));
}
