import { describe, expect, it } from "vitest";
import { pickPhoneUrl } from "../src/panels/phone-url";

describe("pickPhoneUrl", () => {
  it("집 공유기 대역(192.168)을 먼저, 그다음 10.x", () => {
    expect(pickPhoneUrl(["https://172.20.0.1:8210", "https://10.0.0.5:8210", "https://192.168.0.7:8210"]))
      .toEqual({ best: "https://192.168.0.7:8210", others: ["https://10.0.0.5:8210", "https://172.20.0.1:8210"] });
  });
  it("없으면 null", () => {
    expect(pickPhoneUrl([])).toEqual({ best: null, others: [] });
  });
});
