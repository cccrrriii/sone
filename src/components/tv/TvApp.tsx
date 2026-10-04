import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Disc3,
  Home,
  Library,
  LogOut,
  Pause,
  Play,
  Search,
} from "lucide-react";
import TidalImage from "../TidalImage";
import VideoPlayer from "../VideoPlayer";
import ProxyNoticeBanner from "../ProxyNoticeBanner";
import { tvModeAtom } from "../../atoms/tv";
import { currentTrackAtom, isPlayingAtom } from "../../atoms/playback";
import {
  currentVideoAtom,
  videoExpandedAtom,
  videoFullscreenAtom,
} from "../../atoms/video";
import { useMediaPlay } from "../../hooks/useMediaPlay";
import { useMiniplayerEmitter } from "../../hooks/useMiniplayerEmitter";
import { usePlaybackActions } from "../../hooks/usePlaybackActions";
import {
  focusElement,
  focusFirstIn,
  moveFocus,
  rememberFocus,
  type Direction,
} from "../../lib/spatialNav";
import { getTidalImageUrl } from "../../types";
import { getTrackArtistDisplay, trackCoverId } from "../../utils/itemHelpers";
import { TvNavContext, TvScreenContext, type TvNav } from "./TvNavContext";
import type { TvAction, TvView } from "./tvItems";
import TvHome from "./TvHome";
import TvSearch from "./TvSearch";
import TvCollection from "./TvCollection";
import TvNowPlaying from "./TvNowPlaying";
import TvTrackListScreen from "./TvTrackListScreen";
import TvArtistScreen from "./TvArtistScreen";
import "./tv.css";

type RootType = "home" | "search" | "collection" | "nowPlaying";

const RAIL: { type: RootType; label: string; icon: typeof Home }[] = [
  { type: "home", label: "Home", icon: Home },
  { type: "search", label: "Search", icon: Search },
  { type: "collection", label: "My Collection", icon: Library },
  { type: "nowPlaying", label: "Now Playing", icon: Disc3 },
];

const ARROWS: Record<string, Direction> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

const BACK_KEYS = new Set(["Escape", "BrowserBack", "GoBack"]);
const CURSOR_HIDE_MS = 2500;

interface Entry {
  id: number;
  view: TvView;
}

let nextEntryId = 1;
const entry = (view: TvView): Entry => ({ id: nextEntryId++, view });

function isTextField(el: EventTarget | null): el is HTMLInputElement {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
}

/** Left/Right inside a text field move the caret until it reaches the edge. */
function caretAllowsLeaving(el: HTMLInputElement, dir: Direction): boolean {
  if (dir === "up" || dir === "down") return true;
  const start = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? 0;
  if (start !== end) return false;
  return dir === "left" ? start === 0 : end === el.value.length;
}

function renderScreen(view: TvView): ReactNode {
  switch (view.type) {
    case "home":
      return <TvHome />;
    case "search":
      return <TvSearch />;
    case "collection":
      return <TvCollection />;
    case "nowPlaying":
      return <TvNowPlaying />;
    case "artist":
      return <TvArtistScreen view={view} />;
    case "album":
    case "playlist":
    case "mix":
    case "favorites":
      return <TvTrackListScreen view={view} />;
  }
}

function Screen({ active, view }: { active: boolean; view: TvView }) {
  const ref = useRef<HTMLDivElement>(null);
  const element = useCallback(() => ref.current, []);
  const ctx = useMemo(() => ({ active, element }), [active, element]);
  return (
    <TvScreenContext.Provider value={ctx}>
      <div
        ref={ref}
        data-tv-remember
        className={`tv-screen absolute inset-0 overflow-y-auto overflow-x-hidden ${
          active ? "" : "hidden"
        }`}
      >
        {renderScreen(view)}
      </div>
    </TvScreenContext.Provider>
  );
}

/** Slim now-playing strip along the bottom; opens Now Playing on click. */
function MiniBar({ onOpen }: { onOpen: () => void }) {
  const track = useAtomValue(currentTrackAtom);
  const playing = useAtomValue(isPlayingAtom);
  if (!track) return null;
  return (
    <div
      onClick={onOpen}
      className="shrink-0 flex items-center gap-[1rem] h-[3.6rem] pl-[1.5rem] pr-[3rem] bg-th-surface/80 border-t border-th-border-subtle backdrop-blur cursor-pointer"
    >
      <TidalImage
        src={getTidalImageUrl(trackCoverId(track), 160) || undefined}
        alt=""
        className="w-[2.6rem] h-[2.6rem] rounded-[0.3rem] overflow-hidden shrink-0"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[0.8rem] font-semibold text-th-text-primary">
          {track.title}
        </div>
        <div className="truncate text-[0.65rem] text-th-text-muted">
          {getTrackArtistDisplay(track)}
        </div>
      </div>
      {playing ? (
        <Pause className="w-[1.1rem] h-[1.1rem] text-th-text-secondary" />
      ) : (
        <Play className="w-[1.1rem] h-[1.1rem] text-th-text-secondary" />
      )}
    </div>
  );
}

/**
 * The 10-foot interface: every screen is driven by arrows, Enter and Back, so
 * it works from a remote, a gamepad mapped to keys, or a keyboard. Replaces
 * the desktop Layout while TV mode is on; playback, MPRIS and the rest of the
 * app keep running underneath unchanged.
 */
export default function TvApp() {
  const store = useStore();
  const setTvMode = useSetAtom(tvModeAtom);
  const currentVideo = useAtomValue(currentVideoAtom);
  const videoExpanded = useAtomValue(videoExpandedAtom);
  const videoFullscreen = useAtomValue(videoFullscreenAtom);
  const overlayShowing = !!currentVideo && videoExpanded;
  const { playFromSource, togglePlayPause, playNext, playPrevious } =
    usePlaybackActions();
  const playMedia = useMediaPlay();

  const rootRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLElement>(null);
  const [stack, setStack] = useState<Entry[]>(() => [entry({ type: "home" })]);
  const stackRef = useRef(stack);
  useLayoutEffect(() => {
    stackRef.current = stack;
  }, [stack]);
  // Focus to give back to each screen when the one above it closes.
  const savedFocus = useRef(new Map<number, HTMLElement>());
  const pendingRestore = useRef<number | null>(null);
  const [cursorHidden, setCursorHidden] = useState(false);

  useMiniplayerEmitter();

  // Scale the whole UI with the screen (rem-based sizes) and go fullscreen.
  useLayoutEffect(() => {
    document.documentElement.classList.add("tv-mode");
    return () => document.documentElement.classList.remove("tv-mode");
  }, []);
  useEffect(() => {
    const win = getCurrentWindow();
    return () => {
      win.setFullscreen(false).catch(() => {});
    };
  }, []);
  // The video player drops window fullscreen when its own fullscreen ends;
  // TV mode always wants it back.
  useEffect(() => {
    if (!videoFullscreen)
      getCurrentWindow()
        .setFullscreen(true)
        .catch(() => {});
  }, [videoFullscreen]);

  // Hide the pointer until the mouse moves.
  useEffect(() => {
    let timer = setTimeout(() => setCursorHidden(true), CURSOR_HIDE_MS);
    const onMove = () => {
      setCursorHidden(false);
      clearTimeout(timer);
      timer = setTimeout(() => setCursorHidden(true), CURSOR_HIDE_MS);
    };
    window.addEventListener("mousemove", onMove);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("mousemove", onMove);
    };
  }, []);

  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      if (e.target instanceof HTMLElement) rememberFocus(e.target);
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);

  const goTo = useCallback((type: RootType) => {
    savedFocus.current.clear();
    setStack([entry({ type })]);
  }, []);

  /** Put a screen on the stack, remembering where focus was below it. */
  const stackPush = useCallback((view: TvView) => {
    const top = stackRef.current[stackRef.current.length - 1];
    const active = document.activeElement;
    if (active instanceof HTMLElement) savedFocus.current.set(top.id, active);
    setStack((s) => [...s, entry(view)]);
  }, []);

  const push = useCallback(
    (view: TvView) => {
      if (
        view.type === "home" ||
        view.type === "search" ||
        view.type === "collection" ||
        view.type === "nowPlaying"
      ) {
        goTo(view.type);
        return;
      }
      stackPush(view);
    },
    [goTo, stackPush],
  );

  // Starting playback opens Now Playing on top of the current screen, so
  // Back returns to the album or list it was started from.
  const showNowPlaying = useCallback(() => {
    const s = stackRef.current;
    if (s[s.length - 1].view.type === "nowPlaying") return;
    stackPush({ type: "nowPlaying" });
  }, [stackPush]);

  const focusRail = useCallback(() => {
    const rail = railRef.current;
    if (!rail) return;
    const current = rail.querySelector<HTMLElement>("[aria-current='page']");
    if (current) focusElement(current);
    else focusFirstIn(rail);
  }, []);

  const back = useCallback(() => {
    const s = stackRef.current;
    if (s.length > 1) {
      const below = s[s.length - 2];
      pendingRestore.current = below.id;
      savedFocus.current.delete(s[s.length - 1].id);
      setStack(s.slice(0, -1));
      return;
    }
    if (!railRef.current?.contains(document.activeElement)) {
      focusRail();
      return;
    }
    if (s[0].view.type !== "home") goTo("home");
  }, [focusRail, goTo]);

  useLayoutEffect(() => {
    const id = pendingRestore.current;
    if (id == null) return;
    pendingRestore.current = null;
    const el = savedFocus.current.get(id);
    savedFocus.current.delete(id);
    if (el?.isConnected) {
      focusElement(el);
    }
  }, [stack]);

  const run = useCallback<TvNav["run"]>(
    (action: TvAction, queue) => {
      switch (action.kind) {
        case "open":
          push(action.view);
          return;
        case "playVideo":
          void playMedia(action.item);
          return;
        case "playTrack": {
          const tracks = queue?.tracks.length ? queue.tracks : [action.track];
          void playFromSource(action.track, tracks, {
            source: {
              type: "tv-row",
              id: queue?.id ?? action.track.id,
              name: queue?.name ?? action.track.title,
              allTracks: tracks,
            },
          });
          showNowPlaying();
          return;
        }
      }
    },
    [push, playMedia, playFromSource, showNowPlaying],
  );

  const nav = useMemo<TvNav>(
    () => ({ push, back, run, showNowPlaying }),
    [push, back, run, showNowPlaying],
  );

  // The desktop "focus search" shortcut opens the Search screen here.
  useEffect(() => {
    const onFocusSearch = () => goTo("search");
    window.addEventListener("focus-search", onFocusSearch);
    return () => window.removeEventListener("focus-search", onFocusSearch);
  }, [goTo]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // An element (the seek bar) or the Escape dismiss stack handled it.
      if (e.defaultPrevented) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      if (store.get(currentVideoAtom) && store.get(videoExpandedAtom)) {
        // The video player owns the screen; Back returns to Now Playing
        // with the video still playing.
        if (e.key === "Backspace" || e.key === "BrowserBack") {
          e.preventDefault();
          store.set(videoExpandedAtom, false);
        }
        return;
      }

      switch (e.key) {
        case "MediaPlayPause":
          e.preventDefault();
          void togglePlayPause();
          return;
        case "MediaTrackNext":
          e.preventDefault();
          void playNext({ explicit: true });
          return;
        case "MediaTrackPrevious":
          e.preventDefault();
          void playPrevious();
          return;
      }

      const dir = ARROWS[e.key];
      if (dir) {
        if (isTextField(e.target) && !caretAllowsLeaving(e.target, dir)) {
          return;
        }
        e.preventDefault();
        if (rootRef.current) moveFocus(rootRef.current, dir);
        return;
      }

      if (
        BACK_KEYS.has(e.key) ||
        (e.key === "Backspace" && !isTextField(e.target))
      ) {
        e.preventDefault();
        if (isTextField(e.target)) e.target.blur();
        back();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store, back, togglePlayPause, playNext, playPrevious]);

  const rootType = stack[0].view.type;
  const top = stack[stack.length - 1];

  return (
    <TvNavContext.Provider value={nav}>
      <div
        ref={rootRef}
        className={`tv-root relative flex flex-col h-full w-full bg-th-base text-th-text-primary overflow-hidden ${
          cursorHidden ? "tv-cursor-hidden" : ""
        } ${overlayShowing ? "hidden" : ""}`}
      >
        <ProxyNoticeBanner />
        <div className="relative flex-1 min-h-0">
          <nav
            ref={railRef}
            data-tv-remember
            aria-label="Main"
            className="tv-rail group overflow-hidden absolute inset-y-0 left-0 z-20 flex flex-col gap-[0.4rem] py-[2rem] px-[0.8rem] bg-th-sidebar"
          >
            {RAIL.map(({ type, label, icon: Icon }) => (
              <button
                key={type}
                data-tv-focusable
                aria-current={rootType === type ? "page" : undefined}
                data-tv-default={rootType === type || undefined}
                onClick={() => goTo(type)}
                className={`tv-rail-item flex items-center gap-[1rem] h-[2.8rem] px-[0.85rem] rounded-[0.7rem] text-left ${
                  rootType === type
                    ? "text-th-accent"
                    : "text-th-text-secondary"
                }`}
              >
                <Icon className="w-[1.3rem] h-[1.3rem] shrink-0" />
                <span className="tv-rail-label whitespace-nowrap text-[0.85rem] font-semibold">
                  {label}
                </span>
              </button>
            ))}
            <div className="flex-1" />
            <button
              data-tv-focusable
              onClick={() => setTvMode(false)}
              className="tv-rail-item flex items-center gap-[1rem] h-[2.8rem] px-[0.85rem] rounded-[0.7rem] text-left text-th-text-muted"
            >
              <LogOut className="w-[1.3rem] h-[1.3rem] shrink-0" />
              <span className="tv-rail-label whitespace-nowrap text-[0.85rem] font-semibold">
                Exit TV mode
              </span>
            </button>
          </nav>

          <main
            data-tv-remember
            className="absolute inset-y-0 right-0 left-[4.5rem] bg-th-base"
          >
            {stack.map((e) => (
              <Screen key={e.id} view={e.view} active={e.id === top.id} />
            ))}
          </main>
        </div>
        {top.view.type !== "nowPlaying" && (
          <MiniBar onOpen={() => goTo("nowPlaying")} />
        )}
      </div>
      {currentVideo && <VideoPlayer />}
    </TvNavContext.Provider>
  );
}
