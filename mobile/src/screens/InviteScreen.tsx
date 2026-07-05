import { useCallback, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { StackActions, type NavigationProp, type RouteProp } from '@react-navigation/native'
import { joinGroup } from '@splitstupid/core'
import { useInvite } from '@splitstupid/hooks'
import type { RootStackParamList } from '../navigation/types'
import { useAuth } from '../auth/AuthContext'
import { isOAuthConfigured } from '../auth/oauth'
import { Avatar } from '../components/Avatar'
import { Button, Card, ErrorBanner } from '../components/ui'
import { colors, fonts, space } from '../theme'

export default function InviteScreen({
  route,
  navigation,
}: {
  route: RouteProp<RootStackParamList, 'Invite'>
  navigation: NavigationProp<RootStackParamList>
}) {
  const { groupId } = route.params
  const { me, signIn, signingIn } = useAuth()
  // Public invite preview from the shared hook (same as the web Invite page).
  const { invite, loading, error: inviteError } = useInvite(groupId)
  const [error, setError] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)

  const join = useCallback(async () => {
    setJoining(true)
    setError(null)
    try {
      await joinGroup(groupId)
      navigation.dispatch(StackActions.replace('Group', { groupId }))
    } catch (e) {
      setError((e as Error)?.message ?? 'Failed to join')
    } finally {
      setJoining(false)
    }
  }, [groupId, navigation])

  if (loading) {
    return (
      <SafeAreaView style={styles.splash}>
        <ActivityIndicator color={colors.accent} />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.center}>
        {(error ?? inviteError) ? (
          <ErrorBanner message={(error ?? inviteError)!} onDismiss={() => setError(null)} />
        ) : null}
        {invite ? (
          <Card style={{ alignItems: 'center', gap: space(3), width: '100%' }}>
            <Avatar login={invite.owner} size={64} />
            <Text style={styles.invited}>
              <Text style={{ fontWeight: '600' }}>{invite.owner}</Text> invited you to join
            </Text>
            <Text style={styles.groupName}>{invite.name}</Text>
            <Text style={styles.meta}>
              {invite.currency.toUpperCase()} · {invite.memberCount}{' '}
              {invite.memberCount === 1 ? 'member' : 'members'}
              {invite.finalized ? ' · finalized' : ''}
            </Text>

            {me ? (
              <Button title={`Join as ${me.login}`} onPress={join} loading={joining} style={{ width: '100%' }} />
            ) : isOAuthConfigured() ? (
              <Button title="Sign in to join" onPress={signIn} loading={signingIn} style={{ width: '100%' }} />
            ) : (
              <Text style={styles.meta}>OAuth isn’t configured.</Text>
            )}
          </Card>
        ) : null}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: space(6) },
  splash: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space(3) },
  invited: { fontSize: 15, color: colors.fgMuted, fontFamily: fonts.sans },
  groupName: { fontSize: 26, fontWeight: '600', color: colors.fg, textAlign: 'center', fontFamily: fonts.display },
  meta: { fontSize: 13, color: colors.fgMuted, fontFamily: fonts.mono },
})
