// 폰 빌드의 폰 계약 판본 값(형은 src/contract/phone-version.ts). 서버는 src/phone/protocol.ts에 같은 형으로 둔다.
import type { PhoneProtocol } from "../../../src/contract/phone-version.ts";

export const PHONE_PROTOCOL: PhoneProtocol = 2;
