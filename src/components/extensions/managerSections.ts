/**
 * The site page's sections. Route IDs stay the ones earlier releases used (bookmarks and links
 * keep working); several old IDs now open a section they were folded into.
 */
export type ManagerTab = "development" | "overview" | "plugins" | "themes" | "updates" | "security" | "backups" | "deployments" | "history" | "connections";
export type ManagerSection = "overview" | "plugins" | "development" | "deployments" | "backups" | "history" | "security";

export const MANAGER_TABS: readonly ManagerTab[] = ["development", "overview", "plugins", "themes", "updates", "security", "backups", "deployments", "history", "connections"];

export const MANAGER_SECTIONS: ReadonlyArray<{ id: ManagerSection; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "plugins", label: "Plugins & themes" },
  { id: "development", label: "Development" },
  { id: "deployments", label: "Push & pull" },
  { id: "backups", label: "Backups" },
  { id: "history", label: "Activity" },
  { id: "security", label: "Security" },
];

/** The section a route opens: Themes is the second half of Plugins & themes, Updates & logs became Activity. */
export function managerSection(tab: ManagerTab): ManagerSection {
  if (tab === "themes") return "plugins";
  if (tab === "updates") return "history";
  if (tab === "connections") return "overview";
  return tab;
}

/** Sections a site offers: the read-only scanner inspects local DDEV sites only. */
export function managerSections(provider: string | undefined) {
  return MANAGER_SECTIONS.filter(section => section.id !== "security" || provider === "ddev");
}

/** The site-details request a section needs, or null when it reads only saved records. */
export function detailSectionFor(tab: ManagerTab): string | null {
  const section = managerSection(tab);
  if (section === "development" || section === "history" || section === "security") return null;
  if (section === "plugins") return tab === "themes" ? "themes" : "plugins";
  return section;
}
