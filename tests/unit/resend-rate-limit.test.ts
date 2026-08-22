import { describe, expect, it } from "vitest";
import {
  RESEND_MAX_API_ATTEMPTS,
  RESEND_REQUEST_INTERVAL_MS,
  parseRetryAfterMs,
  retryDelayForResendFailure
} from "@/lib/resend-rate-limit";

describe("Resend delivery pacing", () => {
  it("paces requests below the provider's five-per-second default", () => {
    expect(1_000 / RESEND_REQUEST_INTERVAL_MS).toBeLessThan(5);
  });

  it("parses Retry-After seconds and HTTP dates", () => {
    expect(parseRetryAfterMs("2", 0)).toBe(2_000);
    expect(
      parseRetryAfterMs("Wed, 21 Oct 2015 07:28:00 GMT", Date.parse("2015-10-21T07:27:58Z"))
    ).toBe(2_000);
    expect(parseRetryAfterMs("invalid", 0)).toBeNull();
  });

  it("retries transient rate limits and provider failures", () => {
    expect(
      retryDelayForResendFailure({
        attempt: 0,
        errorName: "rate_limit_exceeded",
        retryAfter: "1",
        status: 429
      })
    ).toBe(1_000);
    expect(
      retryDelayForResendFailure({
        attempt: 1,
        errorName: "internal_server_error",
        retryAfter: null,
        status: 503
      })
    ).toBe(1_000);
  });

  it("does not repeatedly call the provider for quota or permanent errors", () => {
    expect(
      retryDelayForResendFailure({
        attempt: 0,
        errorName: "daily_quota_exceeded",
        retryAfter: "60",
        status: 429
      })
    ).toBeNull();
    expect(
      retryDelayForResendFailure({
        attempt: 0,
        errorName: "validation_error",
        retryAfter: null,
        status: 422
      })
    ).toBeNull();
    expect(
      retryDelayForResendFailure({
        attempt: RESEND_MAX_API_ATTEMPTS - 1,
        errorName: "rate_limit_exceeded",
        retryAfter: "1",
        status: 429
      })
    ).toBeNull();
  });
});
