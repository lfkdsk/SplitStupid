// Auth state for the whole app. The RN counterpart of the boot logic in
// the web's App.tsx: load a stashed token, validate it via GitHub /user,
// expose sign-in / sign-out. Token lives in the Keychain (SecureStore),
// not localStorage; identity + the API client come from @splitstupid/core.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { Platform } from 'react-native'
import * as FileSystem from 'expo-file-system/legacy'
import * as SecureStore from 'expo-secure-store'
import { authWithAppleIdentityToken, authWithGitHubToken, getMe, setApiToken, type AuthMe } from '@splitstupid/core'
import { isAppleSignInAvailable, signInWithApple as requestAppleSignIn } from './apple'
import { signInWithGitHub } from './oauth'

const TOKEN_KEY = 'splitstupid_token'
const SESSION_PREFIX = 'ss1:'
const DEV_TOKEN_URI = FileSystem.documentDirectory ? `${FileSystem.documentDirectory}${TOKEN_KEY}.txt` : null
const ALLOW_FILE_TOKEN_FALLBACK = __DEV__ && Platform.OS === 'ios'

interface Me {
  login: string
  avatar: string
}

interface AuthState {
  me: Me | null
  booting: boolean
  signingIn: boolean
  appleAvailable: boolean
  error: string | null
  signIn: () => Promise<void>
  signInWithApple: () => Promise<void>
  signOut: () => Promise<void>
  clearError: () => void
}

const AuthCtx = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)
  const [booting, setBooting] = useState(true)
  const [signingIn, setSigningIn] = useState(false)
  const [appleAvailable, setAppleAvailable] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    isAppleSignInAvailable().then(setAppleAvailable).catch(() => setAppleAvailable(false))
  }, [])

  // One-shot boot: pull a stashed token and confirm it still works.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const stored = await getStoredToken()
        if (!stored) return
        if (isStoredSession(stored)) {
          const sessionToken = unwrapSessionToken(stored)
          setApiToken(sessionToken)
          const user = await getMe()
          if (!cancelled) setMe(toMe(user))
          return
        }

        const session = await authWithGitHubToken(stored)
        await setStoredToken(wrapSessionToken(session.token))
        setApiToken(session.token)
        if (!cancelled) setMe(toMe(session.me))
      } catch (e) {
        await deleteStoredToken()
        setApiToken(null)
        if (!cancelled) setError((e as Error)?.message || 'Stored session rejected — sign in again.')
      } finally {
        if (!cancelled) setBooting(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function signIn() {
    setSigningIn(true)
    setError(null)
    try {
      const res = await signInWithGitHub()
      if (!res.ok || !res.token) {
        if (res.error && res.error !== 'cancelled') setError(res.error)
        return
      }
      const session = await authWithGitHubToken(res.token)
      await setStoredToken(wrapSessionToken(session.token))
      setApiToken(session.token)
      setMe(toMe(session.me))
    } catch (e) {
      setError((e as Error)?.message ?? 'Sign-in failed')
    } finally {
      setSigningIn(false)
    }
  }

  async function signInWithApple() {
    setSigningIn(true)
    setError(null)
    try {
      const res = await requestAppleSignIn()
      if (!res.ok || !res.identityToken) {
        if (res.error && res.error !== 'cancelled') setError(res.error)
        return
      }
      const session = await authWithAppleIdentityToken({
        identityToken: res.identityToken,
        fullName: res.fullName,
      })
      await setStoredToken(wrapSessionToken(session.token))
      setApiToken(session.token)
      setMe(toMe(session.me))
    } catch (e) {
      setError((e as Error)?.message ?? 'Apple sign-in failed')
    } finally {
      setSigningIn(false)
    }
  }

  async function signOut() {
    await deleteStoredToken()
    setApiToken(null)
    setMe(null)
  }

  return (
    <AuthCtx.Provider
      value={{
        me,
        booting,
        signingIn,
        appleAvailable,
        error,
        signIn,
        signInWithApple,
        signOut,
        clearError: () => setError(null),
      }}
    >
      {children}
    </AuthCtx.Provider>
  )
}

function toMe(user: AuthMe): Me {
  return { login: user.key, avatar: user.avatarUrl || '' }
}

function isStoredSession(token: string): boolean {
  return token.startsWith(SESSION_PREFIX)
}

function wrapSessionToken(token: string): string {
  return SESSION_PREFIX + token
}

function unwrapSessionToken(token: string): string {
  return isStoredSession(token) ? token.slice(SESSION_PREFIX.length) : token
}

async function getStoredToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY)
  } catch (e) {
    if (!canUseFileFallback(e)) throw e
    return readFileToken()
  }
}

async function setStoredToken(token: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(TOKEN_KEY, token)
    await deleteFileToken()
  } catch (e) {
    if (!canUseFileFallback(e)) throw e
    await writeFileToken(token)
  }
}

async function deleteStoredToken(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY)
  } catch (e) {
    if (!canUseFileFallback(e)) throw e
  }
  await deleteFileToken()
}

function canUseFileFallback(e: unknown): boolean {
  return ALLOW_FILE_TOKEN_FALLBACK && isMissingEntitlementError(e)
}

function isMissingEntitlementError(e: unknown): boolean {
  const message = String((e as Error | undefined)?.message ?? e)
  return message.includes("required entitlement isn't present")
}

async function readFileToken(): Promise<string | null> {
  if (!DEV_TOKEN_URI) return null
  try {
    return await FileSystem.readAsStringAsync(DEV_TOKEN_URI)
  } catch {
    return null
  }
}

async function writeFileToken(token: string): Promise<void> {
  if (!DEV_TOKEN_URI) return
  await FileSystem.writeAsStringAsync(DEV_TOKEN_URI, token)
}

async function deleteFileToken(): Promise<void> {
  if (!DEV_TOKEN_URI) return
  try {
    await FileSystem.deleteAsync(DEV_TOKEN_URI, { idempotent: true })
  } catch {
    // Best effort cleanup for the local simulator fallback.
  }
}
