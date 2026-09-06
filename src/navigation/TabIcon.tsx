// src/navigation/TabIcon.tsx
//
// Same pattern as mango-mobile's own src/navigation/TabIcon.tsx: real
// lucide icon path data rendered through react-native-svg, not invented
// glyphs. Five destinations now (Home/Search/Swap/Community/Profile),
// matching the reference nav's own five-icon layout.

import Svg, {Circle, Path} from 'react-native-svg';

export type TabIconName = 'home' | 'search' | 'swap' | 'community' | 'profile';

const STROKE = {fill: 'none', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const};

export function TabIcon({name, color, size = 20}: {name: TabIconName; color: string; size?: number}) {
  const common = {viewBox: '0 0 24 24', stroke: color, ...STROKE};
  switch (name) {
    case 'home':
      return (
        <Svg width={size} height={size} {...common}>
          <Path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <Path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
        </Svg>
      );
    case 'search':
      return (
        <Svg width={size} height={size} {...common}>
          <Circle cx="11" cy="11" r="8" />
          <Path d="m21 21-4.3-4.3" />
        </Svg>
      );
    // The reference's own "center distinctive swap logo" — a real repeat/
    // exchange glyph rather than a branded mark, same shape mango-mobile
    // uses for its own DEX tab.
    case 'swap':
      return (
        <Svg width={size} height={size} {...common}>
          <Path d="m17 2 4 4-4 4" />
          <Path d="M3 11v-1a4 4 0 0 1 4-4h14" />
          <Path d="m7 22-4-4 4-4" />
          <Path d="M21 13v1a4 4 0 0 1-4 4H3" />
        </Svg>
      );
    case 'community':
      return (
        <Svg width={size} height={size} {...common}>
          <Path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <Circle cx="9" cy="7" r="4" />
          <Path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <Path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </Svg>
      );
    case 'profile':
      return (
        <Svg width={size} height={size} {...common}>
          <Circle cx="12" cy="8" r="5" />
          <Path d="M20 21a8 8 0 0 0-16 0" />
        </Svg>
      );
    default:
      return null;
  }
}
