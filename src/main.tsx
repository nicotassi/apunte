import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// Sin <StrictMode>: el editor limpia notas vacías al desmontarse y no debe correr dos veces.
createRoot(document.getElementById('root')!).render(<App />);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
