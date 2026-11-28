# Apunte

Notas simples, rápidas y sin fricción. Pensada para el celular (PWA instalable y offline), con la calma de Google Keep y algunas cosas más:

- **Carpetas** (que se pueden anidar: subcarpetas, mover, renombrar) y **tags**.
- **Barra de herramientas a tu gusto**: mantené apretado un botón y arrastralo para cambiarlo de lugar (se guarda; en Ajustes se puede volver al orden de fábrica).
- **Enlaces entre notas** con `[[`: elegís la nota de una lista, se tocan para abrirlas, avisa en qué otras notas está mencionada, y si renombrás una nota los enlaces se actualizan solos.
- **Seleccionar varias notas** (mantené apretada una, o el botón de arriba) para mover, duplicar, cambiar color o eliminar, con aviso para deshacer.
- **Colores** para las notas (8 colores suaves, se ven en la tarjeta y en el editor).
- **Tres vistas** de la lista: grilla, lista compacta y grande.
- **Dictado por voz**: botón de micrófono en el editor. Decí "nueva línea", "nuevo párrafo" o "punto y aparte" para dar formato.
- **Markdown con vista previa en vivo** (como Obsidian, tablas incluidas): el formato aparece mientras escribís y los símbolos (`**`, `#`, `[]()`) se ocultan al salir de ese texto. Los `- [ ]` se tildan tocándolos.
- **Imágenes**: desde la galería/cámara o pegadas. Se comprimen solas.
- **Pegar con formato**: copiás de ChatGPT (títulos, negritas, listas, tablas, código) y al pegar queda como Markdown.
- **Exportar a PDF** una nota, o todas (desde Ajustes). Usa "Guardar como PDF" del sistema.
- **Letra** a elección, para los títulos (Claude, Fraunces, Lora, Newsreader o Sans) y para todo el texto (Inter, Claude o Sistema), **tamaño de la app** (S/M/L/XL) independiente del **tamaño del texto de las notas**.
- **Local + nube**: todo se guarda en el dispositivo (IndexedDB) y, si querés, se sincroniza con un repo **privado** de GitHub como archivos `.md`.
- **Transiciones estilo iPhone**: las pantallas se deslizan, las hojas suben y bajan, y hay gestos (deslizar desde el borde para volver o abrir el menú, arrastrar una hoja hacia abajo). Respeta "reducir movimiento" del sistema.
- **Abre siempre al instante, con o sin señal**: la app y sus letras quedan guardadas en el teléfono y se abre desde ahí sin esperar a internet; primero se ven las notas locales y, como segundo paso automático, se mezcla con GitHub (al abrir, al volver la señal y al editar).
- Búsqueda, fijar notas, papelera, modo oscuro, copia de seguridad, importar `.md`.
- En Android, "Compartir → Apunte" crea una nota con el texto compartido.

## Abrirla

**https://nicotassi.github.io/apunte/** — en el celular, abrila en el navegador y elegí “Agregar a pantalla de inicio”.
Cada push a `main` la republica (`.github/workflows/deploy.yml`; en *Settings → Pages* la fuente tiene que ser la rama `gh-pages`).

## Sincronizar con GitHub

1. En Ajustes hay un botón que crea el repo **privado** (`apunte-notas`) ya cargado. No uses este repo: es público.
2. Otro botón crea el token con el permiso justo (**Contents: Read and write**): elegí solo ese repo.
3. En Apunte: Ajustes → Sincronizar con GitHub → pegá `usuario/apunte-notas` y el token.

En el repo queda:

```
notes/<carpeta>/<sub>/<titulo>-<id>.md   # una nota por archivo, con encabezado YAML (id, título, tags, color…)
notes/<titulo>-<id>.md              # notas sin carpeta
assets/<id>.jpg                     # imágenes
```

- Se sincroniza al abrir la app, al editar (con una pausa) y a demanda.
- Si editás la misma nota en dos dispositivos a la vez, no se pierde nada: queda una copia “(conflicto)”.
- El token se guarda solo en el navegador de cada dispositivo.

## Desarrollo

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # pruebas de la sincronización (contra un GitHub falso)
npm run build
```

Stack: React + Vite + TypeScript + Zustand, CodeMirror 6 (editor en vivo), `marked` + `DOMPurify` (Markdown), `turndown` (HTML → Markdown al pegar).
