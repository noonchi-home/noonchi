// 폰 화면 파일 확인: /phone/ HTML은 빈 #root와 빌드 파일 주소만 있어서, 화면이 뜨려면 그 script·link 파일과 폰 JS가 띄우는 인코딩 워커가 있어야 한다.
// 키 없는 컨테이너 확인(scripts/container-smoke.ts)이 폰 서버에서 이 파일들을 모두 받아 200인지 본다.

export type Fetcher = (url: string) => Promise<{ status: number; text(): Promise<string> }>;

/** HTML의 script src·link href 중 같은 서버 주소(/로 시작, // 아님). 나온 차례대로, 한 번씩. */
export function pageRefs(html: string): string[] {
  const refs = [...html.matchAll(/<(?:script|link)\b[^>]*?\s(?:src|href)="(\/(?!\/)[^"]*)"/g)].map((m) => m[1]!);
  return [...new Set(refs)];
}

/** 폰 JS 안의 인코딩 워커 주소(/assets/encoder-worker-….js). */
export function workerRefs(js: string): string[] {
  return [...new Set([...js.matchAll(/\/assets\/encoder-worker-[\w-]+\.js/g)].map((m) => m[0]))];
}

/** base(폰 서버)에서 /phone/, 그 HTML의 파일, 폰 JS의 인코딩 워커를 받는다. checked는 받은 수, failures는 까닭. */
export async function phoneAssetFailures(base: string, fetcher: Fetcher): Promise<{ checked: number; failures: string[] }> {
  let checked = 0;
  const get = async (path: string) => {
    checked += 1;
    try {
      const r = await fetcher(new URL(path, base).href);
      return { status: r.status, body: r.status === 200 ? await r.text() : "" };
    } catch (e) {
      return { status: 0, body: "", error: (e as Error).message };
    }
  };
  const page = await get("/phone/");
  if (page.status !== 200) return { checked, failures: [`폰 화면이 열리지 않아요(${"error" in page ? page.error : page.status})`] };
  const failures: string[] = [];
  const scripts: string[] = [];
  for (const ref of pageRefs(page.body)) {
    const r = await get(ref);
    if (r.status !== 200) failures.push(`폰 화면 파일이 열리지 않아요(${ref} ${"error" in r ? r.error : r.status})`);
    else if (ref.endsWith(".js")) scripts.push(r.body);
  }
  const workers = workerRefs(scripts.join("\n"));
  if (!workers.length && !failures.length) failures.push("폰 화면 JS에 인코딩 워커 주소가 없어요");
  for (const ref of workers) {
    const r = await get(ref);
    if (r.status !== 200) failures.push(`폰 화면 파일이 열리지 않아요(${ref} ${"error" in r ? r.error : r.status})`);
  }
  return { checked, failures };
}
