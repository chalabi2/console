import type { IncomingMessage } from "http";
import { describe, expect, it } from "vitest";
import { mock } from "vitest-mock-extended";

import type { ProxyConnectionResult } from "../services/ProviderProxy";
import { shouldResendAfterError, shouldResendProxyRequest } from "./proxyRetry";

describe(shouldResendProxyRequest.name, () => {
  it.each(["GET", "PUT"])("resends a %s the provider answered with a server error", method => {
    expect(shouldResendProxyRequest(method, answered(502))).toBe(true);
  });

  it.each(["POST", "DELETE"])("does not resend a %s the provider answered with a server error", method => {
    expect(shouldResendProxyRequest(method, answered(502))).toBe(false);
  });

  it("resends a GET answered without a status code", () => {
    expect(shouldResendProxyRequest("GET", answered(undefined))).toBe(true);
  });

  it.each([200, 404, 499])("does not resend a GET answered with %s", statusCode => {
    expect(shouldResendProxyRequest("GET", answered(statusCode))).toBe(false);
  });

  it("resends a GET answered with exactly 500", () => {
    expect(shouldResendProxyRequest("GET", answered(500))).toBe(true);
  });

  it.each(["POST", "DELETE"])("resends a %s whose connection was refused", method => {
    expect(shouldResendProxyRequest(method, failed(errnoError("ECONNREFUSED")))).toBe(true);
  });

  it.each(["ECONNRESET", "ETIMEDOUT", "ESOCKETTIMEDOUT"])("does not resend a POST after %s", code => {
    expect(shouldResendProxyRequest("POST", failed(errnoError(code)))).toBe(false);
  });

  it.each(["ECONNRESET", "ETIMEDOUT"])("resends a GET after %s", code => {
    expect(shouldResendProxyRequest("GET", failed(errnoError(code)))).toBe(true);
  });

  it("does not resend a GET after an error that is not retriable", () => {
    expect(shouldResendProxyRequest("GET", failed(errnoError("ENOTFOUND")))).toBe(false);
  });

  it("does not resend a short-circuited request", () => {
    expect(shouldResendProxyRequest("GET", { ...failed(errnoError("ECONNREFUSED")), shortCircuited: true })).toBe(false);
  });

  it("does not resend to a provider that failed repeatedly", () => {
    expect(shouldResendProxyRequest("GET", { ...failed(errnoError("ECONNREFUSED")), repeatedFailure: true })).toBe(false);
  });

  it("does not resend after an invalid certificate", () => {
    expect(shouldResendProxyRequest("GET", { ok: false, code: "invalidCertificate", reason: "unknownCertificate" })).toBe(false);
  });

  it("does not resend after an insecure connection", () => {
    expect(shouldResendProxyRequest("GET", { ok: false, code: "insecureConnection" })).toBe(false);
  });

  function answered(statusCode: number | undefined): ProxyConnectionResult {
    return { ok: true, response: mock<IncomingMessage>({ statusCode }) };
  }

  function failed(error: unknown): ProxyConnectionResult {
    return { ok: false, code: "connectionError", error };
  }
});

describe(shouldResendAfterError.name, () => {
  it("resends a GET after a reset connection", () => {
    expect(shouldResendAfterError("GET", errnoError("ECONNRESET"))).toBe(true);
  });

  it("does not resend a POST after a reset connection", () => {
    expect(shouldResendAfterError("POST", errnoError("ECONNRESET"))).toBe(false);
  });

  it("resends a DELETE whose connection was refused", () => {
    expect(shouldResendAfterError("DELETE", errnoError("ECONNREFUSED"))).toBe(true);
  });
});

function errnoError(code: string) {
  return Object.assign(new Error(code), { code });
}
