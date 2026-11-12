// 실제 폰 덮개 배치 검사: 화면 사진 페이지(shots.tsx)가 크롬에서 잰 자리(CSS px)로 부른다. 문제가 있으면 console.error로 내서 npm run capture가 실패한다.
// 단추는 화면 안에 있거나, 화면 안에 있는 스크롤 칸 안에 있어야 누를 수 있다. 세로 화면에서 엄지 자리 단추(완료·답·기록)는 엄지가 닿는 아래 1/3 안에, 가로 화면에서는 오른손 엄지가 닿는 오른쪽 절반·아래 절반 안에 있다.
// 위 줄(미어캣·명령)·엄지 자리 칸은 가운데 조준점(28px)과 그 칸 밖 단추를 가리지 않는다. 모달 안 단추는 칸 위에 뜨므로 보지 않는다.
// 위 줄 첫 내용(미어캣 단추)은 상태 표시줄 아래, 화면 위에서 36px부터 시작한다.
// 명령·비전 상태 글(data-phone-text)은 …나 줄 자름으로 잘리지 않는다. 화면 밖 세모는 칸·단추와 겹치지 않고, 화면 안 고리는 칸 밑에 깔리지 않는다(canvas가 맨 아래다).
// 모달 내용은 옆으로 넘치지 않는다(가로 화면에서 단추 줄이 모달보다 넓으면 상태 칩이 잘린다). 위아래는 모달 안에서 스크롤한다.
// 처음 화면은 「AR 시작」 단추가 스크롤하지 않은 첫 화면 안에 있어야 한다(세로·가로 모두).

export interface Box { left: number; top: number; right: number; bottom: number }
/** 단추 하나. scroller는 그 단추를 담은 스크롤 칸(없으면 null), zone은 그 단추를 담은 칸 이름(모달 안이면 「모달」, 없으면 비움). */
export interface Target { name: string; box: Box; scroller: Box | null; zone?: string }

const RETICLE_HALF = 14;
/** 위 줄 첫 내용은 이보다 아래에서 시작한다(상태 표시줄 28px + 8px). */
export const TOP_MIN = 36;
export const TOP_ZONE = "위 줄";
export const THUMB_ZONE = "엄지 자리";
export const MODAL_ZONE = "모달";
const inside = (b: Box, w: number, h: number) => b.left >= 0 && b.top >= 0 && b.right <= w && b.bottom <= h;
const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const where = (b: Box) => `${Math.round(b.left)},${Math.round(b.top)}–${Math.round(b.right)},${Math.round(b.bottom)}`;

export function layoutIssues(
  view: { width: number; height: number }, targets: Target[], panels: { name: string; box: Box }[], arrows: { name: string; box: Box }[] = [], rings: { name: string; box: Box }[] = [],
): string[] {
  const issues: string[] = [];
  const size = `${view.width}×${view.height}`;
  for (const t of targets) {
    const reach = t.scroller ?? t.box;
    if (!inside(reach, view.width, view.height)) issues.push(`「${t.name}」 단추가 화면 밖이에요(${where(reach)} / ${size})`);
  }
  // 위 줄 첫 내용(미어캣)이 상태 표시줄(배터리 줄)에 걸리면 안 된다
  const tops = targets.filter((t) => t.zone === TOP_ZONE);
  const first = tops.reduce<Target | null>((a, t) => (!a || t.box.top < a.box.top ? t : a), null);
  if (first && first.box.top < TOP_MIN) issues.push(`위 줄이 상태 표시줄과 겹쳐요(${where(first.box)} / ${size})`);
  if (view.height > view.width) {
    for (const t of targets) {
      if (t.zone === THUMB_ZONE && t.box.top < (view.height * 2) / 3) issues.push(`「${t.name}」 단추가 엄지가 닿는 아래 1/3 밖이에요(${where(t.box)} / ${size})`);
    }
  } else {
    for (const t of targets) {
      if (t.zone === THUMB_ZONE && (t.box.left < view.width / 2 || t.box.top < view.height / 2)) issues.push(`「${t.name}」 단추가 가로 화면 오른쪽 아래 엄지 자리 밖이에요(${where(t.box)} / ${size})`);
    }
  }
  const cx = view.width / 2;
  const cy = view.height / 2;
  const reticle = { left: cx - RETICLE_HALF, top: cy - RETICLE_HALF, right: cx + RETICLE_HALF, bottom: cy + RETICLE_HALF };
  const under = targets.filter((t) => t.zone !== MODAL_ZONE);
  for (const p of panels) {
    if (overlaps(p.box, reticle)) issues.push(`「${p.name}」 칸이 조준점을 가려요`);
    for (const t of under) if (t.zone !== p.name && overlaps(p.box, t.box)) issues.push(`「${p.name}」 칸이 「${t.name}」 단추를 가려요`);
  }
  for (const a of arrows) {
    for (const p of panels) if (overlaps(a.box, p.box)) issues.push(`「${a.name}」 화살표가 「${p.name}」 칸과 겹쳐요`);
    for (const t of under) if (overlaps(a.box, t.box)) issues.push(`「${a.name}」 화살표가 「${t.name}」 단추와 겹쳐요`);
  }
  for (const r of rings) {
    for (const p of panels) if (overlaps(r.box, p.box)) issues.push(`「${r.name}」 고리가 「${p.name}」 칸 밑에 깔려요`);
  }
  return issues;
}

/** 잘리면 안 되는 글(data-phone-text). 폭이 칸보다 1px 넘게 크면 …로 잘린 것이고, 높이가 줄 높이(line) 절반 이상 크면
 * 줄 자름으로 아래 줄이 숨은 것이다(글자 위아래가 줄 상자를 조금 넘는 것은 잘림이 아니다). */
export interface TextBox { name: string; line: number; scroll: { width: number; height: number }; client: { width: number; height: number } }
export function clipIssues(texts: TextBox[]): string[] {
  return texts
    .filter((t) => t.scroll.width > t.client.width + 1 || t.scroll.height - t.client.height >= t.line / 2)
    .map((t) => `「${t.name}」 글이 잘려요(${t.scroll.width}×${t.scroll.height} / ${t.client.width}×${t.client.height})`);
}

/** 모달(이름, 내용 크기 scroll, 보이는 크기 client): 내용이 옆으로 1px 넘게 넘치면 문제다. 위아래는 모달 안에서 스크롤한다. */
export function modalIssues(modals: { name: string; scroll: { width: number; height: number }; client: { width: number; height: number } }[]): string[] {
  return modals.filter((m) => m.scroll.width > m.client.width + 1).map((m) => `「${m.name}」 모달 내용이 옆으로 넘쳐요(${m.scroll.width} / ${m.client.width})`);
}

/** 처음 화면: 「AR 시작」 단추(start, 스크롤 0에서 잰 자리)가 첫 화면 안에 있는지. */
export function introIssues(view: { width: number; height: number }, start: Box | null): string[] {
  if (!start) return ["「AR 시작」 단추가 없어요"];
  return inside(start, view.width, view.height) ? [] : [`「AR 시작」 단추가 첫 화면 밖이에요(${where(start)} / ${view.width}×${view.height})`];
}
