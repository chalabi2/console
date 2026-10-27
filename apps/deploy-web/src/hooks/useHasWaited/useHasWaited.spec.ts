import { describe, expect, it, onTestFinished, vi } from "vitest";

import { useHasWaited } from "./useHasWaited";

import { act, renderHook } from "@testing-library/react";

describe(useHasWaited.name, () => {
  it("has not waited before the wait runs out", () => {
    const { result } = setup({ isWaiting: true });

    act(() => vi.advanceTimersByTime(999));

    expect(result.current).toBe(false);
  });

  it("has waited once the wait runs out", () => {
    const { result } = setup({ isWaiting: true });

    act(() => vi.advanceTimersByTime(1000));

    expect(result.current).toBe(true);
  });

  it("never waits while nothing is waited on", () => {
    const { result } = setup({ isWaiting: false });

    act(() => vi.advanceTimersByTime(5000));

    expect(result.current).toBe(false);
  });

  it("starts over once the wait stops and begins again", () => {
    const { result, rerender } = setup({ isWaiting: true });
    act(() => vi.advanceTimersByTime(1000));

    rerender({ isWaiting: false });
    expect(result.current).toBe(false);
    rerender({ isWaiting: true });
    act(() => vi.advanceTimersByTime(999));

    expect(result.current).toBe(false);
  });

  function setup(input: { isWaiting: boolean }) {
    vi.useFakeTimers();
    onTestFinished(() => {
      vi.useRealTimers();
    });

    return renderHook(({ isWaiting }) => useHasWaited(isWaiting, 1000), { initialProps: input });
  }
});
