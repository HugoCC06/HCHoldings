import { Route, Routes } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, type Snapshot } from './lib/api';
import { Layout } from './components/Layout';
import { Loading } from './components/ui';
import { Dashboard } from './pages/Dashboard';
import { AssetsPage } from './pages/Assets';
import { AssetDetail } from './pages/AssetDetail';
import { FinancePage } from './pages/Finance';
import { WorkPage } from './pages/Work';
import { AcquisitionsPage } from './pages/Acquisitions';
import { OpportunityDetail } from './pages/OpportunityDetail';
import { PerformancePage } from './pages/Performance';
import { KnowledgePage } from './pages/Knowledge';
import { ReportsPage } from './pages/Reports';
import { SettingsPage } from './pages/Settings';
import { Empty } from './components/ui';
import { Link } from 'react-router-dom';

export function App() {
  const boot = useQuery({ queryKey: ['snapshot'], queryFn: () => api<Snapshot>('/api/snapshot') });
  if (boot.isLoading) return <Loading label="Opening your data…" />;
  if (boot.isError)
    return (
      <div className="login">
        <Empty title="Your data could not be opened">
          {(boot.error as Error).message} — make sure you are using Chrome, Edge or Firefox in a normal (not private) window, then reload.
        </Empty>
      </div>
    );
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/assets" element={<AssetsPage />} />
        <Route path="/assets/:id" element={<AssetDetail />} />
        <Route path="/finance" element={<FinancePage />} />
        <Route path="/work" element={<WorkPage />} />
        <Route path="/performance" element={<PerformancePage />} />
        <Route path="/acquisitions" element={<AcquisitionsPage />} />
        <Route path="/acquisitions/:id" element={<OpportunityDetail />} />
        <Route path="/knowledge" element={<KnowledgePage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Empty title="Page not found" action={<Link to="/" className="link">Back to dashboard</Link>} />} />
      </Routes>
    </Layout>
  );
}

