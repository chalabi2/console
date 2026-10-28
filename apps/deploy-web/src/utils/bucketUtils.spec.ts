import { AxiosError, AxiosHeaders } from "axios";
import { describe, expect, it } from "vitest";

import { bucketEnvOf, bucketKeyNameErrorOf, bucketRefusalOf, isBucketBeingProvisioned } from "./bucketUtils";

describe("bucketUtils", () => {
  describe(bucketKeyNameErrorOf.name, () => {
    it.each(["app", "a", "0", "app-1", "a".repeat(32)])("accepts %s", name => {
      expect(bucketKeyNameErrorOf(name, [])).toBeUndefined();
    });

    it.each(["", "App", "app_1", "-app", "app-", "a:b", "a".repeat(33)])("refuses %s", name => {
      expect(bucketKeyNameErrorOf(name, [])).toBe("Use up to 32 lowercase letters, digits and dashes, starting and ending with a letter or digit.");
    });

    it("refuses a name the bucket's keys already took", () => {
      expect(bucketKeyNameErrorOf("app", ["other", "app"])).toBe("This bucket already has a key named app.");
    });
  });

  describe(bucketRefusalOf.name, () => {
    it("reads the provider's reason for a refused request as a sentence", () => {
      expect(bucketRefusalOf(responseError(409, "an access key with this name exists\n"))).toBe("An access key with this name exists.");
    });

    it("reads no reason from a server error", () => {
      expect(bucketRefusalOf(responseError(500, "bucket backend error"))).toBeUndefined();
    });

    it("reads a reason from the last status below a server error", () => {
      expect(bucketRefusalOf(responseError(499, "client closed"))).toBe("Client closed.");
    });

    it.each([
      { case: "an empty answer", error: responseError(409, " \n") },
      { case: "a structured answer", error: responseError(401, { error: "unauthorized" }) },
      { case: "no answer", error: new AxiosError("Network Error") },
      { case: "an error from elsewhere", error: new Error("an access key with this name exists") }
    ])("reads no reason from $case", ({ error }) => {
      expect(bucketRefusalOf(error)).toBeUndefined();
    });
  });

  describe(isBucketBeingProvisioned.name, () => {
    it("reads an unavailable bucket as being provisioned", () => {
      expect(isBucketBeingProvisioned(responseError(503, "the bucket is being provisioned"))).toBe(true);
    });

    it.each([responseError(502, ""), responseError(404, "no bucket for this lease"), new AxiosError("Network Error"), new Error("boom")])(
      "reads %s as something else",
      error => {
        expect(isBucketBeingProvisioned(error)).toBe(false);
      }
    );
  });

  describe(bucketEnvOf.name, () => {
    it("gives the endpoint, region and bucket as variables and the key as secrets", () => {
      expect(
        bucketEnvOf(
          { endpoint: "https://s3.provider.example", region: "default", bucket: "assets-0123" },
          { access_key_id: "AKID", secret_access_key: "SECRET" }
        )
      ).toEqual([
        { key: "AWS_ENDPOINT_URL_S3", value: "https://s3.provider.example", isSecret: false },
        { key: "AWS_REGION", value: "default", isSecret: false },
        { key: "S3_BUCKET", value: "assets-0123", isSecret: false },
        { key: "AWS_ACCESS_KEY_ID", value: "AKID", isSecret: true },
        { key: "AWS_SECRET_ACCESS_KEY", value: "SECRET", isSecret: true }
      ]);
    });
  });

  function responseError(status: number, data: unknown) {
    return new AxiosError("Request failed", String(status), undefined, undefined, {
      status,
      statusText: "",
      data,
      headers: {},
      config: { headers: new AxiosHeaders() }
    });
  }
});
