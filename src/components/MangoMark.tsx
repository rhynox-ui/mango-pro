// src/components/MangoMark.tsx
//
// The real Mango brand mark, extracted out of FloatingMangoDecor.tsx (it
// was defined there first, inline, as that component's only consumer) so
// other real UI — not just the decorative floating background — can use
// the exact same pixel-identical mark rather than a redrawn approximation
// or a plain text glyph standing in for it. Same literal path data as
// site's src/MangoLogo.jsx: two small leaf/stem accents, the main body
// fill (in the passed color), and a white 16%-opacity overlay path for
// the body's two-tone highlight.

import Svg, {Path} from 'react-native-svg';

export function MangoMark({size, color}: {size: number; color: string}) {
  return (
    <Svg width={size} height={size * 0.86} viewBox="0 0 70 60">
      <Path d="M27 4c1.5-2 4-3.5 6-3.5-.3 3-2.3 5.8-5.3 7-1-1-1.2-2.3-0.7-3.5Z" fill={color} />
      <Path d="M29 6c6-2 13 0.5 16 6.5-5.5 3-13 1.5-16.5-3-0.4-1.3-0.2-2.5 0.5-3.5Z" fill={color} />
      <Path d="M35 12c11 0 20 10.5 20 24s-10 24-20 24-20-10.5-20-24 9-24 20-24Z" fill={color} />
      <Path
        d="M35 12c2.5 0 4.8 0.4 6.9 1.2-7.7 2.6-13.4 11.6-13.4 22.3s5.7 19.7 13.4 22.3c-2.1 0.8-4.4 1.2-6.9 1.2-11 0-20-10.5-20-24s9-24 20-24Z"
        fill="#FFFFFF"
        opacity={0.16}
      />
    </Svg>
  );
}
