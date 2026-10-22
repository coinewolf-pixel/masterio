import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import 'leaflet/dist/leaflet.css';
import './styles.css';
import './i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { ApiError } from '@masterio/shared';
import { App } from './App';
import { SessionProvider } from './auth/Session';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (n, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && n < 2,
      staleTime: 10_000,
      refetchOnWindowFocus: true,
    },
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <SessionProvider>
          <App />
        </SessionProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
