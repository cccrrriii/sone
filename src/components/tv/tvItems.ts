import type { MediaItemType, Track } from "../../types";
import { getTidalImageUrl, getTidalPromoImageUrl } from "../../types";
import {
  buildMediaItem,
  getItemImage,
  getItemSubtitle,
  getItemTitle,
  getItemType,
  isMagazineItem,
  isMyTracksItem,
  isTrackItem,
} from "../../utils/itemHelpers";

/** A screen of the TV interface. The first four are the rail's roots. */
export type TvView =
  | { type: "home" }
  | { type: "search" }
  | { type: "collection" }
  | { type: "nowPlaying" }
  | { type: "favorites" }
  | { type: "album"; id: number; title?: string; image?: string }
  | { type: "playlist"; uuid: string; title?: string; image?: string }
  | { type: "mix"; mixId: string; title?: string; image?: string }
  | { type: "artist"; id: number; name?: string; image?: string };

export type TvAction =
  | { kind: "open"; view: TvView }
  | { kind: "playTrack"; track: Track }
  | { kind: "playVideo"; item: Extract<MediaItemType, { type: "video" }> };

export interface TvEntry {
  key: string;
  title: string;
  subtitle: string;
  image: string;
  round?: boolean;
  /** Drawn in place of artwork when the entry has none (My Tracks). */
  icon?: "heart";
  action: TvAction;
}

/** The view a media item opens, or a play action for a video. */
function actionForMedia(item: MediaItemType): TvAction {
  switch (item.type) {
    case "album":
      return {
        kind: "open",
        view: {
          type: "album",
          id: item.id,
          title: item.title,
          image: getTidalImageUrl(item.cover, 640),
        },
      };
    case "playlist":
      return {
        kind: "open",
        view: {
          type: "playlist",
          uuid: item.uuid,
          title: item.title,
          image: getTidalImageUrl(item.image, 640),
        },
      };
    case "mix":
      return {
        kind: "open",
        view: {
          type: "mix",
          mixId: item.mixId,
          title: item.title,
          image: item.image,
        },
      };
    case "artist":
      return {
        kind: "open",
        view: { type: "artist", id: item.id, name: item.name },
      };
    case "video":
      return { kind: "playVideo", item };
  }
}

/**
 * Map a raw catalog item (home feed, artist page, search, collection) to a
 * TV card. Mirrors HomeSection's click routing so a card does on the TV what
 * it does on the desktop. Returns null for items with nowhere to go.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toTvEntry(item: any, sectionType?: string): TvEntry | null {
  if (!item) return null;
  const title = getItemTitle(item);
  const subtitle = getItemSubtitle(item);

  if (isMyTracksItem(item)) {
    return {
      key: "my-tracks",
      title: title || "My Tracks",
      subtitle: subtitle || "Your favorite tracks",
      image: getItemImage(item, 640),
      icon: "heart",
      action: { kind: "open", view: { type: "favorites" } },
    };
  }

  // MULTIPLE_TOP_PROMOTIONS ("Featured") reference content by artifactId.
  if (item.artifactId && item.type && !isMagazineItem(item)) {
    const promoTitle = item.shortHeader || item.header || "";
    const image = getTidalPromoImageUrl(item.imageId);
    const id = String(item.artifactId);
    const base = {
      key: `promo:${item.type}:${id}`,
      title: promoTitle,
      subtitle: item.shortSubHeader || item.subHeader || "",
      image,
    };
    switch (item.type) {
      case "PLAYLIST":
        return {
          ...base,
          action: {
            kind: "open",
            view: { type: "playlist", uuid: id, title: promoTitle },
          },
        };
      case "ALBUM":
        return {
          ...base,
          action: {
            kind: "open",
            view: { type: "album", id: Number(id), title: promoTitle },
          },
        };
      case "ARTIST":
        return {
          ...base,
          action: {
            kind: "open",
            view: { type: "artist", id: Number(id), name: promoTitle },
          },
        };
      case "VIDEO":
        return {
          ...base,
          action: {
            kind: "playVideo",
            item: {
              type: "video",
              id: Number(id),
              title: promoTitle,
              imageId: item.imageId,
            },
          },
        };
      default:
        return null;
    }
  }

  const media = buildMediaItem(item, sectionType);
  if (media) {
    return {
      key: `${media.type}:${"uuid" in media ? media.uuid : "mixId" in media ? media.mixId : media.id}`,
      title,
      subtitle,
      image: getItemImage(item, 640),
      round: media.type === "artist",
      action: actionForMedia(media),
    };
  }

  if (isTrackItem(item, sectionType) && item.id != null) {
    return {
      key: `track:${item.id}`,
      title,
      subtitle,
      image: getItemImage(item, 640),
      action: { kind: "playTrack", track: item as Track },
    };
  }

  return null;
}

/** The section's items as cards, plus the tracks among them (for building a
 *  queue when one of them is played). A mixed row ignores its section type,
 *  which the backend derives from the first item only. */
export function sectionEntries(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  items: any[],
  sectionType?: string,
): { entries: TvEntry[]; tracks: Track[] } {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  const mixed =
    new Set(list.map((i) => getItemType(i)).filter(Boolean)).size > 1;
  const hint = mixed ? undefined : sectionType;
  const entries: TvEntry[] = [];
  const tracks: Track[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const entry = toTvEntry(item, hint);
    if (!entry || seen.has(entry.key)) continue;
    seen.add(entry.key);
    entries.push(entry);
    if (entry.action.kind === "playTrack") tracks.push(entry.action.track);
  }
  return { entries, tracks };
}
