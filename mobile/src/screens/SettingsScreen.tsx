// Settings — reached by tapping the header avatar. For now it holds the
// account identity and Sign out; it's laid out as grouped sections (iOS
// settings style) so future preferences (default currency, theme,
// notifications, …) slot in as new SectionLabel + card blocks.
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useAuth } from '../auth/AuthContext'
import { Avatar } from '../components/Avatar'
import { SectionLabel } from '../components/ui'
import { colors, fonts, radius, space } from '../theme'

export default function SettingsScreen() {
  const { me, signOut } = useAuth()

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <SectionLabel>Account</SectionLabel>
      <View style={styles.card}>
        <View style={styles.accountRow}>
          {me ? <Avatar login={me.login} size={44} /> : null}
          <View style={{ flex: 1 }}>
            <Text style={styles.muted}>Signed in with GitHub as</Text>
            <Text style={styles.login} numberOfLines={1}>{me?.login}</Text>
          </View>
        </View>
      </View>

      {/* Future settings sections land here — default currency, theme,
          notifications, etc. Each is a <SectionLabel> + a styles.card of rows. */}

      <View style={{ height: space(5) }} />

      <Pressable
        onPress={signOut}
        style={({ pressed }) => [styles.card, styles.signOutRow, pressed && { opacity: 0.85 }]}
        accessibilityRole="button"
      >
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>

      <Text style={styles.footer}>SplitStupid</Text>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space(4), gap: space(2) },
  card: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  accountRow: { flexDirection: 'row', alignItems: 'center', gap: space(3), padding: space(4) },
  muted: { fontSize: 12, color: colors.fgMuted, fontFamily: fonts.sans },
  login: { fontSize: 18, fontWeight: '600', color: colors.fg, fontFamily: fonts.display, marginTop: 2 },
  signOutRow: { alignItems: 'center', paddingVertical: 15 },
  signOutText: { color: colors.negative, fontSize: 16, fontWeight: '600', fontFamily: fonts.sans },
  footer: { textAlign: 'center', color: colors.fgSubtle, fontSize: 12, marginTop: space(4), fontFamily: fonts.mono },
})
