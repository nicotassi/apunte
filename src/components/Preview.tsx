import { useEffect, useMemo, useRef } from 'react';
import { renderMd } from '../lib/md';
import { imageURL } from '../lib/images';

/** Markdown renderizado. Los checkboxes `- [ ]` se pueden tocar para marcarlos. */
export function Preview({ body, onToggleTask, onTap }: { body: string; onToggleTask?: (i: number) => void; onTap?: () => void }) {
  const html = useMemo(() => renderMd(body), [body]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    root.querySelectorAll<HTMLImageElement>('img[data-asset]').forEach(async (img) => {
      const u = await imageURL(img.dataset.asset!);
      if (u && img.isConnected) img.src = u;
    });
  }, [html]);

  return (
    <div
      ref={ref}
      className="md"
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        const t = e.target as HTMLElement;
        if (t instanceof HTMLInputElement && t.type === 'checkbox') {
          const all = [...(ref.current?.querySelectorAll('input[type="checkbox"]') ?? [])];
          onToggleTask?.(all.indexOf(t));
          return;
        }
        if (t.closest('a')) return;
        onTap?.();
      }}
    />
  );
}
