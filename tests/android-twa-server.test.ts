import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startServer, type RunningServer } from "../src/server/start.js";
import type { SetupView } from "../src/contract/setup.js";

const hub = "https://demo.test.ts.net";
const phone = hub + ":8443/phone/";
const path = "/.well-known/assetlinks.json";
const fingerprint = Array.from({ length: 32 }, (_, index) => index.toString(16).padStart(2, "0")).join(":");
const appId = JSON.parse(readFileSync(new URL("../apps/android/app.json", import.meta.url), "utf8")).expo.android.package;
let server: RunningServer | undefined;
let dir: string | undefined;

afterEach(async () => {
  await server?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

async function start(fingerprints?: string, phoneUrl = phone, cameraOnlyOrigin?: string) {
  dir = mkdtempSync(join(tmpdir(), "android-twa-"));
  server = await startServer({
    env: {
      HUB: "memory", BRAIN: "0", PORT: "0", PHONE_PORT: "0", PHONE_HOST: "127.0.0.1",
      RUNTIME_DIR: dir, PHONE_URL: phoneUrl, ANDROID_TWA_SHA256_FINGERPRINTS: fingerprints,
      HUB_URL: cameraOnlyOrigin, ALLOWED_ORIGINS: cameraOnlyOrigin,
    },
    servedHubUrls: async () => [hub],
    servedPhoneUrls: cameraOnlyOrigin ? async () => [cameraOnlyOrigin + "/phone/"] : undefined,
    log: () => {},
  });
  const localPhone = server.phoneUrls.map(url => new URL(url)).find(url => url.hostname === "127.0.0.1");
  const setup = await (await fetch(server.url + "/api/setup")).json() as SetupView & { mobile_urls: string[] };
  return { hubUrl: server.url, arUrl: localPhone!.origin, setup };
}

describe("Android TWA site association", () => {
  it("serves the APK association from the camera listener and identifies port 8443 separately from the dashboard QR", async () => {
    const { hubUrl, arUrl, setup } = await start(` ${fingerprint}, ${fingerprint.toUpperCase()} `);
    const result = await fetch(arUrl + path, { redirect: "manual" });
    expect(result.status).toBe(200);
    expect(result.headers.get("content-type")).toMatch(/^application\/json\b/);
    expect(result.headers.get("location")).toBeNull();
    expect(await result.json()).toEqual([{
      relation: ["delegate_permission/common.handle_all_urls"],
      target: { namespace: "android_app", package_name: appId, sha256_cert_fingerprints: [fingerprint.toUpperCase()] },
    }]);
    expect(await (await fetch(arUrl + path, { method: "HEAD" })).text()).toBe("");
    expect((await fetch(hubUrl + path, { redirect: "manual" })).status).toBe(404);
    expect(setup.mobile_urls).toEqual([hub + "/mobile/"]);
    expect(setup.position.phone_urls[0]).toBe(phone);
    expect(setup.android_twa).toEqual({
      phone_url: phone, assetlinks_url: hub + ":8443" + path, package_name: appId, statements_configured: true,
    });
  });

  it("reports the verification target with an unconfigured statement and rejects a malformed fingerprint list", async () => {
    const { arUrl, setup } = await start(`${fingerprint},bad-value`);
    expect((await fetch(arUrl + path, { redirect: "manual" })).status).toBe(404);
    expect(setup.android_twa).toEqual({
      phone_url: phone, assetlinks_url: hub + ":8443" + path, package_name: appId, statements_configured: false,
    });
  });

  it("does not infer an HTTPS camera location from the QR or accept an unrelated HTTPS path", async () => {
    const { setup, arUrl } = await start(undefined, hub + "/mobile/");
    expect(setup.android_twa).toBeNull();
    expect((await fetch(arUrl + path)).status).toBe(404);
  });

  it("leaves a discovered camera-only origin on port 443 out of the QR candidates", async () => {
    const cameraOrigin = "https://camera.test.ts.net";
    const { setup } = await start(fingerprint, cameraOrigin, cameraOrigin);
    expect(setup.mobile_urls).toEqual([hub + "/mobile/"]);
    expect(setup.android_twa).toMatchObject({ phone_url: cameraOrigin + "/phone/", assetlinks_url: cameraOrigin + path });
  });
});
