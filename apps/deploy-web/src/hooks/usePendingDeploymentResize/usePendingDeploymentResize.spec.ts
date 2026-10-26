import { describe, expect, it, vi } from "vitest";
import { mock } from "vitest-mock-extended";

import type { Activity } from "@src/queries/useLatestActivitiesQuery";
import type { DEPENDENCIES } from "./usePendingDeploymentResize";
import { usePendingDeploymentResize } from "./usePendingDeploymentResize";

import { renderHook } from "@testing-library/react";
import { buildActivity } from "@tests/seeders/activity";
import { buildUser } from "@tests/seeders/user";

describe(usePendingDeploymentResize.name, () => {
  it("finds the deployment's newest update while it waits for the provider to resize the lease", () => {
    const resizing = buildActivity({ type: "deployment_update", status: "pending", meta: { dseq: "1001", manifestVersion: "bmV3", resize: true } });
    const { result } = setup({
      dseq: "1001",
      activities: [
        buildActivity({ type: "deployment_update", status: "pending", meta: { dseq: "2002", resize: true } }),
        resizing,
        buildActivity({ type: "deployment_update", status: "failed", meta: { dseq: "1001", resize: true } })
      ]
    });

    expect(result.current).toBe(resizing);
  });

  it.each([
    { case: "a pending update that resizes nothing", activity: { status: "pending" as const, meta: { dseq: "1001" } } },
    { case: "a resize that already ended", activity: { status: "failed" as const, meta: { dseq: "1001", resize: true } } }
  ])("finds nothing for $case", ({ activity }) => {
    const { result } = setup({ dseq: "1001", activities: [buildActivity({ type: "deployment_update", ...activity })] });

    expect(result.current).toBeUndefined();
  });

  it("finds nothing while the activity center is off", () => {
    const { result } = setup({
      dseq: "1001",
      activities: [buildActivity({ type: "deployment_update", status: "pending", meta: { dseq: "1001", resize: true } })],
      isEnabled: false
    });

    expect(result.current).toBeUndefined();
  });

  function setup(input: { dseq: string; activities?: Activity[]; isEnabled?: boolean }) {
    const dependencies: typeof DEPENDENCIES = {
      useFlag: vi.fn((flag: string) => flag === "notifications_activity_center" && (input.isEnabled ?? true)) as typeof DEPENDENCIES.useFlag,
      useUser: () => mock<ReturnType<typeof DEPENDENCIES.useUser>>({ user: buildUser() }),
      useLatestActivitiesQuery: (() =>
        Object.assign(mock<ReturnType<typeof DEPENDENCIES.useLatestActivitiesQuery>>(), {
          data: input.activities
        })) as typeof DEPENDENCIES.useLatestActivitiesQuery
    };

    return renderHook(() => usePendingDeploymentResize(input.dseq, dependencies));
  }
});
