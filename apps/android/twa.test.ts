import assert from "node:assert/strict";
import { test } from "node:test";
import { readTwaTarget } from "./twa.ts";

const configured = { android_twa: {
  phone_url: "https://hub.example.test:8443/phone/",
  assetlinks_url: "https://hub.example.test:8443/.well-known/assetlinks.json",
  package_name: "app.noonchi.android",
  statements_configured: true,
} };

test("TWA validates the AR listener origin and its port independently of the dashboard", () => {
  assert.deepEqual(readTwaTarget(configured), {
    url: "https://hub.example.test:8443/phone/", origin: "https://hub.example.test:8443",
  });
  for (const other of ["https://hub.example.test/.well-known/assetlinks.json", "https://elsewhere.test:8443/.well-known/assetlinks.json"]) {
    assert.throws(() => readTwaTarget({ android_twa: { ...configured.android_twa, assetlinks_url: other } }), /주소/);
  }
});

test("an AR listener on the default HTTPS port keeps that origin without inferring 8443", () => {
  const direct = { ...configured.android_twa,
    phone_url: "https://hub.example.test/phone/",
    assetlinks_url: "https://hub.example.test:443/.well-known/assetlinks.json",
  };
  assert.deepEqual(readTwaTarget({ android_twa: direct }), {
    url: "https://hub.example.test/phone/", origin: "https://hub.example.test",
  });
  assert.throws(() => readTwaTarget({ android_twa: {
    ...direct, assetlinks_url: "https://hub.example.test:8443/.well-known/assetlinks.json",
  } }), /주소/);
});

test("TWA refuses missing declarations, another package, insecure targets and non-phone pages", () => {
  assert.throws(() => readTwaTarget({ android_twa: null }), /주소/);
  assert.throws(() => readTwaTarget({ android_twa: { ...configured.android_twa, statements_configured: false } }), /서명/);
  assert.throws(() => readTwaTarget({ android_twa: { ...configured.android_twa, package_name: "app.other" } }), /앱/);
  for (const invalid of ["http://hub.example.test:8443/phone/", "https://hub.example.test:8443/mobile/", "https://hub.example.test:8443/phone/?start=1"]) {
    assert.throws(() => readTwaTarget({ android_twa: { ...configured.android_twa, phone_url: invalid } }), /주소/);
  }
});
