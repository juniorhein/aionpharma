import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import { useAuth } from './auth/auth-context';
import VendasPage from './pages/VendasPage';
import RankingsPage from './pages/RankingsPage';
import LoginPage from './pages/LoginPage';
import Layout from './components/Layout';
import CouponsPage from './pages/CouponsPage';
import InfluencersPage from './pages/InfluencersPage';
import CouponStatsPage from './pages/CouponStatsPage';
import B2BPage from './pages/B2BPage';
import VitrinePage from './pages/VitrinePage';

function PrivateRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="boot">Carregando…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <PrivateRoute>
            <Layout />
          </PrivateRoute>
        }
      >
        <Route index element={<Navigate to="/vendas" replace />} />
        <Route path="vendas" element={<VendasPage />} />
        <Route path="rankings" element={<RankingsPage />} />
        <Route path="cupons" element={<CouponsPage />} />
        <Route path="cupons/:id" element={<CouponStatsPage />} />
        <Route path="influencers" element={<InfluencersPage />} />
        <Route path="b2b" element={<B2BPage />} />
        <Route path="vitrine" element={<VitrinePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
