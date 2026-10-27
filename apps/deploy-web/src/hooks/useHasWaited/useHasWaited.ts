import { useEffect, useState } from "react";

export function useHasWaited(isWaiting: boolean, waitMs: number): boolean {
  const [hasWaited, setHasWaited] = useState(false);

  useEffect(
    function markWaitedOnceTheWaitRunsOut() {
      setHasWaited(false);
      if (!isWaiting) return;

      const timer = setTimeout(() => setHasWaited(true), waitMs);
      return () => clearTimeout(timer);
    },
    [isWaiting, waitMs]
  );

  return isWaiting && hasWaited;
}
