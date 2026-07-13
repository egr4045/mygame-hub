import { useEffect, useRef, useState } from 'react';
import type { social } from '@mygame/protocol';
import { useSocialStore } from './socialStore.js';

/**
 * Debounced people-search over the social socket, shared by the desktop sidebar and the mobile
 * Друзья tab. Returns the current results for `query` (trimmed; under 2 chars → empty) plus a
 * loading flag. Out-of-order responses are dropped (a monotonic seq guards last-write-wins), so a
 * slow earlier query can't overwrite a newer one's results.
 */
export const useFriendSearch = (
  query: string,
  debounceMs = 250,
): { results: social.SearchResult[]; loading: boolean } => {
  const search = useSocialStore((s) => s.search);
  const [results, setResults] = useState<social.SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      seq.current++; // invalidate any in-flight response
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const mine = ++seq.current;
    const t = window.setTimeout(() => {
      void search(q).then((r) => {
        if (mine === seq.current) {
          setResults(r);
          setLoading(false);
        }
      });
    }, debounceMs);
    return () => window.clearTimeout(t);
  }, [query, debounceMs, search]);

  return { results, loading };
};
