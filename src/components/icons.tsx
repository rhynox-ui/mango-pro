// src/components/icons.tsx
//
// Shared one-off glyphs for Settings/Profile — same "real lucide path
// data through react-native-svg" pattern as src/navigation/TabIcon.tsx,
// just not tab icons. Deliberately monochrome (stroke/fill=currentColor
// via the `color` prop): per the product's own hard-won rule (see
// palette.ts's own header), UI chrome never gets a flat brand color —
// XIcon and TelegramIcon below are brand marks, but even those render
// in the theme's own text color rather than a brand color.
//
// XIcon/TelegramIcon are ported verbatim (same path data) from
// mango-mobile's own src/settings/AboutModal.tsx — real social links
// for the same Mango product family, not a separate app's assets.

import type {ReactElement} from 'react';
import Svg, {Circle, Path, Polygon, Rect} from 'react-native-svg';

type IconProps = {color: string; size?: number};
export type IconComponent = (props: IconProps) => ReactElement;
const STROKE = {fill: 'none', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const};

export function ChevronLeftIcon({color, size = 22}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" stroke={color} {...STROKE}>
      <Path d="m15 18-6-6 6-6" />
    </Svg>
  );
}

export function ChevronRightIcon({color, size = 18}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" stroke={color} {...STROKE}>
      <Path d="m9 18 6-6-6-6" />
    </Svg>
  );
}

export function ChevronDownIcon({color, size = 16}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" stroke={color} {...STROKE}>
      <Path d="m6 9 6 6 6-6" />
    </Svg>
  );
}

export function UserIcon({color, size = 22}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" stroke={color} {...STROKE}>
      <Circle cx="12" cy="8" r="5" />
      <Path d="M20 21a8 8 0 0 0-16 0" />
    </Svg>
  );
}

export function ContrastIcon({color, size = 22}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" stroke={color} {...STROKE}>
      <Circle cx="12" cy="12" r="10" />
      <Path d="M12 18a6 6 0 0 0 0-12z" fill={color} stroke="none" />
    </Svg>
  );
}

export function GlobeIcon({color, size = 22}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" stroke={color} {...STROKE}>
      <Circle cx="12" cy="12" r="10" />
      <Path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
      <Path d="M2 12h20" />
    </Svg>
  );
}

export function BellIcon({color, size = 22}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" stroke={color} {...STROKE}>
      <Path d="M10.268 21a2 2 0 0 0 3.464 0" />
      <Path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" />
    </Svg>
  );
}

export function ShieldCheckIcon({color, size = 22}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" stroke={color} {...STROKE}>
      <Path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <Path d="m9 12 2 2 4-4" />
    </Svg>
  );
}

export function LandmarkIcon({color, size = 22}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" stroke={color} {...STROKE}>
      <Polygon points="12 2 20 7 4 7" />
      <Path d="M6 18v-7" />
      <Path d="M10 18v-7" />
      <Path d="M14 18v-7" />
      <Path d="M18 18v-7" />
      <Path d="M3 22h18" />
    </Svg>
  );
}

export function ScaleIcon({color, size = 22}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" stroke={color} {...STROKE}>
      <Path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
      <Path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
      <Path d="M7 21h10" />
      <Path d="M12 3v18" />
      <Path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2" />
    </Svg>
  );
}

export function FileTextIcon({color, size = 22}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" stroke={color} {...STROKE}>
      <Path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <Path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <Path d="M16 13H8" />
      <Path d="M16 17H8" />
    </Svg>
  );
}

export function BookOpenIcon({color, size = 22}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" stroke={color} {...STROKE}>
      <Path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <Path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </Svg>
  );
}

// Real Lucide "newspaper" path data — same "real lucide path data" rule
// this file's own header states, not a redrawn approximation.
export function NewspaperIcon({color, size = 22}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" stroke={color} {...STROKE}>
      <Path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" />
      <Path d="M18 14h-8" />
      <Path d="M15 18h-5" />
      <Path d="M10 6h8v4h-8V6Z" />
    </Svg>
  );
}

export function HelpCircleIcon({color, size = 22}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" stroke={color} {...STROKE}>
      <Circle cx="12" cy="12" r="10" />
      <Path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <Path d="M12 17h.01" />
    </Svg>
  );
}

// Real brand mark path data (not redrawn), same as mango-mobile's own
// AboutModal.tsx — rendered in the theme's own text color, never X's
// black/white brand treatment.
export function XIcon({color, size = 22}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M18.9 2H22l-7.6 8.7L23.3 22h-6.8l-5.3-6.9L5 22H1.9l8.1-9.3L1 2h7l4.8 6.3L18.9 2Zm-1.2 18h1.9L7.4 4H5.4l12.3 16Z" fill={color} />
    </Svg>
  );
}

// Same paper-plane stand-in mango-mobile's own AboutModal.tsx uses for
// Telegram (lucide's "send" glyph, not a redrawn Telegram logo).
export function TelegramIcon({color, size = 22}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" stroke={color} {...STROKE}>
      <Path d="m22 2-7 20-4-9-9-4Z" />
      <Path d="M22 2 11 13" />
    </Svg>
  );
}

export function HistoryIcon({color, size = 20}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" stroke={color} {...STROKE}>
      <Path d="M3 12a9 9 0 1 0 3-6.71L3 8" />
      <Path d="M3 3v5h5" />
      <Path d="M12 7v5l4 2" />
    </Svg>
  );
}

export function GearIcon({color, size = 20}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" stroke={color} {...STROKE}>
      <Path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <Circle cx="12" cy="12" r="3" />
    </Svg>
  );
}

export function PencilIcon({color, size = 13}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" stroke={color} {...STROKE}>
      <Path d="M21.174 6.812a1 1 0 0 0-3.986-3.986L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497Z" />
      <Path d="m15 5 4 4" />
    </Svg>
  );
}

export function UploadIcon({color, size = 16}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" stroke={color} {...STROKE}>
      <Path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <Path d="M17 8l-5-5-5 5" />
      <Path d="M12 3v12" />
    </Svg>
  );
}

export function GiftIcon({color, size = 16}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" stroke={color} {...STROKE}>
      <Path d="M20 12v10H4V12" />
      <Path d="M2 7h20v5H2z" />
      <Path d="M12 22V7" />
      <Path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7Z" />
      <Path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7Z" />
    </Svg>
  );
}

export function PlusIcon({color, size = 16}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" stroke={color} {...STROKE}>
      <Path d="M5 12h14" />
      <Path d="M12 5v14" />
    </Svg>
  );
}

export function MoreHorizontalIcon({color, size = 16}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx="5" cy="12" r="1.6" fill={color} />
      <Circle cx="12" cy="12" r="1.6" fill={color} />
      <Circle cx="19" cy="12" r="1.6" fill={color} />
    </Svg>
  );
}

export function UsersIcon({color, size = 20}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" stroke={color} {...STROKE}>
      <Path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <Circle cx="9" cy="7" r="4" />
      <Path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <Path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </Svg>
  );
}

export function HomeIcon({color, size = 20}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" stroke={color} {...STROKE}>
      <Path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <Path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
    </Svg>
  );
}

export function RepeatIcon({color, size = 20}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" stroke={color} {...STROKE}>
      <Path d="m17 2 4 4-4 4" />
      <Path d="M3 11v-1a4 4 0 0 1 4-4h14" />
      <Path d="m7 22-4-4 4-4" />
      <Path d="M21 13v1a4 4 0 0 1-4 4H3" />
    </Svg>
  );
}

export function SearchIcon({color, size = 20}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" stroke={color} {...STROKE}>
      <Circle cx="11" cy="11" r="8" />
      <Path d="m21 21-4.3-4.3" />
    </Svg>
  );
}

// Filled warning circle with an exclamation mark — the network-status
// banner's own icon, deliberately using colors.warning (the one real
// non-monochrome token this design system carries for exactly this kind
// of "not broken, but pay attention" state).
export function AlertCircleIcon({color, size = 18}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx="12" cy="12" r="10" fill={color} />
      <Path d="M12 8v5" stroke="#0A0A0B" strokeWidth={2} strokeLinecap="round" />
      <Circle cx="12" cy="16.2" r="1.15" fill="#0A0A0B" />
    </Svg>
  );
}

export function ArrowUpIcon({color, size = 18}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" stroke={color} {...STROKE}>
      <Path d="M12 19V5" />
      <Path d="m5 12 7-7 7 7" />
    </Svg>
  );
}

// The Home discovery filter row's own leading button — three
// descending-width horizontal lines, the standard "filter" glyph (lucide
// "list-filter"), not a hamburger menu.
export function FilterIcon({color, size = 18}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" stroke={color} {...STROKE}>
      <Path d="M3 6h18" />
      <Path d="M7 12h10" />
      <Path d="M11 18h4" />
    </Svg>
  );
}

export function StarIcon({color, size = 16}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" stroke={color} {...STROKE}>
      <Path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" />
    </Svg>
  );
}

export function CalendarIcon({color, size = 14}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" stroke={color} {...STROKE}>
      <Rect x="3" y="4" width="18" height="18" rx="2" />
      <Path d="M8 2v4" />
      <Path d="M16 2v4" />
      <Path d="M3 10h18" />
    </Svg>
  );
}

// Real Lucide "log-out" path data (door frame + an arrow exiting it) —
// same "real lucide path data through react-native-svg" convention this
// file's own header describes.
export function LogOutIcon({color, size = 18}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" stroke={color} {...STROKE}>
      <Path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <Path d="m16 17 5-5-5-5" />
      <Path d="M21 12H9" />
    </Svg>
  );
}

// Token-row verification badge — a filled circle + checkmark, same
// composite shape as the reference's blue badge but rendered in the
// theme's own cta tokens instead of a flat blue, per this file's own
// "no flat brand color in UI chrome" rule.
export function VerifiedBadge({bg, check, size = 15}: {bg: string; check: string; size?: number}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx="12" cy="12" r="11" fill={bg} />
      <Path d="M7 12.5 10.2 16 17 8.5" stroke={check} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}
