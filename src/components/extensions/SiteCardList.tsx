import { useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown, GripVertical } from "lucide-react";
import type { WordPressSiteGroup } from "./wordpressSiteGroups";
import { siteCardId, siteCardMembers } from "./siteCardPreferences";

export interface SiteCardControls { handle: ReactNode; toggle: ReactNode; collapsed: boolean; contentId: string }

/** Pointer dragging works with mouse, pen and touch; the focused handle also accepts arrow keys. */
export default function SiteCardList({ groups, collapsed, onToggle, onMove, renderCard }: {
  groups: WordPressSiteGroup[]; collapsed: readonly string[];
  onToggle: (id: string) => void;
  onMove: (id: string, target: string, after: boolean) => void;
  renderCard: (group: WordPressSiteGroup, controls: SiteCardControls) => ReactNode;
}) {
  const prefix = useId();
  const list = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; pointer: number; x: number; y: number; active: boolean; target: string; after: boolean } | null>(null);
  const [feedback, setFeedback] = useState<{ id: string; target: string; after: boolean } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const label = (group: WordPressSiteGroup) => siteCardMembers(group)[0]!.name;
  const controls = "inline-flex h-8 w-6 shrink-0 items-center justify-center rounded text-text-muted hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-input-focus";
  const finish = (commit: boolean) => {
    const state = drag.current;
    drag.current = null; setFeedback(null);
    if (commit && state?.active && state.id !== state.target) {
      onMove(state.id, state.target, state.after);
      setAnnouncement("Card order updated.");
    }
  };
  return <div ref={list} className="space-y-1.5">
    <p id={`${prefix}-help`} className="sr-only">Drag to reorder cards, or use Up and Down arrow keys on a drag handle. Press Escape to cancel dragging.</p>
    <p role="status" aria-live="polite" className="sr-only">{announcement}</p>
    {groups.map((group, index) => {
      const id = siteCardId(group), name = label(group), isCollapsed = collapsed.includes(id);
      const contentId = `${prefix}-${encodeURIComponent(id)}`;
      return <div key={id} data-site-card-id={id} className={`relative rounded-lg ${feedback?.id === id ? "opacity-60" : ""} ${feedback?.target === id && feedback.id !== id ? feedback.after ? "after:absolute after:inset-x-0 after:-bottom-1 after:h-0.5 after:bg-accent" : "before:absolute before:inset-x-0 before:-top-1 before:h-0.5 before:bg-accent" : ""}`}>
        {renderCard(group, {
          collapsed: isCollapsed, contentId,
          toggle: <button type="button" className={controls} aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${name}`} aria-expanded={!isCollapsed} aria-controls={contentId} onClick={() => onToggle(id)}>
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isCollapsed ? "-rotate-90" : ""}`} aria-hidden="true" />
          </button>,
          handle: <button type="button" className={`${controls} touch-none select-none ${feedback?.id === id ? "cursor-grabbing" : "cursor-grab"}`} aria-label={`Reorder ${name}`} aria-describedby={`${prefix}-help`} title="Drag to reorder · ↑/↓ to move"
            onPointerDown={event => {
              if (event.button !== 0 || !event.isPrimary) return;
              event.preventDefault(); event.currentTarget.focus();
              event.currentTarget.setPointerCapture(event.pointerId);
              drag.current = { id, pointer: event.pointerId, x: event.clientX, y: event.clientY, active: false, target: id, after: false };
            }}
            onPointerMove={event => {
              const state = drag.current;
              if (!state || state.pointer !== event.pointerId) return;
              if (!state.active && Math.hypot(event.clientX - state.x, event.clientY - state.y) < 5) return;
              state.active = true;
              const cards = Array.from(list.current?.querySelectorAll<HTMLElement>("[data-site-card-id]") ?? []);
              const target = cards.find(card => event.clientY <= card.getBoundingClientRect().bottom) ?? cards.at(-1);
              if (!target) return;
              const rect = target.getBoundingClientRect();
              state.target = target.dataset.siteCardId!; state.after = event.clientY > rect.top + rect.height / 2;
              setFeedback({ id, target: state.target, after: state.after });
              const scroll = list.current?.parentElement;
              if (scroll) {
                const bounds = scroll.getBoundingClientRect();
                if (event.clientY < bounds.top + 36) scroll.scrollTop -= 16;
                else if (event.clientY > bounds.bottom - 36) scroll.scrollTop += 16;
              }
            }}
            onPointerUp={event => { if (drag.current?.pointer === event.pointerId) finish(true); }}
            onPointerCancel={() => finish(false)} onLostPointerCapture={() => finish(false)}
            onKeyDown={event => {
              if (event.key === "Escape") { event.preventDefault(); finish(false); return; }
              if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
              event.preventDefault();
              if (drag.current) return;
              const next = index + (event.key === "ArrowUp" ? -1 : 1), target = groups[next];
              if (!target) return;
              onMove(id, siteCardId(target), next > index);
              setAnnouncement(`${name} moved to position ${next + 1} of ${groups.length}.`);
            }}><GripVertical className="h-3.5 w-3.5" aria-hidden="true" /></button>,
        })}
      </div>;
    })}
  </div>;
}
