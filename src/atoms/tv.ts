import { atomWithStorage } from "jotai/utils";

/** `true` = the 10-foot TV interface (remote / D-pad navigation, fullscreen)
 *  replaces the desktop layout. Read on init so a TV launch never paints the
 *  desktop layout first. Frontend-only preference (localStorage); `--tv` on
 *  the command line forces it on (see AppInitializer). */
export const tvModeAtom = atomWithStorage("sone.tvMode.v1", false, undefined, {
  getOnInit: true,
});
