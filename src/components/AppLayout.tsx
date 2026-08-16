import { Outlet } from 'react-router-dom';
import { BottomNav } from './BottomNav';

export function AppLayout() {
  return (
    <div style={{ paddingBottom: 'calc(88px + env(safe-area-inset-bottom))' }}>
      <Outlet />
      <BottomNav />
    </div>
  );
}
