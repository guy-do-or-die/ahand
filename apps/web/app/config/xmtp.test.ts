import { describe, expect, it } from "vitest";
import { XMTP_ENV, resolveXmtpEnv, xmtpRegisteredKey } from "./xmtp";

const ADDR = "0xAbCdEf0000000000000000000000000000000001";

describe("XMTP network", () => {
  it("defaults to dev and takes the configured network", () => {
    expect(XMTP_ENV).toBe("dev");
    expect(resolveXmtpEnv(undefined)).toBe("dev");
    expect(resolveXmtpEnv("")).toBe("dev");
    expect(resolveXmtpEnv("production")).toBe("production");
    expect(resolveXmtpEnv("local")).toBe("local");
  });

  it("refuses a misspelled network instead of quietly using dev", () => {
    expect(() => resolveXmtpEnv("prod")).toThrow(/VITE_XMTP_ENV/);
  });

  it("scopes the registration marker per network, keeping the dev key as it was", () => {
    expect(xmtpRegisteredKey(ADDR, "dev")).toBe(`ahand.xmtp.registered.${ADDR.toLowerCase()}`);
    expect(xmtpRegisteredKey(ADDR, "production")).toBe(`ahand.xmtp.production.registered.${ADDR.toLowerCase()}`);
    expect(xmtpRegisteredKey(ADDR, "production")).not.toBe(xmtpRegisteredKey(ADDR, "dev"));
    expect(xmtpRegisteredKey(ADDR)).toBe(xmtpRegisteredKey(ADDR, "dev"));
  });
});
