import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Zap } from 'lucide-react'
import { authApi, ApiError } from '@/lib/api'
import { useAuthStore } from '@/store/auth'
import { isNative, getServerUrl, setServerUrl } from '@/lib/server-config'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'

export function LoginPage() {
  const navigate = useNavigate()
  const setAuth = useAuthStore((s) => s.setAuth)
  const [serverUrl, setServerUrlState] = useState(getServerUrl)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const data = await authApi.login(username, password)
      setAuth(data.accessToken, data.user)
      navigate('/plan', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-background p-8">
        <div className="mb-6 flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Zap className="h-4 w-4" strokeWidth={2.5} />
          </div>
          <span className="text-base font-semibold tracking-tight text-foreground">Stryde</span>
        </div>
        <h1 className="mb-1 text-xl font-semibold text-foreground">Sign in</h1>
        <p className="mb-6 text-sm text-muted-foreground">Welcome back. Enter your credentials to continue.</p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {isNative() && (
            <Field
              label="Server URL"
              type="url"
              placeholder="http://192.168.1.100:8080"
              value={serverUrl}
              onChange={(e) => setServerUrlState(e.target.value)}
              onBlur={() => setServerUrl(serverUrl)}
              autoComplete="off"
            />
          )}
          <Field
            label="Username"
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
          <Field
            label="Password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" loading={loading} className="w-full mt-1">
            Sign in
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            No account?{' '}
            <Link to="/register" className="text-primary hover:underline">
              Create one
            </Link>
          </p>
        </form>
      </div>
    </div>
  )
}
