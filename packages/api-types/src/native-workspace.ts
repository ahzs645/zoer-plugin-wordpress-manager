/**
 * Host modules a packaged native workspace may import. Zoer supplies its own
 * instances at runtime so plugin UI shares React, React Query and plugin UI
 * controls with the page. Any other import is rejected when the module is served.
 */
export const NATIVE_WORKSPACE_SHARED_MODULES = [
  "react",
  "react/jsx-runtime",
  "react-dom",
  "@tanstack/react-query",
  "@zoer/plugin-ui/analysis",
  "@zoer/plugin-ui/button",
  "@zoer/plugin-ui/controls",
  "@zoer/plugin-ui/database",
  "@zoer/plugin-ui/workspace",
] as const;

export type NativeWorkspaceSharedModule = (typeof NATIVE_WORKSPACE_SHARED_MODULES)[number];

/** Global the frontend populates before importing a native workspace module. */
export const NATIVE_WORKSPACE_SHARED_GLOBAL = "__ZOER_PLUGIN_SHARED__";

export interface NativeWorkspaceDescriptor {
  pluginId: string;
  version: string;
  /** One-use same-origin URL of the rewritten ES module. */
  moduleUrl: string;
  /** One-use same-origin URL of the stylesheet, when the package declares one. */
  styleUrl: string | null;
}
