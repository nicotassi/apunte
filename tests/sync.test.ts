import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseNote, serializeNote } from '../src/lib/frontmatter.ts';
import { runSync, type Change, type GitRemote, type Head, type SyncIO } from '../src/lib/sync.ts';
import type { Folder, Note, SyncState } from '../src/lib/types.ts';

const enc = (s: string) => new TextEncoder().encode(s);
const sha = (b: Uint8Array) => createHash('sha1').update(b).digest('hex');

class FakeRemote implements GitRemote {
  files = new Map<string, Uint8Array>();
  blobs = new Map<string, Uint8Array>();
  commits = 0;
  empty = false;
  async head(): Promise<Head | null> { return this.empty ? null : { commit: 'c' + this.commits, tree: 't' + this.commits }; }
  async init() { this.empty = false; this.files.set('.apunte/LEEME.md', enc('x')); this.commits++; }
  async tree() { return [...this.files].map(([path, b]) => { this.blobs.set(sha(b), b); return { path, sha: sha(b) }; }); }
  async blob(s: string) { return this.blobs.get(s)!; }
  async commit(_p: Head, changes: Change[]) {
    for (const c of changes) {
      if (c.remove) this.files.delete(c.path);
      else this.files.set(c.path, c.bytes ?? enc(c.text ?? ''));
    }
    this.commits++;
    return { commit: 'c' + this.commits, tree: 't' + this.commits };
  }
}

class Device implements SyncIO {
  notesMap = new Map<string, Note>();
  folderList: Folder[] = [];
  st: SyncState = { files: {}, lastAt: 0 };
  images = new Map<string, Uint8Array>();
  notes() { return [...this.notesMap.values()]; }
  folders() { return this.folderList; }
  state() { return this.st; }
  async apply(p: { upsert: Note[]; remove: string[]; newFolders: Folder[]; state: SyncState }) {
    for (const n of p.upsert) this.notesMap.set(n.id, n);
    for (const id of p.remove) this.notesMap.delete(id);
    this.folderList.push(...p.newFolders);
    this.st = p.state;
  }
  async setState(s: SyncState) { this.st = s; }
  async imageNames() { return [...this.images.keys()]; }
  async getImage(n: string) { return this.images.get(n) ?? null; }
  async putImage(n: string, b: Uint8Array) { this.images.set(n, b); }
  add(id: string, title: string, body: string, extra: Partial<Note> = {}, at = Date.now()) {
    this.notesMap.set(id, { id, title, body, folderId: null, tags: [], pinned: false, trashed: false, createdAt: at, updatedAt: at, ...extra });
  }
  edit(id: string, patch: Partial<Note>, at: number) {
    this.notesMap.set(id, { ...this.notesMap.get(id)!, ...patch, updatedAt: at });
  }
}

test('frontmatter: ida y vuelta con acentos, comillas y tags', () => {
  const n: Note = { id: 'abcdefghij', title: 'Reunión "clave": 10%', body: '# Hola\n\n- [ ] tarea\n\n```js\nconst a = 1;\n```\n', folderId: 'f', tags: ['ideas', 'urgente'], pinned: true, trashed: false, createdAt: 1700000000000, updatedAt: 1700000100000 };
  const p = parseNote(serializeNote(n, 'Trabajo'))!;
  assert.equal(p.id, n.id);
  assert.equal(p.title, n.title);
  assert.equal(p.folder, 'Trabajo');
  assert.deepEqual(p.tags, n.tags);
  assert.equal(p.pinned, true);
  assert.equal(p.createdAt, n.createdAt);
  assert.equal(p.updatedAt, n.updatedAt);
  assert.equal(p.body, n.body.replace(/\n$/, ''));
});

test('frontmatter: texto sin encabezado no es una nota de Apunte', () => {
  assert.equal(parseNote('# solo markdown'), null);
});

test('sync: repo vacío, sube notas y carpetas', async () => {
  const gh = new FakeRemote();
  gh.empty = true;
  const a = new Device();
  a.folderList.push({ id: 'f1', name: 'Trabajo', createdAt: 1 });
  a.add('aaaaaaaaaa', 'Primera', 'hola', { folderId: 'f1' }, 1000);
  a.add('bbbbbbbbbb', 'Segunda', 'chau', {}, 1000);
  const r = await runSync(gh, a);
  assert.equal(r.pushed, 2);
  assert.ok(gh.files.has('notes/Trabajo/primera-aaaaaaaaaa.md'));
  assert.ok(gh.files.has('notes/segunda-bbbbbbbbbb.md'));
  // segunda corrida sin cambios: no hace commit
  const c = gh.commits;
  const r2 = await runSync(gh, a);
  assert.deepEqual([r2.pushed, r2.pulled, r2.removed], [0, 0, 0]);
  assert.equal(gh.commits, c);
});

test('sync: un segundo dispositivo baja todo, con su carpeta', async () => {
  const gh = new FakeRemote();
  const a = new Device();
  a.folderList.push({ id: 'f1', name: 'Trabajo', createdAt: 1 });
  a.add('aaaaaaaaaa', 'Primera', 'hola', { folderId: 'f1', tags: ['x'] }, 1000);
  await runSync(gh, a);
  const b = new Device();
  const r = await runSync(gh, b);
  assert.equal(r.pulled, 1);
  const n = b.notesMap.get('aaaaaaaaaa')!;
  assert.equal(n.body, 'hola');
  assert.deepEqual(n.tags, ['x']);
  assert.equal(b.folderList.find((f) => f.id === n.folderId)?.name, 'Trabajo');
});

test('sync: ediciones fluyen en ambos sentidos y el renombrar mueve el archivo', async () => {
  const gh = new FakeRemote();
  const a = new Device(); const b = new Device();
  a.add('aaaaaaaaaa', 'Vieja', 'v1', {}, 1000);
  await runSync(gh, a); await runSync(gh, b);
  a.edit('aaaaaaaaaa', { title: 'Nueva', body: 'v2' }, 2000);
  await runSync(gh, a);
  assert.ok(gh.files.has('notes/nueva-aaaaaaaaaa.md'));
  assert.ok(!gh.files.has('notes/vieja-aaaaaaaaaa.md'));
  await runSync(gh, b);
  assert.equal(b.notesMap.get('aaaaaaaaaa')!.body, 'v2');
  b.edit('aaaaaaaaaa', { body: 'v3' }, 3000);
  await runSync(gh, b); await runSync(gh, a);
  assert.equal(a.notesMap.get('aaaaaaaaaa')!.body, 'v3');
});

test('sync: borrar en un dispositivo borra en el otro', async () => {
  const gh = new FakeRemote();
  const a = new Device(); const b = new Device();
  a.add('aaaaaaaaaa', 'X', 'x', {}, 1000);
  await runSync(gh, a); await runSync(gh, b);
  a.notesMap.delete('aaaaaaaaaa');
  await runSync(gh, a);
  assert.equal([...gh.files.keys()].filter((p) => p.startsWith('notes/')).length, 0);
  const r = await runSync(gh, b);
  assert.equal(r.removed, 1);
  assert.equal(b.notesMap.size, 0);
});

test('sync: edición simultánea conserva ambas versiones (copia de conflicto)', async () => {
  const gh = new FakeRemote();
  const a = new Device(); const b = new Device();
  a.add('aaaaaaaaaa', 'Nota', 'base', {}, 1000);
  await runSync(gh, a); await runSync(gh, b);
  a.edit('aaaaaaaaaa', { body: 'desde A' }, 2000);
  b.edit('aaaaaaaaaa', { body: 'desde B' }, 3000);
  await runSync(gh, a);
  const r = await runSync(gh, b);
  assert.equal(r.conflicts, 1);
  const bodies = b.notes().map((n) => n.body).sort();
  assert.deepEqual(bodies, ['desde A', 'desde B']);
  assert.ok(b.notes().some((n) => n.title.includes('(conflicto)')));
  await runSync(gh, a); // A recibe ambas
  assert.equal(a.notes().length, 2);
});

test('sync: imágenes viajan y solo se bajan las usadas', async () => {
  const gh = new FakeRemote();
  const a = new Device(); const b = new Device();
  a.images.set('img1.jpg', new Uint8Array([1, 2, 3]));
  a.images.set('img2.jpg', new Uint8Array([4, 5, 6]));
  a.add('aaaaaaaaaa', 'Con foto', '![](assets/img1.jpg)', {}, 1000);
  await runSync(gh, a);
  assert.ok(gh.files.has('assets/img1.jpg') && gh.files.has('assets/img2.jpg'));
  await runSync(gh, b);
  assert.deepEqual([...b.images.keys()], ['img1.jpg']);
  assert.deepEqual([...b.images.get('img1.jpg')!], [1, 2, 3]);
});

test('sync: nota editada localmente después de borrarse en remoto se conserva', async () => {
  const gh = new FakeRemote();
  const a = new Device(); const b = new Device();
  a.add('aaaaaaaaaa', 'X', 'x', {}, 1000);
  await runSync(gh, a); await runSync(gh, b);
  a.notesMap.delete('aaaaaaaaaa');
  await runSync(gh, a);
  b.edit('aaaaaaaaaa', { body: 'cambié algo' }, 5000);
  await runSync(gh, b);
  assert.equal(b.notes().length, 1);
  assert.ok(gh.files.has('notes/x-aaaaaaaaaa.md'));
});
