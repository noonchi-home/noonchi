# NOONCHI 브랜드 그림

- 출처: noonchi-home/wiki 저장소 `site/public/brand/` (팀 브랜드 그림)
  - `mascot.png` ← `mascot.png` (마스코트 전신, 1254×1254 RGBA, 그대로)
  - `face.png` ← `header-icon.png` (마스코트 얼굴, 1254×1254 RGBA, 그대로)
- 원본에서 만든 것(색 바꾸기·필터·뒤집기 없이 자르고 줄이기만)
  - `mascot@1x.webp`: 몸 둘레로 자르고 높이 360px
  - `face-64.png`, `face-128.png`: 얼굴을 64·128px 정사각형에 맞춤
  - `../favicon.ico`(16·32·48), `../favicon-32.png`, `../apple-touch-icon.png`(180), `../icon-192.png`, `../icon-512.png`: 로고 얼굴 상자(바탕 cream 토큰, 모서리 크기의 26%, 안 여백 8%)에 얼굴을 넣음
- 폰 화면도 이 폴더의 파비콘·마스코트를 쓴다(폰 서버가 ui/dist에서 내준다).
- 쓰는 법: `src/design/tokens.json`의 `mascot`(크기·둘레 빈자리·하지 않는 것).
