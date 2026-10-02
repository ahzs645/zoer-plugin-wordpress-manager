import { api, type WordPressManagedSite } from "./api";

export function wordpressPreviewUrl(site: WordPressManagedSite) {
  return site.managedUrl || (site.provider === "ddev" ? `/api/computers/${encodeURIComponent(site.id)}/pages/80/` : site.url);
}

export async function openWordPressAdmin(site: WordPressManagedSite) {
  const popup = window.open("", "_blank");
  if (!popup) throw new Error("Allow pop-ups for Zoer, then try Admin again.");
  popup.opener = null;
  popup.document.title = "Opening WordPress Admin";
  const message = popup.document.createElement("main");
  message.style.cssText = "font:16px system-ui;max-width:32rem;margin:15vh auto;padding:2rem;line-height:1.6";
  message.textContent = `Preparing admin login for ${site.name}…`;
  popup.document.body.append(message);
  try {
    const url = site.provider === "hostinger" ? (await api.createWordPressAdminLink(site.id)).url : (await api.createWordPressLoginHandoff(site.id)).path;
    if (!popup.closed) popup.location.replace(url);
  } catch (error) {
    if (!popup.closed) message.textContent = `${error instanceof Error ? error.message : "Unable to open Admin."} Return to Zoer and choose Admin to retry.`;
    throw error;
  }
}
