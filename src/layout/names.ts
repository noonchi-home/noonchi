// 평면도 물건·가전을 사람에게 부르는 이름 하나. 계획 단계 글(src/agent/planTools.ts), 실행 추적의 사람 부탁·켜기 전 질문·끄기 안내,
// 비전 상태 줄(src/act/robot/steps.ts)이 모두 이것만 쓴다. 이름을 못 찾으면 null이고, id는 사람 글에 쓰지 않는다.
import { KIND_LABELS, findTypeRule } from "../devices/index.js";
import { placeShort } from "../act/labels.js";

/** 이름 자료: 카탈로그 종류 이름(예: bookcase → 책장), 배치 이름(배치 편집기, 예: 침실 1 책장), [가전] 종류. 서버는 배치 편집기·허브에서 준다. */
export interface PlaceNames {
  typeLabel?: (type: string) => string | undefined;
  layoutName?: (id: string) => string | undefined;
  deviceKind?: (id: string) => string | undefined;
}

/** 부르는 이름: 종류 짧은 이름(placeShort) → 카탈로그 종류 이름 → 배치 이름 → 가전 종류 이름([가전] 종류, 없으면 배치 종류가 뜻하는 가전 종류).
 *  type은 평면도 물건 종류(평면도에 없으면 null). id와 같은 이름은 이름으로 보지 않는다. 하나도 없으면 null. */
export function placeName(id: string, type: string | null | undefined, src: PlaceNames = {}): string | null {
  const kind = src.deviceKind?.(id) ?? (type ? findTypeRule(type)?.kind : undefined);
  const names = [
    type ? placeShort(type) : undefined, type ? src.typeLabel?.(type) : undefined, src.layoutName?.(id), kind ? KIND_LABELS[kind as keyof typeof KIND_LABELS] : undefined,
  ];
  return names.find((n): n is string => !!n && n.trim() !== "" && n !== id) ?? null;
}
