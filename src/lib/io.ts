import { useStore } from './store';
import { getImageBytes, imageNames } from './images';
import { b64encode } from './sync';
import { parseNote, serializeNote } from './frontmatter';
import { download, nid, slug } from './util';
import type { Folder, Note } from './types';

/** Descarga una copia completa (notas, carpetas e imágenes) en un único archivo .json. */
export async function exportBackup() {
  const { notes, folders } = useStore.getState();
  const images: { name: string; data: string }[] = [];
  for (const name of await imageNames()) {
    const b = await getImageBytes(name);
    if (b) images.push({ name, data: `data:image/jpeg;base64,${b64encode(b)}` });
  }
  const blob = new Blob([JSON.stringify({ app: 'apunte', version: 1, notes: Object.values(notes), folders: Object.values(folders), images })], { type: 'application/json' });
  download(`apunte-copia-${new Date().toISOString().slice(0, 10)}.json`, blob);
}

export function downloadNoteMd(n: Note) {
  const folder = n.folderId ? useStore.getState().folders[n.folderId]?.name ?? null : null;
  download(`${slug(n.title) || 'nota'}.md`, new Blob([serializeNote(n, folder)], { type: 'text/markdown' }));
}

/** Importa un .json de copia de seguridad, o archivos .md sueltos (con o sin encabezado de Apunte). */
export async function readImportFile(file: File): Promise<{ notes?: Note[]; folders?: Folder[]; images?: { name: string; data: string }[] }> {
  const text = await file.text();
  if (file.name.toLowerCase().endsWith('.json')) {
    const d = JSON.parse(text);
    if (d.app !== 'apunte') throw new Error('Este archivo no es una copia de Apunte');
    return d;
  }
  const now = Date.now();
  const p = parseNote(text);
  if (p) {
    return { notes: [{ id: p.id, title: p.title, body: p.body, folderId: null, tags: p.tags, pinned: p.pinned, trashed: p.trashed, createdAt: p.createdAt, updatedAt: p.updatedAt }] };
  }
  const title = file.name.replace(/\.(md|markdown|txt)$/i, '');
  const id = nid();
  return { notes: [{ id, title, body: text, folderId: null, tags: [], pinned: false, trashed: false, createdAt: now, updatedAt: now }] };
}
