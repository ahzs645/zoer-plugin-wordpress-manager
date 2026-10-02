import type { BrowserProvider } from './browser-providers';
export type ManagedBrowserProvider = Exclude<BrowserProvider, 'cloak' | 'browserbase'>;
export interface BrowserRelease {
  provider: ManagedBrowserProvider;
  version: string;
  sourceUrl: string;
  image?: string;
  wheel?: { url: string; sha256: string; name: string };
  browserVersion?: string;
}
export interface BrowserRuntimeSelection {
  id: string; provider: ManagedBrowserProvider; version: string; image: string;
  compatibility: string; pvc?: string; pvcUid?: string; receiptHash?: string;
}
export interface BrowserUpdateCandidate {
  id: string; release: BrowserRelease; baseId: string; compatibility: string;
  createdAt: string; expiresAt: string; status: 'preparing' | 'ready' | 'applied' | 'failed';
  selection?: BrowserRuntimeSelection; planHash?: string; checks: string[]; error?: string;
  canaryId?: string; installerPod?: string;
}
export interface BrowserUpdateInventory {
  supported: boolean; checkedAt: string | null;
  providers: Array<{ provider: BrowserProvider; currentVersion: string; activeId: string;
    latest?: BrowserRelease; available: boolean; error?: string; previousVersion?: string }>;
  candidates: BrowserUpdateCandidate[];
}
