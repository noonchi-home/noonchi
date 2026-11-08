// 폰 덮개 배치 검사: 화면 사진 페이지(shots.tsx)가 크롬에서 잰 자리(CSS px)로 부른다. 문제가 있으면 console.error로 내서 npm run capture가 실패한다.
// 단추는 화면 안에 있거나, 화면 안에 있는 스크롤 칸 안에 있어야 누를 수 있다. 위 줄·말풍선·엄지 자리 칸은 가운데 조준점(28px)과
// 그 칸 밖 단추(큰 단추·⋯·다른 칸의 단추)를 가리지 않는다.

export interface Box { left: number; top: number; right: number; bottom: number }
/** 단추 하나. scroller는 그 단추를 담은 스크롤 칸(없으면 null), zone은 그 단추를 담은 칸 이름(없으면 비움). */
export interface Target { name: string; box: Box; scroller: Box | null; zone?: string }

const RETICLE_HALF = 14;
const inside = (b: Box, w: number, h: number) => b.left >= 0 && b.top >= 0 && b.right <= w && b.bottom <= h;
const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const where = (b: Box) => `${Math.round(b.left)},${Math.round(b.top)}–${Math.round(b.right)},${Math.round(b.bottom)}`;

export function layoutIssues(view: { width: number; height: number }, targets: Target[], panels: { name: string; box: Box }[]): string[] {
  const issues: string[] = [];
  for (const t of targets) {
    const reach = t.scroller ?? t.box;
    if (!inside(reach, view.width, view.height)) issues.push(`「${t.name}」 단추가 화면 밖이에요(${where(reach)} / ${view.width}×${view.height})`);
  }
  const cx = view.width / 2;
  const cy = view.height / 2;
  const reticle = { left: cx - RETICLE_HALF, top: cy - RETICLE_HALF, right: cx + RETICLE_HALF, bottom: cy + RETICLE_HALF };
  for (const p of panels) {
    if (overlaps(p.box, reticle)) issues.push(`「${p.name}」 칸이 조준점을 가려요`);
    for (const t of targets) if (t.zone !== p.name && overlaps(p.box, t.box)) issues.push(`「${p.name}」 칸이 「${t.name}」 단추를 가려요`);
  }
  return issues;
}
