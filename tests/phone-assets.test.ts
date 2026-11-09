// 폰 화면 파일 확인(scripts/phone-assets.ts): /phone/ HTML이 부르는 script·link 파일과 폰 JS 안의 인코딩 워커가 모두 200인지 본다.
// 키 없는 컨테이너 확인(scripts/container-smoke.ts)이 이것으로 폰 화면이 실제로 뜨는지 본다.
import { describe, expect, it } from "vitest";
import { pageRefs, phoneAssetFailures, workerRefs } from "../scripts/phone-assets.js";

/** ui/dist/phone/index.html 모양(빌드가 만든 주소). */
const HTML = `<!doctype html>
<html lang="ko" data-surface="phone">
<head><meta charset="utf-8"><title>클로이드의 눈 · NOONCHI</title>
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">  <script type="module" crossorigin src="/assets/phone-306ozFFZ.js"></script>
  <link rel="modulepreload" crossorigin href="/assets/button-Dak-GovL.js">
  <link rel="stylesheet" crossorigin href="/assets/button-C-7-TU7h.css">
</head>
<body><div id="root"></div></body>
</html>`;
/** 폰 JS 안 인코딩 워커(vite가 new URL(…, import.meta.url)을 바꾼 꼴). */
const JS = "const w=new Worker(new URL(`/assets/encoder-worker-nSDAuQYW.js`,``+import.meta.url),{type:`module`});";

function server(files: Record<string, string>) {
  const asked: string[] = [];
  const fetcher = async (url: string) => {
    const path = new URL(url).pathname;
    asked.push(path);
    return path in files ? { status: 200, text: async () => files[path]! } : { status: 404, text: async () => "" };
  };
  return { asked, fetcher };
}
const all = { "/phone/": HTML, "/favicon.ico": "", "/apple-touch-icon.png": "", "/assets/phone-306ozFFZ.js": JS, "/assets/button-Dak-GovL.js": "", "/assets/button-C-7-TU7h.css": "", "/assets/encoder-worker-nSDAuQYW.js": "" };

describe("폰 화면 파일 확인", () => {
  it("HTML의 script src·link href(같은 서버 주소)를 뽑는다", () => {
    expect(pageRefs(HTML)).toEqual(["/favicon.ico", "/apple-touch-icon.png", "/assets/phone-306ozFFZ.js", "/assets/button-Dak-GovL.js", "/assets/button-C-7-TU7h.css"]);
  });

  it("폰 JS 안의 인코딩 워커 주소를 뽑는다", () => {
    expect(workerRefs(JS)).toEqual(["/assets/encoder-worker-nSDAuQYW.js"]);
    expect(workerRefs("console.log(1)")).toEqual([]);
  });

  it("다 있으면 실패 없음. HTML·JS·CSS·워커를 모두 받아 본다", async () => {
    const s = server(all);
    const r = await phoneAssetFailures("http://127.0.0.1:8510", s.fetcher);
    expect(r).toEqual({ checked: 7, failures: [] });
    expect(s.asked).toContain("/assets/encoder-worker-nSDAuQYW.js");
  });

  it("파일이 404면, JS에 인코딩 워커가 없으면, /phone/이 안 열리면 그 까닭", async () => {
    const { "/assets/button-C-7-TU7h.css": _css, ...noCss } = all;
    expect((await phoneAssetFailures("http://h", server(noCss).fetcher)).failures).toEqual(["폰 화면 파일이 열리지 않아요(/assets/button-C-7-TU7h.css 404)"]);
    expect((await phoneAssetFailures("http://h", server({ ...all, "/assets/phone-306ozFFZ.js": "x" }).fetcher)).failures).toEqual(["폰 화면 JS에 인코딩 워커 주소가 없어요"]);
    const { "/assets/encoder-worker-nSDAuQYW.js": _w, ...noWorker } = all;
    expect((await phoneAssetFailures("http://h", server(noWorker).fetcher)).failures).toEqual(["폰 화면 파일이 열리지 않아요(/assets/encoder-worker-nSDAuQYW.js 404)"]);
    expect((await phoneAssetFailures("http://h", server({}).fetcher)).failures).toEqual(["폰 화면이 열리지 않아요(404)"]);
    const down = async () => { throw new Error("ECONNREFUSED"); };
    expect((await phoneAssetFailures("http://h", down)).failures).toEqual(["폰 화면이 열리지 않아요(ECONNREFUSED)"]);
  });
});
