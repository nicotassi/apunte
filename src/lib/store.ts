import { create } from 'zustand';
import * as db from './db';
import { DEFAULT_SETTINGS, type Folder, type Note, type Settings, type SyncState } from './types';
import { debounce, nid, normTag } from './util';
import { withDescendants } from './folders';
import { GitHubRemote, parseRepo, runSync, SyncError, type SyncIO } from './sync';
import { getImageBytes, imageNames, putImageBytes } from './images';

const SETTINGS_KEY = 'apunte.settings';

function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return { ...DEFAULT_SETTINGS, ...raw, sync: { ...DEFAULT_SETTINGS.sync, ...(raw.sync || {}) } };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export type SyncStatus = 'off' | 'idle' | 'syncing' | 'ok' | 'error';

interface State {
  ready: boolean;
  notes: Record<string, Note>;
  folders: Record<string, Folder>;
  settings: Settings;
  syncStatus: SyncStatus;
  syncMessage: string;
  syncAt: number;
}

export const useStore = create<State>(() => ({
  ready: false,
  notes: {},
  folders: {},
  settings: loadSettings(),
  syncStatus: 'off',
  syncMessage: '',
  syncAt: 0,
}));

const get = () => useStore.getState();
const set = useStore.setState;

/* ───────────── Persistencia ───────────── */

const timers = new Map<string, ReturnType<typeof setTimeout>>();
function persistNote(id: string) {
  clearTimeout(timers.get(id));
  timers.set(id, setTimeout(() => flushNote(id), 300));
}
function flushNote(id: string) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  const n = get().notes[id];
  if (n) void db.put('notes', n);
}
export function flushAll() {
  for (const id of [...timers.keys()]) flushNote(id);
}

export async function initStore() {
  const [notes, folders, sync] = await Promise.all([db.getAll<Note>('notes'), db.getAll<Folder>('folders'), db.kvGet<SyncState>('sync')]);
  syncState = sync ?? { files: {}, lastAt: 0 };
  set({
    ready: true,
    notes: Object.fromEntries(notes.map((n) => [n.id, n])),
    folders: Object.fromEntries(folders.map((f) => [f.id, f])),
    syncStatus: syncConfigured() ? 'idle' : 'off',
    syncAt: syncState.lastAt,
  });
  window.addEventListener('pagehide', flushAll);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAll();
    else if (syncConfigured() && get().settings.sync.auto && Date.now() - get().syncAt > 60_000) void syncNow();
  });
  if (syncConfigured() && get().settings.sync.auto) void syncNow();
}

/* ───────────── Ajustes ───────────── */

export function setSettings(patch: Partial<Settings>) {
  const s = { ...get().settings, ...patch };
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* sin almacenamiento */ }
  set({ settings: s, syncStatus: syncConfigured(s) ? (get().syncStatus === 'off' ? 'idle' : get().syncStatus) : 'off' });
}

/* ───────────── Notas ───────────── */

export function newNote(init: Partial<Note> = {}): string {
  const now = Date.now();
  const n: Note = { id: nid(), title: '', body: '', folderId: null, tags: [], pinned: false, trashed: false, createdAt: now, updatedAt: now, ...init };
  set({ notes: { ...get().notes, [n.id]: n } });
  persistNote(n.id);
  return n.id;
}

export function updateNote(id: string, patch: Partial<Pick<Note, 'title' | 'body' | 'folderId' | 'tags' | 'pinned' | 'trashed' | 'color'>>) {
  const cur = get().notes[id];
  if (!cur) return;
  const next: Note = { ...cur, ...patch, updatedAt: Date.now() };
  if (patch.tags) next.tags = [...new Set(patch.tags.map(normTag).filter(Boolean))];
  set({ notes: { ...get().notes, [id]: next } });
  persistNote(id);
  scheduleSync();
}

export function deleteForever(id: string) {
  const { [id]: _gone, ...rest } = get().notes;
  set({ notes: rest });
  clearTimeout(timers.get(id));
  timers.delete(id);
  void db.del('notes', id);
  scheduleSync();
}

export function emptyTrash() {
  for (const n of Object.values(get().notes)) if (n.trashed) deleteForever(n.id);
}

/** Una nota recién creada y abandonada vacía no se guarda. */
export function dropIfEmpty(id: string) {
  const n = get().notes[id];
  if (n && !n.title.trim() && !n.body.trim()) {
    const { [id]: _gone, ...rest } = get().notes;
    set({ notes: rest });
    clearTimeout(timers.get(id));
    timers.delete(id);
    void db.del('notes', id);
  }
}

/* ───────────── Carpetas (se pueden anidar) ───────────── */

const cleanName = (n: string) => n.replace(/[\\/]+/g, '-').trim();

export function addFolder(name: string, parentId: string | null = null): string | null {
  const nm = cleanName(name);
  if (!nm) return null;
  const dup = Object.values(get().folders).find((f) => f.name.toLowerCase() === nm.toLowerCase() && (f.parentId ?? null) === parentId);
  if (dup) return dup.id;
  const f: Folder = { id: nid(), name: nm, parentId, createdAt: Date.now() };
  set({ folders: { ...get().folders, [f.id]: f } });
  void db.put('folders', f);
  return f.id;
}

/** La ruta de GitHub de cada nota incluye los nombres de sus carpetas: si una carpeta cambia, sus notas se resincronizan. */
function touchNotesUnder(folderId: string) {
  const ids = withDescendants(folderId, get().folders);
  for (const n of Object.values(get().notes)) if (n.folderId && ids.has(n.folderId)) updateNote(n.id, {});
}

export function renameFolder(id: string, name: string) {
  const f = get().folders[id];
  const nm = cleanName(name);
  if (!f || !nm || nm === f.name) return;
  const nf = { ...f, name: nm };
  set({ folders: { ...get().folders, [id]: nf } });
  void db.put('folders', nf);
  touchNotesUnder(id);
}

/** Mueve una carpeta adentro de otra (o a la raíz con null). No se puede mover adentro de sí misma. */
export function moveFolder(id: string, parentId: string | null): boolean {
  const f = get().folders[id];
  if (!f || (f.parentId ?? null) === parentId) return false;
  if (parentId && withDescendants(id, get().folders).has(parentId)) return false;
  const nf = { ...f, parentId };
  set({ folders: { ...get().folders, [id]: nf } });
  void db.put('folders', nf);
  touchNotesUnder(id);
  return true;
}

/** Al borrar una carpeta, sus notas y subcarpetas suben un nivel (no se pierde nada). */
export function deleteFolder(id: string) {
  const f = get().folders[id];
  if (!f) return;
  const up = f.parentId ?? null;
  const folders = { ...get().folders };
  for (const c of Object.values(folders)) {
    if (c.parentId === id) { folders[c.id] = { ...c, parentId: up }; void db.put('folders', folders[c.id]); }
  }
  const affected = new Set(withDescendants(id, get().folders));
  for (const n of Object.values(get().notes)) {
    if (n.folderId && affected.has(n.folderId)) updateNote(n.id, n.folderId === id ? { folderId: up } : {});
  }
  delete folders[id];
  set({ folders });
  void db.del('folders', id);
}

/* ───────────── Sincronización con GitHub ───────────── */

let syncState: SyncState = { files: {}, lastAt: 0 };
let syncing = false;
let again = false;

export function syncConfigured(s: Settings = get().settings): boolean {
  return !!parseRepo(s.sync.repo) && !!s.sync.token.trim();
}

const scheduleSync = debounce(() => {
  if (syncConfigured() && get().settings.sync.auto) void syncNow();
}, 4000);

export async function syncNow(): Promise<void> {
  if (!syncConfigured()) return;
  if (syncing) { again = true; return; }
  syncing = true;
  flushAll();
  set({ syncStatus: 'syncing', syncMessage: '' });
  const { sync } = get().settings;
  const remote = new GitHubRemote(parseRepo(sync.repo), sync.token.trim(), sync.branch.trim());
  const io: SyncIO = {
    notes: () => Object.values(get().notes),
    folders: () => Object.values(get().folders),
    state: () => syncState,
    setState: async (s) => { syncState = s; await db.kvSet('sync', s); },
    apply: async ({ upsert, remove, newFolders, state }) => {
      const notes = { ...get().notes };
      const folders = { ...get().folders };
      for (const f of newFolders) { folders[f.id] = f; await db.put('folders', f); }
      for (const n of upsert) { notes[n.id] = n; await db.put('notes', n); }
      for (const id of remove) { delete notes[id]; await db.del('notes', id); }
      syncState = state;
      await db.kvSet('sync', state);
      set({ notes, folders });
    },
    imageNames,
    getImage: getImageBytes,
    putImage: putImageBytes,
  };
  try {
    const r = await runSync(remote, io);
    const parts = [r.pushed && `${r.pushed} subida(s)`, r.pulled && `${r.pulled} bajada(s)`, r.removed && `${r.removed} borrada(s)`, r.conflicts && `${r.conflicts} conflicto(s)`].filter(Boolean);
    set({ syncStatus: 'ok', syncAt: syncState.lastAt, syncMessage: parts.length ? parts.join(', ') : 'Todo al día' });
  } catch (e) {
    set({ syncStatus: 'error', syncMessage: e instanceof SyncError ? e.message : `Error al sincronizar: ${(e as Error).message}` });
  } finally {
    syncing = false;
    if (again) { again = false; scheduleSync(); }
  }
}

export async function disconnectSync() {
  syncState = { files: {}, lastAt: 0 };
  await db.kvSet('sync', syncState);
  setSettings({ sync: { ...get().settings.sync, token: '', repo: '', branch: '' } });
  set({ syncStatus: 'off', syncMessage: '', syncAt: 0 });
}

/* ───────────── Copia de seguridad ───────────── */

export async function importAll(data: { notes?: Note[]; folders?: Folder[]; images?: { name: string; data: string }[] }) {
  const notes = { ...get().notes };
  const folders = { ...get().folders };
  for (const f of data.folders ?? []) if (f?.id && !folders[f.id]) { folders[f.id] = f; await db.put('folders', f); }
  for (const n of data.notes ?? []) {
    if (!n?.id) continue;
    const cur = notes[n.id];
    if (!cur || cur.updatedAt < n.updatedAt) { notes[n.id] = n; await db.put('notes', n); }
  }
  for (const im of data.images ?? []) {
    const bin = atob(im.data.split(',')[1] ?? '');
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    await putImageBytes(im.name, bytes);
  }
  set({ notes, folders });
  scheduleSync();
}
