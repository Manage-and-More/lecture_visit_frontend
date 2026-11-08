'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff, Mail } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [mode, setMode] = useState<'password' | 'magic-link'>('password')
  const [status, setStatus] = useState<'idle' | 'loading' | 'sent' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState('')

  function switchMode(newMode: 'password' | 'magic-link') {
    setMode(newMode)
    setStatus('idle')
    setErrorMessage('')
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('loading')
    setErrorMessage('')

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setStatus('error')
      if (
        error.message.toLowerCase().includes('email not confirmed') ||
        error.code === 'email_not_confirmed'
      ) {
        setErrorMessage('Please check your email and confirm your account before logging in.')
      } else {
        setErrorMessage('Invalid email or password.')
      }
    } else {
      router.push('/outreach')
      router.refresh()
    }
  }

  async function handleMagicLinkSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('loading')
    setErrorMessage('')

    const supabase = createClient()
    const origin = window.location.origin
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${origin}/auth/confirm`,
      },
    })

    if (error) {
      setStatus('error')
      setErrorMessage(error.message)
    } else {
      setStatus('sent')
    }
  }

  if (status === 'sent') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <CardTitle className="text-xl">Lecture Visit</CardTitle>
          </CardHeader>
          <CardContent className="text-center space-y-2">
            <Mail className="h-10 w-10 mx-auto text-muted-foreground" />
            <p className="text-sm font-medium">Check your email</p>
            <p className="text-sm text-muted-foreground">
              We sent a login link to{' '}
              <span className="font-medium text-foreground">{email}</span>
            </p>
            <button
              type="button"
              onClick={() => switchMode('password')}
              className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              Sign in with password instead
            </button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Lecture Visit</CardTitle>
          <CardDescription>Sign in to your account</CardDescription>
        </CardHeader>

        {mode === 'password' ? (
          <form onSubmit={handlePasswordSubmit}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-medium">
                  Email
                </label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                  disabled={status === 'loading'}
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="password" className="text-sm font-medium">
                  Password
                </label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    disabled={status === 'loading'}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <Link
                  href="/auth/forgot-password"
                  className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
                >
                  Forgot your password?
                </Link>
              </div>

              {status === 'error' && (
                <p className="text-sm text-red-500">{errorMessage}</p>
              )}
            </CardContent>

            <CardFooter className="flex flex-col gap-4">
              <Button
                type="submit"
                className="w-full bg-black hover:bg-black/90 text-white"
                disabled={status === 'loading'}
              >
                {status === 'loading' ? 'Signing in...' : 'Log in'}
              </Button>
              <button
                type="button"
                onClick={() => switchMode('magic-link')}
                className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
              >
                Sign in with a magic link instead
              </button>
              <p className="text-sm text-muted-foreground text-center">
                Don&apos;t have an account?{' '}
                <Link
                  href="/auth/signup"
                  className="underline underline-offset-4 hover:text-foreground"
                >
                  Sign up
                </Link>
              </p>
            </CardFooter>
          </form>
        ) : (
          <form onSubmit={handleMagicLinkSubmit}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="email-magic" className="text-sm font-medium">
                  Email
                </label>
                <Input
                  id="email-magic"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                  disabled={status === 'loading'}
                />
              </div>

              {status === 'error' && (
                <p className="text-sm text-red-500">{errorMessage}</p>
              )}
            </CardContent>

            <CardFooter className="flex flex-col gap-4">
              <Button
                type="submit"
                className="w-full bg-black hover:bg-black/90 text-white"
                disabled={status === 'loading'}
              >
                {status === 'loading' ? 'Sending...' : 'Send magic link'}
              </Button>
              <button
                type="button"
                onClick={() => switchMode('password')}
                className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
              >
                Sign in with password instead
              </button>
              <p className="text-sm text-muted-foreground text-center">
                Don&apos;t have an account?{' '}
                <Link
                  href="/auth/signup"
                  className="underline underline-offset-4 hover:text-foreground"
                >
                  Sign up
                </Link>
              </p>
            </CardFooter>
          </form>
        )}
      </Card>
    </div>
  )
}
