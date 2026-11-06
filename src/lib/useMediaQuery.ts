import { useCallback, useSyncExternalStore } from "react";

/** Tracks a CSS media query; renders false wherever `matchMedia` is missing. */
export function useMediaQuery(query: string) {
  const subscribe = useCallback((listener: () => void) => {
    if (typeof window.matchMedia !== "function") return () => {};
    const media = window.matchMedia(query);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [query]);
  return useSyncExternalStore(subscribe, () => typeof window.matchMedia === "function" && window.matchMedia(query).matches, () => false);
}
