import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icons';

export interface ToolItem {
  id: string;
  icon: string;
  label: string;
  onClick: () => void;
  className?: string;
}

/** Orden final: primero lo que la persona guardó (si el botón todavía existe) y después los botones que no estaban en esa lista. */
export function orderItems(items: ToolItem[], saved: string[]): ToolItem[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const first = saved.filter((id) => byId.has(id)).map((id) => byId.get(id)!);
  const seen = new Set(first.map((i) => i.id));
  return [...first, ...items.filter((i) => !seen.has(i.id))];
}

const HOLD_MS = 380;

interface Drag { id: string; from: number; to: number; dx: number }

/**
 * Barra de botones del editor. Mantené apretado un botón y arrastralo para cambiarlo de lugar.
 * Un toque normal ejecuta el botón.
 */
export function Toolbar({ items, order, onReorder }: { items: ToolItem[]; order: string[]; onReorder: (ids: string[]) => void }) {
  const ordered = orderItems(items, order);
  const [drag, setDrag] = useState<Drag | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const press = useRef<{ x: number; y: number; id: string; index: number; el: HTMLElement; scroll0: number } | null>(null);
  const metrics = useRef({ slot: 44, first: 0, orig: 0 });
  const dragging = useRef<Drag | null>(null);
  const lastX = useRef(0);
  const suppress = useRef(false);
  const edgeTimer = useRef<ReturnType<typeof setInterval>>();

  // Para que el dedo no haga scroll mientras se arrastra, el touchmove tiene que poder cancelarse (no es "pasivo").
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const stop = (e: TouchEvent) => { if (dragging.current) e.preventDefault(); };
    el.addEventListener('touchmove', stop, { passive: false });
    return () => el.removeEventListener('touchmove', stop);
  }, []);
  useEffect(() => () => { clearTimeout(timer.current); clearInterval(edgeTimer.current); }, []);

  const update = (clientX: number) => {
    const p = press.current;
    const bar = barRef.current;
    if (!p || !bar || !dragging.current) return;
    const dx = clientX - p.x + (bar.scrollLeft - p.scroll0);
    const { slot, first, orig } = metrics.current;
    const to = Math.max(0, Math.min(ordered.length - 1, Math.round((orig + dx - first) / slot)));
    const next = { ...dragging.current, dx, to };
    dragging.current = next;
    setDrag(next);
  };

  const finish = () => {
    clearTimeout(timer.current);
    clearInterval(edgeTimer.current);
    const d = dragging.current;
    dragging.current = null;
    press.current = null;
    if (d) {
      suppress.current = true;
      setTimeout(() => { suppress.current = false; }, 80); // el "click" que llega justo después de soltar no debe ejecutar el botón
      if (d.from !== d.to) {
        const ids = ordered.map((i) => i.id);
        const [moved] = ids.splice(d.from, 1);
        ids.splice(d.to, 0, moved);
        onReorder(ids);
      }
    }
    setDrag(null);
  };

  const start = (e: React.PointerEvent<HTMLButtonElement>, id: string, index: number) => {
    const bar = barRef.current;
    if (!bar) return;
    const el = e.currentTarget;
    press.current = { x: e.clientX, y: e.clientY, id, index, el, scroll0: bar.scrollLeft };
    lastX.current = e.clientX;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const btns = [...bar.querySelectorAll<HTMLElement>('button')];
      metrics.current = { slot: btns.length > 1 ? btns[1].offsetLeft - btns[0].offsetLeft : 44, first: btns[0]?.offsetLeft ?? 0, orig: el.offsetLeft };
      press.current = { ...press.current!, scroll0: bar.scrollLeft };
      const d = { id, from: index, to: index, dx: 0 };
      dragging.current = d;
      setDrag(d);
      try { el.setPointerCapture(e.pointerId); } catch { /* ya soltó */ }
      navigator.vibrate?.(20);
      // si el dedo queda cerca de un borde, la barra se desplaza sola
      edgeTimer.current = setInterval(() => {
        const r = bar.getBoundingClientRect();
        if (lastX.current < r.left + 44) bar.scrollLeft -= 7;
        else if (lastX.current > r.right - 44) bar.scrollLeft += 7;
        else return;
        update(lastX.current);
      }, 16);
    }, HOLD_MS);
  };

  const move = (e: React.PointerEvent) => {
    lastX.current = e.clientX;
    const p = press.current;
    if (!p) return;
    if (!dragging.current) {
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) { clearTimeout(timer.current); press.current = null; } // era un scroll, no un "mantener apretado"
      return;
    }
    update(e.clientX);
  };

  const { slot } = metrics.current;

  return (
    <div className="toolbar-wrap">
      {drag && <div className="tb-hint">Arrastrá y soltá donde quieras</div>}
      <div
        ref={barRef}
        className={`toolbar${drag ? ' reordering' : ''}`}
        onMouseDown={(e) => e.preventDefault()}
        onContextMenu={(e) => e.preventDefault()}
      >
        {ordered.map((it, i) => {
          let tx = 0;
          if (drag) {
            if (i === drag.from) tx = drag.dx;
            else if (drag.from < drag.to && i > drag.from && i <= drag.to) tx = -slot;
            else if (drag.from > drag.to && i >= drag.to && i < drag.from) tx = slot;
          }
          return (
            <button
              key={it.id}
              type="button"
              className={`${it.className ?? ''}${drag?.id === it.id ? ' lifted' : ''}`}
              style={tx ? { transform: `translateX(${tx}px)${drag?.id === it.id ? ' scale(1.18)' : ''}` } : undefined}
              aria-label={it.label}
              onPointerDown={(e) => start(e, it.id, i)}
              onPointerMove={move}
              onPointerUp={finish}
              onPointerCancel={finish}
              onClick={(e) => { if (suppress.current || dragging.current) { e.preventDefault(); return; } it.onClick(); }}
            >
              <Icon name={it.icon} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
