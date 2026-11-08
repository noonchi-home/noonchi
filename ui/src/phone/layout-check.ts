// 폰 덮개 배치 검사: 화면 사진 페이지(shots.tsx)가 크롬에서 잰 자리(CSS px)로 부른다. 문제가 있으면 console.error로 내서 npm run capture가 실패한다.
// 단추는 화면 안에 있거나, 화면 안에 있는 스크롤 칸 안에 있어야 누를 수 있다. 위 줄·말풍선·엄지 자리 칸은 가운데 조준점(28px)과
// 그 칸 밖 단추(큰 단추·⋯·다른 칸의 단추)를 가리지 않는다. 세로 화면에서 큰 단추 셋은 엄지가 닿는 아래 1/3 안에 있다.
// 위 상태 줄 글(data-phone-text)은 …나 줄 자름으로 잘리지 않는다. 화면 밖 화살표 묶음(세모+이름표)은 칸·단추와 겹치지 않는다
// (위 줄·말풍선은 canvas 아래라 화살표가 그 글을 가리고, 엄지 자리·단추는 canvas 위라 화살표가 그 아래 깔린다).
// 처음 화면은 「AR 시작」 단추가 스크롤하지 않은 첫 화면 안에 있어야 한다(세로·가로 모두).

export interface Box { left: number; top: number; right: number; bottom: number }
/** 단추 하나. scroller는 그 단추를 담은 스크롤 칸(없으면 null), zone은 그 단추를 담은 칸 이름(없으면 비움). */
export interface Target { name: string; box: Box; scroller: Box | null; zone?: string }

const RETICLE_HALF = 14;
/** 큰 단추 셋(PhoneScreen.tsx의 aria-label). */
const BIG_BUTTONS = new Set(["누르고 말하기", "사진 찍기", "끝내기"]);
const inside = (b: Box, w: number, h: number) => b.left >= 0 && b.top >= 0 && b.right <= w && b.bottom <= h;
const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const where = (b: Box) => `${Math.round(b.left)},${Math.round(b.top)}–${Math.round(b.right)},${Math.round(b.bottom)}`;

export function layoutIssues(view: { width: number; height: number }, targets: Target[], panels: { name: string; box: Box }[], arrows: { name: string; box: Box }[] = []): string[] {
  const issues: string[] = [];
  const size = `${view.width}×${view.height}`;
  for (const t of targets) {
    const reach = t.scroller ?? t.box;
    if (!inside(reach, view.width, view.height)) issues.push(`「${t.name}」 단추가 화면 밖이에요(${where(reach)} / ${size})`);
  }
  if (view.height > view.width) {
    for (const t of targets) {
      if (BIG_BUTTONS.has(t.name) && t.box.top < (view.height * 2) / 3) issues.push(`「${t.name}」 단추가 엄지가 닿는 아래 1/3 밖이에요(${where(t.box)} / ${size})`);
    }
  }
  const cx = view.width / 2;
  const cy = view.height / 2;
  const reticle = { left: cx - RETICLE_HALF, top: cy - RETICLE_HALF, right: cx + RETICLE_HALF, bottom: cy + RETICLE_HALF };
  for (const p of panels) {
    if (overlaps(p.box, reticle)) issues.push(`「${p.name}」 칸이 조준점을 가려요`);
    for (const t of targets) if (t.zone !== p.name && overlaps(p.box, t.box)) issues.push(`「${p.name}」 칸이 「${t.name}」 단추를 가려요`);
  }
  for (const a of arrows) {
    for (const p of panels) if (overlaps(a.box, p.box)) issues.push(`「${a.name}」 화살표가 「${p.name}」 칸과 겹쳐요`);
    for (const t of targets) if (overlaps(a.box, t.box)) issues.push(`「${a.name}」 화살표가 「${t.name}」 단추와 겹쳐요`);
  }
  return issues;
}

/** 잘리면 안 되는 글(data-phone-text). 폭이 칸보다 1px 넘게 크면 …로 잘린 것이고, 높이가 줄 높이(line) 절반 이상 크면
 * 줄 자름으로 아래 줄이 숨은 것이다(글자 위아래가 줄 상자를 조금 넘는 것은 잘림이 아니다). */
export interface TextBox { name: string; line: number; scroll: { width: number; height: number }; client: { width: number; height: number } }
export function clipIssues(texts: TextBox[]): string[] {
  return texts
    .filter((t) => t.scroll.width > t.client.width + 1 || t.scroll.height - t.client.height >= t.line / 2)
    .map((t) => `「${t.name}」 글이 잘려요(${t.scroll.width}×${t.scroll.height} / 칸 ${t.client.width}×${t.client.height})`);
}

/** 처음 화면: 「AR 시작」 단추(start, 스크롤 0에서 잰 자리)가 첫 화면 안에 있는지. */
export function introIssues(view: { width: number; height: number }, start: Box | null): string[] {
  if (!start) return ["「AR 시작」 단추가 없어요"];
  return inside(start, view.width, view.height) ? [] : [`「AR 시작」 단추가 첫 화면 밖이에요(${where(start)} / ${view.width}×${view.height})`];
}
