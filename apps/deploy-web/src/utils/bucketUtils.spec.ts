import { AxiosError, AxiosHeaders } from "axios";
import { describe, expect, it } from "vitest";

import {
  BUCKET_ENV_KEYS,
  bucketEnvOf,
  bucketKeyNameErrorOf,
  bucketKeyNameFor,
  bucketRefusalOf,
  isBucketBeingProvisioned,
  withBucketEnv,
  withoutBucketEnv
} from "./bucketUtils";

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

  describe(bucketKeyNameFor.name, () => {
    it("names a key after the service it was made for", () => {
      expect(bucketKeyNameFor("web", "a1b2")).toBe("web-a1b2");
    });

    it("turns what a key name cannot hold into dashes", () => {
      expect(bucketKeyNameFor("My_API.Server", "a1b2")).toBe("my-api-server-a1b2");
    });

    it("turns a run of what a key name cannot hold into one dash", () => {
      expect(bucketKeyNameFor("my  api__server", "a1b2")).toBe("my-api-server-a1b2");
    });

    it("trims dashes the service name starts or ends with", () => {
      expect(bucketKeyNameFor("--web--", "a1b2")).toBe("web-a1b2");
    });

    it("keeps a long service name within the provider's limit", () => {
      const name = bucketKeyNameFor("a".repeat(40), "a1b2");

      expect(name).toBe(`${"a".repeat(27)}-a1b2`);
      expect(bucketKeyNameErrorOf(name, [])).toBeUndefined();
    });

    it("drops a dash the limit leaves at the end", () => {
      expect(bucketKeyNameFor(`${"a".repeat(26)}-web`, "a1b2")).toBe(`${"a".repeat(26)}-a1b2`);
    });

    it.each(["", "___"])("names a key after no service as one for a service, from %o", serviceName => {
      expect(bucketKeyNameFor(serviceName, "a1b2")).toBe("service-a1b2");
    });
  });

  describe(withBucketEnv.name, () => {
    it("adds the bucket's variables after the service's own", () => {
      const env = withBucketEnv([{ id: "1", key: "PORT", value: "80", isSecret: false }], VARIABLES, idsFrom("new"));

      expect(env).toEqual([
        { id: "1", key: "PORT", value: "80", isSecret: false },
        ...VARIABLES.map((variable, index) => ({ id: `new${index}`, ...variable }))
      ]);
    });

    it("gives a variable the service has the bucket's value, in its place", () => {
      const env = withBucketEnv([{ id: "1", key: "AWS_REGION", value: "us-east-1", isSecret: false }], VARIABLES, idsFrom("new"));

      expect(env[0]).toEqual({ id: "1", key: "AWS_REGION", value: "default", isSecret: false });
      expect(env).toHaveLength(VARIABLES.length);
    });

    it("keeps secret a variable the service kept secret", () => {
      const env = withBucketEnv([{ id: "1", key: "S3_BUCKET", value: "old", isSecret: true }], VARIABLES, idsFrom("new"));

      expect(env[0]).toEqual({ id: "1", key: "S3_BUCKET", value: "assets-0123", isSecret: true });
    });

    it("makes a variable secret when the bucket's is", () => {
      const env = withBucketEnv([{ id: "1", key: "AWS_SECRET_ACCESS_KEY", value: "old" }], VARIABLES, idsFrom("new"));

      expect(env[0]).toEqual({ id: "1", key: "AWS_SECRET_ACCESS_KEY", value: "SECRET", isSecret: true });
    });
  });

  describe(withoutBucketEnv.name, () => {
    it("takes every bucket variable out of the service, leaving its own", () => {
      const env = [{ id: "1", key: "PORT", value: "80" }, ...BUCKET_ENV_KEYS.map((key, index) => ({ id: `b${index}`, key, value: "x" }))];

      expect(withoutBucketEnv(env)).toEqual([{ id: "1", key: "PORT", value: "80" }]);
    });
  });

  const VARIABLES = bucketEnvOf(
    { endpoint: "https://s3.provider.example", region: "default", bucket: "assets-0123" },
    { access_key_id: "AKID", secret_access_key: "SECRET" }
  );

  function idsFrom(prefix: string) {
    let next = 0;
    return () => `${prefix}${next++}`;
  }

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
