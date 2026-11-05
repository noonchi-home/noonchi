import { describe, expect, it } from "vitest";
import { pickPhoneUrl } from "../src/panels/phone-url";

describe("pickPhoneUrl", () => {
  it("집 공유기 대역(192.168)을 먼저, 그다음 10.x", () => {
    expect(pickPhoneUrl(["https://172.20.0.1:8210", "https://10.0.0.5:8210", "https://192.168.0.7:8210"]))
      .toEqual({ best: "https://192.168.0.7:8210", others: ["https://10.0.0.5:8210", "https://172.20.0.1:8210"] });
  });
  it("https 주소(서버가 맨 앞에 둔 Tailscale·PHONE_URL)를 와이파이보다 먼저", () => {
    const ts = "https://phone-pc.example-net.ts.net/phone/";
    expect(pickPhoneUrl(["http://192.168.0.7:8210/phone/", ts, "http://100.64.0.2:8210/phone/"]))
      .toEqual({ best: ts, others: ["http://192.168.0.7:8210/phone/", "http://100.64.0.2:8210/phone/"] });
  });
  it("없으면 null", () => {
    expect(pickPhoneUrl([])).toEqual({ best: null, others: [] });
  });
});
