import Svg, { Path, Circle, Rect, G } from 'react-native-svg';
/** Decorative brand artwork; never represents the child's actual route. */
export function JourneyArt({ compact = false }: { compact?: boolean }) {
  return (
    <Svg
      width="100%"
      height={compact ? 100 : 160}
      viewBox="0 0 340 160"
      fill="none"
      aria-hidden={true}
    >
      <Path
        d="M-20 120h95q25 0 25-25V62q0-24 24-24h71q25 0 25 25v54q0 22 22 22h118"
        stroke="#61716D"
        strokeWidth="1"
      />
      <Path
        d="M-20 126h95q31 0 31-31V62q0-18 18-18h71q19 0 19 19v54q0 28 28 28h118"
        stroke="#61716D"
        strokeWidth="1"
      />
      <Path
        d="M6 101h49M19 86h51M244 32h65M263 50h60M262 100h47"
        stroke="#61716D"
        strokeWidth="1"
        opacity=".5"
      />
      <Rect
        x="11"
        y="26"
        width="53"
        height="35"
        rx="7"
        fill="#FFFFFF"
        fillOpacity=".04"
        stroke="#61716D"
      />
      <Rect
        x="255"
        y="63"
        width="56"
        height="18"
        rx="5"
        fill="#FFFFFF"
        fillOpacity=".04"
        stroke="#61716D"
      />
      <Circle cx="105" cy="111" r="20" fill="#D4B58A" fillOpacity=".09" />
      <Circle cx="105" cy="111" r="5" fill="#D4B58A" />
      <Circle cx="218" cy="39" r="5" fill="#D4B58A" />
      <G transform="translate(137 66) rotate(-8 30 30)">
        <Rect width="66" height="52" rx="14" fill="#D4B58A" />
        <Rect x="8" y="8" width="50" height="25" rx="7" fill="#253A38" />
        <Path
          d="M15 40h5m26 0h5M22 8v25m21-25v25"
          stroke="#D4B58A"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <Path d="M12 52v5m42-5v5" stroke="#D4B58A" strokeWidth="5" strokeLinecap="round" />
      </G>
      <Circle cx="29" cy="142" r="2" fill="#D4B58A" />
      <Circle cx="320" cy="17" r="2" fill="#D4B58A" />
    </Svg>
  );
}
