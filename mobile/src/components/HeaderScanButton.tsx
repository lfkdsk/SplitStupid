import { Pressable, StyleSheet } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import type { RootStackParamList } from '../navigation/types'
import { colors, radius } from '../theme'
import { ScanIcon } from './icons'

export function HeaderScanButton() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  return (
    <Pressable
      onPress={() => navigation.navigate('ScanInvite')}
      hitSlop={8}
      style={({ pressed }) => [styles.button, pressed && { opacity: 0.7 }]}
      accessibilityRole="button"
      accessibilityLabel="Scan invite QR"
    >
      <ScanIcon color={colors.fg} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: {
    width: 34,
    height: 34,
    marginLeft: -2,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
