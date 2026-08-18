import { Routes, Route } from 'react-router-dom';
import { AppLayout } from './components/AppLayout';
import { SplashScreen } from './components/SplashScreen';
import { CurrentUserProvider, useCurrentUser } from './hooks/useAnonymousKey';
import { MainPage } from './pages/MainPage';
import { ChoreListPage } from './pages/ChoreListPage';
import { ChoreFormPage } from './pages/ChoreFormPage';
import { ChoreHistoryPage } from './pages/ChoreHistoryPage';
import { CalendarPage } from './pages/CalendarPage';
import { SettingsPage } from './pages/SettingsPage';

function AppRoutes() {
  const currentUser = useCurrentUser();

  if (currentUser.status === 'loading') {
    return <SplashScreen />;
  }

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<MainPage />} />
        <Route path="/chores" element={<ChoreListPage />} />
        <Route path="/calendar" element={<CalendarPage />} />
      </Route>
      <Route path="/chores/new" element={<ChoreFormPage />} />
      <Route path="/chores/:id/edit" element={<ChoreFormPage />} />
      <Route path="/chores/:id/history" element={<ChoreHistoryPage />} />
      <Route path="/settings" element={<SettingsPage />} />
    </Routes>
  );
}

function App() {
  return (
    <CurrentUserProvider>
      <AppRoutes />
    </CurrentUserProvider>
  );
}

export default App;
