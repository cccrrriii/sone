import { Delete, X } from "lucide-react";

const KEYS = "abcdefghijklmnopqrstuvwxyz1234567890".split("");

/** The on-screen keyboard for typing with the remote (search, names). */
export default function TvKeyboard({
  onChange,
  autoFocus,
}: {
  /** Applies an edit to the current text. */
  onChange: (edit: (text: string) => string) => void;
  /** Focus the first key when the screen opens. */
  autoFocus?: boolean;
}) {
  return (
    <div className="grid grid-cols-6 gap-[0.4rem]">
      {KEYS.map((k, i) => (
        <button
          key={k}
          data-tv-focusable
          data-tv-autofocus={(autoFocus && i === 0) || undefined}
          onClick={() => onChange((t) => t + k)}
          className="tv-key h-[2.4rem] rounded-[0.4rem] bg-th-surface text-[0.85rem] font-semibold uppercase text-th-text-primary"
        >
          {k}
        </button>
      ))}
      <button
        data-tv-focusable
        onClick={() => onChange((t) => t + " ")}
        className="tv-key col-span-3 h-[2.4rem] rounded-[0.4rem] bg-th-surface text-[0.75rem] font-semibold text-th-text-primary"
      >
        Space
      </button>
      <button
        data-tv-focusable
        aria-label="Delete"
        title="Delete"
        onClick={() => onChange((t) => t.slice(0, -1))}
        className="tv-key col-span-2 h-[2.4rem] rounded-[0.4rem] bg-th-surface flex items-center justify-center text-th-text-primary"
      >
        <Delete className="w-[1.1rem] h-[1.1rem]" />
      </button>
      <button
        data-tv-focusable
        aria-label="Clear"
        title="Clear"
        onClick={() => onChange(() => "")}
        className="tv-key h-[2.4rem] rounded-[0.4rem] bg-th-surface flex items-center justify-center text-th-text-primary"
      >
        <X className="w-[1.1rem] h-[1.1rem]" />
      </button>
    </div>
  );
}
