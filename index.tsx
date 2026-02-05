import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Polyfill for process.env in browser environments to prevent crashes
if (typeof window !== 'undefined' && !window.process) {
  // @ts-ignore
  window.process = { env: {} };
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <>
    <App />
  </>
);