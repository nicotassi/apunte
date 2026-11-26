import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore, updateNote, deleteForever, dropIfEmpty, addFolder } from '../lib/store';
import { closeOverlay, type Route } from '../lib/router';
import { toggleTask } from '../lib/md';
import { hasRichFormat, htmlToMarkdown, pastedMarkdown } from '../lib/paste';
import { addImage } from '../lib/images';
import { exportPdf } from '../lib/pdf';
import { downloadNoteMd } from '../lib/io';
import { ago, normTag } from '../lib/util';
import { Icon } from './Icons';
import { IconBtn, Sheet, SheetItem } from './ui';
import { Preview } from './Preview';

export function Editor({ id, route }: { id: string; route: Route }) {
  const note = useStore((s) => s.notes[id]);
  const folders = useStore((s) => s.folders);
  const allNotes = useStore((s) => s.notes);

  const [title, setTitle] = useState(note?.title ?? '');
  const [body, setBody] = useState(note?.body ?? '');
  const [mode, setMode] = useState<'edit' | 'view'>(note && (note.body || note.title) ? 'view' : 'edit');
  const [sheet, setSheet] = useState<null | 'more' | 'folder'>(null);
  const [tagText, setTagText] = useState('');
  const [toast, setToast] = useState('');

  const ta = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dirty = useRef(false);
  const latest = useRef({ title, body });
  latest.current = { title, body };

  const readOnly = !!note?.trashed;

  const flush = useCallback(() => {
    if (!dirty.current) return;
    dirty.current = false;
    updateNote(id, { title: latest.current.title, body: latest.current.body });
  }, [id]);

  // Guarda con una pequeña pausa mientras se escribe, y al salir.
  useEffect(() => {
    if (!dirty.current) return;
    const t = setTimeout(flush, 300);
    return () => clearTimeout(t);
  }, [title, body, flush]);
  useEffect(() => () => { flush(); dropIfEmpty(id); }, [id, flush]);

  // Si la nota cambió desde afuera (sincronización) y no hay ediciones pendientes, se refleja.
  useEffect(() => {
    if (!note || dirty.current) return;
    if (note.title !== latest.current.title) setTitle(note.title);
    if (note.body !== latest.current.body) setBody(note.body);
  }, [note?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight, 220)}px`;
  }, [body, mode]);

  const say = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2200); };
  const close = () => { flush(); closeOverlay(route); };

  // El cursor se coloca en el mismo ciclo en que React pinta el texto nuevo (así no se corre si se escribe rápido).
  const pendingSel = useRef<[number, number] | null>(null);
  useLayoutEffect(() => {
    const el = ta.current;
    if (pendingSel.current && el) {
      el.focus();
      el.setSelectionRange(pendingSel.current[0], pendingSel.current[1]);
      pendingSel.current = null;
    }
  });

  const edit = (next: string, s?: number, e?: number) => {
    dirty.current = true;
    if (s !== undefined) pendingSel.current = [s, e ?? s];
    setBody(next);
  };

  /* ───── acciones de la barra ───── */
  const sel = () => {
    const el = ta.current!;
    return { s: el.selectionStart, e: el.selectionEnd };
  };
  const wrap = (pre: string, post = pre, ph = 'texto') => {
    const { s, e } = sel();
    const chosen = body.slice(s, e) || ph;
    edit(body.slice(0, s) + pre + chosen + post + body.slice(e), s + pre.length, s + pre.length + chosen.length);
  };
  const linePrefix = (prefix: string) => {
    const { s, e } = sel();
    const start = body.lastIndexOf('\n', s - 1) + 1;
    let end = body.indexOf('\n', e);
    if (end < 0) end = body.length;
    const lines = body.slice(start, end).split('\n');
    const has = lines.every((l) => l.startsWith(prefix));
    const out = lines.map((l) => (has ? l.slice(prefix.length) : prefix + l.replace(/^#{1,6} /, prefix.startsWith('#') ? '' : '$&'))).join('\n');
    edit(body.slice(0, start) + out + body.slice(end), start, start + out.length);
  };
  const insertText = (text: string) => {
    const el = ta.current;
    const s = el ? el.selectionStart : body.length;
    const e = el ? el.selectionEnd : body.length;
    edit(body.slice(0, s) + text + body.slice(e), s + text.length);
  };
  const addImages = async (files: File[]) => {
    try {
      let out = '';
      for (const f of files) out += `\n![](assets/${await addImage(f)})\n`;
      insertText(out);
      if (mode === 'view') setMode('edit');
    } catch {
      say('No pude cargar la imagen');
    }
  };
  const pasteFromClipboard = async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const img = it.types.find((t) => t.startsWith('image/'));
        if (img) { await addImages([new File([await it.getType(img)], 'pegada', { type: img })]); return; }
        if (it.types.includes('text/html')) {
          const html = await (await it.getType('text/html')).text();
          if (hasRichFormat(html)) { insertText(htmlToMarkdown(html)); return; }
        }
        if (it.types.includes('text/plain')) { insertText(await (await it.getType('text/plain')).text()); return; }
      }
    } catch {
      try { insertText(await navigator.clipboard.readText()); } catch { say('Mantené apretado en el texto y elegí "Pegar"'); }
    }
  };

  const onKeyDown = (ev: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (ev.key !== 'Enter' || ev.shiftKey || ev.nativeEvent.isComposing) return;
    const el = ev.currentTarget;
    if (el.selectionStart !== el.selectionEnd) return;
    const pos = el.selectionStart;
    const ls = body.lastIndexOf('\n', pos - 1) + 1;
    const line = body.slice(ls, pos);
    const m = line.match(/^(\s*)([-*+]|\d+[.)])\s(\[[ xX]\]\s)?/);
    if (!m) return;
    ev.preventDefault();
    if (line.length === m[0].length) {
      // renglón vacío con solo el marcador: termina la lista
      edit(body.slice(0, ls) + body.slice(pos), ls);
      return;
    }
    const marker = /\d/.test(m[2]) ? `${parseInt(m[2], 10) + 1}${m[2].slice(-1)}` : m[2];
    insertText(`\n${m[1]}${marker} ${m[3] ? '[ ] ' : ''}`);
  };

  const onPaste = (ev: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...ev.clipboardData.files].filter((f) => f.type.startsWith('image/'));
    if (files.length) { ev.preventDefault(); void addImages(files); return; }
    const md = pastedMarkdown(ev.clipboardData);
    if (md) { ev.preventDefault(); insertText(md); }
  };

  /* ───── tags y carpeta ───── */
  const knownTags = useMemo(() => [...new Set(Object.values(allNotes).flatMap((n) => n.tags))].sort(), [allNotes]);
  const addTag = (raw: string) => {
    const t = normTag(raw);
    if (t && note && !note.tags.includes(t)) updateNote(id, { tags: [...note.tags, t] });
    setTagText('');
  };

  if (!note) return null;
  const folder = note.folderId ? folders[note.folderId] : null;
  const words = body.trim() ? body.trim().split(/\s+/).length : 0;

  const doPdf = async () => {
    flush();
    setSheet(null);
    await exportPdf([{ ...note, title, body }], title || 'Nota');
  };
  const trash = () => {
    flush();
    updateNote(id, { trashed: true });
    close();
  };

  return (
    <div className="editor-wrap">
      <div className="editor">
        <header className="ed-head">
          <IconBtn icon="back" label="Volver" onClick={close} />
          <div className="grow" />
          {!readOnly && <IconBtn icon={mode === 'edit' ? 'eye' : 'edit'} label={mode === 'edit' ? 'Ver formato' : 'Editar'} onClick={() => { setMode(mode === 'edit' ? 'view' : 'edit'); }} />}
          {!readOnly && <IconBtn icon="pin" label={note.pinned ? 'Desfijar' : 'Fijar'} active={note.pinned} onClick={() => updateNote(id, { pinned: !note.pinned })} />}
          <IconBtn icon="more" label="Más opciones" onClick={() => setSheet('more')} />
        </header>

        {readOnly && (
          <div className="banner">
            <span>Esta nota está en la papelera.</span>
            <button className="btn small" onClick={() => { updateNote(id, { trashed: false }); }} type="button">Restaurar</button>
            <button className="btn small danger" onClick={() => { if (confirm('¿Eliminar para siempre?')) { closeOverlay(route); setTimeout(() => deleteForever(id), 50); } }} type="button">Eliminar</button>
          </div>
        )}

        <div className="ed-scroll">
          <input
            className="ed-title"
            placeholder="Título"
            value={title}
            readOnly={readOnly}
            onChange={(e) => { dirty.current = true; setTitle(e.target.value); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setMode('edit'); ta.current?.focus(); } }}
          />

          <div className="ed-meta">
            <button className="chip btn folder" onClick={() => !readOnly && setSheet('folder')} type="button">
              <Icon name="folder" size={12} />{folder ? folder.name : 'Sin carpeta'}
            </button>
            {note.tags.map((t) => (
              <span className="chip" key={t}>
                #{t}
                {!readOnly && <button className="chip-x" onClick={() => updateNote(id, { tags: note.tags.filter((x) => x !== t) })} aria-label={`Quitar ${t}`} type="button">×</button>}
              </span>
            ))}
            {!readOnly && (
              <input
                className="tag-input"
                placeholder="+ tag"
                value={tagText}
                list="known-tags"
                onChange={(e) => { const v = e.target.value; if (/[,\s]$/.test(v)) addTag(v); else setTagText(v); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(tagText); } else if (e.key === 'Backspace' && !tagText && note.tags.length) updateNote(id, { tags: note.tags.slice(0, -1) }); }}
                onBlur={() => tagText && addTag(tagText)}
              />
            )}
            <datalist id="known-tags">{knownTags.filter((t) => !note.tags.includes(t)).map((t) => <option key={t} value={t} />)}</datalist>
          </div>

          {mode === 'edit' && !readOnly ? (
            <textarea
              ref={ta}
              className="ed-body"
              placeholder="Escribí algo… (acepta Markdown)"
              value={body}
              onChange={(e) => edit(e.target.value)}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              autoFocus={!note.body}
              spellCheck
            />
          ) : (
            <div className="ed-view">
              {body.trim() ? (
                <Preview body={body} onToggleTask={(i) => { if (!readOnly) edit(toggleTask(body, i)); }} onTap={() => !readOnly && setMode('edit')} />
              ) : (
                <div className="muted" onClick={() => !readOnly && setMode('edit')}>Nota vacía. Tocá para escribir.</div>
              )}
            </div>
          )}

          <div className="ed-foot muted tiny">
            {words} {words === 1 ? 'palabra' : 'palabras'} · editada {ago(note.updatedAt)}
          </div>
        </div>

        {mode === 'edit' && !readOnly && (
          <div className="toolbar" onMouseDown={(e) => e.preventDefault()}>
            <button onClick={() => wrap('**')} aria-label="Negrita" type="button"><Icon name="bold" /></button>
            <button onClick={() => wrap('*')} aria-label="Cursiva" type="button"><Icon name="italic" /></button>
            <button onClick={() => linePrefix('## ')} aria-label="Título" type="button"><Icon name="heading" /></button>
            <button onClick={() => linePrefix('- ')} aria-label="Lista" type="button"><Icon name="list" /></button>
            <button onClick={() => linePrefix('- [ ] ')} aria-label="Lista de tareas" type="button"><Icon name="check" /></button>
            <button onClick={() => linePrefix('> ')} aria-label="Cita" type="button"><Icon name="quote" /></button>
            <button onClick={() => wrap('`')} aria-label="Código" type="button"><Icon name="code" /></button>
            <button onClick={() => { const { s, e } = sel(); const t = body.slice(s, e) || 'texto'; edit(body.slice(0, s) + `[${t}](https://)` + body.slice(e), s + t.length + 3, s + t.length + 11); }} aria-label="Enlace" type="button"><Icon name="link" /></button>
            <button onClick={() => fileRef.current?.click()} aria-label="Insertar imagen" type="button"><Icon name="image" /></button>
            <button onClick={() => void pasteFromClipboard()} aria-label="Pegar con formato" type="button"><Icon name="clipboard" /></button>
          </div>
        )}
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; if (f.length) void addImages(f); }} />
        {toast && <div className="toast">{toast}</div>}
      </div>

      {sheet === 'more' && (
        <Sheet title="Opciones" onClose={() => setSheet(null)}>
          {!readOnly && <SheetItem icon="folder" label="Mover a carpeta" onClick={() => setSheet('folder')} />}
          <SheetItem icon="pdf" label="Exportar a PDF" onClick={() => void doPdf()} />
          <SheetItem icon="download" label="Descargar como .md" onClick={() => { flush(); downloadNoteMd({ ...note, title, body }); setSheet(null); }} />
          <SheetItem icon="copy" label="Copiar Markdown" onClick={() => { void navigator.clipboard?.writeText(body).then(() => say('Copiado')); setSheet(null); }} />
          {!readOnly && <SheetItem icon="trash" label="Mover a la papelera" danger onClick={trash} />}
        </Sheet>
      )}
      {sheet === 'folder' && (
        <Sheet title="Carpeta" onClose={() => setSheet(null)}>
          <SheetItem icon="notes" label="Sin carpeta" sub={!note.folderId ? '✓' : undefined} onClick={() => { updateNote(id, { folderId: null }); setSheet(null); }} />
          {Object.values(folders).sort((a, b) => a.name.localeCompare(b.name, 'es')).map((f) => (
            <SheetItem key={f.id} icon="folder" label={f.name} sub={note.folderId === f.id ? '✓' : undefined} onClick={() => { updateNote(id, { folderId: f.id }); setSheet(null); }} />
          ))}
          <SheetItem icon="plus" label="Nueva carpeta…" onClick={() => { const n = window.prompt('Nombre de la carpeta'); const fid = n ? addFolder(n) : null; if (fid) updateNote(id, { folderId: fid }); setSheet(null); }} />
        </Sheet>
      )}
    </div>
  );
}
