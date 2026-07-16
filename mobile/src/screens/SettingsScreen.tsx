// Settings — reached by tapping the header avatar. For now it holds the
// account identity, Sign out, and account deletion; it's laid out as grouped sections (iOS
// settings style) so future preferences (default currency, theme,
// notifications, …) slot in as new SectionLabel + card blocks.
import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { deleteAccount as deleteAccountRequest } from '@splitstupid/core'
import { useAuth } from '../auth/AuthContext'
import { Avatar } from '../components/Avatar'
import { Button, ErrorBanner, SectionLabel } from '../components/ui'
import { colors, fonts, radius, space } from '../theme'

export default function SettingsScreen() {
  const { me, signOut, updateDisplayName } = useAuth()
  const [displayName, setDisplayName] = useState(me?.displayName ?? '')
  const [editingName, setEditingName] = useState(false)
  const [savingName, setSavingName] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    setDisplayName(me?.displayName ?? '')
  }, [me?.displayName])

  const normalizedDisplayName = displayName.trim()
  const canSaveName = normalizedDisplayName.length > 0
    && normalizedDisplayName !== me?.displayName
    && !savingName

  function openNameEditor() {
    setDisplayName(me?.displayName ?? '')
    setProfileError(null)
    setEditingName(true)
  }

  function closeNameEditor() {
    setDisplayName(me?.displayName ?? '')
    setProfileError(null)
    setEditingName(false)
  }

  async function saveDisplayName() {
    if (!canSaveName) return
    setSavingName(true)
    setProfileError(null)
    try {
      await updateDisplayName(normalizedDisplayName)
      setDisplayName(normalizedDisplayName)
      setEditingName(false)
    } catch (e) {
      setProfileError((e as Error)?.message || 'Failed to update name')
    } finally {
      setSavingName(false)
    }
  }

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
    <ScrollView style={styles.root} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <SectionLabel>Account</SectionLabel>
      <View style={styles.card}>
        <View style={styles.accountRow}>
          {me ? <Avatar login={me.login} size={44} /> : null}
          <View style={{ flex: 1 }}>
            <Pressable
              onPress={openNameEditor}
              disabled={!me || editingName}
              hitSlop={8}
              style={({ pressed }) => [styles.nameTrigger, pressed && !editingName && styles.nameTriggerPressed]}
              accessibilityRole="button"
              accessibilityLabel={`Edit name${me?.displayName ? `, ${me.displayName}` : ''}`}
              accessibilityState={{ disabled: !me || editingName }}
            >
              <Text style={styles.login} numberOfLines={1}>{me?.displayName}</Text>
              {!editingName ? <Text style={styles.editNameHint}>Edit</Text> : null}
            </Pressable>
            <Text style={styles.muted} numberOfLines={1}>Account ID · {me?.login}</Text>
          </View>
        </View>
        {editingName ? (
          <View style={styles.profileForm}>
            <Text style={styles.fieldLabel}>Name</Text>
            <TextInput
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Your name"
              placeholderTextColor={colors.fgSubtle}
              maxLength={80}
              autoCapitalize="words"
              autoCorrect={false}
              autoFocus
              selectTextOnFocus
              textContentType="name"
              returnKeyType="done"
              onSubmitEditing={() => { void saveDisplayName() }}
              style={styles.input}
            />
            <Text style={styles.profileHelp}>Shown to other members in groups, expenses, and invites.</Text>
            {profileError ? <ErrorBanner message={profileError} onDismiss={() => setProfileError(null)} /> : null}
            <View style={styles.profileActions}>
              <Button
                title="Cancel"
                variant="ghost"
                onPress={closeNameEditor}
                disabled={savingName}
                style={{ flex: 1 }}
              />
              <Button
                title="Save"
                onPress={() => { void saveDisplayName() }}
                loading={savingName}
                disabled={!canSaveName}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        ) : null}
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
  nameTrigger: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
    borderRadius: radius.sm,
    marginBottom: 2,
  },
  nameTriggerPressed: { opacity: 0.6 },
  login: { flexShrink: 1, fontSize: 18, fontWeight: '600', color: colors.fg, fontFamily: fonts.display },
  editNameHint: { fontSize: 12, fontWeight: '600', color: colors.accent, fontFamily: fonts.sans },
  profileForm: {
    marginHorizontal: space(3),
    marginBottom: space(3),
    padding: space(3),
    gap: space(2),
    borderRadius: radius.md,
    backgroundColor: colors.bgSubtle,
  },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: colors.fgMuted, fontFamily: fonts.sans },
  input: {
    height: 44,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: space(3),
    color: colors.fg,
    backgroundColor: colors.bg,
    fontSize: 15,
    fontFamily: fonts.sans,
  },
  profileHelp: { color: colors.fgMuted, fontSize: 12, lineHeight: 17, fontFamily: fonts.sans },
  profileActions: { flexDirection: 'row', gap: space(2), marginTop: space(1) },
  signOutRow: { alignItems: 'center', paddingVertical: 15 },
  signOutText: { color: colors.negative, fontSize: 16, fontWeight: '600', fontFamily: fonts.sans },
  deleteRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space(2), paddingVertical: 15 },
  deleteText: { color: colors.negative, fontSize: 16, fontWeight: '600', fontFamily: fonts.sans },
  deleteHelp: { color: colors.fgMuted, fontSize: 12, lineHeight: 17, fontFamily: fonts.sans, paddingHorizontal: space(2) },
  footer: { textAlign: 'center', color: colors.fgSubtle, fontSize: 12, marginTop: space(4), fontFamily: fonts.mono },
})
