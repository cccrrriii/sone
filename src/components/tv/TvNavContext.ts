import { createContext, useContext, useEffect } from "react";
import { focusFirstIn } from "../../lib/spatialNav";
import type { Track } from "../../types";
import type { TvAction, TvView } from "./tvItems";

export interface TvNav {
  /** Open a screen on top of the current one; Back returns to it. */
  push: (view: TvView) => void;
  back: () => void;
  /** Show Now Playing on top of the current screen (after starting playback). */
  showNowPlaying: () => void;
  /** Carry out a card's action. `queue` is the row it sits in, so playing a
   *  track keeps the rest of that row queued behind it. */
  run: (
    action: TvAction,
    queue?: { tracks: Track[]; name: string; id: string },
  ) => void;
}

export const TvNavContext = createContext<TvNav | null>(null);

export function useTvNav(): TvNav {
  const nav = useContext(TvNavContext);
  if (!nav) throw new Error("useTvNav must be used inside the TV interface");
  return nav;
}

interface TvScreen {
  /** Whether this screen is the one on top. Screens below it stay mounted
   *  (so Back restores their focus and scroll) but must not grab focus. */
  active: boolean;
  element: () => HTMLElement | null;
}

export const TvScreenContext = createContext<TvScreen>({
  active: true,
  element: () => null,
});

/**
 * Put focus on the screen's first item (or its `data-tv-autofocus` one) once
 * its content has loaded — unless focus is already inside it, e.g. restored
 * by Back. Checked a frame later so a restore in the same commit wins.
 */
export function useTvInitialFocus(ready: boolean) {
  const { active, element } = useContext(TvScreenContext);
  useEffect(() => {
    if (!ready || !active) return;
    const id = requestAnimationFrame(() => {
      const el = element();
      if (!el || el.contains(document.activeElement)) return;
      focusFirstIn(el);
    });
    return () => cancelAnimationFrame(id);
  }, [ready, active, element]);
}
