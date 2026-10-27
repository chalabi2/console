import { ApiError } from "@akashnetwork/openapi-sdk";
import { describe, expect, it } from "vitest";

import {
  addCreditsContentOf,
  creditsRefusalOf,
  isClientRefusal,
  isResizePending,
  isStaleProviderVersion,
  resourceRefusalOf,
  sdlRefusalOf
} from "./updateDeploymentFailure";

const BAD_SDL = new ApiError(400, { message: "SDL is not valid YAML: line 3, column 5" }, "PATCH /v1/deployments/{dseq} → 400");
const PATCHED_SDL_TOO_LARGE = new ApiError(
  400,
  { message: "The patched SDL is too large: it exceeds the maximum of 131072 characters once stored" },
  "PATCH /v1/deployments/{dseq} → 400"
);
const PROVIDER_BEHIND = new ApiError(
  409,
  { message: "Your update was accepted, but the provider has not picked it up yet.", code: "provider_manifest_version_stale" },
  "PATCH /v1/deployments/{dseq} → 409"
);
const DEFINITION_CHANGED = new ApiError(
  409,
  { message: "Deployment definition changed concurrently, please retry", code: "deployment_definition_changed" },
  "PATCH /v1/deployments/{dseq} → 409"
);
const UNKNOWN_PORT = new ApiError(400, { message: 'service "web" exposes no port "8080"' }, "PATCH /v1/deployments/{dseq} → 400");
const TRIAL_GATED = new ApiError(400, { message: "Invalid SDL: GPU deployments are not available on free trial" }, "PATCH /v1/deployments/{dseq} → 400");
const OUT_OF_CREDITS = new ApiError(402, { message: "Insufficient balance: top up to keep deploying" }, "PATCH /v1/deployments/{dseq} → 402");
const SERVER_FAILURE = new ApiError(500, { message: "Invalid SDL: the console could not read it" }, "PATCH /v1/deployments/{dseq} → 500");
const RESIZE_REFUSED = new ApiError(
  422,
  { message: 'The SDL changes group "dcloud" in a way a running lease cannot be resized to: it adds or removes GPUs.', code: "deployment_resize_refused" },
  "PATCH /v1/deployments/{dseq} → 422"
);

describe("sdlRefusalOf", () => {
  it("returns the message of a 400 refusing the document itself", () => {
    expect(sdlRefusalOf(BAD_SDL)).toBe("SDL is not valid YAML: line 3, column 5");
  });

  it("returns the message of a 400 refusing a patched document too large to store", () => {
    expect(sdlRefusalOf(PATCHED_SDL_TOO_LARGE)).toBe("The patched SDL is too large: it exceeds the maximum of 131072 characters once stored");
  });

  it("returns nothing for a 400 that refuses something other than the document", () => {
    expect(sdlRefusalOf(UNKNOWN_PORT)).toBeNull();
  });

  it("returns nothing for a trial gate, which only adding credits resolves", () => {
    expect(sdlRefusalOf(TRIAL_GATED)).toBeNull();
  });

  it("returns nothing for a server failure worded like a refusal", () => {
    expect(sdlRefusalOf(SERVER_FAILURE)).toBeNull();
  });
});

describe("creditsRefusalOf", () => {
  it("returns the message of a 402", () => {
    expect(creditsRefusalOf(OUT_OF_CREDITS)).toBe("Insufficient balance: top up to keep deploying");
  });

  it("returns a trial gate without the refusal prefix", () => {
    expect(creditsRefusalOf(TRIAL_GATED)).toBe("GPU deployments are not available on free trial");
  });

  it("returns nothing for any other refusal", () => {
    expect(creditsRefusalOf(BAD_SDL)).toBeNull();
  });

  it("returns an empty refusal for a 402 that carries no message", () => {
    expect(creditsRefusalOf(new ApiError(402, {}, "PATCH /v1/deployments/{dseq} → 402"))).toBe("");
  });

  it("reads a trial gate only off a 400", () => {
    expect(creditsRefusalOf(new ApiError(500, { message: "GPU deployments are not available on free trial" }, "PATCH → 500"))).toBeNull();
  });

  it("returns nothing for a 400 that carries no message", () => {
    expect(creditsRefusalOf(new ApiError(400, {}, "PATCH → 400"))).toBeNull();
  });
});

describe("addCreditsContentOf", () => {
  it("splits a titled refusal at its first colon", () => {
    expect(addCreditsContentOf("Insufficient balance: top up to keep deploying")).toEqual({
      title: "Insufficient balance",
      message: "top up to keep deploying"
    });
  });

  it("titles an untitled refusal as a request for credits", () => {
    expect(addCreditsContentOf("Not enough funds")).toEqual({ title: "Add credits to continue", message: "Not enough funds" });
  });

  it("carries no message for an empty refusal", () => {
    expect(addCreditsContentOf("")).toEqual({ title: "Add credits to continue", message: undefined });
  });
});

describe("isStaleProviderVersion", () => {
  it.each([
    { named: "the provider lagging the chain", cause: PROVIDER_BEHIND, expected: true },
    { named: "a definition changed elsewhere", cause: DEFINITION_CHANGED, expected: false },
    {
      named: "a seal made against a retired key",
      cause: new ApiError(409, { message: "Sealed to a key the console no longer holds; refetch the SDL secrets context", code: "conflict" }, "PATCH → 409"),
      expected: false
    },
    { named: "an error that is not the api's", cause: new Error("offline"), expected: false }
  ])("reads $named as $expected", ({ cause, expected }) => {
    expect(isStaleProviderVersion(cause)).toBe(expected);
  });
});

describe("isClientRefusal", () => {
  it.each([
    { named: "a 400", cause: BAD_SDL, expected: true },
    { named: "a 402", cause: OUT_OF_CREDITS, expected: true },
    { named: "a 422", cause: RESIZE_REFUSED, expected: true },
    { named: "a 500", cause: SERVER_FAILURE, expected: false },
    { named: "an error that is not the api's", cause: new Error("offline"), expected: false }
  ])("reads $named as $expected", ({ cause, expected }) => {
    expect(isClientRefusal(cause)).toBe(expected);
  });
});

describe("resourceRefusalOf", () => {
  it.each(["deployment_resources_changed", "deployment_resources_unapplied", "deployment_resize_refused", "deployment_resize_several_groups"])(
    "returns the message of a 422 coded %s, which the user answers by editing the resources",
    code => {
      expect(resourceRefusalOf(new ApiError(422, { message: "The SDL changes the resources", code }, "PATCH → 422"))).toBe("The SDL changes the resources");
    }
  );

  it.each([
    { named: "a 422 carrying another code", cause: new ApiError(422, { message: "Unprocessable", code: "other" }, "PATCH → 422") },
    { named: "a refusal of resources that is not a 422", cause: new ApiError(409, { message: "Held", code: "deployment_resize_refused" }, "PATCH → 409") },
    { named: "an error that is not the api's", cause: new Error("offline") }
  ])("returns nothing for $named", ({ cause }) => {
    expect(resourceRefusalOf(cause)).toBeNull();
  });
});

describe("isResizePending", () => {
  it("tells a conflict over a resize waiting for its provider", () => {
    expect(isResizePending(new ApiError(409, { message: "A resize is waiting", code: "deployment_resize_pending" }, "PATCH → 409"))).toBe(true);
  });

  it.each([
    { case: "another conflict", cause: new ApiError(409, { message: "Changed elsewhere", code: "deployment_definition_changed" }, "PATCH → 409") },
    {
      case: "the same code answered as no conflict",
      cause: new ApiError(422, { message: "A resize is waiting", code: "deployment_resize_pending" }, "PATCH → 422")
    },
    { case: "an error the api did not answer", cause: Object.assign(new Error("offline"), { status: 409, code: "deployment_resize_pending" }) }
  ])("tells no pending resize from $case", ({ cause }) => {
    expect(isResizePending(cause)).toBe(false);
  });
});
