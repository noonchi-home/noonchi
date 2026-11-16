import type { AptViewer, TwinObject } from "../lib/twin-viewer";

/**
 * 말풍선을 감출지: 방 초점 + 초점 방만 때문에 다른 방 물건이 숨었을 때만 true.
 * 천장 보기가 꺼져 숨은 천장 기기, 낮춘 벽에 걸려 숨은 것은 말풍선을 그대로 둔다.
 * 다른 방이라도 초점 방으로 이어진 문·창은 뷰어가 보여 주므로, 마지막은 노드가 실제로 숨었는지(nodeHidden)로 정한다.
 * nodeHidden은 다른 방 물건일 때만 부른다(매 프레임 노드를 훑지 않게).
 */
export function hiddenByFocus(
  obj: Pick<TwinObject, "room" | "category"> | undefined,
  view: Pick<AptViewer["view"], "focus" | "isolate" | "cctv">,
  nodeHidden: () => boolean | null,
): boolean {
  if (!view.focus || !view.isolate || view.cctv) return false; // CCTV는 다른 방 물건도 숨기지 않는다
  if (!obj?.room || obj.category === "structure" || obj.room === view.focus) return false;
  return nodeHidden() === true;
}
