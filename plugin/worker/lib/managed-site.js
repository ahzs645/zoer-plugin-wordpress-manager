export const isManagedSiteId = id => typeof id === "string" && /^(?:ddev-[a-z0-9-]+|wpilot-[a-f0-9]{12})$/.test(id);
export const sitePort = id => String(id).startsWith("wpilot-") ? 8080 : 80;
export function destinationProfile(value) {
  if (value === undefined || value === "wordpress-ddev") return "wordpress-ddev";
  if (value === "wordpress-kubernetes") return value;
  throw new Error("Choose a DDEV or Kubernetes local site.");
}
