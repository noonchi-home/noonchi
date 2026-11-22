// 서버가 쓰는 폰 계약 판본 값(형은 src/contract/phone-version.ts). 폰 빌드는 ui/src/phone/protocol.ts에 같은 형으로 둔다.
import type { PhoneProtocol } from "../contract/phone-version.js";

export const PHONE_PROTOCOL: PhoneProtocol = 5;
