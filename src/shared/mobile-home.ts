export const MOKRYEON_HOME = "mokryeon_180b";
export const MOKRYEON_TWIN_PREVIEW = "/brand/mokryeon-twin-overview.webp";
export const TWIN_PREPARATION_MS = 5_000;

export const thinqListPath = (home: string) => `/api/setup/thinq?home=${encodeURIComponent(home)}`;

export async function waitForTwinPreview(startedMs: number): Promise<void> {
  const remaining = startedMs + TWIN_PREPARATION_MS - Date.now();
  if (remaining > 0) await new Promise<void>(resolve => setTimeout(resolve, remaining));
}
