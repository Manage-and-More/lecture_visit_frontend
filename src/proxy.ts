import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  // Supabase often redirects PKCE email flows to the Site URL root (`/?code=...`).
  // Session exchange lives in `/auth/confirm` — forward so `exchangeCodeForSession` runs.
  if (request.nextUrl.pathname === '/') {
    const { searchParams } = request.nextUrl
    const code = searchParams.get('code')
    const token_hash = searchParams.get('token_hash')
    const type = searchParams.get('type')
    if (code || (token_hash && type)) {
      const url = request.nextUrl.clone()
      url.pathname = '/auth/confirm'
      return NextResponse.redirect(url)
    }
  }

  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refresh session — IMPORTANT: do not use getSession() here,
  // as it reads from cookies without validation. getUser() actually
  // verifies the JWT with Supabase Auth.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Allow public routes (auth pages, landing page). The mail bridge API checks its own
  // Google identity token instead of a login session.
  const isPublicRoute =
    request.nextUrl.pathname.startsWith('/auth') ||
    request.nextUrl.pathname.startsWith('/api/mail/') ||
    request.nextUrl.pathname === '/'

  // Redirect unauthenticated users to login
  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/auth/login'
    return NextResponse.redirect(url)
  }

  // If user is logged in and visits auth-only pages, redirect to app home
  const authOnlyPaths = ['/auth/login', '/auth/signup', '/auth/forgot-password']
  if (user && authOnlyPaths.includes(request.nextUrl.pathname)) {
    const url = request.nextUrl.clone()
    url.pathname = '/scheduled'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico (favicon)
     * - public files (images, etc.)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
