import { createRoot } from 'react-dom/client';
import App from './App';
import { initStore } from './lib/store';
import './fonts.css';
import './styles.css';

// Primero lo local: se empieza a leer el almacenamiento del teléfono ya, en paralelo con el dibujo de la pantalla.
void initStore();

// Sin <StrictMode>: el editor limpia notas vacías al desmontarse y no debe correr dos veces.
createRoot(document.getElementById('root')!).render(<App />);

// El servicio que guarda la app para abrir sin señal se registra enseguida (sin esperar a que cargue todo lo demás).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  setTimeout(() => navigator.serviceWorker.register('./sw.js').catch(() => {}), 0);
}
