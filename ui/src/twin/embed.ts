const STYLE_ID = "twin-home-embed";

/**
 * 뷰어 자체 위 막대(가전 패널·벽·방·CCTV·천장 보기·상태 배지·연결 칩)를 숨긴다. 같은 출처 iframe 문서에 스타일을 한 번 넣는다.
 * 뷰어 body는 세로 flex(막대 + 무대)라 막대가 빠지면 캔버스가 iframe 위 끝까지 늘어난다. 뷰어는 창 resize 때만 크기를 다시 재므로 직접 보낸다.
 */
export function hideViewerBar(doc: Document): void {
  const host = doc.head ?? doc.documentElement;
  if (host && !doc.getElementById(STYLE_ID)) {
    const style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = ".bar { display: none !important; }";
    host.append(style);
  }
  doc.defaultView?.dispatchEvent(new Event("resize"));
}
