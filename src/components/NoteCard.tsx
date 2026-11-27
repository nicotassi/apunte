import { useMemo, useRef } from 'react';
import type { Folder, Note } from '../lib/types';
import { firstImage, plainText } from '../lib/md';
import { navigate, type Route } from '../lib/router';
import { AssetImg } from './ui';
import { Icon } from './Icons';

interface Props {
  note: Note;
  folder?: Folder;
  route: Route;
  selecting: boolean;
  selected: boolean;
  onToggle: () => void; // tocar mientras se está seleccionando
  onLongPress: () => void; // mantener apretado: empieza la selección
}

export function NoteCard({ note, folder, route, selecting, selected, onToggle, onLongPress }: Props) {
  const preview = useMemo(() => plainText(note.body).slice(0, 700), [note.body]);
  const img = useMemo(() => firstImage(note.body), [note.body]);
  const showFolder = folder && !(route.view === 'folder' && route.arg === folder.id);

  const timer = useRef<ReturnType<typeof setTimeout>>();
  const fired = useRef(false);
  const origin = useRef({ x: 0, y: 0 });
  const cancel = () => clearTimeout(timer.current);

  return (
    <button
      className={`card${note.color ? ` c-${note.color}` : ''}${selected ? ' sel' : ''}${selecting ? ' selecting' : ''}`}
      type="button"
      onPointerDown={(e) => {
        fired.current = false;
        origin.current = { x: e.clientX, y: e.clientY };
        cancel();
        timer.current = setTimeout(() => { fired.current = true; navigator.vibrate?.(15); onLongPress(); }, 450);
      }}
      onPointerMove={(e) => { if (Math.hypot(e.clientX - origin.current.x, e.clientY - origin.current.y) > 10) cancel(); }}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => e.preventDefault()}
      onClick={(e) => {
        if (fired.current) { fired.current = false; e.preventDefault(); return; } // el toque que cierra el "mantener apretado"
        if (selecting) onToggle();
        else navigate({ view: route.view, arg: route.arg, note: note.id });
      }}
    >
      {selecting && <span className={`card-check${selected ? ' on' : ''}`}>{selected && <Icon name="tick" size={14} />}</span>}
      {img && <AssetImg name={img} className="card-img" />}
      {note.pinned && <span className="card-pin"><Icon name="pin" size={14} fill /></span>}
      <div className="card-main">
        {note.title && <div className="card-title">{note.title}</div>}
        {preview && <div className="card-text">{preview}</div>}
        {!note.title && !preview && <div className="card-text muted">Nota vacía</div>}
        {(note.tags.length > 0 || showFolder) && (
          <div className="chips">
            {showFolder && <span className="chip folder"><Icon name="folder" size={11} />{folder.name}</span>}
            {note.tags.slice(0, 4).map((t) => <span className="chip" key={t}>#{t}</span>)}
          </div>
        )}
      </div>
    </button>
  );
}
