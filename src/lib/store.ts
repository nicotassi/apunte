import { create } from 'zustand';
import * as db from './db';
import { DEFAULT_SETTINGS, type Folder, type Note, type Settings, type SyncState } from './types';
import { debounce, nid, normTag } from './util';
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

export function updateNote(id: string, patch: Partial<Pick<Note, 'title' | 'body' | 'folderId' | 'tags' | 'pinned' | 'trashed'>>) {
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

/* ───────────── Carpetas ───────────── */

export function addFolder(name: string): string | null {
  const nm = name.trim();
  if (!nm) return null;
  const dup = Object.values(get().folders).find((f) => f.name.toLowerCase() === nm.toLowerCase());
  if (dup) return dup.id;
  const f: Folder = { id: nid(), name: nm, createdAt: Date.now() };
  set({ folders: { ...get().folders, [f.id]: f } });
  void db.put('folders', f);
  return f.id;
}

export function renameFolder(id: string, name: string) {
  const f = get().folders[id];
  const nm = name.trim();
  if (!f || !nm || nm === f.name) return;
  const nf = { ...f, name: nm };
  set({ folders: { ...get().folders, [id]: nf } });
  void db.put('folders', nf);
  // El nombre viaja dentro de cada nota: se marcan como modificadas para que se resincronicen.
  for (const n of Object.values(get().notes)) if (n.folderId === id) updateNote(n.id, {});
}

export function deleteFolder(id: string) {
  for (const n of Object.values(get().notes)) if (n.folderId === id) updateNote(n.id, { folderId: null });
  const { [id]: _gone, ...rest } = get().folders;
  set({ folders: rest });
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
