// src/navigation/TabIcon.tsx
//
// Same pattern as mango-mobile's own src/navigation/TabIcon.tsx: real
// lucide icon path data rendered through react-native-svg, not invented
// glyphs. The "wallet" icon is copied byte-for-byte from mobile's own
// TabIcon so Portfolio reads as the same concept there and here.

import Svg, {Circle, Path} from 'react-native-svg';

export type TabIconName = 'search' | 'wallet' | 'activity' | 'settings';

const STROKE = {fill: 'none', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const};

export function TabIcon({name, color, size = 20}: {name: TabIconName; color: string; size?: number}) {
  const common = {viewBox: '0 0 24 24', stroke: color, ...STROKE};
  switch (name) {
    case 'search':
      return (
        <Svg width={size} height={size} {...common}>
          <Circle cx="11" cy="11" r="8" />
          <Path d="m21 21-4.3-4.3" />
        </Svg>
      );
    // Copied verbatim from mango-mobile's TabIcon.tsx 'wallet' case, so
    // Portfolio here reads as the exact same icon mobile already uses
    // for its own wallet-balance concept.
    case 'wallet':
      return (
        <Svg width={size} height={size} {...common}>
          <Path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" />
          <Path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" />
        </Svg>
      );
    case 'activity':
      return (
        <Svg width={size} height={size} {...common}>
          <Path d="M22 12h-4l-3 9L9 3l-3 9H2" />
        </Svg>
      );
    case 'settings':
      return (
        <Svg width={size} height={size} {...common}>
          <Path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <Circle cx="12" cy="12" r="3" />
        </Svg>
      );
    default:
      return null;
  }
}
