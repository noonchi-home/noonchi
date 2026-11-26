import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const { getAssetData } = createRequire(import.meta.url)("metro/private/Assets") as {
  getAssetData(path: string, localPath: string, plugins: string[], platform: string, publicPath: string):
    Promise<{ width: number; height: number; scales: number[] }>;
};

for (const screen of ["App.tsx", "ConnectedHome.tsx"]) {
  test(`${screen} bundles sufficiently detailed artwork in the mascot's original proportions`, async () => {
    const code = readFileSync(new URL(screen, import.meta.url), "utf8");
    assert.match(code, /<Image source=\{mascot\}/);
    const assetPath = /const mascot = require\("(\.\/assets\/[^"\r\n]+\.webp)"\)/.exec(code)?.[1];
    assert.ok(assetPath);
    const asset = await getAssetData(fileURLToPath(new URL(assetPath, import.meta.url)), assetPath, [], "android", "/assets");

    assert.equal(asset.width * 180, asset.height * 103, "The artwork must keep the 206:360 proportions");
    for (const scale of asset.scales) {
      const [width, height] = [asset.width * scale, asset.height * scale];
      assert.ok(width >= 618 && height >= 1080, `Android can still select undersized artwork (${width}×${height})`);
    }
  });
}
