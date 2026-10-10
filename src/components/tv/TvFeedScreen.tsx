import { useCallback, useEffect } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { getFeed, markFeedSeen } from "../../api/tidal";
import { authTokensAtom } from "../../atoms/auth";
import { feedUnseenCountAtom } from "../../atoms/ui";
import { groupFeedByPeriod } from "../../lib/feedGrouping";
import { useTvInitialFocus } from "./TvNavContext";
import { TvError, TvRow, TvSpinner } from "./TvParts";
import { feedEntries } from "./tvItems";
import { useTvLoader } from "./useTvLoader";

/** New releases from followed artists and history mixes, a row per period
 *  ("This month", "Last month", "Older"), as on the desktop Feed page. */
export default function TvFeedScreen() {
  const userId = useAtomValue(authTokensAtom)?.user_id;
  const setUnseenCount = useSetAtom(feedUnseenCountAtom);
  const load = useCallback(
    () =>
      userId == null
        ? Promise.reject(new Error("Not signed in"))
        : getFeed(userId),
    [userId],
  );
  const { data, error, retry } = useTvLoader(load, "Couldn't load the feed");

  // Opening the feed marks it seen, even when it fails to load (as on the
  // desktop).
  useEffect(() => {
    if (userId == null) return;
    setUnseenCount(0);
    markFeedSeen(userId).catch(() => {});
  }, [userId, setUnseenCount]);

  useTvInitialFocus(data !== null || error !== null);

  if (error) return <TvError message={error} onRetry={retry} />;
  if (!data) return <TvSpinner />;

  const groups = groupFeedByPeriod(data.items, new Date())
    .map((g) => ({ label: g.label, entries: feedEntries(g.items) }))
    .filter((g) => g.entries.length > 0);

  return (
    <div className="pt-[2.5rem] pb-[3rem]">
      <h1 className="text-[2rem] font-extrabold text-th-text-primary px-[3rem] mb-[1rem]">
        Feed
      </h1>
      {groups.length === 0 ? (
        <p className="px-[3rem] text-[0.85rem] text-th-text-muted">
          New releases from artists you follow show up here.
        </p>
      ) : (
        groups.map((g) => (
          <TvRow key={g.label} title={g.label} entries={g.entries} />
        ))
      )}
    </div>
  );
}
