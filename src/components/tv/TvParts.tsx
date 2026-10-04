import type { ReactNode } from "react";
import { useAtomValue } from "jotai";
import { AudioLines } from "lucide-react";
import TidalImage from "../TidalImage";
import { currentTrackAtom, isPlayingAtom } from "../../atoms/playback";
import { formatTime } from "../../lib/format";
import { isTrackUnavailable } from "../../lib/trackAvailability";
import type { Track } from "../../types";
import { getTidalImageUrl } from "../../types";
import { getTrackArtistDisplay, trackCoverId } from "../../utils/itemHelpers";
import { useTvNav } from "./TvNavContext";
import type { TvEntry } from "./tvItems";

function TvCard({
  entry,
  onSelect,
  wide,
}: {
  entry: TvEntry;
  onSelect: () => void;
  wide?: boolean;
}) {
  return (
    <button
      data-tv-focusable
      onClick={onSelect}
      className={`tv-card shrink-0 text-left ${wide ? "w-[15rem]" : "w-[9.5rem]"}`}
    >
      <div
        className={`tv-card-art overflow-hidden bg-th-surface ${
          entry.round ? "rounded-full" : "rounded-[0.6rem]"
        } ${wide ? "aspect-[11/8]" : "aspect-square"}`}
      >
        <TidalImage
          src={entry.image || undefined}
          alt={entry.title}
          type={entry.round ? "artist" : "album"}
          className="w-full h-full"
        />
      </div>
      <div
        className={`mt-[0.6rem] px-[0.15rem] ${entry.round ? "text-center" : ""}`}
      >
        <div className="text-[0.8rem] font-semibold text-th-text-primary truncate">
          {entry.title}
        </div>
        {entry.subtitle && (
          <div className="text-[0.65rem] text-th-text-muted truncate">
            {entry.subtitle}
          </div>
        )}
      </div>
    </button>
  );
}

/** A titled, horizontally scrolling row of cards. Remembers the card it was
 *  left on, so moving up and back down returns to it. */
export function TvRow({
  title,
  entries,
  queueTracks,
  queueId,
}: {
  title: string;
  entries: TvEntry[];
  queueTracks?: Track[];
  queueId?: string;
}) {
  const nav = useTvNav();
  if (entries.length === 0) return null;
  const wide = entries.every((e) => e.key.startsWith("promo:"));
  return (
    <section className="mb-[1.2rem]">
      <h2 className="text-[1.05rem] font-bold text-th-text-primary mb-[0.2rem] px-[3rem]">
        {title}
      </h2>
      <div
        data-tv-remember
        className="tv-row flex gap-[1.1rem] overflow-x-auto px-[3rem] py-[0.8rem]"
      >
        {entries.map((entry) => (
          <TvCard
            key={entry.key}
            entry={entry}
            wide={wide}
            onSelect={() =>
              nav.run(entry.action, {
                tracks: queueTracks ?? [],
                name: title,
                id: queueId ?? title,
              })
            }
          />
        ))}
      </div>
    </section>
  );
}

export function TvButton({
  icon,
  label,
  onClick,
  primary,
  active,
  autoFocus,
  title,
}: {
  icon?: ReactNode;
  label?: string;
  onClick: () => void;
  primary?: boolean;
  active?: boolean;
  autoFocus?: boolean;
  title?: string;
}) {
  return (
    <button
      data-tv-focusable
      data-tv-autofocus={autoFocus || undefined}
      onClick={onClick}
      title={title ?? label}
      aria-label={title ?? label}
      className={`tv-button inline-flex items-center justify-center gap-[0.5rem] rounded-full font-semibold text-[0.8rem] ${
        label ? "px-[1.3rem] h-[2.6rem]" : "w-[2.6rem] h-[2.6rem]"
      } ${
        primary
          ? "bg-th-accent text-th-on-accent"
          : active
            ? "bg-th-button text-th-accent"
            : "bg-th-button text-th-text-primary"
      }`}
    >
      {icon}
      {label && <span>{label}</span>}
    </button>
  );
}

export function TvTrackRow({
  track,
  index,
  showCover,
  onSelect,
}: {
  track: Track;
  index: number;
  showCover?: boolean;
  onSelect: () => void;
}) {
  const current = useAtomValue(currentTrackAtom);
  const playing = useAtomValue(isPlayingAtom);
  const isCurrent = current?.id === track.id;
  const unavailable = isTrackUnavailable(track);
  return (
    <button
      data-tv-focusable
      onClick={onSelect}
      className={`tv-track w-full flex items-center gap-[1rem] px-[1rem] py-[0.45rem] rounded-[0.6rem] text-left ${
        unavailable ? "opacity-40" : ""
      }`}
    >
      <span className="w-[1.6rem] shrink-0 text-right text-[0.75rem] text-th-text-muted tabular-nums">
        {isCurrent ? (
          <AudioLines
            className={`inline text-th-accent w-[1rem] h-[1rem] ${playing ? "animate-pulse" : ""}`}
          />
        ) : (
          index + 1
        )}
      </span>
      {showCover && (
        <TidalImage
          src={getTidalImageUrl(trackCoverId(track), 160) || undefined}
          alt=""
          className="w-[2.4rem] h-[2.4rem] rounded-[0.3rem] overflow-hidden shrink-0"
        />
      )}
      <span className="flex-1 min-w-0">
        <span
          className={`block truncate text-[0.8rem] font-semibold ${
            isCurrent ? "text-th-accent" : "text-th-text-primary"
          }`}
        >
          {track.title}
          {track.version && (
            <span className="text-th-text-muted font-normal">
              {" "}
              ({track.version})
            </span>
          )}
        </span>
        <span className="block truncate text-[0.65rem] text-th-text-muted">
          {track.explicit && (
            <span className="inline-block mr-[0.4rem] px-[0.25rem] rounded-[0.15rem] bg-th-button text-[0.55rem] font-bold leading-[1.2]">
              E
            </span>
          )}
          {getTrackArtistDisplay(track)}
        </span>
      </span>
      <span className="shrink-0 text-[0.7rem] text-th-text-muted tabular-nums">
        {track.duration ? formatTime(track.duration) : ""}
      </span>
    </button>
  );
}

export function TvSpinner() {
  return (
    <div className="flex h-full w-full items-center justify-center py-[4rem]">
      <div className="h-[2.4rem] w-[2.4rem] animate-spin rounded-full border-[0.2rem] border-th-accent border-t-transparent" />
    </div>
  );
}

export function TvError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-[1rem] py-[4rem] text-center px-[3rem]">
      <p className="text-[0.9rem] text-th-text-secondary">{message}</p>
      <TvButton label="Try again" onClick={onRetry} autoFocus />
    </div>
  );
}

/** Big cover + title block shared by the album, playlist, mix and artist
 *  screens. */
export function TvHeader({
  image,
  round,
  kicker,
  title,
  subtitle,
  children,
}: {
  image?: string;
  round?: boolean;
  kicker?: string;
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-end gap-[2rem] px-[3rem] pt-[2.5rem] pb-[1.5rem]">
      <div
        className={`w-[12rem] h-[12rem] shrink-0 overflow-hidden bg-th-surface shadow-2xl ${
          round ? "rounded-full" : "rounded-[0.8rem]"
        }`}
      >
        <TidalImage
          src={image || undefined}
          alt={title}
          type={round ? "artist" : "album"}
          className="w-full h-full"
        />
      </div>
      <div className="min-w-0 flex-1">
        {kicker && (
          <p className="text-[0.65rem] font-bold uppercase tracking-[0.15em] text-th-text-muted">
            {kicker}
          </p>
        )}
        <h1 className="text-[2.2rem] font-extrabold leading-tight text-th-text-primary line-clamp-2">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-[0.3rem] text-[0.85rem] text-th-text-secondary truncate">
            {subtitle}
          </p>
        )}
        {children && (
          <div className="mt-[1.2rem] flex flex-wrap gap-[0.8rem]">
            {children}
          </div>
        )}
      </div>
    </div>
  );
}
