import { NavLink } from 'react-router-dom';

const TABS = [
  { to: '/', label: '홈' },
  { to: '/chores', label: '집안일 리스트' },
  { to: '/calendar', label: '캘린더' },
];

// TODO: 앱빌더 시안 나오면 스타일(아이콘 포함)만 교체 예정. 구조는 그대로 유지.
export function BottomNav() {
  return (
    <nav
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        display: 'flex',
        borderTop: '1px solid #eee',
        background: '#fff',
      }}
    >
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.to === '/'}
          style={({ isActive }) => ({
            flex: 1,
            textAlign: 'center',
            padding: '12px 0',
            fontSize: 13,
            color: isActive ? '#3182F6' : '#888',
            fontWeight: isActive ? 'bold' : 'normal',
          })}
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
