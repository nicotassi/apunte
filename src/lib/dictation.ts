// Dictado por voz con el reconocimiento de voz del navegador (Chrome/Android y Safari/iPhone lo traen).

interface SRResult { isFinal: boolean; 0: { transcript: string } }
interface SREvent { resultIndex: number; results: ArrayLike<SRResult> }
interface SRInstance {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void;
}
type SRCtor = new () => SRInstance;

const ctor = (): SRCtor | undefined => {
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

export const dictationSupported = () => !!ctor();

const ERRORS: Record<string, string> = {
  'not-allowed': 'Permití el micrófono para esta página en el navegador',
  'service-not-allowed': 'Permití el micrófono para esta página en el navegador',
  'audio-capture': 'No encuentro un micrófono',
  network: 'El dictado necesita conexión a internet',
  'language-not-supported': 'El navegador no entiende ese idioma',
};

/**
 * Convierte lo que dijo la persona en texto para insertar.
 * Comandos: "nueva línea", "nuevo párrafo", "punto y aparte". La primera letra va en mayúscula al empezar una frase.
 */
export function formatDictation(raw: string, before: string): string {
  let t = raw
    .replace(/\s*\b(punto y aparte)\b[.,]?\s*/gi, '.\n')
    .replace(/\s*\b(nuevo p[aá]rrafo)\b[.,]?\s*/gi, '\n\n')
    .replace(/\s*\b(nueva l[ií]nea|nuevo rengl[oó]n)\b[.,]?\s*/gi, '\n')
    .trim();
  if (!t) return '';
  const prev = before.replace(/[ \t]+$/, '').slice(-1);
  if (!prev || /[.!?\n]/.test(prev)) t = t.charAt(0).toUpperCase() + t.slice(1);
  const needsSpace = before.length > 0 && !/[\s\n]$/.test(before) && !/^[\n.,;:!?)]/.test(t);
  return (needsSpace ? ' ' : '') + t;
}

export interface DictationHandlers {
  onFinal: (text: string) => void;
  onInterim: (text: string) => void;
  onEnd: () => void;
  onError: (message: string) => void;
}

/** Empieza a escuchar. Devuelve la función para parar. Sigue escuchando entre pausas hasta que se pare. */
export function startDictation(h: DictationHandlers, lang = 'es-AR'): () => void {
  const C = ctor();
  if (!C) { h.onError('Este navegador no tiene dictado. Probá con el micrófono del teclado.'); h.onEnd(); return () => {}; }
  const r = new C();
  r.lang = lang;
  r.continuous = true;
  r.interimResults = true;
  let stopped = false;
  r.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      if (res.isFinal) h.onFinal(res[0].transcript);
      else interim += res[0].transcript;
    }
    h.onInterim(interim);
  };
  r.onerror = (e) => {
    if (e.error === 'no-speech' || e.error === 'aborted') return;
    stopped = true;
    h.onError(ERRORS[e.error] ?? `No pude dictar (${e.error})`);
  };
  r.onend = () => {
    if (!stopped) { try { r.start(); return; } catch { /* ya está en marcha */ } }
    h.onInterim('');
    h.onEnd();
  };
  try { r.start(); } catch { h.onEnd(); }
  return () => { stopped = true; try { r.stop(); } catch { /* nada */ } };
}
