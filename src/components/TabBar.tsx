// src/components/TabBar.tsx
//
// Same visual shape as mango-mobile's own bottom tab bar (App.tsx's
// styles.tabBar/tabItem/tabLabel): a flex row, top border + panel
// background, each item centered with an icon above a 12.5px/600-weight
// label, active label in navActive, inactive in textMuted. Ported as a
// web layout (React Router NavLink instead of a screen-switch state
// machine) rather than copied 1:1, since routing works differently here,
// but the look is deliberately the same app, not a fresh design.

import {NavLink} from 'react-router-dom';
import {Search, Wallet, Clock, Settings} from 'lucide-react';

const TABS = [
  {to: '/', label: 'Search', icon: Search, end: true},
  {to: '/portfolio', label: 'Portfolio', icon: Wallet},
  {to: '/activity', label: 'Activity', icon: Clock},
  {to: '/settings', label: 'Settings', icon: Settings},
];

export function TabBar() {
  return (
    <nav className="flex border-t border-panelBorder bg-panel">
      {TABS.map(({to, label, icon: Icon, end}) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className="flex flex-1 flex-col items-center gap-1 py-2.5"
        >
          {({isActive}) => (
            <>
              <Icon size={22} className={isActive ? 'text-navActive' : 'text-textMuted'} />
              <span className={`text-[12.5px] font-semibold ${isActive ? 'text-navActive' : 'text-textMuted'}`}>
                {label}
              </span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
