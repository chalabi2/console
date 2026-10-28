import type { ProxyConnectionResult } from "../services/ProviderProxy";
import { canRetryOnError, isConnectionRefused } from "./retry";

/** A POST or DELETE that may have reached the provider is never repeated: a second key creation would lose the first key's secret. */
const RESENDABLE_METHODS = new Set(["GET", "PUT"]);

export function shouldResendAfterError(method: string, error: unknown): boolean {
  return RESENDABLE_METHODS.has(method) ? canRetryOnError(error) : isConnectionRefused(error);
}

export function shouldResendProxyRequest(method: string, result: ProxyConnectionResult): boolean {
  if (result.ok) {
    return RESENDABLE_METHODS.has(method) && (!result.response.statusCode || result.response.statusCode >= 500);
  }

  if (result.code !== "connectionError" || result.shortCircuited || result.repeatedFailure) {
    return false;
  }

  return shouldResendAfterError(method, result.error);
}
