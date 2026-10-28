import type { LoggerService } from "@akashnetwork/logging";
import { setTimeout } from "timers/promises";

export const httpRetry = <T>(callback: () => Promise<T>, options: HttpRetryOptions<T>): Promise<T> => {
  return retryWithBackoff(callback, options.retryIf, options.retryOnError ?? canRetryOnError, options.maxRetries || 3, 0, options.logger);
};

export interface HttpRetryOptions<T> {
  retryIf: (response: T) => boolean;
  retryOnError?: (error: unknown) => boolean;
  maxRetries?: number;
  logger?: LoggerService;
}

async function retryWithBackoff<T>(
  callback: () => Promise<T>,
  shouldRetryOnResponse: HttpRetryOptions<T>["retryIf"],
  shouldRetryOnError: (error: unknown) => boolean,
  maxRetries: number,
  attempt: number,
  logger?: LoggerService
): Promise<T> {
  const callbackName = callback.name || String(callback);

  try {
    if (attempt > 0) {
      // (2 ** 1) * 100 = 200 ms
      // (2 ** 2) * 100 = 400 ms
      // (2 ** 3) * 100 = 800 ms
      // (2 ** 4) * 100 = 1600 ms
      // (2 ** 5) * 100 = 3200 ms
      await setTimeout(2 ** attempt * 100);
    }

    logger?.info({
      event: "RUN_CALLBACK",
      attempt: attempt + 1,
      maxRetries,
      callback: callbackName
    });
    const response = await callback();

    if (attempt < maxRetries && shouldRetryOnResponse(response)) {
      logger?.warn({
        event: "RUN_CALLBACK_FAILED",
        attempt: attempt + 1,
        maxRetries,
        callback: callbackName,
        error: "Callback result requires retry"
      });
      return retryWithBackoff(callback, shouldRetryOnResponse, shouldRetryOnError, maxRetries, attempt + 1, logger);
    }
    return response;
  } catch (error: unknown) {
    if (attempt < maxRetries && shouldRetryOnError(error)) {
      logger?.warn({
        event: "RUN_CALLBACK_FAILED",
        attempt: attempt + 1,
        maxRetries,
        callback: callbackName,
        error
      });
      return retryWithBackoff(callback, shouldRetryOnResponse, shouldRetryOnError, maxRetries, attempt + 1, logger);
    }

    if (attempt >= maxRetries) {
      throw new Error(`Max retries reached: ${maxRetries}`, { cause: error });
    }

    throw new Error("Fail to retry due to receiving non-retriable error", { cause: error });
  }
}

const isRetriableError = (code: string) =>
  code === "ECONNREFUSED" || code === "ECONNRESET" || code === "ERR_TLS_SESSION_REJECTED" || code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT";

export function canRetryOnError(error: unknown): boolean {
  const code = errorCodeOf(error);
  return code !== undefined && isRetriableError(code);
}

export function isConnectionRefused(error: unknown): boolean {
  return errorCodeOf(error) === "ECONNREFUSED";
}

function errorCodeOf(error: unknown): string | undefined {
  if (!error) return undefined;

  if (Object.hasOwn(error as Error, "code")) {
    return (error as { code: string }).code;
  }

  return errorCodeOf((error as Error).cause);
}
