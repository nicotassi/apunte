import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, initStore, newNote, emptyTrash, setSettings, updateNote, duplicateNotes, deleteForever } from './lib/store';
import { folderChain, withDescendants } from './lib/folders';
import { closeOverlay, navigate, useRoute } from './lib/router';
import { applyUpdate, checkForUpdate, useUpdate } from './lib/update';
import { Sidebar } from './components/Sidebar';
import { NoteCard } from './components/NoteCard';
import { Editor } from './components/Editor';
import { Settings } from './components/Settings';
import { ColorPicker, FolderPicker } from './components/Pickers';
import type { NoteColor } from './lib/types';
import { Icon } from './components/Icons';
import { IconBtn, Sheet, SheetItem } from './components/ui';
import { BODY_FONTS, TITLE_FONTS } from './lib/fonts';
import { isBlank } from './lib/util';
import type { Route } from './lib/router';

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

  // ---- pantalla que se desliza encima (nota o ajustes): se mantiene montada mientras se anima la salida
  const overlayKey = route.note ? `n:${route.note}` : route.settings ? 's' : null;
  const [shown, setShown] = useState<{ key: string; route: Route } | null>(null);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (overlayKey) { setShown({ key: overlayKey, route }); setLeaving(false); return; }
    setLeaving(true);
    const t = setTimeout(() => { setShown(null); setLeaving(false); }, 340);
    return () => clearTimeout(t);
  }, [overlayKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const ovRef = useRef<HTMLDivElement>(null);
  const swipe = useRef<{ x: number; y: number; active: boolean } | null>(null);
  const edge = useRef<{ x: number; y: number } | null>(null);

  // ---- selección de varias notas
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pick, setPick] = useState<null | 'folder' | 'color'>(null);
  const [toast, setToast] = useState<{ msg: string; undo?: () => void } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();
  const say = (msg: string, undo?: () => void) => {
    setToast({ msg, undo });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  };
  const startSelecting = (id?: string) => {
    if (!selecting) history.pushState({ apunteSel: true }, '', location.href); // así el botón "atrás" del celular solo sale de la selección
    setSelecting(true);
    if (id) setSelected(new Set([id]));
  };
  const stopSelecting = (fromHistory = false) => {
    setSelecting(false);
    setSelected(new Set());
    setPick(null);
    if (!fromHistory && history.state?.apunteSel) history.back();
  };
  const toggleSel = (id: string) => setSelected((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });

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

  useEffect(() => {
    const onPop = () => { if (selecting) stopSelecting(true); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  });
  // al cambiar de lista (carpeta, tag, papelera) o abrir una nota se cierra la selección
  useEffect(() => { if (selecting) stopSelecting(); }, [route.view, route.arg, route.note, route.settings]); // eslint-disable-line react-hooks/exhaustive-deps

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
  }, [settings.theme, settings.uiSize, settings.textSize, settings.titleFont, settings.bodyFont]);

  // Color de las barras del sistema (arriba y abajo) igual al de la app, también si el teléfono cambia de modo claro a oscuro.
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = settings.theme === 'dark' || (settings.theme === 'auto' && mq.matches);
      const metas = [...document.querySelectorAll('meta[name="theme-color"]')];
      metas.slice(1).forEach((m) => m.remove()); // las dos del arranque (claro/oscuro) pasan a ser una sola que se actualiza
      metas[0]?.removeAttribute('media');
      metas[0]?.setAttribute('content', dark ? '#151412' : '#f7f4ee');
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [settings.theme]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    // una carpeta muestra también lo que tienen sus subcarpetas
    const inFolder = route.view === 'folder' && route.arg ? withDescendants(route.arg, folders) : null;
    return Object.values(notes)
      .filter((n) => {
        if (route.view === 'trash') return n.trashed;
        if (n.trashed || isBlank(n)) return false;
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

  const ids = [...selected];
  const word = (n: number) => `${n} ${n === 1 ? 'nota' : 'notas'}`;
  const snapshot = (list: string[]) => list.map((id) => ({ id, folderId: notes[id]?.folderId ?? null, color: notes[id]?.color ?? null, trashed: !!notes[id]?.trashed }));
  const restore = (snap: ReturnType<typeof snapshot>) => () => snap.forEach((x) => updateNote(x.id, { folderId: x.folderId, color: x.color, trashed: x.trashed }));

  const doMove = (folderId: string | null) => {
    const snap = snapshot(ids);
    ids.forEach((id) => updateNote(id, { folderId }));
    say(`${word(ids.length)} movida${ids.length === 1 ? '' : 's'}`, restore(snap));
    stopSelecting();
  };
  const doColor = (color: NoteColor | null) => {
    const snap = snapshot(ids);
    ids.forEach((id) => updateNote(id, { color }));
    say(`Color cambiado en ${word(ids.length)}`, restore(snap));
    stopSelecting();
  };
  const doDuplicate = () => {
    const copies = duplicateNotes(ids);
    say(`${word(copies.length)} duplicada${copies.length === 1 ? '' : 's'}`, () => copies.forEach(deleteForever));
    stopSelecting();
  };
  const doTrash = () => {
    const snap = snapshot(ids);
    ids.forEach((id) => updateNote(id, { trashed: true }));
    say(`${word(ids.length)} a la papelera`, restore(snap));
    stopSelecting();
  };
  const doRestore = () => {
    const snap = snapshot(ids);
    ids.forEach((id) => updateNote(id, { trashed: false }));
    say(`${word(ids.length)} restaurada${ids.length === 1 ? '' : 's'}`, restore(snap));
    stopSelecting();
  };
  const doDeleteForever = () => {
    if (!confirm(`¿Eliminar para siempre ${word(ids.length)}? No se puede deshacer.`)) return;
    ids.forEach(deleteForever);
    stopSelecting();
  };

  const grid = (items: typeof list) => (
    <div className={`grid-notes v-${settings.view}`}>
      {items.map((n, i) => <NoteCard key={n.id} note={n} folder={n.folderId ? folders[n.folderId] : undefined} route={route} index={i} selecting={selecting} selected={selected.has(n.id)} onToggle={() => toggleSel(n.id)} onLongPress={() => (selecting ? toggleSel(n.id) : startSelecting(n.id))} />)}
    </div>
  );

  return (
    <div
      className={`app${shown && !leaving ? ' ov' : ''}`}
      onTouchStart={(e) => { const t = e.touches[0]; edge.current = !shown && !selecting && !drawer && t.clientX < 18 ? { x: t.clientX, y: t.clientY } : null; }}
      onTouchEnd={(e) => {
        const o = edge.current; edge.current = null;
        if (!o) return;
        const t = e.changedTouches[0];
        if (t.clientX - o.x > 60 && Math.abs(t.clientY - o.y) < 50) setDrawer(true);
      }}
    >
      <Sidebar route={route} open={drawer} onClose={() => setDrawer(false)} />
      <main className="main" key={`${route.view}:${route.arg ?? ''}`}>
        {updateAvailable && (
          <button className="update-bar" onClick={applyUpdate} type="button">Hay una versión nueva · tocá para actualizar</button>
        )}
        {selecting ? (
          <div className="top selbar">
            <IconBtn icon="close" label="Cancelar selección" onClick={() => stopSelecting()} />
            <div className="sel-count">{selected.size === 0 ? 'Elegí notas' : word(selected.size)}</div>
            <div className="grow" />
            <button className="btn small" onClick={() => setSelected(selected.size === list.length ? new Set() : new Set(list.map((n) => n.id)))} type="button">{selected.size === list.length && list.length > 0 ? 'Ninguna' : 'Todas'}</button>
          </div>
        ) : (
          <div className="top">
            <IconBtn icon="menu" label="Menú" onClick={() => setDrawer(true)} />
            <div className="grow" />
            {route.view === 'trash' && list.length > 0 && <button className="btn small danger" onClick={() => { if (confirm('¿Vaciar la papelera?')) emptyTrash(); }} type="button">Vaciar</button>}
            {list.length > 0 && <IconBtn icon="select" label="Seleccionar notas" onClick={() => startSelecting()} />}
            <IconBtn icon={settings.view === 'list' ? 'rows' : settings.view === 'large' ? 'large' : 'grid'} label="Cómo ver las notas" onClick={() => setViewSheet(true)} />
            <IconBtn icon={searching ? 'close' : 'search'} label="Buscar" onClick={() => { setSearching(!searching); if (searching) setQ(''); }} />
          </div>
        )}

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

      {route.view !== 'trash' && !route.note && !route.settings && !selecting && (
        <button className="fab" onClick={create} aria-label="Nueva nota" type="button"><Icon name="plus" size={26} /></button>
      )}

      {selecting && (
        <div className="actionbar">
          {route.view === 'trash' ? (
            <>
              <button onClick={doRestore} disabled={!ids.length} type="button"><Icon name="restore" /><span>Restaurar</span></button>
              <button className="danger" onClick={doDeleteForever} disabled={!ids.length} type="button"><Icon name="trash" /><span>Eliminar</span></button>
            </>
          ) : (
            <>
              <button onClick={() => setPick('folder')} disabled={!ids.length} type="button"><Icon name="folder" /><span>Mover</span></button>
              <button onClick={doDuplicate} disabled={!ids.length} type="button"><Icon name="duplicate" /><span>Duplicar</span></button>
              <button onClick={() => setPick('color')} disabled={!ids.length} type="button"><Icon name="palette" /><span>Color</span></button>
              <button className="danger" onClick={doTrash} disabled={!ids.length} type="button"><Icon name="trash" /><span>Eliminar</span></button>
            </>
          )}
        </div>
      )}
      {pick === 'folder' && <FolderPicker title={`Mover ${word(ids.length)} a…`} onPick={doMove} onClose={() => setPick(null)} />}
      {pick === 'color' && <ColorPicker title={`Color para ${word(ids.length)}`} onPick={doColor} onClose={() => setPick(null)} />}
      {toast && (
        <div className="toast-bar">
          <span>{toast.msg}</span>
          {toast.undo && <button onClick={() => { toast.undo?.(); setToast(null); }} type="button">Deshacer</button>}
        </div>
      )}

      {viewSheet && (
        <Sheet title="Cómo ver las notas" onClose={() => setViewSheet(false)}>
          <SheetItem icon="grid" label="Grilla" sub={settings.view === 'grid' ? '✓' : 'tarjetas en columnas'} onClick={() => { setSettings({ view: 'grid' }); setViewSheet(false); }} />
          <SheetItem icon="rows" label="Lista" sub={settings.view === 'list' ? '✓' : 'una línea por nota'} onClick={() => { setSettings({ view: 'list' }); setViewSheet(false); }} />
          <SheetItem icon="large" label="Grande" sub={settings.view === 'large' ? '✓' : 'más texto de cada nota'} onClick={() => { setSettings({ view: 'large' }); setViewSheet(false); }} />
        </Sheet>
      )}

      {shown && (
        <div
          ref={ovRef}
          className={`overlay${leaving ? ' leaving' : ''}`}
          onTouchStart={(e) => { const t = e.touches[0]; swipe.current = t.clientX < 24 ? { x: t.clientX, y: t.clientY, active: false } : null; }}
          onTouchMove={(e) => {
            const sw = swipe.current; const el = ovRef.current;
            if (!sw || !el) return;
            const t = e.touches[0]; const dx = t.clientX - sw.x; const dy = t.clientY - sw.y;
            if (!sw.active) {
              if (dx > 10 && dx > Math.abs(dy) * 1.5) sw.active = true;
              else if (Math.abs(dy) > 10) { swipe.current = null; return; }
            }
            if (sw.active) { el.style.transition = 'none'; el.style.transform = `translateX(${Math.max(0, dx)}px)`; }
          }}
          onTouchEnd={(e) => {
            const sw = swipe.current; const el = ovRef.current;
            swipe.current = null;
            if (!sw || !sw.active || !el) return;
            const dx = e.changedTouches[0].clientX - sw.x;
            el.style.transition = '';
            if (dx > 100) { el.style.setProperty('--dx', `${dx}px`); el.style.transform = ''; closeOverlay(shown.route); }
            else el.style.transform = '';
          }}
        >
          {shown.route.note ? <Editor key={shown.route.note} id={shown.route.note} route={shown.route} /> : <Settings route={shown.route} />}
        </div>
      )}
      {/* si el id de la nota no existe (enlace viejo) se cierra */}
      {route.note && !notes[route.note] && !leaving && <Closer route={route} />}
    </div>
  );
}

function Closer({ route }: { route: ReturnType<typeof useRoute> }) {
  useEffect(() => { closeOverlay(route); }, [route]);
  return null;
}
