/** Browser file naming, download, and upload helpers. */

/** Convert a project title into a filesystem-safe filename stem. */
export function projectFileStem(name: string) {
  const safe =
    name
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
      .trim()
      .replace(/[. ]+$/g, '')
      .slice(0, 120)
      .replace(/[. ]+$/g, '') || 'Contour Workbench';
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe) ? 'Project ' + safe : safe;
}

/** Start a browser download and release its temporary object URL after navigation begins. */
export function downloadFile(data: BlobPart, name: string, type = 'application/octet-stream') {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Read a selected upload while enforcing the browser memory safety limit. */
export async function readSelectedFile(input: HTMLInputElement) {
  const file = input.files?.[0];
  if (!file) return;
  if (file.size > 100_000_000) throw new Error('Please use a file smaller than 100 MB.');
  return file;
}
