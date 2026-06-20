// The web's inline action-button icons, redrawn with react-native-svg (same
// paths as src/pages/Group.tsx) so the native detail buttons read identically.
import Svg, { Path, Circle, Rect } from 'react-native-svg'

interface IconProps {
  color: string
  size?: number
}

export function ShareIcon({ color, size = 15 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <Path
        d="M9.5 4.5L7 2L4.5 4.5M7 2v7M3 8.5v2.25A1.25 1.25 0 0 0 4.25 12h5.5A1.25 1.25 0 0 0 11 10.75V8.5"
        stroke={color}
        strokeWidth={1.3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  )
}

export function AddFriendIcon({ color, size = 15 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <Circle cx={5.25} cy={4.5} r={2.1} stroke={color} strokeWidth={1.3} />
      <Path d="M1.5 11.5c0-2 1.7-3.2 3.75-3.2 1 0 1.9.28 2.6.78" stroke={color} strokeWidth={1.3} strokeLinecap="round" />
      <Path d="M10.5 6.5v4M8.5 8.5h4" stroke={color} strokeWidth={1.3} strokeLinecap="round" />
    </Svg>
  )
}

export function ReceiptIcon({ color, size = 15 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <Path
        d="M3 1.5v11l1.25-1L5.5 12.5l1.25-1L8 12.5l1.25-1L10.5 12.5L11.75 11.5V1.5L10.5 2.5L9.25 1.5L8 2.5L6.75 1.5L5.5 2.5L4.25 1.5L3 1.5Z M5 5h5 M5 7.25h5 M5 9.5h3"
        stroke={color}
        strokeWidth={1.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  )
}

export function LockIcon({ color, size = 15 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <Path
        d="M3.5 6.5h7a.75.75 0 0 1 .75.75v4a.75.75 0 0 1-.75.75h-7a.75.75 0 0 1-.75-.75v-4A.75.75 0 0 1 3.5 6.5Z M4.75 6.5V4.25a2.25 2.25 0 0 1 4.5 0V6.5"
        stroke={color}
        strokeWidth={1.3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  )
}

export function UnlockIcon({ color, size = 15 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <Path
        d="M3.5 6.5h7a.75.75 0 0 1 .75.75v4a.75.75 0 0 1-.75.75h-7a.75.75 0 0 1-.75-.75v-4A.75.75 0 0 1 3.5 6.5Z M4.75 6.5V4.25a2.25 2.25 0 0 1 4.5 0"
        stroke={color}
        strokeWidth={1.3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  )
}

export function PostcardIcon({ color, size = 15 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <Rect x={1.5} y={3} width={11} height={8} rx={1} stroke={color} strokeWidth={1.2} />
      <Circle cx={9.5} cy={6} r={1.4} stroke={color} strokeWidth={1} />
      <Path d="M3 6.5h3 M3 8.5h5" stroke={color} strokeWidth={1.1} strokeLinecap="round" />
    </Svg>
  )
}
