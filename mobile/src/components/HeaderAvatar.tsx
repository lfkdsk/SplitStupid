// Top-right nav-bar avatar. Tapping it pushes the Settings screen (where
// Sign out and future preferences live). Wired as `headerRight` on the
// authed screens in App.tsx.
import { Pressable } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useAuth } from '../auth/AuthContext'
import { Avatar } from './Avatar'
import type { RootStackParamList } from '../navigation/types'

export function HeaderAvatar() {
  const { me } = useAuth()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  if (!me) return null
  return (
    <Pressable
      onPress={() => navigation.navigate('Settings')}
      hitSlop={8}
      style={{ marginRight: 4 }}
      accessibilityLabel="Settings"
    >
      <Avatar login={me.login} size={30} />
    </Pressable>
  )
}
