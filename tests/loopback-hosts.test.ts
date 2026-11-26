// 서버가 들을 주소: 컨테이너 밖에서는 루프백만, 컨테이너(NOONCHI_IN_CONTAINER=1) 안에서는 0.0.0.0·::도 된다.
import { describe, expect, it } from "vitest";
import { lanBindingError } from "../src/server/loopback.js";
import { localPhoneUrls } from "../src/phone/server.js";
import { isLoopbackHost } from "../src/shared/net.js";

describe("루프백 주소", () => {
  it("127.0.0.0/8·localhost·::1만 루프백이다", () => {
    for (const host of ["127.0.0.1", "127.0.0.2", "localhost", "LOCALHOST", "::1", "[::1]"]) expect(isLoopbackHost(host), host).toBe(true);
    for (const host of ["0.0.0.0", "::", "192.168.0.53", "100.101.102.103", "10.0.0.5", "128.0.0.1", "127.example.com", ""]) expect(isLoopbackHost(host), host).toBe(false);
  });
});

describe("들을 주소 검사", () => {
  it("비우거나 루프백이면 통과", () => {
    expect(lanBindingError({})).toBeNull();
    expect(lanBindingError({ HOST: " 127.0.0.1 ", PHONE_HOST: "::1" })).toBeNull();
  });

  it("컨테이너 밖에서 0.0.0.0·::·네트워크 주소면 어느 변수인지 담아 거절한다", () => {
    expect(lanBindingError({ HOST: "0.0.0.0" })).toMatch(/^와이파이 직접 연결은 쓰지 않아요\..*HOST=0\.0\.0\.0.*Tailscale serve/);
    expect(lanBindingError({ PHONE_HOST: "192.168.0.53" })).toMatch(/PHONE_HOST=192\.168\.0\.53/);
    expect(lanBindingError({ HOST: "127.0.0.1", PHONE_HOST: "::" })).toMatch(/PHONE_HOST=::/);
  });

  it("컨테이너 안에서는 0.0.0.0·::를 허용하고 그 밖의 네트워크 주소는 거절한다", () => {
    expect(lanBindingError({ NOONCHI_IN_CONTAINER: "1", HOST: "0.0.0.0", PHONE_HOST: "0.0.0.0" })).toBeNull();
    expect(lanBindingError({ NOONCHI_IN_CONTAINER: "1", HOST: "::" })).toBeNull();
    expect(lanBindingError({ NOONCHI_IN_CONTAINER: "1", HOST: "192.168.0.53" })).toMatch(/HOST=192\.168\.0\.53/);
    expect(lanBindingError({ NOONCHI_IN_CONTAINER: "0", HOST: "0.0.0.0" })).toMatch(/HOST=0\.0\.0\.0/);
  });
});

describe("폰 서버가 알리는 이 PC 주소", () => {
  it("루프백이면 그 주소 하나, 컨테이너의 0.0.0.0·::면 없음(밖에서는 PHONE_URL·tailscale 주소로 연다)", () => {
    expect(localPhoneUrls(8210, "127.0.0.1")).toEqual(["http://127.0.0.1:8210/phone/"]);
    expect(localPhoneUrls(8210, "::1")).toEqual(["http://[::1]:8210/phone/"]);
    expect(localPhoneUrls(8210, "0.0.0.0")).toEqual([]);
    expect(localPhoneUrls(8210, "::")).toEqual([]);
  });
});
