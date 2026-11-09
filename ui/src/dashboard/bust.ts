// 대시보드 마스코트 그림 자리(순수 함수). 마스코트 전신 그림을 마스코트 단추 안에 놓는다:
// 머리 꼭대기가 단추 위 끝 바로 아래, 그림의 cut 줄이 화면 밑 선(단추 아래 끝)에 오게 키운다. 그 아래 몸은 단추 밖이라 보이지 않는다.
// 여기서는 키우고 옮기기만 한다. 그림은 오른쪽(주둥이 쪽)을 보고, 행동하는 동안 좌우로 뒤집는 것은 Mascot.tsx가 transform으로 한다.
// 그때 가슴 LG 표시 원(mascotLogoBox)만 다시 뒤집어 바로 읽히게 한다.
import type { MascotImage } from "./mascot-image";

/** 그림 배율(화면 px / 그림 픽셀): 단추 높이(shown)에서 머리 위 빈자리(headRoom)를 뺀 만큼이 머리 꼭대기에서 cut 줄까지와 같다. */
export function mascotScale({ headTop, cut }: Pick<MascotImage, "headTop" | "cut">, shown: number, headRoom: number): number {
  return Math.max(0, (shown - headRoom) / (cut - headTop[1]));
}

/** 단추 안 그림 자리(px, 단추 왼쪽 위 기준): 배율 scale로 키우고, 그림 x0 열을 단추 왼쪽에, 머리 꼭대기를 단추 위 끝에서 headRoom 아래에 둔다. */
export function mascotImageBox({ width, height, x0, headTop }: Pick<MascotImage, "width" | "height" | "x0" | "headTop">, scale: number, headRoom: number) {
  return { left: -x0 * scale, top: headRoom - headTop[1] * scale, width: width * scale, height: height * scale };
}

/** 가슴 LG 표시 원을 담는 네모(px, 단추 왼쪽 위 기준): 그림 자리 image에서 logo 원 가운데·반지름을 배율 scale로 옮긴다. */
export function mascotLogoBox({ logo }: Pick<MascotImage, "logo">, scale: number, image: { left: number; top: number }) {
  const r = logo.r * scale;
  return { left: image.left + logo.center[0] * scale - r, top: image.top + logo.center[1] * scale - r, width: 2 * r, height: 2 * r };
}
