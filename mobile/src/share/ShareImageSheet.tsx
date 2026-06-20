import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { WebView } from 'react-native-webview'
import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import type { Balance, Group, Transfer } from '@splitstupid/core'
import { Button, ErrorBanner } from '../components/ui'
import { colors, fonts, radius, space } from '../theme'
import { RECEIPT_HTML } from './receiptHtml'

// Renders the receipt PNG by running the web app's canvas code inside an
// offscreen WebView (see webview/receipt-entry.ts), shows it as a preview,
// then shares the file via the OS sheet. The WebView is the "second render
// path" the B+WebView decision accepts — kept 1×1 and invisible; only its
// output (the PNG) is shown.
type Phase = 'rendering' | 'ready' | 'error'

export function ShareImageSheet({
  open,
  onClose,
  kind = 'receipt',
  group,
  balances,
  transfers,
}: {
  open: boolean
  onClose: () => void
  kind?: 'receipt' | 'postcard'
  group: Group
  balances: Balance[]
  transfers: Transfer[]
}) {
  const webRef = useRef<WebView>(null)
  const [phase, setPhase] = useState<Phase>('rendering')
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)

  // Reset each time the sheet opens so re-shares re-render fresh.
  useEffect(() => {
    if (open) {
      setPhase('rendering')
      setDataUrl(null)
      setError(null)
    }
  }, [open])

  function handleMessage(raw: string) {
    let msg: { type: string; dataUrl?: string; message?: string }
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    if (msg.type === 'ready') {
      webRef.current?.postMessage(
        JSON.stringify(kind === 'postcard' ? { kind: 'postcard', group } : { kind: 'receipt', group, balances, transfers }),
      )
    } else if (msg.type === 'png' && msg.dataUrl) {
      setDataUrl(msg.dataUrl)
      setPhase('ready')
    } else if (msg.type === 'error') {
      setError(msg.message ?? 'render failed')
      setPhase('error')
    }
  }

  async function share() {
    if (!dataUrl) return
    setSharing(true)
    try {
      const base64 = dataUrl.split(',')[1] ?? ''
      const fileUri = `${FileSystem.cacheDirectory}${kind}-${group.id}.png`
      await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: FileSystem.EncodingType.Base64 })
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, { mimeType: 'image/png', dialogTitle: `${group.name} — ${kind}` })
      } else {
        setError('Sharing is not available on this device')
      }
    } catch (e) {
      setError((e as Error)?.message ?? 'Failed to share')
    } finally {
      setSharing(false)
    }
  }

  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.head}>
            <Text style={styles.title}>{kind === 'postcard' ? 'Trip postcard' : 'Receipt'}</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={styles.close}>✕</Text>
            </Pressable>
          </View>

          {error ? <ErrorBanner message={error} onDismiss={() => setError(null)} /> : null}

          <View style={styles.preview}>
            {phase === 'rendering' && <ActivityIndicator color={colors.accent} />}
            {phase === 'ready' && dataUrl && (
              <Image source={{ uri: dataUrl }} style={styles.image} resizeMode="contain" />
            )}
          </View>

          <Button title="Share image" onPress={share} loading={sharing} disabled={phase !== 'ready'} />

          {/* Offscreen renderer — never visibly shown. */}
          {open && (
            <View style={styles.hidden} pointerEvents="none">
              <WebView
                ref={webRef}
                originWhitelist={['*']}
                source={{ html: RECEIPT_HTML }}
                onMessage={e => handleMessage(e.nativeEvent.data)}
                javaScriptEnabled
                // Avatars (postcard) load cross-origin; allow it.
                mixedContentMode="always"
              />
            </View>
          )}
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(26,20,16,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: space(4),
    gap: space(3),
    maxHeight: '88%',
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 18, fontWeight: '600', color: colors.fg, fontFamily: fonts.display },
  close: { fontSize: 18, color: colors.fgMuted },
  preview: {
    minHeight: 240,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgSubtle,
    borderRadius: radius.md,
    padding: space(3),
  },
  image: { width: '100%', height: 360 },
  hidden: { position: 'absolute', width: 1, height: 1, opacity: 0, left: -9999 },
})
