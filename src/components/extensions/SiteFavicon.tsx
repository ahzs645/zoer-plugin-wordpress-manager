import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Globe2 } from "lucide-react";
import type { WordPressManagedSite } from "../../lib/api";
import { getApiBase, json } from "../../lib/api/_http";

export default function SiteFavicon({ site }: { site: WordPressManagedSite }) {
  const element = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!element.current) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: "100px" });
    observer.observe(element.current);
    return () => observer.disconnect();
  }, []);
  const icon = useQuery({
    queryKey: [getApiBase(), "wordpress-site-favicon", site.id, site.managedUrl, site.url, site.domain, site.status],
    queryFn: () => json<{ src: string | null }>(`/wordpress-manager/sites/${encodeURIComponent(site.id)}/favicon`),
    enabled: visible, staleTime: 600_000, gcTime: 1_800_000, retry: false,
  });
  const src = icon.data?.src ?? null;
  const [failed, setFailed] = useState<string | null>(null);
  return <span ref={element} className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-surface-secondary" aria-hidden="true">
    {src && failed !== src
      ? <img src={src} alt="" width={16} height={16} className="h-4 w-4 rounded-sm object-contain" loading="lazy" referrerPolicy="no-referrer" draggable={false} onError={() => setFailed(src)} />
      : <Globe2 className="h-4 w-4 text-text-muted" />}
  </span>;
}
