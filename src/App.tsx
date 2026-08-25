import { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from './components/AppLayout';
import { SplashScreen } from './components/SplashScreen';
import { CurrentUserProvider, useCurrentUser } from './hooks/useAnonymousKey';
import { fetchChores } from './lib/chores';
import { fetchMonthOccurrences } from './lib/occurrences';
import { MainPage } from './pages/MainPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { ChoreListPage } from './pages/ChoreListPage';
import { ChoreFormPage } from './pages/ChoreFormPage';
import { ChoreHistoryPage } from './pages/ChoreHistoryPage';
import { CalendarPage } from './pages/CalendarPage';
import { SettingsPage } from './pages/SettingsPage';

function AppRoutes() {
  const currentUser = useCurrentUser();
  // 앱 최초 진입(스플래시 직후) 시점에 집안일이 0개인지 딱 한 번만 확인해 시작 경로를 정한다.
  // 판단이 끝나면 'checked'로 넘어가 더 이상 라우팅에 관여하지 않으므로, 이후 앱 안에서
  // 집안일을 전부 지워도, 온보딩에서 "시작하기"로 "/"에 돌아와도 다시 끼어들지 않는다.
  const [entry, setEntry] = useState<{ status: 'pending' } | { status: 'checked'; goToOnboarding: boolean }>({
    status: 'pending',
  });

  useEffect(() => {
    if (currentUser.status !== 'success') return;
    const anonKey = currentUser.user.anonKey;
    fetchChores(anonKey)
      .then((chores) => {
        setEntry({ status: 'checked', goToOnboarding: chores.length === 0 });

        // 캘린더 탭을 처음 눌렀을 때도 로딩 없이 바로 보이도록, 이번 달 데이터를 미리 캐시에
        // 채워둔다(prefetch). entry 판단(스플래시 종료)이 끝난 뒤에 시작해야 같은 네트워크를
        // 두고 경합하지 않아 홈 화면 진입이 이 요청 때문에 늦어지지 않는다. 실패해도 캘린더
        // 진입 시 정상적으로 다시 시도되므로 조용히 무시.
        const now = new Date();
        const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        fetchMonthOccurrences(anonKey, currentMonth).catch(() => {});
      })
      .catch(() => setEntry({ status: 'checked', goToOnboarding: false }));
  }, [currentUser]);

  if (currentUser.status === 'loading' || entry.status === 'pending') {
    return <SplashScreen />;
  }

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={entry.goToOnboarding ? <Navigate to="/onboarding" replace /> : <MainPage />} />
        <Route path="/chores" element={<ChoreListPage />} />
        <Route path="/calendar" element={<CalendarPage />} />
      </Route>
      <Route
        path="/onboarding"
        element={<OnboardingPage onStart={() => setEntry({ status: 'checked', goToOnboarding: false })} />}
      />
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
