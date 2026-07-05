import { useCallback, useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { CameraView, type BarcodeScanningResult, useCameraPermissions } from 'expo-camera'
import { StackActions, type NavigationProp, useFocusEffect } from '@react-navigation/native'
import type { RootStackParamList } from '../navigation/types'
import { Button, ErrorBanner } from '../components/ui'
import { extractInviteGroupId } from '../lib/inviteLinks'
import { colors, fonts, radius, space } from '../theme'

export default function ScanInviteScreen({ navigation }: { navigation: NavigationProp<RootStackParamList> }) {
  const [permission, requestPermission] = useCameraPermissions()
  const [error, setError] = useState<string | null>(null)
  const [scanned, setScanned] = useState(false)
  const scannedRef = useRef(false)

  useFocusEffect(
    useCallback(() => {
      scannedRef.current = false
      setScanned(false)
      setError(null)
    }, []),
  )

  const onBarcodeScanned = useCallback((result: BarcodeScanningResult) => {
    if (scannedRef.current) return
    scannedRef.current = true

    const groupId = extractInviteGroupId(result.data)
    if (!groupId) {
      setScanned(true)
      setError('That QR code is not a SplitStupid invite.')
      return
    }

    setScanned(true)
    navigation.dispatch(StackActions.replace('Invite', { groupId }))
  }, [navigation])

  function scanAgain() {
    scannedRef.current = false
    setError(null)
    setScanned(false)
  }

  if (!permission) {
    return <SafeAreaView style={styles.root} />
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.center}>
          <Text style={styles.title}>Scan invite QR</Text>
          <Text style={styles.copy}>
            Camera access is needed to scan the QR code shown by Share to invite.
          </Text>
          <Button title="Allow camera" onPress={requestPermission} style={{ width: '100%' }} />
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.scanner}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          active={!scanned}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={scanned ? undefined : onBarcodeScanned}
        />
        <View style={styles.overlay}>
          <View style={styles.scanBox} />
          <Text style={styles.hint}>Point the camera at a Share to invite QR.</Text>
        </View>
      </View>
      {error ? (
        <View style={styles.errorWrap}>
          <ErrorBanner message={error} onDismiss={scanAgain} />
          <Button title="Scan again" variant="secondary" onPress={scanAgain} />
        </View>
      ) : null}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: {
    flex: 1,
    justifyContent: 'center',
    padding: space(6),
    gap: space(3),
  },
  title: { fontSize: 26, fontWeight: '600', color: colors.fg, fontFamily: fonts.display },
  copy: { fontSize: 15, lineHeight: 22, color: colors.fgMuted, fontFamily: fonts.sans },
  scanner: {
    flex: 1,
    margin: space(4),
    overflow: 'hidden',
    borderRadius: radius.lg,
    backgroundColor: '#000000',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space(6),
    gap: space(5),
  },
  scanBox: {
    width: 240,
    height: 240,
    maxWidth: '100%',
    borderWidth: 3,
    borderColor: '#ffffff',
    borderRadius: radius.md,
    backgroundColor: 'transparent',
  },
  hint: {
    color: '#ffffff',
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
    fontFamily: fonts.sans,
    textShadowColor: 'rgba(0, 0, 0, 0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  errorWrap: { paddingHorizontal: space(4), paddingBottom: space(4), gap: space(2) },
})
