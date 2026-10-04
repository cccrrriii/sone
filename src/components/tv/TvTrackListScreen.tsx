import { useCallback } from "react";
import { useAtomValue } from "jotai";
import { Play, Shuffle } from "lucide-react";
import {
  getAlbumPage,
  getFavoriteTracks,
  getMixItems,
  getPlaylistDetails,
  getPlaylistTracks,
} from "../../api/tidal";
import { authTokensAtom } from "../../atoms/auth";
import { usePlaybackActions } from "../../hooks/usePlaybackActions";
import { isTrackUnavailable } from "../../lib/trackAvailability";
import type { Track } from "../../types";
import { getTidalImageUrl } from "../../types";
import {
  formatTotalDuration,
  getTrackArtistDisplay,
  playlistCountLabel,
} from "../../utils/itemHelpers";
import { useTvInitialFocus, useTvNav } from "./TvNavContext";
import { TvButton, TvError, TvHeader, TvSpinner, TvTrackRow } from "./TvParts";
import type { TvView } from "./tvItems";
import { useTvLoader } from "./useTvLoader";

type ListView = Extract<
  TvView,
  { type: "album" | "playlist" | "mix" | "favorites" }
>;

interface Loaded {
  kicker: string;
  title: string;
  subtitle?: string;
  image?: string;
  tracks: Track[];
  artist?: { id: number; name: string };
}

const FAVORITES_PAGE = 100;

async function loadList(view: ListView, userId?: number): Promise<Loaded> {
  switch (view.type) {
    case "album": {
      const { page } = await getAlbumPage(view.id);
      const a = page.album;
      const year = a.releaseDate?.slice(0, 4);
      const artist = a.artist ?? a.artists?.[0];
      return {
        kicker:
          a.albumType === "SINGLE"
            ? "Single"
            : a.albumType === "EP"
              ? "EP"
              : "Album",
        title: a.title,
        subtitle: [getTrackArtistDisplay(a, ""), year]
          .filter(Boolean)
          .join(" · "),
        image: getTidalImageUrl(a.cover, 1280),
        tracks: page.tracks,
        artist: artist ? { id: artist.id, name: artist.name } : undefined,
      };
    }
    case "playlist": {
      const [details, tracks] = await Promise.all([
        getPlaylistDetails(view.uuid).catch(() => null),
        getPlaylistTracks(view.uuid),
      ]);
      const creator = details?.creator?.name
        ? `By ${details.creator.name}`
        : details?.creator?.id === 0
          ? "By TIDAL"
          : undefined;
      return {
        kicker: "Playlist",
        title: details?.title ?? view.title ?? "Playlist",
        subtitle: [
          creator,
          playlistCountLabel(details?.numberOfTracks, details?.numberOfVideos),
        ]
          .filter(Boolean)
          .join(" · "),
        image:
          getTidalImageUrl(details?.squareImage ?? details?.image, 1280) ||
          view.image,
        tracks,
      };
    }
    case "mix": {
      const mix = await getMixItems(view.mixId);
      return {
        kicker: "Mix",
        title: mix.title ?? view.title ?? "Mix",
        subtitle: mix.subtitle ?? undefined,
        image: mix.image ?? view.image,
        tracks: mix.tracks,
      };
    }
    case "favorites": {
      if (!userId) throw new Error("Not signed in");
      const tracks: Track[] = [];
      for (let offset = 0; ; offset += FAVORITES_PAGE) {
        const page = await getFavoriteTracks(userId, offset, FAVORITES_PAGE);
        tracks.push(...page.items);
        if (
          page.items.length < FAVORITES_PAGE ||
          tracks.length >= page.totalNumberOfItems
        ) {
          break;
        }
      }
      return {
        kicker: "Collection",
        title: "My Tracks",
        subtitle: `${tracks.length} tracks`,
        image: tracks[0]?.album?.cover
          ? getTidalImageUrl(tracks[0].album.cover, 1280)
          : undefined,
        tracks,
      };
    }
  }
}

function sourceId(view: ListView): string | number {
  switch (view.type) {
    case "album":
      return view.id;
    case "playlist":
      return view.uuid;
    case "mix":
      return view.mixId;
    case "favorites":
      return "favorites";
  }
}

export default function TvTrackListScreen({ view }: { view: ListView }) {
  const nav = useTvNav();
  const userId = useAtomValue(authTokensAtom)?.user_id;
  const { playAllFromSource, setShuffledQueue, playTrack } =
    usePlaybackActions();
  const load = useCallback(() => loadList(view, userId), [view, userId]);
  const { data, error, retry } = useTvLoader(load, "Couldn't load tracks");

  useTvInitialFocus(data !== null || error !== null);

  if (error) return <TvError message={error} onRetry={retry} />;
  if (!data) return <TvSpinner />;

  const source = {
    type: view.type === "favorites" ? "favorites" : view.type,
    id: sourceId(view),
    name: data.title,
    image: data.image,
    allTracks: data.tracks,
  };
  const albumMode = view.type === "album";
  const totalSecs = data.tracks.reduce((s, t) => s + (t.duration ?? 0), 0);

  // Same as the desktop pages: Play follows the shuffle setting, Shuffle is
  // a one-off shuffled run that leaves the setting alone.
  const playAll = () => {
    void playAllFromSource(data.tracks, { source, albumMode });
    nav.showNowPlaying();
  };
  const shufflePlay = () => {
    const playable = data.tracks.filter((t) => !isTrackUnavailable(t));
    if (playable.length === 0) return;
    const pick = Math.floor(Math.random() * playable.length);
    const rest = playable.filter((_, i) => i !== pick);
    setShuffledQueue(rest, { source, albumMode });
    void playTrack(playable[pick]);
    nav.showNowPlaying();
  };

  return (
    <div className="pb-[3rem]">
      <TvHeader
        image={data.image}
        kicker={data.kicker}
        title={data.title}
        subtitle={[
          data.subtitle,
          totalSecs > 0 ? formatTotalDuration(totalSecs) : undefined,
        ]
          .filter(Boolean)
          .join(" · ")}
      >
        <TvButton
          primary
          autoFocus
          icon={<Play className="w-[1rem] h-[1rem]" fill="currentColor" />}
          label="Play"
          onClick={playAll}
        />
        <TvButton
          icon={<Shuffle className="w-[1rem] h-[1rem]" />}
          label="Shuffle"
          onClick={shufflePlay}
        />
        {data.artist && (
          <TvButton
            label={data.artist.name}
            title={`Go to ${data.artist.name}`}
            onClick={() =>
              nav.push({
                type: "artist",
                id: data.artist!.id,
                name: data.artist!.name,
              })
            }
          />
        )}
      </TvHeader>
      {data.tracks.length === 0 ? (
        <p className="px-[3rem] text-[0.85rem] text-th-text-muted">
          No tracks here yet.
        </p>
      ) : (
        <div className="px-[2rem]">
          {data.tracks.map((track, i) => (
            <TvTrackRow
              key={`${track.id}:${i}`}
              track={track}
              index={i}
              showCover={view.type !== "album"}
              onSelect={() =>
                nav.playTrack(track, data.tracks, { source, albumMode })
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
