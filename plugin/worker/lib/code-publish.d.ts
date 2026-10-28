import type { ExportOptions, ImportOptions } from "../../../src/lib/api/types/wordpress-transfer";
export const CODE_EXCLUDES: string[];
export function codeExportOptions(options: ExportOptions): ExportOptions;
export function codeExportOptionsFor(code: unknown): ExportOptions | null;
export function codeImportOptions(): ImportOptions;
export function codeExportIssue(options: { profile?: Record<string, unknown>; database?: unknown } | null | undefined): string | null;
export function codePathReason(path: string, profile?: Record<string, unknown>): string | null;
export function codeContentIssue(text: string, source: { url?: string; originalUrls?: string[]; abspath?: string } | null | undefined, target: string, options?: { credentials?: boolean }): string | null;
