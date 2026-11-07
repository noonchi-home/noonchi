# twin-home 작업 규칙

| 규칙 | 막는 장치 |
|---|---|
| 대시보드·설정 화면은 React+TypeScript(`ui/`)로 만든다. 빌드 없는 HTML·JS 화면을 새로 만들지 않는다(폰 화면 `web/phone/`은 옮기기 전까지 예외). 21st.dev 부품은 React 그대로 가져다 쓴다. | 구조: 서버는 React 빌드 `ui/dist/`만 내준다(`src/server/app.ts` `DEFAULT_WEB_DIR`, `tests/server.test.ts` 「기본 화면 폴더는 ui/dist」). `web/`에 화면을 만들어도 나오지 않는다. 21st.dev 부품을 React로 쓰는지는 막는 장치 없음. |
| 대시보드(허브 화면)에는 입력창을 두지 않는다. 요청과 질문·답은 거주자와 클로이드가 폰에서 음성으로 주고받고, 허브에는 추론 과정과 판단 과정만 보인다. | `ui/tests/no-input.test.tsx`(대시보드에 input·textarea·select·form·contenteditable이 없는지 본다). `npm test`가 돌린다. |
| 시안으로 보여 준 21st.dev 부품은 실제 코드를 받아 보이는 모양(유리 효과·색·여백·꾸밈)까지 옮긴다. 틀만 따고 꾸밈을 지우지 않는다. 시안에 그림만 쓴 부품도 쓰기로 했으면 코드를 받는다. | 없음. |
| 트윈 위 말풍선·표시는 에이전트가 판단하면서 확인한 기기·물건에만 띄운다. 모든 기기에 늘 띄우지 않고, 점선 테두리를 쓰지 않는다. 표시용 말풍선은 마우스를 받지 않는다(`pointer-events-none`). | `ui/tests/bubble-layer.test.tsx`(확인 목록에 없는 기기는 그리지 않음, 점선 없음, 말풍선 `pointer-events-none`)·`ui/tests/checks.test.ts`(확인 목록 규칙). `npm test`가 돌린다. |
| 트윈 3D는 React 대시보드 안에서 three.js로 직접 그린다. iframe으로 다른 뷰어 페이지를 띄우지 않는다. twin-studio는 모델·데이터를 만드는 곳으로만 쓴다. | 없음. 한양목련 3D 계획 Task 43에서 옛 iframe 경로를 지우면 구조로 막힌다. |
| 화면 글(web/·ui/src)에는 사용자가 할 일과 지금 상태만 쓴다. 생각 과정·구현 설명·흐름 나열(「집 → 가전 → …」)·괄호 덧붙임·설명 칸(.sub·.note·.help)을 넣지 않는다. | `npm run lint`(scripts/lint-ui-copy.ts)가 web/(폰)과 ui/src의 HTML·JS·TS·TSX 글(JSX 글·속성 포함)을 검사. `npm test`도 tests/lint-ui-copy.test.ts로 같은 검사를 돌린다. 짧은 메타 문구는 못 잡으니 글을 쓸 때 직접 본다. |
| 3D 크롬·시험·빌드·Blender·변환은 한 번에 하나만 돌린다. 시험은 파일 하나도 npm run heavy로, 캡처는 npm run capture로만. | npm run heavy·npm run capture가 잡는 잠금(scripts/twin3d/heavy.ts). 잠금 없이 직접 돌리는 것은 못 막는다. |
| 추론 모드 mock과 live는 같은 구조로 돈다. 바뀌는 것은 모델 주소와 모델 이름, 그 주소가 받는 제공자 칸(생각 켜기·끄기 칸 모양, OpenRouter provider·문맥 압축 끔, OpenAI `reasoning_effort`)뿐이다. mock이라고 단계를 건너뛰거나 다른 길로 가지 않는다. 시험의 가짜 모델은 같은 주소 자리에 붙는 가짜 서버로 둔다. | `tests/same-structure.test.ts`(두 모드의 주소 표 차이, `INFERENCE_MODE`를 `src/infer/endpoints.ts`만 읽는지, src에 가짜 판단·인식·감지 클래스(`Mock`·`Scripted`·`Fake`)가 없는지, 두 모드가 같은 가짜 주소 자리에 같은 요청을 보내는지). 시험 대역은 `tests/helpers/`에 둔다. `npm test`가 돌린다. |
| PAM에는 사진을 넘기지 않는다. 사진마다 YOLO와 VLM이 각각 분석하고, World State가 둘을 합친 관찰 텍스트를 PAM에 넘긴다. | 타입: `src/contract/pam.ts`·`src/brain/decision.ts` `DecisionInput`에 사진 칸이 없다. `tests/pam-text-only.test.ts`(사진 칸을 넣으면 타입 검사 실패, 사진 칸·`data:image` 본문은 보내기 전에 막힘, 실제로 나간 본문 확인)·`services/pam/tests/test_v2.py`·`test_app.py`(사진 칸이면 400). `npm test`·CI가 돌린다. |
| 이 저장소 하나로 빌드·실행·시험·배포한다. 다른 저장소(ai, noonchi-server, twin-studio)의 경로를 쓰지 않고, 아키텍처에 쓰는 코드는 이 저장소로 옮긴다. | `tests/self-contained.test.ts`(빌드·실행·시험·배포 파일에서 `../ai`·`../twin-studio*`·경로 조각(`"..", "ai"`)·저장소 밖 compose build·`noonchi-server`·`소웨공/` 경로를 찾으면 대신 쓸 폴더 `services/pam/`·`twin/`·`src/`를 말하며 실패, 트윈 기본 폴더가 저장소 `twin/`인지 본다). `npm test`와 CI가 돌린다. |
