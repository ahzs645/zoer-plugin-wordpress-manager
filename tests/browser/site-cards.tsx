// Component fixture only: no backend responses, host bridge or WordPress operations are simulated.
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import SiteCardList from "../../src/components/extensions/SiteCardList";
import { moveSiteCard, orderedSiteCards, readSiteCardPreferences, saveSiteCardPreferences, siteCardId } from "../../src/components/extensions/siteCardPreferences";
import type { WordPressSiteGroup } from "../../src/components/extensions/wordpressSiteGroups";
import type { WordPressManagedSite } from "../../src/lib/api";

const groups: WordPressSiteGroup[] = ["Alpha", "Beta", "Gamma"].map(id => ({ kind: "site", site: { id, name: id } as WordPressManagedSite }));
function Fixture() {
  const [preferences, setPreferences] = useState(readSiteCardPreferences);
  const [query, setQuery] = useState("");
  useEffect(() => { saveSiteCardPreferences(preferences); }, [preferences]);
  const ordered = orderedSiteCards(groups, preferences.order);
  return <div className="zoer-native-wordpress-manager" style={{ width: 280, padding: 12 }}>
    <input aria-label="Filter cards" value={query} onChange={event => setQuery(event.target.value)} />
    <SiteCardList groups={ordered.filter(group => query.split(",").some(part => siteCardId(group).includes(part)))} collapsed={preferences.collapsed}
      onToggle={id => setPreferences(current => ({ ...current, collapsed: current.collapsed.includes(id) ? current.collapsed.filter(value => value !== id) : [...current.collapsed, id] }))}
      onMove={(id, target, after) => setPreferences(current => ({ ...current, order: moveSiteCard(current.order, ordered.map(siteCardId), id, target, after) }))}
      renderCard={(group, controls) => <section className="rounded-lg border border-border-default bg-surface-primary">
        <div className="flex items-center gap-1 p-1">{controls.handle}{controls.toggle}<span>{siteCardId(group)}</span></div>
        <div id={controls.contentId} hidden={controls.collapsed} className="p-3"><input aria-label={`${siteCardId(group)} draft`} defaultValue="Kept draft" /></div>
      </section>} />
  </div>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
