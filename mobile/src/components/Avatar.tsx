// GitHub avatar with a deterministic monogram fallback — the RN take on the
// web's <img src={avatarUrl(...)}>. On a 404 / offline we draw a login-keyed
// gradient-ish circle with the initial, mirroring postcard.ts's fallback.
import { useState } from 'react'
import { Image, Text, View, type ImageStyle, type ViewStyle } from 'react-native'
import { avatarUrl, memberAvatarUrl, type UserProfile } from '@splitstupid/core'
import { colors } from '../theme'

const PAIRS: ReadonlyArray<string> = ['#c2410c', '#6f6356', '#9f1239', '#3f6212', '#6b46c1']

function colorForLogin(login: string): string {
  let h = 0
  for (let i = 0; i < login.length; i++) h = (h * 31 + login.charCodeAt(i)) >>> 0
  return PAIRS[h % PAIRS.length]
}

export function Avatar({
  login,
  profile,
  size = 40,
  style,
}: {
  login: string
  profile?: UserProfile
  size?: number
  style?: ImageStyle
}) {
  const [failed, setFailed] = useState(false)
  const displayName = profile?.displayName || login
  const offline = profile?.kind === 'offline' || login.startsWith('guest:')
  const radius = size / 2
  const base: ImageStyle = {
    width: size,
    height: size,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgSubtle,
  }

  if (failed || offline) {
    return (
      <View style={[base as ViewStyle, { backgroundColor: colorForLogin(displayName), alignItems: 'center', justifyContent: 'center' }, style as ViewStyle]}>
        <Text style={{ color: colors.accentFg, fontSize: size * 0.45, fontWeight: '600' }}>
          {(displayName[0] ?? '?').toUpperCase()}
        </Text>
      </View>
    )
  }

  return (
    <Image
      source={{ uri: profile ? memberAvatarUrl(login, { [login]: profile }, Math.round(size * 2)) : avatarUrl(login, Math.round(size * 2)) }}
      onError={() => setFailed(true)}
      style={[base, style]}
    />
  )
}
