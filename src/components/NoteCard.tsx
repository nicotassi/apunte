import { useMemo } from 'react';
import type { Folder, Note } from '../lib/types';
import { firstImage, plainText } from '../lib/md';
import { navigate, type Route } from '../lib/router';
import { AssetImg } from './ui';
import { Icon } from './Icons';

export function NoteCard({ note, folder, route }: { note: Note; folder?: Folder; route: Route }) {
  const preview = useMemo(() => plainText(note.body).slice(0, 400), [note.body]);
  const img = useMemo(() => firstImage(note.body), [note.body]);
  return (
    <button className="card" onClick={() => navigate({ view: route.view, arg: route.arg, note: note.id })} type="button">
      {img && <AssetImg name={img} className="card-img" />}
      {note.pinned && <span className="card-pin"><Icon name="pin" size={14} fill /></span>}
      {note.title && <div className="card-title">{note.title}</div>}
      {preview && <div className="card-text">{preview}</div>}
      {!note.title && !preview && <div className="card-text muted">Nota vacía</div>}
      {(note.tags.length > 0 || (folder && route.view !== 'folder')) && (
        <div className="chips">
          {folder && route.view !== 'folder' && <span className="chip folder"><Icon name="folder" size={11} />{folder.name}</span>}
          {note.tags.slice(0, 4).map((t) => <span className="chip" key={t}>#{t}</span>)}
        </div>
      )}
    </button>
  );
}
