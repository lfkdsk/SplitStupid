import { ActivityIndicator, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { NavigationContainer, type LinkingOptions } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import * as Linking from 'expo-linking'
import { useFonts } from 'expo-font'

import { bootstrapApi } from './config'
import { colors, fonts, isDark } from './theme'
import { AuthProvider, useAuth } from './auth/AuthContext'
import type { RootStackParamList } from './navigation/types'
import SignInScreen from './screens/SignInScreen'
import GroupsScreen from './screens/GroupsScreen'
import GroupScreen from './screens/GroupScreen'
import InviteScreen from './screens/InviteScreen'
import SettingsScreen from './screens/SettingsScreen'
import ScanInviteScreen from './screens/ScanInviteScreen'
import { HeaderAvatar } from './components/HeaderAvatar'
import { HeaderScanButton } from './components/HeaderScanButton'

// Wire @splitstupid/core's API client to the Worker before anything renders.
bootstrapApi()

const Stack = createNativeStackNavigator<RootStackParamList>()

// splitstupid://g/<id> and the universal link both deep-link a group. When
// signed out the path resolves to Invite (the only screen mounted); when
// signed in it resolves to Group. They never coexist, so sharing the path
// is safe. (Universal-link caveat re: the web's hash routing is in the README.)
const linking: LinkingOptions<RootStackParamList> = {
  prefixes: [Linking.createURL('/'), 'splitstupid://', 'https://splitstupid.lfkdsk.org'],
  config: {
    screens: {
      Groups: '',
      SignIn: 'signin',
      Group: 'g/:groupId',
      ScanInvite: 'scan',
      Settings: 'settings',
      Invite: 'g/:groupId',
    },
  },
}

const navTheme = {
  dark: isDark,
  colors: {
    primary: colors.accent,
    background: colors.bg,
    card: colors.bgElevated,
    text: colors.fg,
    border: colors.border,
    notification: colors.accent,
  },
  fonts: {
    regular: { fontFamily: fonts.sans, fontWeight: '400' as const },
    medium: { fontFamily: fonts.sans, fontWeight: '500' as const },
    bold: { fontFamily: fonts.sans, fontWeight: '600' as const },
    heavy: { fontFamily: fonts.sans, fontWeight: '700' as const },
  },
}

function Splash() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={colors.accent} />
    </View>
  )
}

function RootNavigator() {
  const { me, booting } = useAuth()
  if (booting) return <Splash />

  const headerOptions = {
    headerStyle: { backgroundColor: colors.bg },
    headerTintColor: colors.fg,
    headerShadowVisible: false,
    headerBackButtonDisplayMode: 'minimal' as const,
    contentStyle: { backgroundColor: colors.bg },
  }

  return (
    <Stack.Navigator screenOptions={headerOptions}>
      {me ? (
        <>
          <Stack.Screen
            name="Groups"
            component={GroupsScreen}
            options={{
              title: 'SplitStupid',
              headerLeft: () => <HeaderScanButton />,
              headerRight: () => <HeaderAvatar />,
            }}
          />
          <Stack.Screen name="Group" component={GroupScreen} options={{ title: '', headerRight: () => <HeaderAvatar /> }} />
          <Stack.Screen name="ScanInvite" component={ScanInviteScreen} options={{ title: 'Scan invite' }} />
          <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
          <Stack.Screen name="Invite" component={InviteScreen} options={{ title: 'Invite' }} />
        </>
      ) : (
        <>
          <Stack.Screen name="SignIn" component={SignInScreen} options={{ headerShown: false }} />
          <Stack.Screen name="Invite" component={InviteScreen} options={{ title: 'Invite' }} />
        </>
      )}
    </Stack.Navigator>
  )
}

export default function App() {
  // Bundle the web's faces so the native typography matches (Fraunces serif
  // headings, Inter body, JetBrains Mono labels). Loaded at runtime — no
  // native rebuild. Gate render so nothing flashes in a fallback font.
  const [fontsLoaded, fontError] = useFonts({
    Fraunces: require('../assets/fonts/Fraunces.ttf'),
    Inter: require('../assets/fonts/Inter.ttf'),
    JetBrainsMono: require('../assets/fonts/JetBrainsMono.ttf'),
  })
  // Render once loaded — or if a font fails, fall through to the system fallback
  // rather than hanging on the splash.
  if (!fontsLoaded && !fontError) return <Splash />

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <NavigationContainer linking={linking} theme={navTheme} fallback={<Splash />}>
          <RootNavigator />
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  )
}
