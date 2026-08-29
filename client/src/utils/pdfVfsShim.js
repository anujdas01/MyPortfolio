import vfsSource from 'pdfmake/build/vfs_fonts.js?raw';

let cached = null;

export function getVfs() {
  if (cached) return cached;
  // Vite ?raw gives string; fallback for non-Vite contexts
  const src = typeof vfsSource === 'string' ? vfsSource : (vfsSource?.default ?? String(vfsSource || ''));
  // CSP-safe extraction: parse the object literal instead of eval/new Function
  const marker = 'this.pdfMake.vfs =';
  const idx = src.indexOf(marker);
  if (idx === -1) throw new Error('PDF font data marker not found');
  let jsonStr = src.slice(idx + marker.length).trim();
  // remove trailing semicolon and whitespace
  if (jsonStr.endsWith(';')) jsonStr = jsonStr.slice(0, -1).trim();
  let vfs;
  try {
    vfs = JSON.parse(jsonStr);
  } catch {
    throw new Error('PDF font data could not be parsed');
  }
  if (!vfs || !Object.keys(vfs).length) {
    throw new Error('PDF font data could not be initialised');
  }
  cached = vfs;
  return cached;
}
