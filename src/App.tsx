import { Routes, Route } from 'react-router-dom';
import { AppLayout } from './components/AppLayout';
import { MainPage } from './pages/MainPage';
import { ChoreListPage } from './pages/ChoreListPage';
import { CalendarPage } from './pages/CalendarPage';

function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<MainPage />} />
        <Route path="/chores" element={<ChoreListPage />} />
        <Route path="/calendar" element={<CalendarPage />} />
      </Route>
    </Routes>
  );
}

export default App;
