// Settings — reached by tapping the header avatar. For now it holds the
// account identity, Sign out, and account deletion; it's laid out as grouped sections (iOS
// settings style) so future preferences (default currency, theme,
// notifications, …) slot in as new SectionLabel + card blocks.
import { useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { deleteAccount as deleteAccountRequest } from '@splitstupid/core'
import { useAuth } from '../auth/AuthContext'
import { Avatar } from '../components/Avatar'
import { ErrorBanner, SectionLabel } from '../components/ui'
import { colors, fonts, radius, space } from '../theme'

export default function SettingsScreen() {
  const { me, signOut } = useAuth()
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  async function deleteAccount() {
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteAccountRequest()
    } catch (e) {
      setDeleteError((e as Error)?.message || 'Failed to delete account')
      setDeleting(false)
      return
    }

    // The account is already gone. signOut clears in-memory auth in a
    // finally block, so even a Keychain cleanup error must not keep this
    // screen mounted or turn a successful deletion into a visible failure.
    try { await signOut() } catch { /* stale token is rejected on next boot */ }
  }

  function confirmDeleteAccount() {
    Alert.alert(
      'Delete account',
      'This permanently deletes your account, every group you own, and every ledger entry you created. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete account', style: 'destructive', onPress: () => { void deleteAccount() } },
      ],
    )
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <SectionLabel>Account</SectionLabel>
      <View style={styles.card}>
        <View style={styles.accountRow}>
          {me ? <Avatar login={me.login} size={44} /> : null}
          <View style={{ flex: 1 }}>
            <Text style={styles.muted}>Signed in as</Text>
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

      <View style={{ height: space(3) }} />

      <SectionLabel>Danger zone</SectionLabel>
      {deleteError ? <ErrorBanner message={deleteError} onDismiss={() => setDeleteError(null)} /> : null}
      <Pressable
        onPress={confirmDeleteAccount}
        disabled={deleting}
        style={({ pressed }) => [
          styles.card,
          styles.deleteRow,
          pressed && !deleting && { opacity: 0.85 },
          deleting && { opacity: 0.6 },
        ]}
        accessibilityRole="button"
        accessibilityState={{ disabled: deleting }}
      >
        {deleting ? <ActivityIndicator color={colors.negative} /> : null}
        <Text style={styles.deleteText}>{deleting ? 'Deleting account…' : 'Delete account'}</Text>
      </Pressable>
      <Text style={styles.deleteHelp}>
        Permanently deletes your account, owned groups, and ledger entries you created.
      </Text>

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
  deleteRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space(2), paddingVertical: 15 },
  deleteText: { color: colors.negative, fontSize: 16, fontWeight: '600', fontFamily: fonts.sans },
  deleteHelp: { color: colors.fgMuted, fontSize: 12, lineHeight: 17, fontFamily: fonts.sans, paddingHorizontal: space(2) },
  footer: { textAlign: 'center', color: colors.fgSubtle, fontSize: 12, marginTop: space(4), fontFamily: fonts.mono },
})
