import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import '@fontsource-variable/inter';
import './styles.css';
import { queryClient } from './lib/api';
import { App } from './App';
import { FeedbackProvider } from './components/ui';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <FeedbackProvider>
          <App />
        </FeedbackProvider>
      </HashRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
