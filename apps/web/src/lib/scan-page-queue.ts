export type ScanPage = {
  id: string;
  file: File;
  previewUrl: string | null;
};

export function createScanPages(files: FileList | File[]): ScanPage[] {
  return Array.from(files).map((file) => ({
    id: crypto.randomUUID(),
    file,
    previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
  }));
}

export function revokeScanPages(pages: ScanPage[]): void {
  for (const page of pages) {
    if (page.previewUrl) URL.revokeObjectURL(page.previewUrl);
  }
}

export function moveScanPage(
  pages: ScanPage[],
  id: string,
  direction: -1 | 1,
): ScanPage[] {
  const index = pages.findIndex((p) => p.id === id);
  if (index < 0) return pages;
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= pages.length) return pages;
  const next = [...pages];
  const [item] = next.splice(index, 1);
  next.splice(nextIndex, 0, item);
  return next;
}
