import { useCallback, useEffect, useState } from "react";
import { safeErrorMessage } from "../../lib/errorUtils";

/** Load a screen's data once (and again on `retry`). `load` must be stable,
 *  i.e. wrapped in useCallback by the caller. */
export function useTvLoader<T>(load: () => Promise<T>, failure: string) {
  const [state, setState] = useState<{ data: T | null; error: string | null }>({
    data: null,
    error: null,
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    load().then(
      (data) => {
        if (!cancelled) setState({ data, error: null });
      },
      (e) => {
        if (!cancelled)
          setState({ data: null, error: safeErrorMessage(e, failure) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [load, failure, attempt]);

  const retry = useCallback(() => {
    setState({ data: null, error: null });
    setAttempt((a) => a + 1);
  }, []);

  return { ...state, retry };
}
