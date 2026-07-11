import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { tryRefresh } from '@/lib/api'
import { useAuthStore } from '@/store/auth'
import { AppShell } from '@/components/layout/AppShell'
import { LoginPage } from '@/pages/LoginPage'
import { RegisterPage } from '@/pages/RegisterPage'
import { PlanPage } from '@/pages/PlanPage'
import { GoalsPage } from '@/pages/GoalsPage'
import { InboxPage } from '@/pages/InboxPage'
import { CalendarPage } from '@/pages/CalendarPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { ActivitiesPage } from '@/pages/ActivitiesPage'
import { GoalDetailPage } from '@/pages/GoalDetailPage'
import { ActivityDetailPage } from '@/pages/ActivityDetailPage'

function AppRoutes() {
  const { status, setStatus } = useAuthStore()

  useEffect(() => {
    tryRefresh().then((ok) => {
      if (!ok) setStatus('unauthenticated')
    })
  }, [setStatus])

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  if (status === 'unauthenticated') {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  return (
    <AppShell>
      <Routes>
        <Route path="/plan"     element={<PlanPage />} />
        <Route path="/inbox"    element={<InboxPage />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/goals"         element={<GoalsPage />} />
        <Route path="/goals/:id"     element={<GoalDetailPage />} />
        <Route path="/activities"    element={<ActivitiesPage />} />
        <Route path="/activities/:id" element={<ActivityDetailPage />} />
        <Route path="/settings"   element={<SettingsPage />} />
        <Route path="/"       element={<Navigate to="/plan" replace />} />
        <Route path="*"       element={<Navigate to="/plan" replace />} />
      </Routes>
    </AppShell>
  )
}

export default function App() {
  return <AppRoutes />
}
