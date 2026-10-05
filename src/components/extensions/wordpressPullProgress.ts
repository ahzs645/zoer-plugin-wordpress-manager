/** Decimal byte sizes for transfer progress ("3.56 GB"). */
export function formatTransferBytes(bytes: number) {
  if (bytes < 1000) return `${bytes} B`;
  const unit = Math.min(3, Math.floor(Math.log10(bytes) / 3));
  return `${(bytes / 1000 ** unit).toFixed(2)} ${["B", "KB", "MB", "GB"][unit]}`;
}
