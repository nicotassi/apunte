import { useEffect, useMemo, useState } from 'react';
import { useStore, initStore, newNote, emptyTrash, setSettings } from './lib/store';
import { folderChain, withDescendants } from './lib/folders';
import { closeOverlay, navigate, useRoute } from './lib/router';
import { applyUpdate, checkForUpdate, useUpdate } from './lib/update';
import { Sidebar } from './components/Sidebar';
import { NoteCard } from './components/NoteCard';
import { Editor } from './components/Editor';
import { Settings } from './components/Settings';
import { Icon } from './components/Icons';
import { IconBtn, Sheet, SheetItem } from './components/ui';
import { BODY_FONTS, TITLE_FONTS } from './lib/fonts';

const UI_SCALE = [0.9, 1, 1.12, 1.26];
const TXT_SCALE = [0.9, 1, 1.18];

export default function App() {
  const route = useRoute();
  const ready = useStore((s) => s.ready);
  const notes = useStore((s) => s.notes);
  const folders = useStore((s) => s.folders);
  const settings = useStore((s) => s.settings);
  const updateAvailable = useUpdate((s) => s.available);
  const [drawer, setDrawer] = useState(false);
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [viewSheet, setViewSheet] = useState(false);

  useEffect(() => {
    void initStore().then(() => {
      // Contenido compartido desde otra app (Android: Compartir → Apunte).
      const p = new URLSearchParams(location.search);
      const text = [p.get('text'), p.get('url')].filter(Boolean).join('\n');
      const title = p.get('title') ?? '';
      if (text || title) {
        const id = newNote({ title, body: text });
        history.replaceState(null, '', location.pathname);
        navigate({ view: 'all', note: id });
      }
    });
    void checkForUpdate();
    const t = setInterval(() => void checkForUpdate(), 30 * 60_000);
    return () => clearInterval(t);
  }, []);

  // Tema, tamaño de la interfaz y del texto de las notas.
  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'auto') delete root.dataset.theme;
    else root.dataset.theme = settings.theme;
    root.style.setProperty('--ui', String(UI_SCALE[settings.uiSize]));
    root.style.setProperty('--txt', String(TXT_SCALE[settings.textSize]));
    const tf = TITLE_FONTS[settings.titleFont] ?? TITLE_FONTS.fraunces;
    root.style.setProperty('--serif', tf.css);
    root.style.setProperty('--tw', String(tf.weight));
    root.style.setProperty('--sans', BODY_FONTS[settings.bodyFont] ?? BODY_FONTS.inter);
    const dark = settings.theme === 'dark' || (settings.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#151412' : '#f7f4ee');
  }, [settings.theme, settings.uiSize, settings.textSize, settings.titleFont, settings.bodyFont]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    // una carpeta muestra también lo que tienen sus subcarpetas
    const inFolder = route.view === 'folder' && route.arg ? withDescendants(route.arg, folders) : null;
    return Object.values(notes)
      .filter((n) => {
        if (route.view === 'trash') return n.trashed;
        if (n.trashed) return false;
        if (inFolder && (!n.folderId || !inFolder.has(n.folderId))) return false;
        if (route.view === 'tag' && !n.tags.includes(route.arg ?? '')) return false;
        if (!needle) return true;
        const fname = n.folderId ? folders[n.folderId]?.name ?? '' : '';
        return `${n.title}\n${n.body}\n${n.tags.join(' ')}\n${fname}`.toLowerCase().includes(needle);
      })
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
  }, [notes, folders, route.view, route.arg, q]);

  if (!ready) return <div className="boot serif">Apunte</div>;

  const pinned = list.filter((n) => n.pinned);
  const others = list.filter((n) => !n.pinned);
  const folder = route.view === 'folder' && route.arg ? folders[route.arg] : undefined;
  const title = route.view === 'folder' ? folder?.name ?? 'Carpeta' : route.view === 'tag' ? `#${route.arg}` : route.view === 'trash' ? 'Papelera' : 'Notas';
  const parents = route.view === 'folder' ? folderChain(route.arg, folders).slice(0, -1).map((f) => f.name).join(' / ') : '';
  const subfolders = route.view === 'folder' ? Object.values(folders).filter((f) => f.parentId === route.arg).sort((a, b) => a.name.localeCompare(b.name, 'es')) : [];
  const eyebrow = route.view === 'folder' ? (parents || 'Carpeta') : route.view === 'tag' ? 'Tag' : route.view === 'trash' ? 'Se borran solo si las eliminás' : `${list.length} ${list.length === 1 ? 'nota' : 'notas'}`;

  const create = () => {
    const id = newNote({ folderId: route.view === 'folder' ? route.arg ?? null : null, tags: route.view === 'tag' && route.arg ? [route.arg] : [] });
    navigate({ view: route.view, arg: route.arg, note: id });
  };

  const grid = (items: typeof list) => (
    <div className={`grid-notes v-${settings.view}`}>
      {items.map((n) => <NoteCard key={n.id} note={n} folder={n.folderId ? folders[n.folderId] : undefined} route={route} />)}
    </div>
  );

  return (
    <div className="app">
      <Sidebar route={route} open={drawer} onClose={() => setDrawer(false)} />
      <main className="main">
        {updateAvailable && (
          <button className="update-bar" onClick={applyUpdate} type="button">Hay una versión nueva · tocá para actualizar</button>
        )}
        <div className="top">
          <IconBtn icon="menu" label="Menú" onClick={() => setDrawer(true)} />
          <div className="grow" />
          {route.view === 'trash' && list.length > 0 && <button className="btn small danger" onClick={() => { if (confirm('¿Vaciar la papelera?')) emptyTrash(); }} type="button">Vaciar</button>}
          <IconBtn icon={settings.view === 'list' ? 'rows' : settings.view === 'large' ? 'large' : 'grid'} label="Cómo ver las notas" onClick={() => setViewSheet(true)} />
          <IconBtn icon={searching ? 'close' : 'search'} label="Buscar" onClick={() => { setSearching(!searching); if (searching) setQ(''); }} />
        </div>

        <div className="page-head">
          <div className="eyebrow">{eyebrow}</div>
          <h1 className="title">{title}</h1>
        </div>

        {subfolders.length > 0 && (
          <div className="subfolders">
            {subfolders.map((f) => (
              <button key={f.id} className="chip folder btn" onClick={() => navigate({ view: 'folder', arg: f.id })} type="button"><Icon name="folder" size={12} />{f.name}</button>
            ))}
          </div>
        )}

        {searching && (
          <div className="searchbar">
            <Icon name="search" size={17} />
            <input autoFocus placeholder="Buscar en título, texto, tags y carpetas" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        )}

        {list.length === 0 ? (
          <div className="empty">
            <div className="empty-mark"><Icon name={route.view === 'trash' ? 'trash' : 'notes'} size={30} /></div>
            <div className="serif empty-title">{q ? 'Sin resultados' : route.view === 'trash' ? 'La papelera está vacía' : 'Todavía no hay notas'}</div>
            <p className="muted small">{q ? 'Probá con otra palabra.' : route.view === 'trash' ? 'Lo que borres aparece acá.' : 'Tocá + para escribir la primera.'}</p>
          </div>
        ) : pinned.length > 0 && route.view !== 'trash' ? (
          <>
            <div className="group-label">Fijadas</div>
            {grid(pinned)}
            {others.length > 0 && <div className="group-label">Otras</div>}
            {grid(others)}
          </>
        ) : grid(list)}
      </main>

      {route.view !== 'trash' && !route.note && !route.settings && (
        <button className="fab" onClick={create} aria-label="Nueva nota" type="button"><Icon name="plus" size={26} /></button>
      )}

      {viewSheet && (
        <Sheet title="Cómo ver las notas" onClose={() => setViewSheet(false)}>
          <SheetItem icon="grid" label="Grilla" sub={settings.view === 'grid' ? '✓' : 'tarjetas en columnas'} onClick={() => { setSettings({ view: 'grid' }); setViewSheet(false); }} />
          <SheetItem icon="rows" label="Lista" sub={settings.view === 'list' ? '✓' : 'una línea por nota'} onClick={() => { setSettings({ view: 'list' }); setViewSheet(false); }} />
          <SheetItem icon="large" label="Grande" sub={settings.view === 'large' ? '✓' : 'más texto de cada nota'} onClick={() => { setSettings({ view: 'large' }); setViewSheet(false); }} />
        </Sheet>
      )}

      {route.note && <Editor key={route.note} id={route.note} route={route} />}
      {route.settings && <Settings route={route} />}
      {/* si el id de la nota no existe (enlace viejo) se cierra */}
      {route.note && !notes[route.note] && <Closer route={route} />}
    </div>
  );
}

function Closer({ route }: { route: ReturnType<typeof useRoute> }) {
  useEffect(() => { closeOverlay(route); }, [route]);
  return null;
}
