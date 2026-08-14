import { Outlet } from 'react-router-dom';
import { BottomNav } from './BottomNav';

export function AppLayout() {
  return (
    <div style={{ paddingBottom: 56 }}>
      <Outlet />
      <BottomNav />
    </div>
  );
}
