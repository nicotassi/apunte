import { create } from 'zustand';

const currentScript = () => document.querySelector<HTMLScriptElement>('script[type="module"][src*="assets/index-"]')?.getAttribute('src')?.replace(/^\.\//, '') ?? null;

export const useUpdate = create<{ available: boolean }>(() => ({ available: false }));

/** Pregunta al servidor si hay una versión nueva publicada. */
export async function checkForUpdate(): Promise<boolean> {
  const mine = currentScript();
  if (!mine || !navigator.onLine) return false;
  try {
    const r = await fetch(`./index.html?v=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return false;
    const latest = (await r.text()).match(/assets\/index-[\w-]+\.js/)?.[0];
    const available = !!latest && latest !== mine;
    if (available) useUpdate.setState({ available: true });
    return available;
  } catch {
    return false;
  }
}

/** Baja la versión nueva completa (código y letras) y recién entonces recarga: así no queda a medias. */
export async function applyUpdate() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      await reg.update().catch(() => {}); // por si hay una versión nueva del servicio que guarda la app
      const next = reg.installing ?? reg.waiting;
      if (next && next.state !== 'activated') {
        await new Promise<void>((resolve) => {
          next.addEventListener('statechange', () => { if (next.state === 'activated' || next.state === 'redundant') resolve(); });
          setTimeout(resolve, 8000);
        });
      }
      const sw = reg.active;
      if (sw) {
        await new Promise<void>((resolve) => {
          const done = () => { navigator.serviceWorker.removeEventListener('message', on); resolve(); };
          const on = (e: MessageEvent) => { if (e.data?.type === 'shell-ready') done(); };
          navigator.serviceWorker.addEventListener('message', on);
          sw.postMessage({ type: 'update-shell' });
          setTimeout(done, 6000);
        });
      }
    }
  } catch { /* se recarga igual */ }
  window.location.reload();
}
