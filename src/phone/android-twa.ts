import type { AndroidTwaView } from "../contract/setup.js";

export const ANDROID_ASSET_LINKS_PATH = "/.well-known/assetlinks.json";
const packageName = "app.noonchi.android";
const fingerprint = /^(?:[\dA-F]{2}:){31}[\dA-F]{2}$/;

export interface AndroidAssetLink {
  relation: ["delegate_permission/common.handle_all_urls"];
  target: { namespace: "android_app"; package_name: string; sha256_cert_fingerprints: string[] };
}

export function androidTwaStatements(value?: string): AndroidAssetLink[] | undefined {
  if (!value?.trim()) return undefined;
  const values = value.split(",").map(part => part.trim().toUpperCase());
  if (!values.every(part => fingerprint.test(part))) return undefined;
  return [{
    relation: ["delegate_permission/common.handle_all_urls"],
    target: { namespace: "android_app", package_name: packageName, sha256_cert_fingerprints: [...new Set(values)] },
  }];
}

export function androidTwaTarget(phoneUrls: readonly string[], configured: boolean): AndroidTwaView | null {
  for (const address of phoneUrls) {
    let url: URL;
    try { url = new URL(address); } catch { continue; }
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
        !["/", "/phone", "/phone/"].includes(url.pathname)) continue;
    return {
      phone_url: new URL("/phone/", url.origin).href,
      assetlinks_url: new URL(ANDROID_ASSET_LINKS_PATH, url.origin).href,
      package_name: packageName,
      statements_configured: configured,
    };
  }
  return null;
}
