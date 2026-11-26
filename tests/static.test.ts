import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { serveFile, serveRange } from "../src/shared/static.js";

let base: string, root: string;
beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "static-root-"));
  root = join(base, "root");
  mkdirSync(join(root, "sub"), { recursive: true });
  mkdirSync(join(base, "rootx"));
  writeFileSync(join(root, "a.png"), Buffer.from([137, 80, 78, 71]));
  writeFileSync(join(root, "sub", "b.txt"), "inside");
  writeFileSync(join(base, "outside.txt"), "outside");
  writeFileSync(join(base, "rootx", "secret.txt"), "sibling");
});
afterAll(() => rmSync(base, { recursive: true, force: true }));

function fakeRes() {
  const out: { status?: number; body?: Buffer } = {};
  const res = {
    writeHead(status: number) { out.status = status; return res; },
    end(body?: Buffer) { out.body = body; return res; },
  } as unknown as ServerResponse;
  return { res, out };
}
const noRange = { headers: {} } as IncomingMessage;
const roots = () => {
  const rel = relative(process.cwd(), root);
  expect(isAbsolute(rel)).toBe(false);
  return [["절대 경로", root], ["상대 경로", rel]] as const;
};

describe("serveFile·serveRange", () => {
  it("root가 상대 경로여도 root 안의 파일을 내준다", () => {
    for (const [kind, dir] of roots()) {
      const png = fakeRes();
      expect(serveFile(png.res, dir, "a.png", false), kind).toBe(true);
      expect(png.out).toMatchObject({ status: 200 });
      expect(png.out.body?.byteLength).toBe(4);
      const txt = fakeRes();
      expect(serveFile(txt.res, dir, "/sub/b.txt", false)).toBe(true);
      expect(txt.out.body?.toString()).toBe("inside");
      const video = fakeRes();
      expect(serveRange(noRange, video.res, dir, "a.png", true)).toBe(true);
      expect(video.out.status).toBe(200);
    }
  });

  it("root 밖으로 나가는 경로는 root가 절대·상대 경로 모두 막는다", () => {
    const escapes = ["../outside.txt", "..%2Foutside.txt", "%2e%2e%5coutside.txt", "../rootx/secret.txt", "sub/../../outside.txt", "a.png%00"];
    for (const [kind, dir] of roots()) {
      for (const rel of escapes) {
        const file = fakeRes();
        expect(serveFile(file.res, dir, rel, false), `${kind} ${rel}`).toBe(false);
        expect(file.out.status).toBeUndefined();
        const video = fakeRes();
        expect(serveRange(noRange, video.res, dir, rel, true), `${kind} ${rel}`).toBe(false);
        expect(video.out.status).toBeUndefined();
      }
    }
  });
});
