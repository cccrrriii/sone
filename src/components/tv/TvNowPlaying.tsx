import { useEffect, useState } from "react";
import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import {
  ChevronDown,
  Heart,
  Mic2,
  MoreHorizontal,
  Volume1,
  Volume2,
  VolumeX,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Tv,
} from "lucide-react";
import TidalImage from "../TidalImage";
import {
  currentTrackAtom,
  isPlayingAtom,
  manualQueueAtom,
  queueAtom,
  repeatAtom,
  shuffleAtom,
  streamInfoAtom,
  volumeAtom,
  preMuteVolumeAtom,
  bitPerfectAtom,
} from "../../atoms/playback";
import { currentVideoAtom, videoExpandedAtom } from "../../atoms/video";
import { tvLyricsAtom } from "../../atoms/tv";
import { useFavorites } from "../../hooks/useFavorites";
import { usePlaybackActions } from "../../hooks/usePlaybackActions";
import { formatTime } from "../../lib/format";
import { getInterpolatedPosition } from "../../lib/playbackPosition";
import { getTidalImageUrl } from "../../types";
import {
  formatStreamQuality,
  getTrackArtistDisplay,
  trackCoverId,
} from "../../utils/itemHelpers";
import { useTvInitialFocus, useTvNav } from "./TvNavContext";
import { TvButton, TvTrackRow } from "./TvParts";
import { TvLyricsPanel } from "./TvLyrics";
import { useTvLyrics } from "./useTvLyrics";

const SEEK_STEP_SECS = 10;
const UP_NEXT_SHOWN = 20;

/** Re-reads the interpolated playback position a few times a second. */
function usePosition(): number {
  const [pos, setPos] = useState(getInterpolatedPosition);
  useEffect(() => {
    const id = setInterval(() => setPos(getInterpolatedPosition()), 250);
    return () => clearInterval(id);
  }, []);
  return pos;
}

const VOLUME_STEP = 0.05;

/** Volume bar: Left/Right change it in 5% steps, Enter mutes. Locked while
 *  bit-perfect output is on, since the DAC must get unscaled samples. */
function VolumeControl() {
  const volume = useAtomValue(volumeAtom);
  const bitPerfect = useAtomValue(bitPerfectAtom);
  const store = useStore();
  const { setVolume } = usePlaybackActions();
  const pct = Math.round(volume * 100);
  const Icon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  if (bitPerfect) {
    return (
      <span className="inline-flex items-center gap-[0.5rem] text-[0.7rem] text-th-text-muted">
        <Volume2 className="w-[1.1rem] h-[1.1rem]" />
        Volume fixed (bit-perfect)
      </span>
    );
  }

  const toggleMute = () => {
    if (volume > 0) {
      store.set(preMuteVolumeAtom, volume);
      void setVolume(0);
    } else {
      void setVolume(store.get(preMuteVolumeAtom) || 0.5);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const delta = e.key === "ArrowLeft" ? -VOLUME_STEP : VOLUME_STEP;
      void setVolume(
        Math.round(Math.max(0, Math.min(1, volume + delta)) * 100) / 100,
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      toggleMute();
    }
  };

  return (
    <div
      data-tv-focusable
      tabIndex={0}
      role="slider"
      aria-label="Volume"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      onKeyDown={onKeyDown}
      onClick={toggleMute}
      className="tv-progress inline-flex items-center gap-[0.6rem] h-[2.6rem] px-[0.9rem] rounded-full bg-th-button outline-none"
    >
      <Icon className="w-[1.1rem] h-[1.1rem] text-th-text-primary shrink-0" />
      <span className="relative w-[7rem] h-[0.3rem] rounded-full bg-th-slider-track">
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-th-accent"
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="w-[2.2rem] text-right text-[0.7rem] text-th-text-secondary tabular-nums">
        {pct}%
      </span>
    </div>
  );
}

function Progress({
  duration,
  seekable,
}: {
  duration: number;
  seekable: boolean;
}) {
  const position = Math.min(usePosition(), duration || Infinity);
  const { seekTo } = usePlaybackActions();
  const pct = duration > 0 ? (position / duration) * 100 : 0;

  // Left/Right on the focused bar seek instead of moving focus; the TV key
  // handler skips events a focused element already handled.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!seekable || duration <= 0) return;
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const delta = e.key === "ArrowLeft" ? -SEEK_STEP_SECS : SEEK_STEP_SECS;
    void seekTo(Math.max(0, Math.min(duration - 1, position + delta)));
  };

  return (
    <div className="w-full">
      <div
        data-tv-focusable={seekable || undefined}
        tabIndex={seekable ? 0 : -1}
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(position)}
        onKeyDown={onKeyDown}
        className="tv-progress relative h-[0.35rem] w-full rounded-full bg-th-slider-track outline-none"
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-th-accent"
          style={{ width: `${pct}%` }}
        />
        <div
          className="tv-progress-thumb absolute top-1/2 h-[0.9rem] w-[0.9rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-th-text-primary opacity-0"
          style={{ left: `${pct}%` }}
        />
      </div>
      <div className="mt-[0.4rem] flex justify-between text-[0.7rem] text-th-text-muted tabular-nums">
        <span>{formatTime(position)}</span>
        <span>{duration > 0 ? formatTime(duration) : ""}</span>
      </div>
    </div>
  );
}

export default function TvNowPlaying() {
  const nav = useTvNav();
  const track = useAtomValue(currentTrackAtom);
  const isPlaying = useAtomValue(isPlayingAtom);
  const streamInfo = useAtomValue(streamInfoAtom);
  const queue = useAtomValue(queueAtom);
  const manualQueue = useAtomValue(manualQueueAtom);
  const shuffle = useAtomValue(shuffleAtom);
  const [repeat, setRepeat] = useAtom(repeatAtom);
  const currentVideo = useAtomValue(currentVideoAtom);
  const setVideoExpanded = useSetAtom(videoExpandedAtom);
  const [lyricsOn, setLyricsOn] = useAtom(tvLyricsAtom);
  const lyrics = useTvLyrics(
    track && track.itemType !== "video" ? track.id : undefined,
  );
  const { favoriteTrackIds, addFavoriteTrack, removeFavoriteTrack } =
    useFavorites();
  const {
    togglePlayPause,
    playNext,
    playPrevious,
    toggleShuffle,
    playFromQueue,
  } = usePlaybackActions();

  useTvInitialFocus(true);

  if (!track) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-[1rem] text-center">
        <p className="text-[1.1rem] font-semibold text-th-text-primary">
          Nothing is playing
        </p>
        <p className="text-[0.8rem] text-th-text-muted">
          Pick something from Home, Search or your Collection.
        </p>
        <TvButton
          autoFocus
          label="Go to Home"
          onClick={() => nav.push({ type: "home" })}
        />
      </div>
    );
  }

  const isVideo = track.itemType === "video";
  const cover = getTidalImageUrl(trackCoverId(track), 1280);
  const liked = favoriteTrackIds.has(track.id);
  const upNext = [...manualQueue, ...queue].slice(0, UP_NEXT_SHOWN);
  const artist = track.artist ?? track.artists?.[0];
  const quality = isVideo ? "" : formatStreamQuality(streamInfo);
  const icon = "w-[1.2rem] h-[1.2rem]";
  const showLyrics = lyricsOn && !!lyrics;

  return (
    // The player fills the first screen; "Up next" starts below the fold and
    // scrolls into view only when focus moves down into it.
    <div className="relative h-full">
      {/* Blurred cover backdrop */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {cover && (
          <TidalImage
            src={cover}
            alt=""
            className="absolute inset-0 w-full h-full scale-125 blur-[3rem] opacity-35"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-th-base/60 to-th-base" />
      </div>

      <div
        data-tv-scroll-top
        className="relative h-full flex items-center gap-[3.5rem] px-[4rem] py-[2.5rem]"
      >
        {showLyrics ? (
          <div className="shrink-0 h-[min(72vh,40rem)] w-[min(46vw,48rem)]">
            <TvLyricsPanel lyrics={lyrics} duration={track.duration ?? 0} />
          </div>
        ) : (
          <div
            className={`shrink-0 overflow-hidden rounded-[1rem] shadow-2xl bg-th-surface ${
              isVideo
                ? "w-[min(55vw,60rem)] aspect-video"
                : "h-[min(72vh,40rem)] aspect-square"
            }`}
          >
            <TidalImage
              src={cover || undefined}
              alt=""
              className="w-full h-full"
            />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <h1 className="text-[2.4rem] font-extrabold leading-tight text-th-text-primary line-clamp-2">
            {track.title}
            {track.version && (
              <span className="font-semibold text-th-text-muted">
                {" "}
                ({track.version})
              </span>
            )}
          </h1>
          <p className="mt-[0.4rem] text-[1.1rem] text-th-text-secondary truncate">
            {getTrackArtistDisplay(track)}
          </p>
          {track.album?.title && (
            <p className="mt-[0.2rem] text-[0.85rem] text-th-text-muted truncate">
              {track.album.title}
            </p>
          )}
          {quality && (
            <p className="mt-[0.8rem] inline-block rounded-[0.3rem] border border-th-border-subtle px-[0.5rem] py-[0.1rem] text-[0.6rem] font-bold tracking-[0.12em] text-th-accent">
              {quality}
            </p>
          )}

          <div className="mt-[2rem]">
            <Progress duration={track.duration ?? 0} seekable={!isVideo} />
          </div>

          <div className="mt-[1.4rem] flex flex-wrap items-center gap-[0.8rem]">
            <TvButton
              title="Shuffle"
              active={shuffle}
              icon={<Shuffle className={icon} />}
              onClick={toggleShuffle}
            />
            <TvButton
              title="Previous"
              icon={<SkipBack className={icon} fill="currentColor" />}
              onClick={() => void playPrevious()}
            />
            <TvButton
              primary
              autoFocus
              title={isPlaying ? "Pause" : "Play"}
              icon={
                isPlaying ? (
                  <Pause className={icon} fill="currentColor" />
                ) : (
                  <Play className={icon} fill="currentColor" />
                )
              }
              onClick={() => void togglePlayPause()}
            />
            <TvButton
              title="Next"
              icon={<SkipForward className={icon} fill="currentColor" />}
              onClick={() => void playNext({ explicit: true })}
            />
            <TvButton
              title={
                repeat === 2
                  ? "Repeat one"
                  : repeat === 1
                    ? "Repeat all"
                    : "Repeat off"
              }
              active={repeat !== 0}
              icon={
                repeat === 2 ? (
                  <Repeat1 className={icon} />
                ) : (
                  <Repeat className={icon} />
                )
              }
              onClick={() => setRepeat((repeat + 1) % 3)}
            />
          </div>

          <div className="mt-[1rem] flex flex-wrap items-center gap-[0.8rem]">
            {!isVideo && (
              <TvButton
                title={liked ? "Remove from My Tracks" : "Add to My Tracks"}
                active={liked}
                icon={
                  <Heart
                    className={icon}
                    fill={liked ? "currentColor" : "none"}
                  />
                }
                onClick={() =>
                  void (
                    liked
                      ? removeFavoriteTrack(track.id)
                      : addFavoriteTrack(track.id, track)
                  ).catch(() => {})
                }
              />
            )}
            {lyrics && (
              <TvButton
                active={lyricsOn}
                icon={<Mic2 className={icon} />}
                label="Lyrics"
                title={lyricsOn ? "Show cover" : "Show lyrics"}
                onClick={() => setLyricsOn(!lyricsOn)}
              />
            )}
            {isVideo && currentVideo && (
              <TvButton
                icon={<Tv className={icon} />}
                label="Watch video"
                onClick={() => setVideoExpanded(true)}
              />
            )}
            {!isVideo && artist && (
              <TvButton
                label="Artist"
                onClick={() =>
                  nav.push({ type: "artist", id: artist.id, name: artist.name })
                }
              />
            )}
            {!isVideo && track.album?.id && (
              <TvButton
                label="Album"
                onClick={() =>
                  nav.push({
                    type: "album",
                    id: track.album!.id,
                    title: track.album!.title,
                  })
                }
              />
            )}
            <TvButton
              title="More options"
              icon={<MoreHorizontal className={icon} />}
              onClick={() => nav.openMenu(nav.trackMenu(track))}
            />
          </div>

          <div className="mt-[1rem] flex items-center">
            <VolumeControl />
          </div>
        </div>

        {upNext.length > 0 && (
          <div className="pointer-events-none absolute inset-x-0 bottom-[1rem] flex items-center justify-center gap-[0.4rem] text-[0.7rem] text-th-text-muted">
            <ChevronDown className="w-[1rem] h-[1rem]" />
            <span className="truncate max-w-[40rem]">
              Up next: {upNext[0].title}
            </span>
          </div>
        )}
      </div>

      {upNext.length > 0 && (
        <section className="relative px-[3rem] pt-[1.5rem] pb-[3rem]">
          <h2 className="text-[1.05rem] font-bold text-th-text-primary px-[1rem] mb-[0.4rem]">
            Up next
          </h2>
          {upNext.map((t, i) => (
            <TvTrackRow
              key={t._qid ?? `${t.id}:${i}`}
              track={t}
              index={i}
              showCover
              onSelect={() => void playFromQueue(i)}
            />
          ))}
        </section>
      )}
    </div>
  );
}
