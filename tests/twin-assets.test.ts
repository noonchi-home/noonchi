// 트윈 결과물 복사(scripts/twin-assets.ts): twin-studio에서 서버·뷰어가 읽는 파일만 twin/으로 옮긴다.
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { copyTwinAssets } from "../scripts/twin-assets.js";

function put(root: string, rel: string, body = "x"): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), body);
}
function list(root: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => readdirSync(d).forEach((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : out.push(relative(root, join(d, n)).replace(/\\/g, "/"))));
  walk(root);
  return out.sort();
}
function fakeStudio(): string {
  const s = mkdtempSync(join(tmpdir(), "studio-"));
  put(s, "homes.json", JSON.stringify({ default: "apartment", viewer: "apartment/viewer", library: "library", homes: [
    { id: "apartment", name: "아파트", data: "data/apartment", out: "apartment" },
    { id: "oneroom", name: "원룸", data: "data/homes/oneroom", out: "homes/oneroom" },
  ] }));
  for (const f of [
    "apartment/viewer/index.html", "apartment/viewer/main.mjs", "apartment/viewer/test/a.test.mjs",
    "apartment/scene.json", "apartment/assets/furniture/t.glb", "apartment/apartment_complete.glb", "apartment/apartment.blend",
    "apartment/rooms/kitchen.png", "apartment/plan.png", "homes/oneroom/scene.json", "homes/oneroom/assets/x/y.glb",
    "data/catalog/sofa.json", "data/apartment/floorplan.json", "data/apartment/placement.json",
    "data/homes/oneroom/floorplan.json", "data/homes/oneroom/placement.json", "data/homes/oneroom/catalog/c.json",
    "library/assets/furniture/t.glb", "studio/x.py", "blender/y.py",
  ]) put(s, f);
  return s;
}

describe("트윈 결과물 복사", () => {
  it("서버·뷰어가 읽는 파일만 복사하고 출처 커밋과 sha256을 적는다", () => {
    const from = fakeStudio();
    const to = join(mkdtempSync(join(tmpdir(), "twin-")), "twin");
    const r = copyTwinAssets({ from, to, commit: "9e3aecf" });
    expect(list(to)).toEqual([
      "SOURCE.json", "apartment/assets/furniture/t.glb", "apartment/scene.json", "apartment/viewer/index.html", "apartment/viewer/main.mjs",
      "data/apartment/floorplan.json", "data/apartment/placement.json", "data/catalog/sofa.json",
      "data/homes/oneroom/catalog/c.json", "data/homes/oneroom/floorplan.json", "data/homes/oneroom/placement.json",
      "homes.json", "homes/oneroom/assets/x/y.glb", "homes/oneroom/scene.json", "library/assets/furniture/t.glb",
    ]);
    const src = JSON.parse(readFileSync(join(to, "SOURCE.json"), "utf8"));
    expect(src).toMatchObject({ source: "twin-studio", commit: "9e3aecf", homes: ["apartment", "oneroom"] });
    expect(src.files.find((f: { path: string }) => f.path === "apartment/scene.json").sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.files).toBe(14);
  });

  it("글 파일은 줄 끝을 LF로 맞추고 그 내용의 sha256을 적는다. GLB는 그대로 복사한다", () => {
    const from = fakeStudio();
    put(from, "apartment/scene.json", '{\r\n  "a": 1\r\n}\r\n');
    put(from, "apartment/viewer/main.mjs", "a();\r\nb();\r\n");
    put(from, "apartment/assets/furniture/t.glb", "glTF\r\n\x00\x01");
    const to = join(mkdtempSync(join(tmpdir(), "twin-")), "twin");
    copyTwinAssets({ from, to, commit: "c" });
    expect(readFileSync(join(to, "apartment/scene.json"), "utf8")).toBe('{\n  "a": 1\n}\n');
    expect(readFileSync(join(to, "apartment/viewer/main.mjs"), "utf8")).toBe("a();\nb();\n");
    expect(readFileSync(join(to, "apartment/assets/furniture/t.glb"), "latin1")).toBe("glTF\r\n\x00\x01");
    const src = JSON.parse(readFileSync(join(to, "SOURCE.json"), "utf8"));
    const sha = (rel: string) => src.files.find((f: { path: string }) => f.path === rel).sha256;
    expect(sha("apartment/scene.json")).toBe(createHash("sha256").update('{\n  "a": 1\n}\n').digest("hex"));
  });

  it("빌드 안 된 집(scene.json 없음)이면 멈춘다", () => {
    const from = fakeStudio();
    writeFileSync(join(from, "homes.json"), JSON.stringify({ homes: [{ id: "x", data: "data/x", out: "homes/x" }] }));
    expect(() => copyTwinAssets({ from, to: join(from, "out"), commit: "c" })).toThrow(/scene\.json/);
  });

  it("git 폴더가 아니고 --commit이 없으면 멈춘다", () => {
    expect(() => copyTwinAssets({ from: fakeStudio(), to: join(tmpdir(), "nope-twin") })).toThrow(/--commit/);
  });
});
