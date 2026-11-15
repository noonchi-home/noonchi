// 실제 폰 ↔ 폰 서버 계약 판본(형 하나). 값은 서버(src/phone/protocol.ts)와 폰 빌드(ui/src/phone/protocol.ts)가 이 형으로 둔다:
// 판본을 올릴 때 여기만 바꾸면 두 값이 이 형과 달라 typecheck가 실패한다(계약 폴더는 형만 둔다, tests/contract.test.ts).
// 폰 페이지는 열리자마자 hello로 판본을 알리고, 서버는 hello가 없거나 판본이 다른 탭(옛 탭)에는 새로 고침 안내만 보낸다(src/phone/server.ts).
// 2: 말(say)에 at(말할 때 떠 있던 명령·보인 승인 대기 token)을 싣는다.
// 3: 명령·reply에 소리 등급(grade)을 싣고, 폰은 안전·질문 말을 자르거나 건너뛰지 않는다.
export type PhoneProtocol = 3;
