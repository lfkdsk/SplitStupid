// Auth state for the whole app. The RN counterpart of the boot logic in
// the web's App.tsx: load a stashed token, validate it via GitHub /user,
// expose sign-in / sign-out. Token lives in the Keychain (SecureStore),
// not localStorage; identity + the API client come from @splitstupid/core.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import * as SecureStore from 'expo-secure-store'
import { fetchMe, setApiToken, type GitHubUser } from '@splitstupid/core'
import { signInWithGitHub } from './oauth'

const TOKEN_KEY = 'splitstupid_token'

interface Me {
  login: string
  avatar: string
}

interface AuthState {
  me: Me | null
  booting: boolean
  signingIn: boolean
  error: string | null
  signIn: () => Promise<void>
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
  const [error, setError] = useState<string | null>(null)

  // One-shot boot: pull a stashed token and confirm it still works.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const token = await SecureStore.getItemAsync(TOKEN_KEY)
        if (!token) return
        setApiToken(token)
        const user = await fetchMe(token)
        if (!cancelled) setMe(toMe(user))
      } catch {
        await SecureStore.deleteItemAsync(TOKEN_KEY)
        setApiToken(null)
        if (!cancelled) setError('Stored token rejected — sign in again.')
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
      await SecureStore.setItemAsync(TOKEN_KEY, res.token)
      setApiToken(res.token)
      const user = await fetchMe(res.token)
      setMe(toMe(user))
    } catch (e) {
      setError((e as Error)?.message ?? 'Sign-in failed')
    } finally {
      setSigningIn(false)
    }
  }

  async function signOut() {
    await SecureStore.deleteItemAsync(TOKEN_KEY)
    setApiToken(null)
    setMe(null)
  }

  return (
    <AuthCtx.Provider
      value={{ me, booting, signingIn, error, signIn, signOut, clearError: () => setError(null) }}
    >
      {children}
    </AuthCtx.Provider>
  )
}

function toMe(user: GitHubUser): Me {
  return { login: user.login, avatar: user.avatar_url }
}
