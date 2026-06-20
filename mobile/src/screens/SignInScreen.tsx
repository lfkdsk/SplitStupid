import { Text, View, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useAuth } from '../auth/AuthContext'
import { isOAuthConfigured } from '../auth/oauth'
import { Button, ErrorBanner } from '../components/ui'
import { colors, fonts, space } from '../theme'

// The RN counterpart of the web's Setup page (sign-in half). The marketing
// flourishes (sample receipt, feature cards) are deferred — see README.
export default function SignInScreen() {
  const { signIn, signingIn, error, clearError } = useAuth()

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.center}>
        <View style={styles.mark}>
          <Text style={styles.markS}>S</Text>
        </View>
        <Text style={styles.brand}>SplitStupid</Text>
        <Text style={styles.tagline}>
          A Splitwise-shaped ledger for friend groups. Sign in, share a QR, split the bill.
        </Text>

        {error ? (
          <View style={{ width: '100%', marginBottom: space(3) }}>
            <ErrorBanner message={error} onDismiss={clearError} />
          </View>
        ) : null}

        {isOAuthConfigured() ? (
          <Button title="Sign in with GitHub" onPress={signIn} loading={signingIn} style={{ width: '100%' }} />
        ) : (
          <Text style={styles.notConfigured}>
            OAuth isn’t configured. Set oauthClientId / oauthWorkerUrl in app.json.
          </Text>
        )}
      </View>

      <Text style={styles.footer}>Your friends already have GitHub. No new account.</Text>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: space(6) },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space(3) },
  mark: {
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: colors.fg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markS: { color: colors.bg, fontSize: 32, fontWeight: '700', fontFamily: fonts.display, fontStyle: 'italic' },
  brand: { fontSize: 30, fontWeight: '600', color: colors.fg, fontFamily: fonts.display },
  tagline: { fontSize: 15, color: colors.fgMuted, textAlign: 'center', lineHeight: 22, fontFamily: fonts.sans },
  notConfigured: { fontSize: 13, color: colors.negative, textAlign: 'center', fontFamily: fonts.sans },
  footer: { fontSize: 12, color: colors.fgSubtle, textAlign: 'center', paddingBottom: space(4), fontFamily: fonts.sans },
})
