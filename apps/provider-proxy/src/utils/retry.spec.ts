import { describe, expect, it, vi } from "vitest";

import { canRetryOnError, httpRetry, isConnectionRefused } from "./retry";

describe(canRetryOnError.name, () => {
  it.each(["ECONNREFUSED", "ECONNRESET", "ERR_TLS_SESSION_REJECTED", "ETIMEDOUT", "ESOCKETTIMEDOUT"])("retries after %s", code => {
    expect(canRetryOnError(errnoError(code))).toBe(true);
  });

  it("finds the code on a wrapped error", () => {
    expect(canRetryOnError(new Error("fetch failed", { cause: errnoError("ECONNRESET") }))).toBe(true);
  });

  it.each([errnoError("ENOTFOUND"), new Error("boom"), null, undefined])("does not retry after %s", error => {
    expect(canRetryOnError(error)).toBe(false);
  });
});

describe(isConnectionRefused.name, () => {
  it("recognizes a refused connection", () => {
    expect(isConnectionRefused(errnoError("ECONNREFUSED"))).toBe(true);
  });

  it("recognizes a refused connection behind a wrapping error", () => {
    expect(isConnectionRefused(new Error("fetch failed", { cause: errnoError("ECONNREFUSED") }))).toBe(true);
  });

  it.each([errnoError("ECONNRESET"), new Error("boom"), undefined])("does not take %s for a refused connection", error => {
    expect(isConnectionRefused(error)).toBe(false);
  });
});

describe(httpRetry.name, () => {
  it("retries a thrown error the caller allows", async () => {
    const callback = vi.fn().mockRejectedValueOnce(errnoError("ECONNRESET")).mockResolvedValueOnce("done");

    await expect(httpRetry(callback, { retryIf: () => false, retryOnError: () => true, maxRetries: 1 })).resolves.toBe("done");
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it("does not retry a thrown error the caller refuses", async () => {
    const callback = vi.fn().mockRejectedValueOnce(errnoError("ECONNRESET")).mockResolvedValueOnce("done");

    await expect(httpRetry(callback, { retryIf: () => false, retryOnError: () => false, maxRetries: 1 })).rejects.toThrow(
      "Fail to retry due to receiving non-retriable error"
    );
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("retries a retriable thrown error by default", async () => {
    const callback = vi.fn().mockRejectedValueOnce(errnoError("ECONNRESET")).mockResolvedValueOnce("done");

    await expect(httpRetry(callback, { retryIf: () => false, maxRetries: 1 })).resolves.toBe("done");
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it("gives up on a thrown error after maxRetries", async () => {
    const callback = vi.fn().mockRejectedValue(errnoError("ECONNRESET"));

    await expect(httpRetry(callback, { retryIf: () => false, maxRetries: 1 })).rejects.toThrow("Max retries reached: 1");
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it("retries without a maxRetries given", async () => {
    const callback = vi.fn().mockRejectedValueOnce(errnoError("ECONNRESET")).mockResolvedValueOnce("done");

    await expect(httpRetry(callback, { retryIf: () => false })).resolves.toBe("done");
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it("asks before retrying a thrown error again", async () => {
    const retryOnError = vi.fn().mockReturnValue(true);
    const callback = vi.fn().mockRejectedValueOnce(errnoError("ECONNRESET")).mockRejectedValueOnce(errnoError("ECONNRESET")).mockResolvedValueOnce("done");

    await expect(httpRetry(callback, { retryIf: () => false, retryOnError, maxRetries: 2 })).resolves.toBe("done");
    expect(retryOnError).toHaveBeenCalledTimes(2);
  });
});

function errnoError(code: string) {
  return Object.assign(new Error(code), { code });
}
