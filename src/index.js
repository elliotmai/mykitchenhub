// src/index.js
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initAnalytics } from './services/analytics';
import 'bootstrap/dist/css/bootstrap.min.css';
import './styles/index.css';

// Switches itself off when there is no GA4 property configured, when the build
// points at the emulators, or when the browser will not have it. Never throws.
initAnalytics();

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
