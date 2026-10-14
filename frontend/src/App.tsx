import { lazy, Suspense } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes, Link } from 'react-router-dom';
import { ArrowLeft, Gauge } from 'lucide-react';
import AppShell from './components/AppShell';
import { ThemeProvider } from './components/theme';
import { ToastProvider } from './components/Toast';

const Overview = lazy(() => import('./pages/Overview'));
const Datasets = lazy(() => import('./pages/Datasets'));
const Quality = lazy(() => import('./pages/Quality'));
const Drift = lazy(() => import('./pages/Drift'));
const Schema = lazy(() => import('./pages/Schema'));
const Runs = lazy(() => import('./pages/Runs'));
const Alerts = lazy(() => import('./pages/Alerts'));
const Reports = lazy(() => import('./pages/Reports'));
const Settings = lazy(() => import('./pages/Settings'));

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 20_000, retry: 1, refetchOnWindowFocus: false }, mutations: { retry: 0 } } });

export default function App() {
  return <ThemeProvider><QueryClientProvider client={queryClient}><ToastProvider><BrowserRouter><Routes>
    <Route element={<AppShell />}>
      <Route index element={<Suspense fallback={<PageFallback />}><Overview /></Suspense>} />
      <Route path="datasets" element={<Suspense fallback={<PageFallback />}><Datasets /></Suspense>} />
      <Route path="quality" element={<Suspense fallback={<PageFallback />}><Quality /></Suspense>} />
      <Route path="drift" element={<Suspense fallback={<PageFallback />}><Drift /></Suspense>} />
      <Route path="schema" element={<Suspense fallback={<PageFallback />}><Schema /></Suspense>} />
      <Route path="runs" element={<Suspense fallback={<PageFallback />}><Runs /></Suspense>} />
      <Route path="alerts" element={<Suspense fallback={<PageFallback />}><Alerts /></Suspense>} />
      <Route path="reports" element={<Suspense fallback={<PageFallback />}><Reports /></Suspense>} />
      <Route path="settings" element={<Suspense fallback={<PageFallback />}><Settings /></Suspense>} />
      <Route path="*" element={<NotFound />} />
    </Route>
  </Routes></BrowserRouter></ToastProvider></QueryClientProvider></ThemeProvider>;
}

function PageFallback() {
  return <div className="route-loading" role="status"><span className="spinner" /> Loading workspace view…</div>;
}

function NotFound() {
  return <div className="not-found"><span><Gauge size={21} /></span><div className="page-eyebrow">404 · PAGE NOT FOUND</div><h1>This view isn’t in your catalog.</h1><p>The requested QualityLens route doesn’t exist.</p><Link to="/"><ArrowLeft size={15} /> Back to overview</Link></div>;
}
