// iOS-style swipe-to-reveal row. Built on RN-core PanResponder + Animated so
// it needs no native module (react-native-gesture-handler would mean another
// rebuild). Swipe a row left to reveal a destructive action button; tap it to
// fire onAction. Horizontal drags are captured here; vertical ones fall
// through to the enclosing list so scrolling still works.
import { useRef, type ReactNode } from 'react'
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native'
import { fonts, radius } from '../theme'

const ACTION_W = 84
// Delete is red in both themes — the iOS convention, not the app accent.
const DELETE_RED = '#d92d3a'

export function SwipeableRow({
  children,
  actionLabel,
  onAction,
}: {
  children: ReactNode
  actionLabel: string
  onAction: () => void
}) {
  const tx = useRef(new Animated.Value(0)).current
  const open = useRef(false)
  const last = useRef(0)

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderMove: (_, g) => {
        const base = open.current ? -ACTION_W : 0
        let next = base + g.dx
        if (next > 0) next = 0
        if (next < -ACTION_W - 24) next = -ACTION_W - 24
        last.current = next
        tx.setValue(next)
      },
      onPanResponderRelease: () => {
        const willOpen = last.current < -ACTION_W / 2
        open.current = willOpen
        last.current = willOpen ? -ACTION_W : 0
        Animated.spring(tx, { toValue: willOpen ? -ACTION_W : 0, useNativeDriver: true, bounciness: 0 }).start()
      },
    }),
  ).current

  function close() {
    open.current = false
    last.current = 0
    Animated.spring(tx, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start()
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.behind}>
        <Pressable
          style={styles.action}
          onPress={() => {
            close()
            onAction()
          }}
        >
          <Text style={styles.actionText}>{actionLabel}</Text>
        </Pressable>
      </View>
      <Animated.View style={{ width: '100%', transform: [{ translateX: tx }] }} {...pan.panHandlers}>
        {children}
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch', borderRadius: radius.lg, overflow: 'hidden' },
  behind: { position: 'absolute', right: 0, top: 0, bottom: 0, width: ACTION_W },
  action: { flex: 1, backgroundColor: DELETE_RED, alignItems: 'center', justifyContent: 'center' },
  actionText: { color: '#fff', fontSize: 14, fontWeight: '600', fontFamily: fonts.sans },
})
