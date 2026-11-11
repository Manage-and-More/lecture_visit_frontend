import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { publicUrl } from '@/lib/public-url'

export async function POST(request: NextRequest) {
  const supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  await supabase.auth.signOut()

  const redirect = NextResponse.redirect(publicUrl(request, '/'))
  // Copy cleared cookies to redirect response
  supabaseResponse.cookies.getAll().forEach((cookie) => {
    redirect.cookies.set(cookie.name, cookie.value)
  })
  return redirect
}
