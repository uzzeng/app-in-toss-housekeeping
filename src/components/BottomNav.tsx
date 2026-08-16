import { NavLink } from 'react-router-dom';
import { Asset, Text } from '@toss/tds-mobile';
import { adaptive } from '@toss/tds-colors';

const TABS = [
  { to: '/', label: '홈', icon: 'icon-home-mono' },
  { to: '/calendar', label: '캘린더', icon: 'icon-calendar-check-mono' },
  { to: '/chores', label: '집안일', icon: 'icon-line-three-dots-mono-02' },
] as const;

export function BottomNav() {
  return (
    <nav
      style={{
        position: 'fixed',
        bottom: 'calc(12px + env(safe-area-inset-bottom))',
        left: 12,
        right: 12,
        display: 'flex',
        borderRadius: 24,
        background: '#fff',
        boxShadow: '0 2px 12px rgba(0, 0, 0, 0.08)',
      }}
    >
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.to === '/'}
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 4,
            padding: '12px 0',
          }}
        >
          {({ isActive }) => {
            const color = isActive ? adaptive.grey800 : adaptive.grey400;
            return (
              <>
                <Asset.Icon frameShape={Asset.frameShape.CleanW24} name={tab.icon} color={color} aria-hidden={true} />
                <Text
                  display="block"
                  color={color}
                  typography="st13"
                  fontWeight="medium"
                  textAlign="center"
                >
                  {tab.label}
                </Text>
              </>
            );
          }}
        </NavLink>
      ))}
    </nav>
  );
}
