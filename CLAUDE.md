# twin-home 작업 규칙

| 규칙 | 막는 장치 |
|---|---|
| 대시보드·설정 화면은 React+TypeScript(`ui/`)로 만든다. 빌드 없는 HTML·JS 화면을 새로 만들지 않는다(폰 화면 `web/phone/`은 옮기기 전까지 예외). 21st.dev 부품은 React 그대로 가져다 쓴다. | 없음. `docs/superpowers/plans/2026-11-06-react-ui.md` Task 10에서 옛 화면을 지우면 구조로 막힌다. |
| 트윈 위 말풍선·표시는 에이전트가 판단하면서 확인한 기기·물건에만 띄운다. 모든 기기에 늘 띄우지 않고, 점선 테두리를 쓰지 않는다. | 없음. 확인한 것만 그리는 화면 시험을 만든 뒤 그 시험이 막는다(`docs/superpowers/plans/2026-11-06-react-ui.md` Task 5b). |
| 화면 글(web/)에는 사용자가 할 일과 지금 상태만 쓴다. 생각 과정·구현 설명·흐름 나열(「집 → 가전 → …」)·괄호 덧붙임·설명 칸(.sub·.note·.help)을 넣지 않는다. | `npm run lint`(scripts/lint-ui-copy.ts). `npm test`도 tests/lint-ui-copy.test.ts로 같은 검사를 돌린다. 짧은 메타 문구는 못 잡으니 글을 쓸 때 직접 본다. |
