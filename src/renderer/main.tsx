import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

document.documentElement.dataset.theme = window.settings.initialTheme;

async function start() {
  const theme = await window.settings.getTheme();
  if (!theme.ok) throw new Error(theme.error.message);
  document.documentElement.dataset.theme = theme.data;
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void start().catch((error: unknown) => {
  document.getElementById('root')!.textContent = error instanceof Error ? error.message : '读取配置失败，请重启应用';
});
