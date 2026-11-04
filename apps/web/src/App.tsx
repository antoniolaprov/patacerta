import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { AuthProvider, useAuth } from './lib/auth';
import { RealtimeProvider } from './lib/realtime';
import { Appointments } from './pages/Appointments';
import { Home } from './pages/Home';
import { Login } from './pages/Login';
import { PetPage } from './pages/PetPage';
import { Schedule } from './pages/Schedule';

function Routed() {
  const { user, loading } = useAuth();
  if (loading) return <p className="page muted">Carregando...</p>;
  if (!user) return <Login />;
  return (
    <RealtimeProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="pets/:id" element={<PetPage />} />
          <Route path="agendar" element={<Schedule />} />
          <Route path="agendamentos" element={<Appointments />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </RealtimeProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routed />
      </AuthProvider>
    </BrowserRouter>
  );
}
