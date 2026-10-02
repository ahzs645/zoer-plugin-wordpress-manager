/** Host-owned integrations. Catalog packages do not confer access to connections. */
export interface AdapterOperation { id: string; title: string; effect: "read"; inputSchema?: Record<string, unknown>; }
export interface AdapterDefinition {
  id: string;
  name: string;
  kind: "tool" | "agent";
  transport: "cli" | "connector" | "computer";
  description: string;
  operations: AdapterOperation[];
  connectionMode: "managed" | "existing" | "computer";
  /** Host-owned setup metadata for adapters that reference an existing resource. */
  target?: { label: string; setupLabel: string; setupHref: string };
}
export interface AdapterConnection {
  id: string;
  adapterId: string;
  name: string;
  enabled: boolean;
  /** Reference to an existing computer or account, never a credential. */
  targetId?: string;
  credentialId?: string;
  createdAt: string;
}
export type PublicAdapterConnection = Omit<AdapterConnection, "credentialId"> & { hasCredential: boolean };
export interface AdapterPrincipal { kind: "plugin" | "computer" | "agent"; id: string; }
export interface AdapterGrant {
  connectionId: string;
  principal: AdapterPrincipal;
  operations: string[];
}
export interface AdapterRequirement {
  alias: string;
  purpose: string;
  adapterId: string;
  operations: string[];
  optional?: boolean;
}
export interface AdapterBinding { pluginId: string; alias: string; connectionId: string; }
export interface AdapterState { version: 1; connections: AdapterConnection[]; grants: AdapterGrant[]; bindings: AdapterBinding[]; }
