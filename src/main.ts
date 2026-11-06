import './styles.css';
import { App } from './app/App';

if (import.meta.env.DEV) {
  const errors: string[] = [];
  (window as unknown as { __ghErrors: string[] }).__ghErrors = errors;
  window.addEventListener('error', (event) => errors.push(String(event.message)));
  window.addEventListener('unhandledrejection', (event) => errors.push(String(event.reason)));
}

const canvas = document.getElementById('render-canvas');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('Missing #render-canvas');
}

const app = new App(canvas, document);
void app.start();
