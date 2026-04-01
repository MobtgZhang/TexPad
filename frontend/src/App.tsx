import type { ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import Login from './pages/Login'
import Register from './pages/Register'
import Projects from './pages/Projects'
import Editor from './pages/Editor'
import Share from './pages/Share'
import { getToken } from './api'

function Private({ children }: { children: ReactNode }) {
  return getToken() ? children : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route
        path="/"
        element={
          <Private>
            <Projects />
          </Private>
        }
      />
      <Route
        path="/p/:projectId"
        element={
          <Private>
            <Editor />
          </Private>
        }
      />
      <Route path="/share/:token" element={<Share />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
