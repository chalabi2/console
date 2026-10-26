import createError from "http-errors";
import { describe, expect, it } from "vitest";

import { TxNotIncludedError, TxOutcomeUnknownError } from "@src/billing/services/external-signer-http-sdk/tx-outcome.error";
import {
  failedUpdateActivityOf,
  notAppliedUpdateActivityOf,
  pendingResizeActivityOf,
  pendingUpdateActivityOf,
  unansweredResizeActivityOf,
  undeliveredUpdateActivityOf,
  updatedActivityOf
} from "./update-activity";

describe("update activity", () => {
  const KEY = { userId: "c0ffee00-0000-4000-8000-000000000001", dseq: "1234", manifestVersion: "U0FWRUQ=" };

  describe(pendingUpdateActivityOf.name, () => {
    it("opens the update as pending under the version it saved", () => {
      expect(pendingUpdateActivityOf(KEY)).toEqual({
        userId: KEY.userId,
        type: "deployment_update",
        status: "pending",
        initiator: "user",
        dedupeKey: null,
        meta: { dseq: "1234", manifestVersion: "U0FWRUQ=" }
      });
    });
  });

  describe(pendingResizeActivityOf.name, () => {
    it("opens the update as a pending resize under the version it saved", () => {
      expect(pendingResizeActivityOf(KEY)).toEqual({
        userId: KEY.userId,
        type: "deployment_update",
        status: "pending",
        initiator: "user",
        meta: { dseq: KEY.dseq, manifestVersion: KEY.manifestVersion, resize: true },
        dedupeKey: null
      });
    });
  });

  describe(updatedActivityOf.name, () => {
    it("records the update as succeeded under the version it saved", () => {
      expect(updatedActivityOf(KEY)).toEqual({
        userId: KEY.userId,
        type: "deployment_update",
        status: "succeeded",
        initiator: "user",
        dedupeKey: null,
        meta: { dseq: "1234", manifestVersion: "U0FWRUQ=" }
      });
    });
  });

  describe(failedUpdateActivityOf.name, () => {
    it("keeps an update whose outcome is undecided pending under its hash", () => {
      expect(failedUpdateActivityOf(KEY, new TxOutcomeUnknownError("ABCDEF"))).toEqual({
        userId: KEY.userId,
        type: "deployment_update",
        status: "pending",
        initiator: "user",
        dedupeKey: null,
        meta: { dseq: "1234", manifestVersion: "U0FWRUQ=", txHash: "ABCDEF" }
      });
    });

    it("records an update that never landed as failed with the reason the caller was given", () => {
      expect(failedUpdateActivityOf(KEY, new TxNotIncludedError("ABCDEF"))).toEqual({
        userId: KEY.userId,
        type: "deployment_update",
        status: "failed",
        initiator: "user",
        dedupeKey: null,
        meta: { dseq: "1234", manifestVersion: "U0FWRUQ=", error: { code: "tx_not_included", message: "The request expired and can no longer complete" } }
      });
    });

    it("keeps the message of an exposed error under a generic code when it names none", () => {
      expect(failedUpdateActivityOf(KEY, createError(400, "Deployment closed")).meta.error).toEqual({ code: "update_failed", message: "Deployment closed" });
    });

    it("hides the message of an error not meant for the caller", () => {
      expect(failedUpdateActivityOf(KEY, new Error("socket hang up")).meta.error).toEqual({
        code: "update_failed",
        message: "Something went wrong while applying the update. Try updating it again in a moment."
      });
    });
  });

  describe(notAppliedUpdateActivityOf.name, () => {
    it("records the update as failed with a reason that asks for another update", () => {
      expect(notAppliedUpdateActivityOf(KEY)).toEqual({
        userId: KEY.userId,
        type: "deployment_update",
        status: "failed",
        initiator: "user",
        dedupeKey: null,
        meta: {
          dseq: "1234",
          manifestVersion: "U0FWRUQ=",
          error: { code: "update_incomplete", message: "The update did not go through. Try updating it again." }
        }
      });
    });
  });

  describe(undeliveredUpdateActivityOf.name, () => {
    it("records the update as failed with a reason that says the provider may not have it", () => {
      expect(undeliveredUpdateActivityOf(KEY)).toEqual({
        userId: KEY.userId,
        type: "deployment_update",
        status: "failed",
        initiator: "user",
        dedupeKey: null,
        meta: {
          dseq: "1234",
          manifestVersion: "U0FWRUQ=",
          error: {
            code: "update_not_delivered",
            message: "The update reached the network, but your provider may not have received it. Try updating it again."
          }
        }
      });
    });
  });

  describe(unansweredResizeActivityOf.name, () => {
    it("records a declined resize as failed, saying the deployment keeps its resources", () => {
      expect(unansweredResizeActivityOf(KEY, "declined")).toEqual({
        userId: KEY.userId,
        type: "deployment_update",
        status: "failed",
        initiator: "user",
        dedupeKey: null,
        meta: {
          dseq: KEY.dseq,
          manifestVersion: KEY.manifestVersion,
          error: {
            code: "resize_declined",
            message:
              "The provider declined the new resources, or the resize was canceled, so the deployment keeps the resources it had. Try a smaller change or a higher price."
          }
        }
      });
    });

    it("records a resize the provider never answered as failed, asking for another update", () => {
      expect(unansweredResizeActivityOf(KEY, "expired").meta.error).toEqual({
        code: "resize_expired",
        message: "The provider did not answer the resize in time, so the deployment keeps the resources it had. Try updating it again."
      });
    });
  });
});
