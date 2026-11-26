import { useRef, useState } from 'react';
import { useStore, setSettings, syncNow, disconnectSync, importAll, emptyTrash, syncConfigured } from '../lib/store';
import { closeOverlay, type Route } from '../lib/router';
import { exportBackup, readImportFile } from '../lib/io';
import { exportPdf } from '../lib/pdf';
import { parseRepo } from '../lib/sync';
import { ago } from '../lib/util';
import { Icon } from './Icons';
import { IconBtn, Segmented } from './ui';
import { TITLE_FONTS } from '../lib/fonts';

export function Settings({ route }: { route: Route }) {
  const settings = useStore((s) => s.settings);
  const notes = useStore((s) => s.notes);
  const sync = useStore((s) => ({ status: s.syncStatus, msg: s.syncMessage, at: s.syncAt }));
  const [repo, setRepo] = useState(settings.sync.repo);
  const [token, setToken] = useState(settings.sync.token);
  const [msg, setMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const connected = syncConfigured(settings);
  const trashCount = Object.values(notes).filter((n) => n.trashed).length;

  const connect = async () => {
    const r = parseRepo(repo);
    if (!r) { setMsg('Escribí el repo como usuario/nombre, por ejemplo tuusuario/apunte-notas'); return; }
    if (!token.trim()) { setMsg('Falta el token'); return; }
    setMsg('Verificando…');
    try {
      const res = await fetch(`https://api.github.com/repos/${r}`, { headers: { Authorization: `Bearer ${token.trim()}`, Accept: 'application/vnd.github+json' } });
      if (res.status === 401) { setMsg('El token no es válido'); return; }
      if (res.status === 404) { setMsg('No encuentro ese repo con ese token. Revisá el nombre y los permisos del token.'); return; }
      const info = await res.json();
      if (info.private === false && !confirm('Ese repo es PÚBLICO: cualquiera podría leer tus notas. ¿Querés usarlo igual?')) { setMsg(''); return; }
    } catch {
      setMsg('Sin conexión con GitHub'); return;
    }
    setMsg('');
    setSettings({ sync: { ...settings.sync, repo: r, token: token.trim() } });
    void syncNow();
  };

  const doImport = async (files: File[]) => {
    let n = 0;
    try {
      for (const f of files) {
        const d = await readImportFile(f);
        await importAll(d);
        n += d.notes?.length ?? 0;
      }
      setMsg(`Se importaron ${n} nota(s)`);
    } catch (e) {
      setMsg((e as Error).message || 'No pude leer el archivo');
    }
  };

  return (
    <div className="editor-wrap">
      <div className="editor settings">
        <header className="ed-head">
          <IconBtn icon="back" label="Volver" onClick={() => closeOverlay(route)} />
          <div className="ed-head-title serif">Ajustes</div>
        </header>
        <div className="ed-scroll">
          <section className="set-sec">
            <h3 className="h3">Apariencia</h3>
            <div className="set-row">
              <label>Tema</label>
              <Segmented value={settings.theme} onChange={(theme) => setSettings({ theme })} options={[{ v: 'auto', label: 'Auto' }, { v: 'light', label: 'Claro' }, { v: 'dark', label: 'Oscuro' }]} />
            </div>
            <div className="set-row">
              <label>Letra de los títulos</label>
              <Segmented
                value={settings.titleFont}
                onChange={(titleFont) => setSettings({ titleFont })}
                options={[
                  { v: 'fraunces', label: 'Fraunces', font: TITLE_FONTS.fraunces.css },
                  { v: 'lora', label: 'Lora', font: TITLE_FONTS.lora.css },
                  { v: 'newsreader', label: 'Newsreader', font: TITLE_FONTS.newsreader.css },
                  { v: 'sans', label: 'Sans', font: TITLE_FONTS.sans.css },
                ]}
              />
            </div>
            <div className="set-row">
              <label>Tamaño de la app<span className="muted small"> botones y menús</span></label>
              <Segmented value={settings.uiSize} onChange={(uiSize) => setSettings({ uiSize })} options={[{ v: 0, label: 'S' }, { v: 1, label: 'M' }, { v: 2, label: 'L' }, { v: 3, label: 'XL' }]} />
            </div>
            <div className="set-row">
              <label>Texto de las notas<span className="muted small"> al leer y escribir</span></label>
              <Segmented value={settings.textSize} onChange={(textSize) => setSettings({ textSize })} options={[{ v: 0, label: 'Chico' }, { v: 1, label: 'Normal' }, { v: 2, label: 'Grande' }]} />
            </div>
          </section>

          <section className="set-sec">
            <h3 className="h3">Sincronizar con GitHub</h3>
            <p className="muted small">Tus notas se guardan siempre en este dispositivo. Si conectás un repo, además se copian ahí como archivos .md (con historial) y se sincronizan entre tus dispositivos.</p>
            {!connected ? (
              <>
                <ol className="steps small">
                  <li>
                    <a className="btn" href="https://github.com/new?name=apunte-notas&visibility=private&description=Notas+de+Apunte" target="_blank" rel="noopener noreferrer">1 · Crear el repo privado</a>
                    <div className="muted tiny">En GitHub tocá el botón verde <b>Create repository</b>. Ya viene con el nombre y en privado.</div>
                  </li>
                  <li>
                    <a className="btn" href="https://github.com/settings/personal-access-tokens/new?name=Apunte&description=Sincronizar+las+notas+de+Apunte&contents=write&expires_in=none" target="_blank" rel="noopener noreferrer">2 · Crear la llave (token)</a>
                    <div className="muted tiny">En <b>Repository access</b> elegí <b>Only select repositories</b> y marcá <b>apunte-notas</b>. Abajo de todo tocá <b>Generate token</b> y copiá el código que empieza con <code>github_pat_</code>.</div>
                  </li>
                  <li>
                    <b>3 · Pegá acá</b> el nombre del repo y el código.
                    <div className="muted tiny">El nombre es tu usuario de GitHub, una barra, y <code>apunte-notas</code>.</div>
                  </li>
                </ol>
                <input className="field" placeholder="usuario/apunte-notas" value={repo} onChange={(e) => setRepo(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
                <input className="field" placeholder="Token (github_pat_…)" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
                <button className="btn primary" onClick={() => void connect()} type="button">Conectar y sincronizar</button>
              </>
            ) : (
              <>
                <div className="sync-card">
                  <Icon name="cloud" size={18} />
                  <div>
                    <div><b>{settings.sync.repo}</b></div>
                    <div className={`small ${sync.status === 'error' ? 'bad' : 'muted'}`}>
                      {sync.status === 'syncing' ? 'Sincronizando…' : sync.status === 'error' ? sync.msg : `${sync.msg || 'Conectado'}${sync.at ? ` · ${ago(sync.at)}` : ''}`}
                    </div>
                  </div>
                </div>
                <label className="check-row small">
                  <input type="checkbox" checked={settings.sync.auto} onChange={(e) => setSettings({ sync: { ...settings.sync, auto: e.target.checked } })} />
                  Sincronizar automáticamente al abrir y al editar
                </label>
                <div className="row gap">
                  <button className="btn primary" onClick={() => void syncNow()} disabled={sync.status === 'syncing'} type="button">Sincronizar ahora</button>
                  <button className="btn" onClick={() => { if (confirm('¿Desconectar? Las notas siguen en este dispositivo y en GitHub.')) void disconnectSync(); }} type="button">Desconectar</button>
                </div>
              </>
            )}
            <p className="muted tiny">El token queda guardado solo en este navegador. Por eso conviene que sea de un único repo y con ese permiso nada más.</p>
          </section>

          <section className="set-sec">
            <h3 className="h3">Datos</h3>
            <div className="col gap">
              <button className="btn" onClick={() => void exportBackup()} type="button"><Icon name="download" size={16} /> Descargar copia de seguridad</button>
              <button className="btn" onClick={() => fileRef.current?.click()} type="button"><Icon name="restore" size={16} /> Importar copia o archivos .md</button>
              <button className="btn" onClick={() => { const list = Object.values(notes).filter((n) => !n.trashed).sort((a, b) => b.updatedAt - a.updatedAt); if (list.length) void exportPdf(list, 'Apunte — todas las notas'); }} type="button"><Icon name="pdf" size={16} /> Exportar todas las notas a PDF</button>
              {trashCount > 0 && <button className="btn danger" onClick={() => { if (confirm(`¿Vaciar la papelera (${trashCount})?`)) emptyTrash(); }} type="button"><Icon name="trash" size={16} /> Vaciar papelera ({trashCount})</button>}
            </div>
            <input ref={fileRef} type="file" accept=".json,.md,.markdown,.txt" multiple hidden onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; if (f.length) void doImport(f); }} />
          </section>

          {msg && <p className="small set-msg">{msg}</p>}

          <section className="set-sec">
            <h3 className="h3">Acerca de</h3>
            <p className="muted small">Apunte · versión del {new Date(__BUILD_TIME__).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' })}. Para instalarla, abrila en el navegador y elegí “Agregar a pantalla de inicio”.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
