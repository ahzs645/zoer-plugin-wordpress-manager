/** Project-owned data, independent of a computer or an immutable site release. */
export interface ProjectCollection {
  name: string;
  schema: Record<string, unknown>;
  publicRead: boolean;
  revision: number;
  recordCount: number;
}
export interface ProjectDataRecord {
  id: string;
  data: Record<string, unknown>;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
export interface ProjectDatabaseStatus {
  available: boolean;
  reason?: string;
  exists: boolean;
  engine: "sqlite";
  version: number;
  collections: ProjectCollection[];
  computerGrants: string[];
  apiBase: "/api/data/v1";
}

/** Operator inventory includes setup candidates, not automatically created databases. */
export interface ProjectDatabaseEntry {
  id: string;
  name: string;
  computerId: string | null;
  database: ProjectDatabaseStatus | null;
  error?: string;
}
