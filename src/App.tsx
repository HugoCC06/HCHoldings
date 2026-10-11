import { useEffect, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, queryClient } from './lib/api';
import { Layout } from './components/Layout';
import { Button, Field, Input, Loading, Panel } from './components/ui';
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
  const auth = useQuery({ queryKey: ['auth'], queryFn: () => api<{ required: boolean; authenticated: boolean }>('/api/auth') });
  useEffect(() => {
    const onUnauth = () => queryClient.invalidateQueries({ queryKey: ['auth'] });
    window.addEventListener('hcos:unauthorised', onUnauth);
    return () => window.removeEventListener('hcos:unauthorised', onUnauth);
  }, []);
  if (auth.isLoading) return <Loading />;
  if (auth.isError) return <div className="login"><Empty title="Cannot reach the server">Make sure the app server is running, then reload.</Empty></div>;
  if (auth.data?.required && !auth.data.authenticated) return <Login />;
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

function Login() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/auth/login', { method: 'POST', json: { password } });
      await queryClient.invalidateQueries();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login">
      <Panel title="Holding Company OS" sub="Private office — enter your password">
        <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="stack gap-md">
          {error && <div className="alert alert-error">{error}</div>}
          <Field label="Password">{(id) => <Input id={id} type="password" autoFocus value={password} onChange={setPassword} />}</Field>
          <Button variant="primary" type="submit" loading={busy}>Unlock</Button>
        </form>
      </Panel>
    </div>
  );
}
