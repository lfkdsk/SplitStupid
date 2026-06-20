// A tiny set of styled primitives so the screens stay terse and on-brand.
// These are the RN analogues of the .btn / .card / .pill classes in the
// web's styles.css — same palette, same radii.
import type { ReactNode } from 'react'
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native'
import { colors, fonts, radius } from '../theme'

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <Text style={styles.sectionLabel}>{children}</Text>
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  icon,
  loading,
  disabled,
  style,
}: {
  title: string
  onPress: () => void
  variant?: 'primary' | 'secondary' | 'ghost'
  icon?: ReactNode
  loading?: boolean
  disabled?: boolean
  style?: StyleProp<ViewStyle>
}) {
  const isDisabled = disabled || loading
  // primary → cinnabar fill; secondary → bordered (web's .secondary); ghost → muted.
  const textColor = variant === 'primary' ? colors.accentFg : variant === 'secondary' ? colors.fg : colors.fgMuted
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.btn,
        variant === 'primary' && styles.btnPrimary,
        variant === 'secondary' && styles.btnSecondary,
        variant === 'ghost' && styles.btnGhost,
        pressed && !isDisabled && { opacity: 0.85 },
        isDisabled && { opacity: 0.5 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <>
          {icon}
          <Text style={[styles.btnText, { color: textColor }]}>{title}</Text>
        </>
      )}
    </Pressable>
  )
}

export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  return (
    <View style={styles.error}>
      <Text style={styles.errorText}>{message}</Text>
      {onDismiss && (
        <Pressable onPress={onDismiss} hitSlop={8}>
          <Text style={[styles.errorText, { fontWeight: '600' }]}>✕</Text>
        </Pressable>
      )}
    </View>
  )
}

export function Money({ minor, currency, color }: { minor: number; currency: string; color?: string }) {
  // formatAmount lives in core — but callers usually pass a pre-formatted
  // string. This helper is for the common signed-balance case.
  const sign = minor > 0 ? '+' : ''
  return (
    <Text style={[styles.money, color ? { color } : null]}>
      {sign}
      {minor}
    </Text>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  sectionLabel: {
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.fgMuted,
    marginBottom: 8,
  },
  btn: {
    height: 46,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 18,
  },
  btnPrimary: { backgroundColor: colors.accent },
  btnSecondary: { backgroundColor: colors.bgElevated, borderWidth: 1, borderColor: colors.borderStrong },
  btnGhost: { backgroundColor: 'transparent' },
  btnText: { fontSize: 15, fontWeight: '600', fontFamily: fonts.sans },
  error: {
    backgroundColor: colors.negativeBg,
    borderRadius: radius.md,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  errorText: { color: colors.negative, fontSize: 13, flexShrink: 1, fontFamily: fonts.sans },
  money: { fontFamily: fonts.mono, fontSize: 14, color: colors.fg },
})
