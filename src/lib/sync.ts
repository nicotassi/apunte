import type { Folder, Note, SyncState } from './types';
import { parseNote, serializeNote } from './frontmatter';
import { nid, safeName, slug } from './util';
import { folderPath } from './folders';

/* ───────────── Cliente mínimo de Git (REST de GitHub) ───────────── */

export interface TreeEntry { path: string; sha: string }
export interface Change { path: string; text?: string; bytes?: Uint8Array; remove?: boolean }
export interface Head { commit: string; tree: string }

/** Lo único que la sincronización necesita del remoto. Se puede reemplazar por uno falso para probar. */
export interface GitRemote {
  head(): Promise<Head | null>; // null = repo vacío
  init(): Promise<void>;
  tree(treeSha: string): Promise<TreeEntry[]>;
  blob(sha: string): Promise<Uint8Array>;
  commit(parent: Head, changes: Change[], message: string): Promise<Head>;
}

export class SyncError extends Error {}

export function parseRepo(input: string): string {
  const s = input.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');
  return /^[\w.-]+\/[\w.-]+$/.test(s) ? s : '';
}

export function b64encode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function b64decode(b64: string): Uint8Array {
  const s = atob(b64.replace(/\s/g, ''));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export class GitHubRemote implements GitRemote {
  private branchName = '';
  constructor(private repo: string, private token: string, branch: string) {
    this.branchName = branch;
  }

  private async api<T>(method: string, path: string, body?: unknown, okStatuses: number[] = []): Promise<T | null> {
    let res: Response;
    try {
      res = await fetch(`https://api.github.com/repos/${this.repo}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
      });
    } catch {
      throw new SyncError('Sin conexión con GitHub');
    }
    if (okStatuses.includes(res.status)) return null;
    if (!res.ok) {
      if (res.status === 401) throw new SyncError('El token no es válido o venció');
      if (res.status === 403) throw new SyncError('GitHub rechazó el acceso (permisos del token o límite de uso)');
      if (res.status === 404) throw new SyncError('No encuentro el repo. Revisá el nombre y que el token tenga acceso a él');
      let detail = '';
      try { detail = (await res.json()).message ?? ''; } catch { /* sin detalle */ }
      throw new SyncError(`GitHub respondió ${res.status}${detail ? `: ${detail}` : ''}`);
    }
    return (await res.json()) as T;
  }

  private async branch(): Promise<string> {
    if (this.branchName) return this.branchName;
    const r = await this.api<{ default_branch: string }>('GET', '');
    this.branchName = r?.default_branch || 'main';
    return this.branchName;
  }

  async head(): Promise<Head | null> {
    const b = await this.branch();
    // 404/409 con repo recién creado y vacío
    const ref = await this.api<{ object: { sha: string } }>('GET', `/git/ref/heads/${encodeURIComponent(b)}`, undefined, [409]);
    if (!ref) return null;
    const c = await this.api<{ tree: { sha: string } }>('GET', `/git/commits/${ref.object.sha}`);
    return { commit: ref.object.sha, tree: c!.tree.sha };
  }

  async init(): Promise<void> {
    // La API de contenidos puede crear el primer commit de un repo vacío.
    await this.api('PUT', '/contents/.apunte/LEEME.md', {
      message: 'Apunte: inicio',
      content: b64encode(new TextEncoder().encode('Notas sincronizadas por Apunte. Cada nota es un archivo .md dentro de `notes/`.\n')),
    });
    this.branchName = '';
  }

  async tree(treeSha: string): Promise<TreeEntry[]> {
    const r = await this.api<{ tree: { path: string; type: string; sha: string }[] }>('GET', `/git/trees/${treeSha}?recursive=1`);
    return r!.tree.filter((t) => t.type === 'blob').map((t) => ({ path: t.path, sha: t.sha }));
  }

  async blob(sha: string): Promise<Uint8Array> {
    const r = await this.api<{ content: string }>('GET', `/git/blobs/${sha}`);
    return b64decode(r!.content);
  }

  async commit(parent: Head, changes: Change[], message: string): Promise<Head> {
    const entries: object[] = [];
    for (const c of changes) {
      if (c.remove) entries.push({ path: c.path, mode: '100644', type: 'blob', sha: null });
      else if (c.bytes) {
        const b = await this.api<{ sha: string }>('POST', '/git/blobs', { content: b64encode(c.bytes), encoding: 'base64' });
        entries.push({ path: c.path, mode: '100644', type: 'blob', sha: b!.sha });
      } else entries.push({ path: c.path, mode: '100644', type: 'blob', content: c.text ?? '' });
    }
    const t = await this.api<{ sha: string }>('POST', '/git/trees', { base_tree: parent.tree, tree: entries });
    const cm = await this.api<{ sha: string }>('POST', '/git/commits', { message, tree: t!.sha, parents: [parent.commit] });
    const b = await this.branch();
    try {
      await this.api('PATCH', `/git/refs/heads/${encodeURIComponent(b)}`, { sha: cm!.sha });
    } catch (e) {
      if (e instanceof SyncError && /422/.test(e.message)) throw new ConflictRace();
      throw e;
    }
    return { commit: cm!.sha, tree: t!.sha };
  }
}

/** Alguien (otro dispositivo) subió cambios mientras sincronizábamos. Se reintenta. */
export class ConflictRace extends Error {}

/* ───────────── Sincronización ───────────── */

export interface SyncIO {
  notes(): Note[];
  folders(): Folder[];
  state(): SyncState;
  /** Aplica en local lo traído del remoto. `notes` ya trae el folderId resuelto. */
  apply(p: { upsert: Note[]; remove: string[]; newFolders: Folder[]; state: SyncState }): Promise<void>;
  setState(s: SyncState): Promise<void>;
  imageNames(): Promise<string[]>;
  getImage(name: string): Promise<Uint8Array | null>;
  putImage(name: string, bytes: Uint8Array): Promise<void>;
}

export interface SyncResult { pulled: number; pushed: number; removed: number; conflicts: number }

const NOTE_RE = /^notes\/(?:(.+)\/)?[^/]*?-?([a-z0-9]{10})\.md$/;
const ASSET_RE = /^assets\/([^/]+)$/;

export function notePath(n: Note, folders: Folder[]): string {
  const dir = folderPath(n.folderId, folders).split('/').filter(Boolean).map(safeName).join('/');
  const file = `${slug(n.title) || 'nota'}-${n.id}.md`;
  return dir ? `notes/${dir}/${file}` : `notes/${file}`;
}

export function referencedImages(notes: Note[]): Set<string> {
  const s = new Set<string>();
  for (const n of notes) for (const m of n.body.matchAll(/assets\/([\w.-]+\.(?:jpe?g|png|gif|webp))/gi)) s.add(m[1]);
  return s;
}

const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const sameContent = (a: Note, b: Note) =>
  a.title === b.title && a.body === b.body && a.pinned === b.pinned && a.trashed === b.trashed &&
  a.folderId === b.folderId && a.tags.join(',') === b.tags.join(',') && (a.color ?? null) === (b.color ?? null);

export async function runSync(remote: GitRemote, io: SyncIO, attempt = 0): Promise<SyncResult> {
  let head = await remote.head();
  if (!head) {
    await remote.init();
    head = await remote.head();
    if (!head) throw new SyncError('No pude inicializar el repo vacío');
  }
  const entries = await remote.tree(head.tree);
  const remoteNotes = new Map<string, { path: string; sha: string; folder: string | null }>();
  const remoteAssets = new Set<string>();
  for (const e of entries) {
    const nm = e.path.match(NOTE_RE);
    if (nm) remoteNotes.set(nm[2], { path: e.path, sha: e.sha, folder: nm[1] ?? null });
    const am = e.path.match(ASSET_RE);
    if (am) remoteAssets.add(am[1]);
  }

  const localNotes = io.notes();
  const folders = [...io.folders()];
  const state: SyncState = { files: { ...io.state().files }, lastAt: Date.now() };
  const byId = new Map(localNotes.map((n) => [n.id, n]));

  // "Trabajo/Proyectos" → crea las carpetas que falten, de arriba hacia abajo.
  const folderByName = (path: string | null): string | null => {
    if (!path) return null;
    let parent: string | null = null;
    for (const name of path.split('/').map((x) => x.trim()).filter(Boolean)) {
      let f = folders.find((x) => x.name.toLowerCase() === name.toLowerCase() && (x.parentId ?? null) === parent);
      if (!f) {
        f = { id: nid(), name, parentId: parent, createdAt: Date.now() };
        folders.push(f);
        newFolders.push(f);
      }
      parent = f.id;
    }
    return parent;
  };
  const newFolders: Folder[] = [];

  const fetchRemote = async (id: string): Promise<Note | null> => {
    const r = remoteNotes.get(id)!;
    const p = parseNote(dec(await remote.blob(r.sha)));
    if (!p) return null;
    return {
      id,
      title: p.title,
      body: p.body,
      folderId: folderByName(p.folder ?? r.folder),
      tags: p.tags,
      pinned: p.pinned,
      trashed: p.trashed,
      color: p.color,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  };

  const upsert: Note[] = [];
  const remove: string[] = [];
  const push: Note[] = []; // notas locales que hay que subir
  const deletePaths: string[] = [];
  const snapshot = new Map<string, number>(); // updatedAt local al decidir (para detectar ediciones durante el sync)
  let conflicts = 0;
  let pulled = 0;

  const pull = async (id: string): Promise<boolean> => {
    const n = await fetchRemote(id);
    if (!n) return false;
    upsert.push(n);
    state.files[id] = { path: remoteNotes.get(id)!.path, sha: remoteNotes.get(id)!.sha, updatedAt: n.updatedAt };
    pulled++;
    return true;
  };

  const ids = new Set([...byId.keys(), ...remoteNotes.keys(), ...Object.keys(state.files)]);
  for (const id of ids) {
    const l = byId.get(id);
    const r = remoteNotes.get(id);
    const s = state.files[id];
    if (l) snapshot.set(id, l.updatedAt);
    if (l && r) {
      const lChanged = !s || l.updatedAt !== s.updatedAt;
      const rChanged = !s || r.sha !== s.sha;
      if (!lChanged && !rChanged) continue;
      if (lChanged && !rChanged) { push.push(l); continue; }
      if (!lChanged && rChanged) { await pull(id); continue; }
      // cambió de los dos lados
      const rn = await fetchRemote(id);
      if (!rn) { push.push(l); continue; }
      if (sameContent(l, rn)) {
        state.files[id] = { path: r.path, sha: r.sha, updatedAt: l.updatedAt };
        continue;
      }
      conflicts++;
      const copyOf = (n: Note): Note => ({ ...n, id: nid(), title: `${n.title || 'Sin título'} (conflicto)`, pinned: false, createdAt: Date.now(), updatedAt: Date.now() });
      if (l.updatedAt >= rn.updatedAt) {
        push.push(l);
        const c = copyOf(rn);
        upsert.push(c);
        push.push(c);
      } else {
        const c = copyOf(l);
        upsert.push(rn, c);
        state.files[id] = { path: r.path, sha: r.sha, updatedAt: rn.updatedAt };
        push.push(c);
        pulled++;
      }
    } else if (l && !r) {
      if (s && l.updatedAt === s.updatedAt) remove.push(id); // la borraron en otro dispositivo
      else push.push(l); // nueva, o editada después de que la borraran: se conserva
    } else if (!l && r) {
      if (s) deletePaths.push(r.path); // la borré acá
      else await pull(id); // nueva en otro dispositivo
    } else {
      delete state.files[id];
    }
  }
  for (const id of remove) delete state.files[id];
  for (const p of deletePaths) {
    const id = p.match(NOTE_RE)?.[2];
    if (id) delete state.files[id];
  }

  // Aplicar lo traído (las notas pulled no se tocan si el usuario las editó mientras tanto).
  const fresh = new Map(io.notes().map((n) => [n.id, n]));
  const safeUpsert = upsert.filter((n) => {
    const cur = fresh.get(n.id);
    if (!cur || !snapshot.has(n.id)) return true;
    if (cur.updatedAt === snapshot.get(n.id)) return true;
    delete state.files[n.id];
    return false;
  });
  const safeRemove = remove.filter((id) => fresh.get(id)?.updatedAt === snapshot.get(id));

  // Imágenes: bajar las que faltan y se usan; subir las que no están en el remoto.
  const merged = new Map(fresh);
  for (const n of safeUpsert) merged.set(n.id, n);
  for (const id of safeRemove) merged.delete(id);
  const allNotes = [...merged.values()];
  const have = new Set(await io.imageNames());
  const assetEntries = new Map(entries.filter((e) => ASSET_RE.test(e.path)).map((e) => [e.path.slice(7), e.sha]));
  for (const name of referencedImages(allNotes)) {
    if (have.has(name) || !assetEntries.has(name)) continue;
    try { await io.putImage(name, await remote.blob(assetEntries.get(name)!)); have.add(name); } catch { /* se reintenta en el próximo sync */ }
  }
  const changes: Change[] = [];
  for (const name of have) {
    if (remoteAssets.has(name)) continue;
    const bytes = await io.getImage(name);
    if (bytes) changes.push({ path: `assets/${name}`, bytes });
  }

  // Notas a subir.
  const allFolders = [...folders];
  const pushed: Note[] = [];
  for (const n of push) {
    const note = fresh.get(n.id) ?? n; // la versión más reciente (puede haberse editado durante el sync)
    const path = notePath(note, allFolders);
    const old = remoteNotes.get(note.id);
    if (old && old.path !== path) changes.push({ path: old.path, remove: true });
    const folder = folderPath(note.folderId, allFolders) || null;
    changes.push({ path, text: serializeNote(note, folder) });
    pushed.push(note);
  }
  for (const p of deletePaths) changes.push({ path: p, remove: true });

  let newHead = head;
  if (changes.length) {
    try {
      newHead = await remote.commit(head, changes, `Apunte: ${pushed.length} nota(s) subida(s)${deletePaths.length ? `, ${deletePaths.length} borrada(s)` : ''}`);
    } catch (e) {
      if (e instanceof ConflictRace && attempt < 2) return runSync(remote, io, attempt + 1);
      throw e;
    }
    const after = new Map((await remote.tree(newHead.tree)).map((e) => [e.path, e.sha]));
    for (const n of pushed) {
      const path = notePath(n, allFolders);
      const sha = after.get(path);
      if (sha) state.files[n.id] = { path, sha, updatedAt: n.updatedAt };
    }
  }

  await io.apply({ upsert: safeUpsert, remove: safeRemove, newFolders, state });
  return { pulled, pushed: pushed.length, removed: safeRemove.length, conflicts };
}
