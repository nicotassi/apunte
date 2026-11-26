import { useMemo } from 'react';
import { useStore, addFolder, renameFolder, deleteFolder, syncNow } from '../lib/store';
import { navigate, type Route } from '../lib/router';
import { Icon } from './Icons';
import { ago } from '../lib/util';

export function Sidebar({ route, open, onClose }: { route: Route; open: boolean; onClose: () => void }) {
  const notes = useStore((s) => s.notes);
  const folders = useStore((s) => s.folders);
  const sync = useStore((s) => ({ status: s.syncStatus, msg: s.syncMessage, at: s.syncAt }));

  const counts = useMemo(() => {
    const byFolder: Record<string, number> = {};
    const tags: Record<string, number> = {};
    let all = 0, trash = 0;
    for (const n of Object.values(notes)) {
      if (n.trashed) { trash++; continue; }
      all++;
      if (n.folderId) byFolder[n.folderId] = (byFolder[n.folderId] ?? 0) + 1;
      for (const t of n.tags) tags[t] = (tags[t] ?? 0) + 1;
    }
    return { byFolder, tags: Object.entries(tags).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])), all, trash };
  }, [notes]);

  const go = (r: Route) => { navigate(r); onClose(); };
  const sorted = Object.values(folders).sort((a, b) => a.name.localeCompare(b.name, 'es'));

  const newFolder = () => {
    const name = window.prompt('Nombre de la carpeta');
    const id = name ? addFolder(name) : null;
    if (id) go({ view: 'folder', arg: id });
  };
  const folderMenu = (id: string, name: string) => {
    const a = window.prompt(`Carpeta "${name}"\n\nEscribí un nombre nuevo para renombrar, o dejá vacío y escribí BORRAR para eliminarla (las notas se conservan).`, name);
    if (a === null) return;
    if (a.trim().toUpperCase() === 'BORRAR') { deleteFolder(id); if (route.view === 'folder' && route.arg === id) go({ view: 'all' }); }
    else renameFolder(id, a);
  };

  const item = (active: boolean, icon: string, label: string, count: number | undefined, onClick: () => void, extra?: () => void) => (
    <div className={`nav-row${active ? ' active' : ''}`}>
      <button className="nav-item" onClick={onClick} type="button">
        <Icon name={icon} size={18} />
        <span className="nav-label">{label}</span>
        {count !== undefined && <span className="nav-count">{count}</span>}
      </button>
      {extra && <button className="nav-more" onClick={extra} aria-label="Opciones de la carpeta" type="button"><Icon name="more" size={16} /></button>}
    </div>
  );

  const syncLabel = sync.status === 'off' ? 'Solo en este dispositivo'
    : sync.status === 'syncing' ? 'Sincronizando…'
    : sync.status === 'error' ? sync.msg
    : sync.at ? `Sincronizado ${ago(sync.at)}` : 'Conectado a GitHub';

  return (
    <>
      {open && <div className="scrim" onClick={onClose} />}
      <aside className={`sidebar${open ? ' open' : ''}`}>
        <div className="brand">
          <div className="brand-mark"><Icon name="notes" size={17} /></div>
          <div className="brand-name">Apunte</div>
        </div>

        <div className="side-scroll">
          {item(route.view === 'all', 'notes', 'Todas las notas', counts.all, () => go({ view: 'all' }))}

          <div className="nav-section">
            <span>Carpetas</span>
            <button className="nav-add" onClick={newFolder} aria-label="Nueva carpeta" type="button"><Icon name="plus" size={16} /></button>
          </div>
          {sorted.length === 0 && <div className="nav-empty muted small">Todavía no hay carpetas.</div>}
          {sorted.map((f) => item(route.view === 'folder' && route.arg === f.id, 'folder', f.name, counts.byFolder[f.id] ?? 0, () => go({ view: 'folder', arg: f.id }), () => folderMenu(f.id, f.name)))}

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
    </>
  );
}
