import { useQueries } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { getApiBase, json } from "../../../lib/api/_http";
import { runAction } from "../../../host/actions";
import type { ZoerConnectCapabilities } from "../../../lib/api/types/wordpress-transfer";

/**
 * Block themes in a code-only push: Site Editor copies are database records that win over theme
 * files. Copies on the local source that are not in its files do not travel with a code push;
 * copies on the live site keep showing instead of the pushed files (Zoer Connect 0.7.0).
 */
interface LocalItem { title: string; slug: string; safeToRemove: boolean }
interface LiveItem { title: string; slug: string }
const names = (items: { title: string; slug: string }[]) => items.slice(0, 4).map(item => item.title || item.slug).join(", ") + (items.length > 4 ? ` and ${items.length - 4} more` : "");

/** Warning lines for the chosen themes: local copies missing from the theme files, and live copies that hide pushed files. */
export function themeOverrideWarnings(themes: string[], local: LocalItem[][], live: LiveItem[][], sourceName: string, destinationHost: string): { key: string; text: string }[] {
  return themes.flatMap((theme, index) => {
    const unsaved = (local[index] ?? []).filter(item => !item.safeToRemove);
    const hidden = live[index] ?? [];
    return [
      ...(unsaved.length ? [{ key: `local:${theme}`, text: `${theme}: ${names(unsaved)} ${unsaved.length === 1 ? "was" : "were"} edited in the Site Editor on ${sourceName} and ${unsaved.length === 1 ? "is" : "are"} not in the theme files, so this push won't include ${unsaved.length === 1 ? "it" : "them"}. Save ${unsaved.length === 1 ? "it" : "them"} to the theme's repository first (Development tab).` }] : []),
      ...(hidden.length ? [{ key: `live:${theme}`, text: `${theme}: ${destinationHost} has its own saved ${hidden.length === 1 ? "copy" : "copies"} of ${names(hidden)}. Visitors will keep seeing ${hidden.length === 1 ? "that" : "those"} instead of the pushed files until ${hidden.length === 1 ? "it is" : "they are"} reset in Appearance → Editor on the live site.` }] : []),
    ];
  });
}

export default function ThemeOverrideWarnings({ themes, sourceId, sourceLocal, sourceName, destinationId, destinationHost, capabilities }: {
  themes: string[]; sourceId: string; sourceLocal: boolean; sourceName: string; destinationId: string; destinationHost: string; capabilities: ZoerConnectCapabilities | undefined;
}) {
  const live = capabilities?.themeOverrides === true;
  const local = useQueries({ queries: themes.map(theme => ({
    queryKey: [getApiBase(), "site-theme-overrides", sourceId, theme], enabled: sourceLocal, staleTime: 30_000, retry: false,
    queryFn: () => json<{ items: LocalItem[] }>(`/wordpress-manager/sites/${encodeURIComponent(sourceId)}/theme-overrides?theme=${encodeURIComponent(theme)}`),
  })) });
  const remote = useQueries({ queries: themes.map(theme => ({
    queryKey: [getApiBase(), "live-theme-overrides", destinationId, theme], enabled: live, staleTime: 30_000, retry: false,
    queryFn: async () => {
      const result = await runAction<{ ok: boolean; summary: string; themeOverrides?: { items: LiveItem[] } }>("site.test", { endpointId: destinationId, themeOverrides: theme }, { timeoutMs: 60_000 });
      if (!result.ok) throw new Error(result.summary);
      return result.themeOverrides?.items ?? [];
    },
  })) });
  const warnings = themeOverrideWarnings(themes, themes.map((_, index) => local[index]?.data?.items ?? []), themes.map((_, index) => remote[index]?.data ?? []), sourceName, destinationHost);
  if (!warnings.length) return null;
  return <div role="status" className="space-y-1.5 rounded-md border border-status-warning/40 bg-status-warning/10 p-3 text-sm">
    {warnings.map(warning => <p key={warning.key} className="flex items-start gap-1.5"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-warning" aria-hidden="true" /><span>{warning.text}</span></p>)}
  </div>;
}
