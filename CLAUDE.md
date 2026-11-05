# twin-home 작업 규칙

| 규칙 | 막는 장치 |
|---|---|
| 대시보드·설정 화면은 React+TypeScript(`ui/`)로 만든다. 빌드 없는 HTML·JS 화면을 새로 만들지 않는다(폰 화면 `web/phone/`은 옮기기 전까지 예외). 21st.dev 부품은 React 그대로 가져다 쓴다. | 없음. `docs/superpowers/plans/2026-11-06-react-ui.md` Task 10에서 옛 화면을 지우면 구조로 막힌다. |
| 대시보드(허브 화면)에는 입력창을 두지 않는다. 요청과 질문·답은 거주자와 클로이드가 폰에서 음성으로 주고받고, 허브에는 추론 과정과 판단 과정만 보인다. | `ui/tests/no-input.test.tsx`(두 모양 모두 input·textarea·select·form·contenteditable이 없는지 본다). `npm test`가 돌린다. |
| 시안으로 보여 준 21st.dev 부품은 실제 코드를 받아 보이는 모양(유리 효과·색·여백·꾸밈)까지 옮긴다. 틀만 따고 꾸밈을 지우지 않는다. 시안에 그림만 쓴 부품도 쓰기로 했으면 코드를 받는다. | 없음. |
| 트윈 위 말풍선·표시는 에이전트가 판단하면서 확인한 기기·물건에만 띄운다. 모든 기기에 늘 띄우지 않고, 점선 테두리를 쓰지 않는다. 표시용 말풍선은 마우스를 받지 않는다(`pointer-events-none`). | `ui/tests/bubble-layer.test.tsx`(확인 목록에 없는 기기는 그리지 않음, 점선 없음, 말풍선 `pointer-events-none`)·`ui/tests/checks.test.ts`(확인 목록 규칙). `npm test`가 돌린다. |
| 트윈 3D는 React 대시보드 안에서 three.js로 직접 그린다. iframe으로 다른 뷰어 페이지를 띄우지 않는다. twin-studio는 모델·데이터를 만드는 곳으로만 쓴다. | 없음. 한양목련 3D 계획 Task 43에서 옛 iframe 경로를 지우면 구조로 막힌다. |
| 화면 글(web/)에는 사용자가 할 일과 지금 상태만 쓴다. 생각 과정·구현 설명·흐름 나열(「집 → 가전 → …」)·괄호 덧붙임·설명 칸(.sub·.note·.help)을 넣지 않는다. | `npm run lint`(scripts/lint-ui-copy.ts). `npm test`도 tests/lint-ui-copy.test.ts로 같은 검사를 돌린다. 짧은 메타 문구는 못 잡으니 글을 쓸 때 직접 본다. |
