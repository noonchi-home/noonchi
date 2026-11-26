import { expect } from "vitest";

/** 버스 봉투에서 가져오는 폰 낭독 발행 식별자. 기동·발행자 값은 서버마다 새로 생긴다. */
export function expectedSpeechId(homeEpoch: string, revision: number) {
  return {
    boot: expect.stringMatching(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/),
    homeEpoch,
    publisher: expect.stringMatching(/^[\da-f]{8}$/),
    revision,
  };
}
