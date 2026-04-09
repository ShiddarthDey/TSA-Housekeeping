import { useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'

import { RequireAuth, RequireManager, RequireManagerOrSupervisor } from '@/components/RouteGuards'
import Login from '@/pages/Login'
import ManageStaff from '@/pages/ManageStaff'
import ManagerDashboard from '@/pages/ManagerDashboard'
import Productivity from '@/pages/Productivity'
import RoomDetail from '@/pages/RoomDetail'
import RoomsBoard from '@/pages/RoomsBoard'
import StaffManagement from '@/pages/StaffManagement'
import WorkHistory from '@/pages/WorkHistory'
import { useAuthStore } from '@/stores/authStore'

export default function App() {
  const init = useAuthStore((s) => s.init)
  const initialized = useAuthStore((s) => s.initialized)
  const user = useAuthStore((s) => s.user)
  const profile = useAuthStore((s) => s.profile)

  useEffect(() => {
    void init()
  }, [init])

  return (
    <Router>
      <Routes>
        <Route
          path="/"
          element={
            initialized ? (
              user && profile ? (
                <Navigate to={profile.role === 'manager' ? '/dashboard' : '/rooms'} replace />
              ) : (
                <Navigate to="/login" replace />
              )
            ) : (
              <div className="min-h-dvh bg-[#0B1220]" />
            )
          }
        />
        <Route path="/login" element={<Login />} />
        <Route
          path="/rooms"
          element={
            <RequireAuth>
              <RoomsBoard />
            </RequireAuth>
          }
        />
        <Route
          path="/rooms/:roomNumber"
          element={
            <RequireAuth>
              <RoomDetail />
            </RequireAuth>
          }
        />
        <Route
          path="/dashboard"
          element={
            <RequireAuth>
              <RequireManager>
                <ManagerDashboard />
              </RequireManager>
            </RequireAuth>
          }
        />
        <Route
          path="/staff"
          element={
            <RequireAuth>
              <RequireManagerOrSupervisor>
                <StaffManagement />
              </RequireManagerOrSupervisor>
            </RequireAuth>
          }
        />
        <Route
          path="/staff/create"
          element={
            <RequireAuth>
              <RequireManagerOrSupervisor>
                <ManageStaff />
              </RequireManagerOrSupervisor>
            </RequireAuth>
          }
        />
        <Route
          path="/productivity"
          element={
            <RequireAuth>
              <Productivity />
            </RequireAuth>
          }
        />
        <Route
          path="/productivity/:staffId"
          element={
            <RequireAuth>
              <RequireManagerOrSupervisor>
                <Productivity />
              </RequireManagerOrSupervisor>
            </RequireAuth>
          }
        />
        <Route
          path="/work-history"
          element={
            <RequireAuth>
              <RequireManagerOrSupervisor>
                <WorkHistory />
              </RequireManagerOrSupervisor>
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}
