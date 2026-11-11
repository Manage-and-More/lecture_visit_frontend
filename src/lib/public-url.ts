import type { NextRequest } from 'next/server'

/**
 * Absolute URL for `path` on the host the browser actually used.
 * In route handlers, `request.nextUrl` carries the server's bind address
 * (HOSTNAME=0.0.0.0:3000 in the Docker image), so redirects built from it
 * send users to https://0.0.0.0:3000. Fly's proxy forwards the real host.
 */
export function publicUrl(request: NextRequest, path: string): URL {
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  const proto = request.headers.get('x-forwarded-proto') ?? request.nextUrl.protocol.replace(':', '')
  return new URL(path, host ? `${proto}://${host}` : request.nextUrl.origin)
}
