// 설정 2단계 가전 검색. 이름·종류·방·id를 띄어쓰기 없이 이어 붙여 찾는다. 자음만 친 낱말(ㄴㅈㄱ)은 초성으로 찾는다.

export interface SearchDevice {
  id: string;
  label: string;
  kindLabel?: string;
  roomLabel?: string;
}

const CHOSEONG = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
const ONLY_JAMO = /^[ㄱ-ㅎ]+$/;

function choseong(text: string): string {
  let out = "";
  for (const ch of text) {
    const i = ch.charCodeAt(0) - 0xac00;
    out += i >= 0 && i < 11172 ? CHOSEONG[Math.floor(i / 588)] : ch;
  }
  return out;
}

/** 검색어를 띄어쓰기로 나눈 낱말이 모두 들어 있는 기기(순서는 그대로). 빈 검색어는 아무것도 고르지 않는다. */
export function searchDevices<T extends SearchDevice>(devices: T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return devices.filter((d) => {
    const flat = [d.label, d.kindLabel, d.roomLabel, d.id].filter(Boolean).join("").toLowerCase().replace(/\s+/g, "");
    const initials = choseong(flat);
    return words.every((w) => (ONLY_JAMO.test(w) ? initials : flat).includes(w));
  });
}
