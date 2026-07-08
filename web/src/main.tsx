/**
 * Trapline web UI entry point.
 *
 * Trapline — community ISP service-quality monitor.
 * Copyright (C) 2026 l-small-tech
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { applyStoredTheme } from './hooks/useTheme';
import './theme.css';

applyStoredTheme();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename="/trapline">
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
