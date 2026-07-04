import * as AppleAuthentication from 'expo-apple-authentication'

export interface AppleSignInResult {
  ok: boolean
  identityToken: string | null
  fullName: string | null
  error: string | null
}

export async function isAppleSignInAvailable(): Promise<boolean> {
  try {
    return await AppleAuthentication.isAvailableAsync()
  } catch {
    return false
  }
}

export async function signInWithApple(): Promise<AppleSignInResult> {
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    })
    if (!credential.identityToken) {
      return { ok: false, identityToken: null, fullName: null, error: 'Apple returned no identity token' }
    }
    return {
      ok: true,
      identityToken: credential.identityToken,
      fullName: formatFullName(credential.fullName),
      error: null,
    }
  } catch (e) {
    if ((e as { code?: string })?.code === 'ERR_REQUEST_CANCELED') {
      return { ok: false, identityToken: null, fullName: null, error: 'cancelled' }
    }
    return { ok: false, identityToken: null, fullName: null, error: (e as Error)?.message || 'Apple sign-in failed' }
  }
}

function formatFullName(name: AppleAuthentication.AppleAuthenticationFullName | null): string | null {
  if (!name) return null
  const parts = [name.givenName, name.middleName, name.familyName].filter(Boolean)
  return parts.length ? parts.join(' ') : null
}
