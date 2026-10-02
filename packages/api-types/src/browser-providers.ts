/** Shared resource inventory. A provider still needs a runtime adapter and feature evidence. */
export const BROWSER_PROVIDERS = [
  { id: "browserbase", label: "Browserbase", transport: "cdp", experimental: false },
  { id: "steel", label: "Steel", transport: "cdp", experimental: false },
  { id: "cloak", label: "CloakBrowser", transport: "cdp", experimental: false },
  { id: "patchright", label: "Patchright", transport: "native", experimental: true },
  { id: "camoufox", label: "Camoufox", transport: "native", experimental: true },
  { id: "clearcote", label: "Clearcote", transport: "native", experimental: true },
] as const;
export type BrowserProvider = typeof BROWSER_PROVIDERS[number]["id"];
export type NativeBrowserProvider = Extract<typeof BROWSER_PROVIDERS[number], { transport: "native" }>["id"];
export const BROWSER_PROVIDER_IDS = BROWSER_PROVIDERS.map(provider => provider.id);
export function isBrowserProvider(value: unknown): value is BrowserProvider {
  return BROWSER_PROVIDERS.some(provider => provider.id === value);
}
export function isNativeBrowserProvider(value: string): value is NativeBrowserProvider {
  return BROWSER_PROVIDERS.some(provider => provider.id === value && provider.transport === "native");
}
export function browserProviderLabel(id: BrowserProvider) {
  return BROWSER_PROVIDERS.find(provider => provider.id === id)!.label;
}
