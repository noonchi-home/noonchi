"use client";

// 21st.dev「Bounding Box Selector」(id 29308, framecn/bounding-box-selector) 받은 코드.
// 바꾼 것: 영상 타임라인(@editframe/react Timegroup)과 그 재생 값(appearAt·speed·fps·durationInFrames), 자리표시 상자, 나타남 keyframes를 뺐다. 바깥 상자는 Timegroup 대신 div이고 overflow는 visible이다.
// 색만 토큰으로: 테두리 선 #0ea5e9 → brand, 바깥 바탕 #fafafa → transparent. 폰 영상 위 세 겹(phoneFocus 토큰)을 지키게 테두리 밖에 흰 테 2px·숯색 1px 그림자를 더했다.
// 기본 테두리 두께 2px → 3px(twin.phoneFocus 고리 폭 토큰). 바깥 상자에 data-slot="bounding-box"를 더했다.
// 크기 바꿈 손잡이 8개(Handle, handleColor)를 뺐다: 보기만 하는 화면에서 쓰지 않고, 작은 상자에서는 안을 가린다.
// 원래 글 크기: 없음. 받은 코드에 글 크기가 없다. 글 크기를 넣으면 npm run lint(scripts/lint-ui-type.ts)가 막는다.
import type { CSSProperties, ReactNode } from "react";

export interface BoundingBoxSelectorProps {
  children?: ReactNode;
  borderColor?: string;
  borderWidth?: number;
  background?: string;
  className?: string;
  width?: number;
  height?: number;
}

export const BoundingBoxSelector = ({
  children,
  borderColor = "var(--brand)",
  borderWidth = 3,
  background = "transparent",
  className,
  width = 1000,
  height = 500,
}: BoundingBoxSelectorProps) => {
  const containerStyle: CSSProperties = {
    alignItems: "center",
    background,
    display: "flex",
    height,
    justifyContent: "center",
    overflow: "visible",
    position: "relative",
    width,
  };

  return (
    <div className={className} data-slot="bounding-box" style={containerStyle}>
      <div style={{ display: "inline-block", position: "relative" }}>
        {children}
        <div
          style={{
            border: `${borderWidth}px solid ${borderColor}`,
            borderRadius: 4,
            boxShadow: "0 0 0 2px var(--twin-casing), 0 0 0 3px var(--charcoal)",
            inset: -8,
            pointerEvents: "none",
            position: "absolute",
            transformOrigin: "center center",
          }}
        />
      </div>
    </div>
  );
};

export default BoundingBoxSelector;
