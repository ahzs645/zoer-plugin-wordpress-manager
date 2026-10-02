/** Subscription limits for the CLI accounts signed in on computers. */
export type SubscriptionUsageProvider = "claude" | "codex";

export interface SubscriptionUsageWindow {
  /** Stable per provider, so the same window lines up across accounts. */
  id: string;
  kind: "session" | "weekly" | "monthly" | "other";
  label: string;
  /** 0–100. */
  usedPercent: number;
  resetsAt: string | null;
  windowMinutes: number | null;
}

export interface SubscriptionUsageCredits {
  label: string;
  /** Spend so far and its cap, in `currency` units when known. */
  used: number | null;
  limit: number | null;
  /** Prepaid balance still available. */
  balance: number | null;
  currency: string | null;
  unlimited: boolean;
}

export interface SubscriptionUsageComputer {
  computerId: string;
  name: string;
  running: boolean;
  /** When this computer last reported the account. */
  checkedAt: string;
  /** Why the latest read on this computer failed, if it did. */
  error: string | null;
}

/** One subscription, however many computers are signed in to it. */
export interface SubscriptionUsageAccount {
  key: string;
  provider: SubscriptionUsageProvider;
  email: string | null;
  plan: string | null;
  organization: string | null;
  /** From the freshest successful read across the account's computers. */
  windows: SubscriptionUsageWindow[];
  credits: SubscriptionUsageCredits[];
  checkedAt: string | null;
  computers: SubscriptionUsageComputer[];
  /** Set when no computer has produced a successful read yet. */
  error: string | null;
}

export interface SubscriptionUsageNotice {
  computerId: string;
  computerName: string;
  provider: SubscriptionUsageProvider | null;
  message: string;
}

export interface SubscriptionUsageReport {
  generatedAt: string;
  accounts: SubscriptionUsageAccount[];
  notices: SubscriptionUsageNotice[];
  /** Running computers read this time, and stopped ones with no earlier reading. */
  checkedComputers: number;
  uncheckedComputers: number;
}
