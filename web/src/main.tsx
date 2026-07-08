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
