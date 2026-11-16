// 가전 종류 등록부(공용 표)가 쓰는 타입: ThinQ 어댑터 이름(도메인 나누기 F9).

/** ThinQ 기기 종류마다 읽기·제어·트윈 반영. 이름은 가전 종류 이름과 다르게 짓는다(등록부 thinq.adapter가 고른다). */
export type ThinqAdapter = "air_conditioner" | "refrigerator";
