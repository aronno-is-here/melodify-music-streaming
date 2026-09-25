import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import Home from './pages/Home/Home.jsx';
import Login from './pages/Login/Login.jsx';
import Signup from './pages/Signup/Signup.jsx';
import ForgotPassword from './pages/ForgotPassword/ForgotPassword.jsx';
import ResetPassword from './pages/ResetPassword/ResetPassword.jsx';
import Dashboard from './pages/Dashboard/Dashboard.jsx';
import SearchView from './pages/Dashboard/SearchView.jsx';
import LibraryView from './pages/Dashboard/LibraryView.jsx';
import Profile from './pages/Profile/Profile.jsx';
import Admin from './pages/Admin/Admin.jsx';
import Playlist from './pages/Playlist/Playlist.jsx';
import SongDetails from './pages/SongDetails/SongDetails.jsx';
import Premium from './pages/Premium/Premium.jsx';
import MelodifyStudio from './pages/MelodifyStudio/MelodifyStudio.jsx';
import UserProfile from './pages/UserProfile/UserProfile.jsx';
import Feed from './pages/Feed/Feed.jsx';
import AuthenticatedAppShell from './components/app/AuthenticatedAppShell.jsx';

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
        element={
          <Protected>
            <AuthenticatedAppShell />
          </Protected>
        }
      >
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/search" element={<SearchView />} />
        <Route path="/library" element={<LibraryView />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/playlist/:id" element={<Playlist />} />
        <Route path="/song/:id" element={<SongDetails />} />
        <Route path="/feed" element={<Feed />} />
        <Route path="/studio" element={<MelodifyStudio />} />
        <Route path="/user/:id" element={<UserProfile />} />
      </Route>
      <Route
        path="/liked"
        element={<Navigate to="/library?tab=liked" replace />}
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
      <Route
        path="/admin/ai-recommendation"
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
