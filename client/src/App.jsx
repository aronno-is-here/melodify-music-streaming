import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import Home from './pages/Home/Home.jsx';
import Login from './pages/Login/Login.jsx';
import Signup from './pages/Signup/Signup.jsx';
import ForgotPassword from './pages/ForgotPassword/ForgotPassword.jsx';
import ResetPassword from './pages/ResetPassword/ResetPassword.jsx';
import Dashboard from './pages/Dashboard/Dashboard.jsx';
import Profile from './pages/Profile/Profile.jsx';
import Admin from './pages/Admin/Admin.jsx';
import Playlist from './pages/Playlist/Playlist.jsx';
import SongDetails from './pages/SongDetails/SongDetails.jsx';
import Premium from './pages/Premium/Premium.jsx';

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function AdminProtected({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'admin') return <Navigate to="/dashboard" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route
        path="/dashboard"
        element={
          <Protected>
            <Dashboard />
          </Protected>
        }
      />
      <Route
        path="/profile"
        element={
          <Protected>
            <Profile />
          </Protected>
        }
      />
      <Route
        path="/playlist/:id"
        element={
          <Protected>
            <Playlist />
          </Protected>
        }
      />
      <Route
        path="/song/:id"
        element={
          <Protected>
            <SongDetails />
          </Protected>
        }
      />
      <Route path="/premium" element={<Premium />} />
      <Route
        path="/admin"
        element={
          <AdminProtected>
            <Admin />
          </AdminProtected>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
