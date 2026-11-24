import { useState } from "react";
import { Button } from "../components/ui/button";
import { house } from "./house";
import twinFloorPlan from "./mokryeon-plan.svg";

type FloorReviewProps = { onBack: () => void } & (
  { canApprove: boolean; onApprove: () => void } | { canApprove?: never; onApprove?: never }
);

export function FloorReview({ canApprove, onApprove, onBack }: FloorReviewProps) {
  const [image, setImage] = useState<"loading" | "ready" | "fallback">("loading");
  return <div className="grid gap-4">
    <p>{house.address}</p>
    <figure className="grid gap-2">
      {image === "fallback"
        ? <><img className="max-h-96 w-full object-contain" alt={house.name + " 트윈 평면도"} src={twinFloorPlan} />
          <figcaption>간략 평면도</figcaption></>
        : <img className="max-h-96 w-full object-contain" alt={house.name + " 공개 평면도"} src={house.kbPlan}
          referrerPolicy="no-referrer" onLoad={() => setImage("ready")} onError={() => setImage("fallback")} />}
      {image === "loading" && <p role="status">공개 평면도를 불러오는 중이에요.</p>}
      {image === "ready" && <Button asChild variant="link" className="w-fit justify-self-start">
        <a href={house.kbPage} target="_blank" rel="noreferrer">KB부동산 공개 도면 출처</a>
      </Button>}
    </figure>
    <div className="grid gap-2 sm:grid-cols-2">
      <Button size="setup-sm" variant="outline" onClick={onBack}>{onApprove ? "다른 주소 찾기" : "우리 집으로"}</Button>
      {onApprove && <Button size="setup-sm" disabled={!canApprove || image === "loading"} onClick={onApprove}>이 도면이 맞아요</Button>}
    </div>
  </div>;
}
