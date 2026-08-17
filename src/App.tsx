import { Routes, Route } from 'react-router-dom';
import { AppLayout } from './components/AppLayout';
import { SplashScreen } from './components/SplashScreen';
import { CurrentUserProvider, useCurrentUser } from './hooks/useAnonymousKey';
import { MainPage } from './pages/MainPage';
import { ChoreListPage } from './pages/ChoreListPage';
import { ChoreFormPage } from './pages/ChoreFormPage';
import { CalendarPage } from './pages/CalendarPage';

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
