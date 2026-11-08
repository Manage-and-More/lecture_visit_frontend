import { createRemoteJWKSet, jwtVerify } from 'jose'

// The Apps Script mail bridge authenticates with the Google identity token of the account it
// runs as (ScriptApp.getIdentityToken()). No shared secret exists anywhere.
const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'))

export type BridgeAuth =
  | { ok: true; email: string; audience: string }
  | { ok: false; status: number; error: string }

export async function verifyBridgeRequest(request: Request): Promise<BridgeAuth> {
  const header = request.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) return { ok: false, status: 401, error: 'Missing bearer token' }

  // MAIL_BRIDGE_AUDIENCE pins the token to the bridge script's OAuth client. Until it is set,
  // any Google token for the allowed account is accepted and its audience is reported back.
  const pinnedAudience = process.env.MAIL_BRIDGE_AUDIENCE || undefined
  const allowedEmail = (process.env.MAIL_BRIDGE_EMAIL ?? 'nick.dienemann@manageandmore.de').toLowerCase()

  try {
    const { payload } = await jwtVerify(token, GOOGLE_JWKS, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: pinnedAudience,
    })
    const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : ''
    if (email !== allowedEmail || payload.email_verified !== true) {
      return { ok: false, status: 403, error: `Account ${email || '(none)'} may not use the mail bridge` }
    }
    const audience = Array.isArray(payload.aud) ? payload.aud[0] : (payload.aud ?? '')
    return { ok: true, email, audience }
  } catch (error) {
    return { ok: false, status: 401, error: `Invalid identity token: ${error instanceof Error ? error.message : 'unknown'}` }
  }
}
