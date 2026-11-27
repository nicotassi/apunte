import { useStore, addFolder } from '../lib/store';
import { folderRows } from '../lib/folders';
import { NOTE_COLORS, type NoteColor } from '../lib/types';
import { Sheet, SheetItem } from './ui';

/** Elegir carpeta (con el árbol de carpetas) o "Sin carpeta". */
export function FolderPicker({ title = 'Carpeta', current, onPick, onClose }: { title?: string; current?: string | null; onPick: (folderId: string | null) => void; onClose: () => void }) {
  const folders = useStore((s) => s.folders);
  return (
    <Sheet title={title} onClose={onClose}>
      <SheetItem icon="notes" label="Sin carpeta" sub={current === null ? '✓' : undefined} onClick={() => onPick(null)} />
      {folderRows(folders).map((r) => (
        <SheetItem key={r.folder.id} icon="folder" label={r.path} sub={current === r.folder.id ? '✓' : undefined} onClick={() => onPick(r.folder.id)} />
      ))}
      <SheetItem icon="plus" label="Nueva carpeta…" onClick={() => { const n = window.prompt('Nombre de la carpeta'); const id = n ? addFolder(n) : null; if (id) onPick(id); }} />
    </Sheet>
  );
}

/** Elegir uno de los colores de nota, o quitar el color. */
export function ColorPicker({ title = 'Color', current, onPick, onClose }: { title?: string; current?: NoteColor | null; onPick: (c: NoteColor | null) => void; onClose: () => void }) {
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="swatches">
        <button className={`swatch none${!current ? ' on' : ''}`} onClick={() => onPick(null)} aria-label="Sin color" type="button">∅</button>
        {NOTE_COLORS.map((c) => (
          <button key={c} className={`swatch c-${c}${current === c ? ' on' : ''}`} onClick={() => onPick(c)} aria-label={c} type="button" />
        ))}
      </div>
    </Sheet>
  );
}
