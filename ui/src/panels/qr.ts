import QRCode from "qrcode";

/** 글 → QR 판 크기와 검은 칸 SVG 경로(한 줄씩 이어진 칸을 한 사각형으로). 여백은 그리는 쪽에서 둔다. */
export function qrPath(text: string): { size: number; d: string } {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = modules.size;
  let d = "";
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; ) {
      if (!modules.get(y, x)) { x++; continue; }
      let run = 1;
      while (x + run < n && modules.get(y, x + run)) run++;
      d += `M${x} ${y}h${run}v1h-${run}z`;
      x += run;
    }
  }
  return { size: n, d };
}
