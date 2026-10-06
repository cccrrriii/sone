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
  Settings,
} from "lucide-react";
import TidalImage from "../TidalImage";
import VideoPlayer from "../VideoPlayer";
import ProxyNoticeBanner from "../ProxyNoticeBanner";
import SettingsSheet from "../settings/SettingsSheet";
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
import TvSettings from "./TvSettings";
import TvMenuHost, { type TvMenuHostHandle } from "./TvMenuHost";
import { menuForElement } from "./tvMenu";
import "./tv.css";

type RootType = "home" | "search" | "collection" | "nowPlaying" | "settings";

const RAIL: { type: RootType; label: string; icon: typeof Home }[] = [
  { type: "home", label: "Home", icon: Home },
  { type: "search", label: "Search", icon: Search },
  { type: "collection", label: "My Collection", icon: Library },
  { type: "nowPlaying", label: "Now Playing", icon: Disc3 },
  { type: "settings", label: "Settings", icon: Settings },
];

const ROOTS = new Set<string>(RAIL.map((r) => r.type));

/** How long Enter must be held to open the action menu instead of
 *  activating the focused item. */
const LONG_PRESS_MS = 550;

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
    case "settings":
      return <TvSettings />;
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
        data-tv-scroll-root
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
 * The desktop settings sheet inside TV mode, for the settings that have no
 * TV screen of their own. Scaled up to TV size, and marked native so every
 * control in it is reachable with the arrow keys.
 */
function MoreSettings({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [zoom] = useState(() => {
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    // The sheet is at most 800x740 CSS px; keep it on screen.
    return Math.max(
      1,
      Math.min(
        rem / 16,
        (window.innerHeight * 0.94) / 740,
        (window.innerWidth * 0.95) / 800,
      ),
    );
  });
  useLayoutEffect(() => {
    const id = requestAnimationFrame(() => {
      if (ref.current) focusFirstIn(ref.current);
    });
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div ref={ref} data-tv-modal data-tv-native style={{ zoom }}>
      <SettingsSheet open onClose={onClose} />
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
    const html = document.documentElement;
    html.classList.add("tv-mode");
    // Pixel-sized desktop pieces shown in TV mode (toasts) scale by this.
    const updateScale = () => {
      const rem = parseFloat(getComputedStyle(html).fontSize);
      html.style.setProperty("--tv-px-scale", String(Math.max(1, rem / 16)));
    };
    updateScale();
    window.addEventListener("resize", updateScale);
    return () => {
      window.removeEventListener("resize", updateScale);
      html.classList.remove("tv-mode");
      html.style.removeProperty("--tv-px-scale");
    };
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
      if (ROOTS.has(view.type)) {
        goTo(view.type as RootType);
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

  // Picking the track that is already playing just shows it rather than
  // restarting it from the beginning.
  const playTrack = useCallback<TvNav["playTrack"]>(
    (track, tracks, options) => {
      if (store.get(currentTrackAtom)?.id !== track.id) {
        void playFromSource(track, tracks, options);
      }
      showNowPlaying();
    },
    [store, playFromSource, showNowPlaying],
  );

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
          playTrack(action.track, tracks, {
            source: {
              type: "tv-row",
              id: queue?.id ?? action.track.id,
              name: queue?.name ?? action.track.title,
              allTracks: tracks,
            },
          });
          return;
        }
      }
    },
    [push, playMedia, playTrack],
  );

  const menuRef = useRef<TvMenuHostHandle>(null);
  const [moreSettings, setMoreSettings] = useState(false);
  const moreSettingsReturn = useRef<HTMLElement | null>(null);

  const moreSettingsOpenRef = useRef(false);
  useLayoutEffect(() => {
    moreSettingsOpenRef.current = moreSettings;
  }, [moreSettings]);

  const openMoreSettings = useCallback(() => {
    const active = document.activeElement;
    moreSettingsReturn.current = active instanceof HTMLElement ? active : null;
    setMoreSettings(true);
  }, []);
  const closeMoreSettings = useCallback(() => {
    setMoreSettings(false);
    const el = moreSettingsReturn.current;
    moreSettingsReturn.current = null;
    if (el?.isConnected) requestAnimationFrame(() => focusElement(el));
  }, []);

  const nav = useMemo<TvNav>(
    () => ({
      push,
      back,
      run,
      showNowPlaying,
      playTrack,
      openMenu: (spec) => menuRef.current?.open(spec),
      trackMenu: (track) => menuRef.current!.trackMenu(track),
      mediaMenu: (item) => menuRef.current!.mediaMenu(item),
      openMoreSettings,
    }),
    [push, back, run, showNowPlaying, playTrack, openMoreSettings],
  );

  // The desktop "focus search" shortcut opens the Search screen here.
  useEffect(() => {
    const onFocusSearch = () => goTo("search");
    window.addEventListener("focus-search", onFocusSearch);
    return () => window.removeEventListener("focus-search", onFocusSearch);
  }, [goTo]);

  useEffect(() => {
    // Long-pressing Enter on an item that has an action menu opens the
    // menu; a short press activates the item as usual.
    let held: { el: HTMLElement; timer: number; fired: boolean } | null = null;

    const openMenuFor = (el: Element | null) => {
      const build = menuForElement(el);
      if (build) menuRef.current?.open(build());
      return !!build;
    };

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
        case "ContextMenu":
          e.preventDefault();
          openMenuFor(document.activeElement);
          return;
        case "Enter": {
          const target = document.activeElement as HTMLElement | null;
          if (!target || !menuForElement(target)) return;
          e.preventDefault();
          if (e.repeat || held) return;
          held = {
            el: target,
            fired: false,
            timer: window.setTimeout(() => {
              if (!held) return;
              held.fired = true;
              openMenuFor(held.el);
            }, LONG_PRESS_MS),
          };
          return;
        }
      }

      // A modal (the action menu, the settings sheet) keeps focus to itself.
      const modals = document.querySelectorAll<HTMLElement>("[data-tv-modal]");
      const scope = modals[modals.length - 1] ?? rootRef.current;

      const dir = ARROWS[e.key];
      if (dir) {
        if (isTextField(e.target) && !caretAllowsLeaving(e.target, dir)) {
          return;
        }
        e.preventDefault();
        if (scope) moveFocus(scope, dir);
        return;
      }

      if (
        BACK_KEYS.has(e.key) ||
        (e.key === "Backspace" && !isTextField(e.target))
      ) {
        e.preventDefault();
        if (isTextField(e.target)) e.target.blur();
        if (menuRef.current?.isOpen()) menuRef.current.back();
        else if (moreSettingsOpenRef.current) closeMoreSettings();
        else back();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || !held) return;
      const { el, timer, fired } = held;
      held = null;
      window.clearTimeout(timer);
      if (!fired) el.click();
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      if (held) window.clearTimeout(held.timer);
    };
  }, [store, back, togglePlayPause, playNext, playPrevious, closeMoreSettings]);

  // Now Playing opened on top of another screen still counts as being on
  // Now Playing for the rail's highlight.
  const top = stack[stack.length - 1];
  const rootType =
    top.view.type === "nowPlaying" ? "nowPlaying" : stack[0].view.type;

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
            data-tv-side
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

          <main data-tv-remember className="absolute inset-0 bg-th-base">
            {stack.map((e) => (
              <Screen key={e.id} view={e.view} active={e.id === top.id} />
            ))}
          </main>
        </div>
        {top.view.type !== "nowPlaying" && (
          <MiniBar onOpen={() => goTo("nowPlaying")} />
        )}
      </div>
      <TvMenuHost ref={menuRef} onNavigate={push} onPlayed={showNowPlaying} />
      {moreSettings && <MoreSettings onClose={closeMoreSettings} />}
      {currentVideo && <VideoPlayer />}
    </TvNavContext.Provider>
  );
}
