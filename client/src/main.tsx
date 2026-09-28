import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  if (!reason || typeof reason !== 'object' || !(reason instanceof Error)) {
    console.warn('Unhandled rejection (non-Error):', reason);
    event.preventDefault();
    event.stopImmediatePropagation();
    return false;
  }
}, true);

window.addEventListener('error', (event) => {
  const msg = event.message || '';
  if (msg.includes('ResizeObserver') || msg.includes('Script error') || msg === '' || !event.error) {
    console.warn('Benign error suppressed:', msg || 'unknown');
    event.preventDefault();
    event.stopImmediatePropagation();
    return false;
  }
}, true);

createRoot(document.getElementById("root")!).render(<App />);
