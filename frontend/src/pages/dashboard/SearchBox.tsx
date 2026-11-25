import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useDebouncedValue } from "../../lib/useDebouncedValue";

export const SEARCH_DEBOUNCE_MS = 300;

/**
 * Figma search pill. Typing updates ?q= after a 300 ms pause (one request
 * per pause, not per keystroke); clearing returns to the tab list at once.
 */
export function SearchBox() {
  const [params, setParams] = useSearchParams();
  const urlQ = params.get("q") ?? "";
  const [text, setText] = useState(urlQ);
  const debounced = useDebouncedValue(text.trim(), SEARCH_DEBOUNCE_MS);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the box in sync when the URL changes elsewhere (back button, tab click).
  const lastUrlQ = useRef(urlQ);
  useEffect(() => {
    if (urlQ !== lastUrlQ.current) {
      lastUrlQ.current = urlQ;
      setText(urlQ);
    }
  }, [urlQ]);

  useEffect(() => {
    if (debounced === lastUrlQ.current) return;
    lastUrlQ.current = debounced;
    setParams(
      (p) => {
        if (debounced) p.set("q", debounced);
        else p.delete("q");
        p.delete("page"); // a new search starts at page 1
        return p;
      },
      { replace: true },
    );
  }, [debounced, setParams]);

  const clear = () => {
    setText("");
    lastUrlQ.current = "";
    setParams(
      (p) => {
        p.delete("q");
        p.delete("page");
        return p;
      },
      { replace: true },
    );
    inputRef.current?.focus();
  };

  return (
    <div className="relative flex h-10 w-full max-w-[680px] items-center rounded-full bg-surface-muted">
      <Search aria-hidden size={16} className="absolute left-4 text-ink-muted" />
      <input
        ref={inputRef}
        type="search"
        role="searchbox"
        aria-label="Search emails"
        placeholder="Search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && text && clear()}
        className="h-full w-full rounded-full bg-transparent pr-10 pl-10 text-sm placeholder:text-ink-muted focus:outline-2 focus:outline-primary [&::-webkit-search-cancel-button]:hidden"
      />
      {text && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={clear}
          className="absolute right-3 rounded-full p-1 text-ink-muted hover:bg-surface hover:text-ink"
        >
          <X aria-hidden size={14} />
        </button>
      )}
    </div>
  );
}
