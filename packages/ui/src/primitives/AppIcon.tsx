import Svg, { Path, Circle, Rect } from 'react-native-svg';
import { colors } from '../theme';
export type IconName =
  | 'home'
  | 'people'
  | 'user'
  | 'bus'
  | 'pin'
  | 'calendar'
  | 'arrow'
  | 'chevron'
  | 'clock'
  | 'shield'
  | 'refresh'
  | 'phone'
  | 'check'
  | 'sun'
  | 'route';
const paths: Partial<Record<IconName, string>> = {
  home: 'M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',
  people: 'M3 21v-2a5 5 0 0 1 10 0v2m3-14a4 4 0 0 1 0 8m2 2a4 4 0 0 1 3 4',
  user: 'M4 21v-2a8 8 0 0 1 16 0v2',
  pin: 'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z',
  calendar: 'M4 5h16v16H4ZM8 3v4m8-4v4M4 11h16m-12 4h2m4 0h2',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  chevron: 'm9 5 7 7-7 7',
  clock: 'M12 7v5l3 2',
  shield: 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Zm-4 9 3 3 5-6',
  refresh: 'M20 7v5h-5M4 17v-5h5M5 8a8 8 0 0 1 14-2l1 2M4 16l1 2a8 8 0 0 0 14-2',
  phone: 'm7 3 3 5-3 3a14 14 0 0 0 6 6l3-3 5 3-2 4C10 23 1 14 3 5Z',
  check: 'm5 12 4 4L19 6',
  sun: 'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1',
  route: 'M6 6h9a5 5 0 0 1 0 10H9',
};
export function AppIcon({
  name,
  size = 22,
  color = colors.ink,
}: {
  name: IconName;
  size?: number;
  color?: string;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      // İkonlar dekoratiftir; anlamı yanındaki metin taşır. Ekran okuyucudan
      // her üç platformda da gizlenir — `aria-hidden` yalnız web'de işler,
      // native'de simge "resim" diye tek tek okunuyordu.
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden
    >
      {paths[name] ? <Path d={paths[name]} /> : null}
      {name === 'user' ? <Circle cx="12" cy="7" r="4" /> : null}
      {name === 'people' ? <Circle cx="8" cy="7" r="4" /> : null}
      {name === 'pin' ? <Circle cx="12" cy="10" r="2.5" /> : null}
      {name === 'clock' ? <Circle cx="12" cy="12" r="9" /> : null}
      {name === 'sun' ? <Circle cx="12" cy="12" r="4" /> : null}
      {name === 'route' ? (
        <>
          <Circle cx="5" cy="6" r="2" />
          <Circle cx="7" cy="16" r="2" />
        </>
      ) : null}
      {name === 'bus' ? (
        <>
          <Rect x="4" y="3" width="16" height="16" rx="4" />
          <Path d="M4 12h16M8 6h8M7 19v2m10-2v2" />
          <Circle cx="8" cy="15.5" r=".7" />
          <Circle cx="16" cy="15.5" r=".7" />
        </>
      ) : null}
    </Svg>
  );
}
