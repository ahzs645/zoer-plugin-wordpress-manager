import { exportLibrary as exportData, libraryEntries as getEntries, readLibraryRecords as readRecords } from "../../../plugin/worker/lib/extension-library.js";
import type { CatalogRecord } from "../queries/plugin-engine";
export { LIBRARY_KIND, MAX_MANIFEST_BYTES, extensionEntry, manifestLocation, parseManifest } from "../../../plugin/worker/lib/extension-library.js";
export interface LibraryEntry { kind: "plugin" | "theme"; name: string; slug: string; repositoryUrl: string; ref: string; path: string; description: string }
export interface ManifestSource { name: string; repositoryUrl?: string; ref?: string; path?: string; snapshot?: LibraryManifest }
export interface LibraryManifest { schemaVersion: 1; repositories: LibraryEntry[]; manifests: ManifestSource[] }
export type LibrarySource = { v: 1; type: "repository"; entry: LibraryEntry } | { v: 1; type: "manifest"; source: ManifestSource };
export type LibraryRecord = Omit<CatalogRecord, "data"> & { data: LibrarySource };
export const libraryRecords = (records: CatalogRecord[]) => readRecords(records) as LibraryRecord[];
export const libraryEntries = (records: CatalogRecord[]) => getEntries(records) as Array<LibraryEntry & { key: string; origins: string[] }>;
export const exportLibrary = (records: CatalogRecord[]) => exportData(records) as LibraryManifest;
