import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type')
  const next = searchParams.get('next') ?? '/home'
  // Password resets and invitations both end on the page where the user sets a password
  const destination = type === 'recovery' || type === 'invite' ? '/auth/reset-password' : next

  // Helper to create Supabase server client for this request
  function makeSupabaseClient(response: NextResponse) {
    return createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options)
            )
          },
        },
      }
    )
  }

  // Helper to redirect on success, copying session cookies
  function successRedirect(response: NextResponse) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = destination
    redirectUrl.searchParams.delete('token_hash')
    redirectUrl.searchParams.delete('type')
    redirectUrl.searchParams.delete('code')
    redirectUrl.searchParams.delete('next')

    const redirect = NextResponse.redirect(redirectUrl)
    response.cookies.getAll().forEach((cookie) => {
      redirect.cookies.set(cookie.name, cookie.value)
    })
    return redirect
  }

  // Flow 1: PKCE code exchange (default Supabase email template)
  if (code) {
    const supabaseResponse = NextResponse.next({ request })
    const supabase = makeSupabaseClient(supabaseResponse)
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return successRedirect(supabaseResponse)
  }

  // Flow 2: Token hash verification (custom email template)
  if (token_hash && type) {
    const supabaseResponse = NextResponse.next({ request })
    const supabase = makeSupabaseClient(supabaseResponse)
    const { error } = await supabase.auth.verifyOtp({
      type: type as 'email' | 'magiclink' | 'signup' | 'invite' | 'recovery',
      token_hash,
    })
    if (!error) return successRedirect(supabaseResponse)
  }

  // If something went wrong, redirect to login with error
  const redirectUrl = request.nextUrl.clone()
  redirectUrl.pathname = '/auth/login'
  redirectUrl.searchParams.set('error', 'Could not verify email link. It may have expired.')
  return NextResponse.redirect(redirectUrl)
}
