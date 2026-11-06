import './styles.css';
import { App } from './app/App';

const canvas = document.getElementById('render-canvas');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('Missing #render-canvas');
}

const app = new App(canvas, document);
void app.start();
