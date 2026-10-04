import { useCallback } from "react";
import { useAtomValue } from "jotai";
import {
  getAllPlaylists,
  getFavoriteAlbums,
  getFavoriteArtists,
  getFavoriteMixes,
} from "../../api/tidal";
import { authTokensAtom } from "../../atoms/auth";
import { useTvInitialFocus } from "./TvNavContext";
import { TvError, TvRow, TvSpinner } from "./TvParts";
import { sectionEntries, type TvEntry } from "./tvItems";
import { useTvLoader } from "./useTvLoader";

const ROW_LIMIT = 50;

interface Rows {
  playlists: TvEntry[];
  albums: TvEntry[];
  artists: TvEntry[];
  mixes: TvEntry[];
}

const MY_TRACKS: TvEntry = {
  key: "my-tracks",
  title: "My Tracks",
  subtitle: "Your favorite tracks",
  image: "",
  icon: "heart",
  action: { kind: "open", view: { type: "favorites" } },
};

export default function TvCollection() {
  const userId = useAtomValue(authTokensAtom)?.user_id;
  const load = useCallback(async (): Promise<Rows> => {
    if (!userId) throw new Error("Not signed in");
    // One failing row (e.g. no mixes endpoint access) leaves the others.
    const settle = <T,>(p: Promise<{ items: T[] }>) =>
      p.then((r) => r.items).catch(() => null);
    const [playlists, albums, artists, mixes] = await Promise.all([
      settle(getAllPlaylists(userId, 0, ROW_LIMIT)),
      settle(getFavoriteAlbums(userId, 0, ROW_LIMIT)),
      settle(getFavoriteArtists(userId, 0, ROW_LIMIT)),
      settle(getFavoriteMixes(0, ROW_LIMIT)),
    ]);
    if (!playlists && !albums && !artists && !mixes) {
      throw new Error("Couldn't load your collection");
    }
    return {
      playlists: sectionEntries(playlists ?? [], "PLAYLIST_LIST").entries,
      albums: sectionEntries(albums ?? [], "ALBUM_LIST").entries,
      artists: sectionEntries(artists ?? [], "ARTIST_LIST").entries,
      mixes: sectionEntries(mixes ?? [], "MIX_LIST").entries,
    };
  }, [userId]);
  const {
    data: rows,
    error,
    retry,
  } = useTvLoader(load, "Couldn't load your collection");

  useTvInitialFocus(rows !== null || error !== null);

  if (error) return <TvError message={error} onRetry={retry} />;
  if (!rows) return <TvSpinner />;

  return (
    <div className="pt-[2rem] pb-[2rem]">
      <TvRow title="Playlists" entries={[MY_TRACKS, ...rows.playlists]} />
      <TvRow title="Albums" entries={rows.albums} />
      <TvRow title="Artists" entries={rows.artists} />
      <TvRow title="Mixes & Radio" entries={rows.mixes} />
    </div>
  );
}
