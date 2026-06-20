import { useCallback, useState } from 'react'
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native'
import { useFocusEffect, type NavigationProp } from '@react-navigation/native'
import { useGroups } from '@splitstupid/hooks'
import type { GroupSummary } from '@splitstupid/core'
import type { RootStackParamList } from '../navigation/types'
import { useAuth } from '../auth/AuthContext'
import { Avatar } from '../components/Avatar'
import { SwipeableRow } from '../components/SwipeableRow'
import { Button, Card, ErrorBanner, SectionLabel } from '../components/ui'
import { colors, fonts, radius, space } from '../theme'

export default function GroupsScreen({ navigation }: { navigation: NavigationProp<RootStackParamList> }) {
  const { me } = useAuth()
  // List + create + delete/leave logic from the shared hook (same as web).
  const { groups, loading, error, setError, refresh, creating: submitting, create, removeOrLeave } =
    useGroups(me?.login ?? '')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('USD')

  // Reload whenever the screen regains focus (e.g. back from a group).
  useFocusEffect(
    useCallback(() => {
      refresh()
    }, [refresh]),
  )

  async function submitCreate() {
    if (!name.trim()) return
    const id = await create({ name, currency: currency.trim().toUpperCase() || 'USD' })
    if (id) {
      setName('')
      setCreating(false)
      navigation.navigate('Group', { groupId: id })
    }
  }

  // Owner → delete (erases the ledger for everyone); member → leave. Native
  // confirm via Alert; the hook does the actual call + list update.
  function confirmRemove(g: GroupSummary) {
    const owned = g.role === 'owner'
    Alert.alert(
      owned ? 'Delete group' : 'Leave group',
      owned
        ? `Delete "${g.name}"? The whole ledger — every expense, void, and member — is erased for everyone. This cannot be undone.`
        : `Leave "${g.name}"? The group keeps running without you; rejoin any time from the share link.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: owned ? 'Delete' : 'Leave', style: 'destructive', onPress: () => { removeOrLeave(g) } },
      ],
    )
  }

  return (
    <FlatList
      style={styles.root}
      contentContainerStyle={styles.content}
      data={groups ?? []}
      keyExtractor={g => g.id}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.accent} />}
      ListHeaderComponent={
        <View style={{ gap: space(3) }}>
          <View style={styles.headRow}>
            <SectionLabel>Your groups</SectionLabel>
          </View>
          {error ? <ErrorBanner message={error} onDismiss={() => setError(null)} /> : null}
          {creating ? (
            <Card style={{ gap: space(2) }}>
              <TextInput
                placeholder="Group name (e.g. Tokyo Trip)"
                placeholderTextColor={colors.fgSubtle}
                value={name}
                onChangeText={setName}
                style={styles.input}
                autoFocus
              />
              <TextInput
                placeholder="Currency (USD, JPY…)"
                placeholderTextColor={colors.fgSubtle}
                value={currency}
                onChangeText={setCurrency}
                autoCapitalize="characters"
                style={styles.input}
              />
              <View style={{ flexDirection: 'row', gap: space(2) }}>
                <Button title="Cancel" variant="ghost" onPress={() => setCreating(false)} style={{ flex: 1 }} />
                <Button title="Create" onPress={submitCreate} loading={submitting} style={{ flex: 1 }} />
              </View>
            </Card>
          ) : (
            <Button title="+  New group" onPress={() => setCreating(true)} variant="secondary" />
          )}
        </View>
      }
      ListEmptyComponent={
        loading ? null : <Text style={styles.empty}>No groups yet. Create one above.</Text>
      }
      renderItem={({ item }) => (
        <SwipeableRow actionLabel={item.role === 'owner' ? 'Delete' : 'Leave'} onAction={() => confirmRemove(item)}>
          <Pressable style={styles.groupLink} onPress={() => navigation.navigate('Group', { groupId: item.id })}>
            <View style={styles.avatarStack}>
              {item.members.slice(0, 4).map((m, i) => (
                <Avatar key={m} login={m} size={28} style={{ marginLeft: i === 0 ? 0 : -10 }} />
              ))}
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <View style={styles.nameRow}>
                <Text style={styles.groupName} numberOfLines={1}>{item.name}</Text>
                {item.finalizedAt != null && <Text style={styles.finalizedTag}>FINALIZED</Text>}
              </View>
              <Text style={styles.groupMeta}>
                {item.role === 'owner' ? 'owner' : `joined · ${item.owner}`} · {item.currency.toUpperCase()} ·{' '}
                {item.eventCount} {item.eventCount === 1 ? 'event' : 'events'}
              </Text>
            </View>
          </Pressable>
        </SwipeableRow>
      )}
    />
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space(4), gap: space(3) },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  groupLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    backgroundColor: colors.bgElevated,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  groupName: { fontSize: 17, fontWeight: '600', color: colors.fg, fontFamily: fonts.display, flex: 1 },
  groupMeta: { fontSize: 13, color: colors.fgMuted, fontFamily: fonts.sans },
  finalizedTag: {
    fontSize: 9,
    color: colors.positive,
    fontFamily: fonts.mono,
    fontWeight: '600',
    letterSpacing: 0.5,
    borderWidth: 1,
    borderColor: colors.positive,
    borderRadius: radius.sm,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  avatarStack: { flexDirection: 'row' },
  input: {
    height: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    color: colors.fg,
    fontSize: 15,
    fontFamily: fonts.sans,
    backgroundColor: colors.bg,
  },
  empty: { textAlign: 'center', color: colors.fgSubtle, marginTop: space(6), fontFamily: fonts.sans },
})
