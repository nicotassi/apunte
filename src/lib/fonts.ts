// Letras disponibles (se cambian desde Ajustes).
// La letra de Claude (Anthropic Serif / Sans) es propia de Anthropic y no se puede incluir en otras apps:
// "Claude" usa Source Serif 4, una serif libre muy parecida en espíritu (cálida, de lectura).

export const TITLE_FONTS = {
  claude: { css: "'Source Serif 4', 'Iowan Old Style', Georgia, serif", weight: 500 },
  fraunces: { css: "'Fraunces', 'Iowan Old Style', Georgia, serif", weight: 500 },
  lora: { css: "'Lora', Georgia, serif", weight: 500 },
  newsreader: { css: "'Newsreader', Georgia, serif", weight: 500 },
  sans: { css: "'Inter', -apple-system, 'Segoe UI', sans-serif", weight: 650 },
} as const;

export const BODY_FONTS = {
  inter: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  claude: "'Source Serif 4', 'Iowan Old Style', Georgia, serif",
  system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif",
} as const;
