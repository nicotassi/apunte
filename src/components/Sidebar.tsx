import { useMemo, useRef, useState } from 'react';
import { useStore, addFolder, renameFolder, deleteFolder, moveFolder, syncNow } from '../lib/store';
import { navigate, type Route } from '../lib/router';
import { folderRows, withDescendants } from '../lib/folders';
import { Icon } from './Icons';
import { Sheet, SheetItem } from './ui';
import { ago, isBlank } from '../lib/util';

const COLLAPSED_KEY = 'apunte.collapsed';
const loadCollapsed = (): Record<string, boolean> => {
  try { return JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '{}'); } catch { return {}; }
};

export function Sidebar({ route, open, onClose }: { route: Route; open: boolean; onClose: () => void }) {
  const notes = useStore((s) => s.notes);
  const folders = useStore((s) => s.folders);
  const sync = useStore((s) => ({ status: s.syncStatus, msg: s.syncMessage, at: s.syncAt }));
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const swipeX = useRef<number | null>(null);
  const [menu, setMenu] = useState<{ id: string; step: 'main' | 'move' } | null>(null);

  const toggle = (id: string) => {
    const next = { ...collapsed, [id]: !collapsed[id] };
    setCollapsed(next);
    try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next)); } catch { /* sin almacenamiento */ }
  };

  const rows = useMemo(() => folderRows(folders, collapsed), [folders, collapsed]);

  const counts = useMemo(() => {
    const direct: Record<string, number> = {};
    const tags: Record<string, number> = {};
    let all = 0, trash = 0;
    for (const n of Object.values(notes)) {
      if (n.trashed) { trash++; continue; }
      if (isBlank(n)) continue;
      all++;
      if (n.folderId) direct[n.folderId] = (direct[n.folderId] ?? 0) + 1;
      for (const t of n.tags) tags[t] = (tags[t] ?? 0) + 1;
    }
    // cada carpeta cuenta también lo que tiene en sus subcarpetas
    const total: Record<string, number> = {};
    for (const f of Object.values(folders)) {
      let c = 0;
      for (const id of withDescendants(f.id, folders)) c += direct[id] ?? 0;
      total[f.id] = c;
    }
    return { total, tags: Object.entries(tags).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])), all, trash };
  }, [notes, folders]);

  const go = (r: Route) => { navigate(r); onClose(); };

  const newFolder = (parentId: string | null = null) => {
    const name = window.prompt(parentId ? `Nueva carpeta dentro de "${folders[parentId]?.name}"` : 'Nombre de la carpeta');
    const id = name ? addFolder(name, parentId) : null;
    if (id) {
      if (parentId && collapsed[parentId]) toggle(parentId);
      go({ view: 'folder', arg: id });
    }
  };

  const menuFolder = menu ? folders[menu.id] : undefined;
  const closeMenu = () => setMenu(null);
  const movable = useMemo(() => {
    if (!menu) return [];
    const blocked = withDescendants(menu.id, folders);
    return folderRows(folders).filter((r) => !blocked.has(r.folder.id));
  }, [menu, folders]);

  const item = (active: boolean, icon: string, label: string, count: number | undefined, onClick: () => void) => (
    <div className={`nav-row${active ? ' active' : ''}`}>
      <button className="nav-item" onClick={onClick} type="button">
        <Icon name={icon} size={18} />
        <span className="nav-label">{label}</span>
        {count !== undefined && <span className="nav-count">{count}</span>}
      </button>
    </div>
  );

  const syncLabel = sync.status === 'off' ? 'Solo en este dispositivo'
    : sync.status === 'syncing' ? 'Sincronizando…'
    : sync.status === 'error' ? sync.msg
    : sync.at ? `Sincronizado ${ago(sync.at)}` : 'Conectado a GitHub';

  return (
    <>
      <div className={`scrim${open ? ' on' : ''}`} onClick={onClose} />
      <aside
        className={`sidebar${open ? ' open' : ''}`}
        onTouchStart={(e) => { swipeX.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => { if (swipeX.current !== null && e.changedTouches[0].clientX - swipeX.current < -60) onClose(); swipeX.current = null; }}
      >
        <div className="brand">
          <div className="brand-mark"><Icon name="notes" size={17} /></div>
          <div className="brand-name">Apunte</div>
        </div>

        <div className="side-scroll">
          {item(route.view === 'all', 'notes', 'Todas las notas', counts.all, () => go({ view: 'all' }))}

          <div className="nav-section">
            <span>Carpetas</span>
            <button className="nav-add" onClick={() => newFolder(null)} aria-label="Nueva carpeta" type="button"><Icon name="plus" size={16} /></button>
          </div>
          {rows.length === 0 && <div className="nav-empty muted small">Todavía no hay carpetas.</div>}
          {rows.map(({ folder: f, depth, hasChildren }) => {
            const active = route.view === 'folder' && route.arg === f.id;
            return (
              <div key={f.id} className={`nav-row${active ? ' active' : ''}`} style={{ paddingLeft: `${depth * 0.9}rem` }}>
                <button className={`nav-chev${hasChildren ? '' : ' off'}${collapsed[f.id] ? '' : ' open'}`} onClick={() => hasChildren && toggle(f.id)} aria-label={collapsed[f.id] ? 'Mostrar subcarpetas' : 'Ocultar subcarpetas'} tabIndex={hasChildren ? 0 : -1} type="button">
                  <Icon name="chevron" size={14} />
                </button>
                <button className="nav-item" onClick={() => go({ view: 'folder', arg: f.id })} type="button">
                  <Icon name="folder" size={18} />
                  <span className="nav-label">{f.name}</span>
                  <span className="nav-count">{counts.total[f.id] ?? 0}</span>
                </button>
                <button className="nav-more" onClick={() => setMenu({ id: f.id, step: 'main' })} aria-label={`Opciones de ${f.name}`} type="button"><Icon name="more" size={16} /></button>
              </div>
            );
          })}

          {counts.tags.length > 0 && (
            <>
              <div className="nav-section"><span>Tags</span></div>
              <div className="tag-cloud">
                {counts.tags.slice(0, 40).map(([t, c]) => (
                  <button key={t} className={`chip btn${route.view === 'tag' && route.arg === t ? ' on' : ''}`} onClick={() => go({ view: 'tag', arg: t })} type="button">#{t} <span className="muted">{c}</span></button>
                ))}
              </div>
            </>
          )}

          <div className="nav-section"><span>Más</span></div>
          {item(route.view === 'trash', 'trash', 'Papelera', counts.trash, () => go({ view: 'trash' }))}
          {item(false, 'settings', 'Ajustes', undefined, () => { navigate({ view: route.view, arg: route.arg, settings: true }); onClose(); })}
        </div>

        <button className={`sync-foot ${sync.status}`} onClick={() => (sync.status === 'off' ? go({ view: route.view, arg: route.arg, settings: true } as Route) : void syncNow())} type="button">
          <Icon name="cloud" size={16} />
          <span>{syncLabel}</span>
        </button>
      </aside>

      {menu && menuFolder && menu.step === 'main' && (
        <Sheet title={menuFolder.name} onClose={closeMenu}>
          <SheetItem icon="subfolder" label="Nueva subcarpeta" onClick={() => { closeMenu(); newFolder(menu.id); }} />
          <SheetItem icon="edit2" label="Renombrar" onClick={() => { closeMenu(); const n = window.prompt('Nuevo nombre', menuFolder.name); if (n) renameFolder(menu.id, n); }} />
          <SheetItem icon="move" label="Mover a otra carpeta" onClick={() => setMenu({ id: menu.id, step: 'move' })} />
          <SheetItem icon="trash" label="Eliminar carpeta" danger sub="las notas se conservan" onClick={() => {
            closeMenu();
            if (confirm(`¿Eliminar la carpeta "${menuFolder.name}"?\nSus notas y subcarpetas suben un nivel, no se borran.`)) {
              if (route.view === 'folder' && route.arg && withDescendants(menu.id, folders).has(route.arg) && route.arg === menu.id) navigate({ view: 'all' });
              deleteFolder(menu.id);
            }
          }} />
        </Sheet>
      )}
      {menu && menuFolder && menu.step === 'move' && (
        <Sheet title={`Mover "${menuFolder.name}" a…`} onClose={closeMenu}>
          <SheetItem icon="notes" label="Al principio (sin carpeta de arriba)" sub={!menuFolder.parentId ? '✓' : undefined} onClick={() => { moveFolder(menu.id, null); closeMenu(); }} />
          {movable.map((r) => (
            <SheetItem key={r.folder.id} icon="folder" label={r.path} sub={menuFolder.parentId === r.folder.id ? '✓' : undefined} onClick={() => { moveFolder(menu.id, r.folder.id); closeMenu(); }} />
          ))}
        </Sheet>
      )}
    </>
  );
}
