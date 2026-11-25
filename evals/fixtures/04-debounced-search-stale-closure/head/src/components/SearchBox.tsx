import { useEffect, useState } from "react";

export interface SearchBoxProps {
  onResults: (query: string) => void;
}

/**
 * Debounced search input. Calls `onResults` a moment after the user stops
 * typing so we only hit the search API once per pause.
 */
export function SearchBox({ onResults }: SearchBoxProps) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      onResults(query);
    }, 300);
    return () => clearTimeout(timer);
  }, []);

  return (
    <input
      value={query}
      onChange={(event) => setQuery(event.target.value)}
      placeholder="Search"
    />
  );
}
