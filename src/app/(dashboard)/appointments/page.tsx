"use client"

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import {
  CalendarDays,
  Clock,
  UserCheck,
  UserX,
  Plus,
  RefreshCw,
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import type {
  DentalAppointment,
  DentalDoctor,
  DentalAppointmentStatus,
} from '@/lib/dental/types'

// -------------------------------------------------------
// Status badge component
// -------------------------------------------------------
const STATUS_COLORS: Record<DentalAppointmentStatus, string> = {
  scheduled: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  reminder_sent: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  confirmed: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  cancelled: 'bg-red-500/15 text-red-400 border-red-500/30',
  reschedule_requested: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  rescheduled: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30',
  completed: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
  no_show: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
}

const STATUS_LABELS: Record<DentalAppointmentStatus, string> = {
  scheduled: 'Scheduled',
  reminder_sent: 'Reminder Sent',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
  reschedule_requested: 'Reschedule Req.',
  rescheduled: 'Rescheduled',
  completed: 'Completed',
  no_show: 'No Show',
}

function StatusBadge({ status }: { status: DentalAppointmentStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATUS_COLORS[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  )
}

// -------------------------------------------------------
// Stat Card
// -------------------------------------------------------
function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string
  value: number | string
  icon: typeof CalendarDays
  color: string
}) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/30">
      <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg ${color}`}>
        <Icon className="h-6 w-6" />
      </div>
      <div>
        <p className="text-2xl font-bold text-foreground">{value}</p>
        <p className="text-sm text-muted-foreground">{label}</p>
      </div>
    </div>
  )
}

// -------------------------------------------------------
// Create Appointment Dialog
// -------------------------------------------------------
function CreateAppointmentDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: () => void
}) {
  const [doctors, setDoctors] = useState<DentalDoctor[]>([])
  const [patients, setPatients] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [isNewPatient, setIsNewPatient] = useState(false)
  const [newPatientName, setNewPatientName] = useState('')
  const [newPatientPhone, setNewPatientPhone] = useState('')
  const [form, setForm] = useState({
    patient_id: '',
    doctor_id: '',
    date: '',
    time: '',
    duration_minutes: 30,
    treatment_type: '',
    notes: '',
  })

  useEffect(() => {
    if (!open) return
    Promise.all([
      fetch('/api/dental/doctors').then((r) => r.json()),
      fetch('/api/dental/patients').then((r) => r.json()),
    ]).then(([docs, pats]) => {
      setDoctors(docs ?? [])
      setPatients(pats ?? [])
    })
  }, [open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      let patientId = form.patient_id

      // If creating a new patient, do that first
      if (isNewPatient) {
        if (!newPatientName.trim() || !newPatientPhone.trim()) {
          alert('Please enter patient name and phone number')
          setLoading(false)
          return
        }
        const patientRes = await fetch('/api/dental/patients', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            full_name: newPatientName.trim(),
            phone: newPatientPhone.trim(),
          }),
        })
        if (!patientRes.ok) {
          const err = await patientRes.json()
          alert(err.error || 'Failed to create patient')
          setLoading(false)
          return
        }
        const newPatient = await patientRes.json()
        patientId = newPatient.id
      }

      if (!patientId) {
        alert('Please select or create a patient')
        setLoading(false)
        return
      }

      const startsAt = new Date(`${form.date}T${form.time}:00`).toISOString()
      const res = await fetch('/api/dental/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_id: patientId,
          doctor_id: form.doctor_id,
          starts_at: startsAt,
          duration_minutes: form.duration_minutes,
          treatment_type: form.treatment_type || undefined,
          notes: form.notes || undefined,
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        alert(err.error || 'Failed to create')
        return
      }
      onCreated()
      onClose()
      setForm({ patient_id: '', doctor_id: '', date: '', time: '', duration_minutes: 30, treatment_type: '', notes: '' })
      setIsNewPatient(false)
      setNewPatientName('')
      setNewPatientPhone('')
    } catch (err) {
      alert('Failed to create appointment')
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <h2 className="mb-6 text-xl font-bold text-foreground">New Appointment</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Patient section */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="block text-sm font-medium text-muted-foreground">Patient</label>
              <button
                type="button"
                onClick={() => { setIsNewPatient(!isNewPatient); setForm({ ...form, patient_id: '' }) }}
                className="text-xs font-medium text-primary hover:text-primary/80 transition-colors"
              >
                {isNewPatient ? '← Select Existing' : '+ New Patient'}
              </button>
            </div>

            {isNewPatient ? (
              <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-background/50 p-3">
                <input
                  type="text"
                  value={newPatientName}
                  onChange={(e) => setNewPatientName(e.target.value)}
                  placeholder="Patient full name"
                  required
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                />
                <input
                  type="tel"
                  value={newPatientPhone}
                  onChange={(e) => setNewPatientPhone(e.target.value)}
                  placeholder="Phone with country code (e.g. +919876543210)"
                  required
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                />
              </div>
            ) : (
              <select
                value={form.patient_id}
                onChange={(e) => setForm({ ...form, patient_id: e.target.value })}
                required
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              >
                <option value="">Select patient...</option>
                {patients.map((p: any) => (
                  <option key={p.id} value={p.id}>{p.full_name} — {p.phone}</option>
                ))}
              </select>
            )}
          </div>

          {/* Doctor */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-muted-foreground">Doctor</label>
            <select
              value={form.doctor_id}
              onChange={(e) => setForm({ ...form, doctor_id: e.target.value })}
              required
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value="">Select doctor...</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>{d.full_name}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted-foreground">Date</label>
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                required
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted-foreground">Time</label>
              <input
                type="time"
                value={form.time}
                onChange={(e) => setForm({ ...form, time: e.target.value })}
                required
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted-foreground">Duration</label>
              <select
                value={form.duration_minutes}
                onChange={(e) => setForm({ ...form, duration_minutes: parseInt(e.target.value) })}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              >
                <option value={15}>15 min</option>
                <option value={30}>30 min</option>
                <option value={45}>45 min</option>
                <option value={60}>60 min</option>
                <option value={90}>90 min</option>
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-muted-foreground">Treatment</label>
            <input
              type="text"
              value={form.treatment_type}
              onChange={(e) => setForm({ ...form, treatment_type: e.target.value })}
              placeholder="e.g. Regular Checkup"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-muted-foreground">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
          </div>
          <div className="mt-2 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create Appointment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// -------------------------------------------------------
// Main Page
// -------------------------------------------------------

export default function AppointmentsPage() {
  const { profile } = useAuth()
  const [appointments, setAppointments] = useState<DentalAppointment[]>([])
  const [loading, setLoading] = useState(true)
  const [count, setCount] = useState(0)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [page, setPage] = useState(0)
  const [showCreate, setShowCreate] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const pageSize = 20

  const [stats, setStats] = useState({
    total: 0,
    confirmed: 0,
    pending: 0,
    noShow: 0,
  })

  const fetchAppointments = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        limit: String(pageSize),
        offset: String(page * pageSize),
      })
      if (statusFilter !== 'all') params.set('status', statusFilter)

      const res = await fetch(`/api/dental/appointments?${params}`)
      const json = await res.json()
      setAppointments(json.data ?? [])
      setCount(json.count ?? 0)
    } catch (err) {
      console.error('Failed to load appointments:', err)
    } finally {
      setLoading(false)
    }
  }, [page, statusFilter])

  const fetchStats = useCallback(async () => {
    try {
      const [all, confirmed, pending, noshow] = await Promise.all([
        fetch('/api/dental/appointments?limit=0').then((r) => r.json()),
        fetch('/api/dental/appointments?status=confirmed&limit=0').then((r) => r.json()),
        fetch('/api/dental/appointments?status=scheduled&limit=0').then((r) => r.json()),
        fetch('/api/dental/appointments?status=no_show&limit=0').then((r) => r.json()),
      ])
      setStats({
        total: all.count ?? 0,
        confirmed: confirmed.count ?? 0,
        pending: pending.count ?? 0,
        noShow: noshow.count ?? 0,
      })
    } catch {}
  }, [])

  useEffect(() => { fetchAppointments() }, [fetchAppointments])
  useEffect(() => { fetchStats() }, [fetchStats])

  const handleSeed = async () => {
    setSeeding(true)
    try {
      const res = await fetch('/api/dental/seed', { method: 'POST' })
      const json = await res.json()
      if (json.ok) {
        fetchAppointments()
        fetchStats()
      } else {
        alert(json.error || 'Seed failed')
      }
    } catch {
      alert('Seed failed')
    } finally {
      setSeeding(false)
    }
  }

  const formatDateTime = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString('en-GB', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: 'Europe/Amsterdam',
    }) + ' · ' + d.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Europe/Amsterdam',
    })
  }

  const filtered = appointments.filter((a) => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return (
      a.patient?.full_name?.toLowerCase().includes(q) ||
      a.doctor?.full_name?.toLowerCase().includes(q) ||
      a.treatment_type?.toLowerCase().includes(q)
    )
  })

  const totalPages = Math.ceil(count / pageSize)

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">🦷 Appointments</h1>
          <p className="text-sm text-muted-foreground">
            Manage dental appointments, reminders & scheduling
          </p>
        </div>
        <div className="flex gap-2">
          {stats.total === 0 && (
            <button
              onClick={handleSeed}
              disabled={seeding}
              className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${seeding ? 'animate-spin' : ''}`} />
              {seeding ? 'Seeding...' : 'Seed Demo Data'}
            </button>
          )}
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            New Appointment
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total" value={stats.total} icon={CalendarDays} color="bg-primary/10 text-primary" />
        <StatCard label="Confirmed" value={stats.confirmed} icon={UserCheck} color="bg-emerald-500/10 text-emerald-400" />
        <StatCard label="Pending" value={stats.pending} icon={Clock} color="bg-amber-500/10 text-amber-400" />
        <StatCard label="No Shows" value={stats.noShow} icon={UserX} color="bg-red-500/10 text-red-400" />
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search patients, doctors, treatments..."
            className="w-full rounded-lg border border-border bg-background py-2 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(0) }}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
          >
            <option value="all">All Statuses</option>
            <option value="scheduled">Scheduled</option>
            <option value="reminder_sent">Reminder Sent</option>
            <option value="confirmed">Confirmed</option>
            <option value="cancelled">Cancelled</option>
            <option value="completed">Completed</option>
            <option value="no_show">No Show</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Patient</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Doctor</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Date & Time</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Treatment</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Duration</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 6 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 w-24 animate-pulse rounded bg-muted" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                    {stats.total === 0
                      ? 'No appointments yet. Click "Seed Demo Data" to get started.'
                      : 'No appointments match your filters.'}
                  </td>
                </tr>
              ) : (
                filtered.map((appt) => (
                  <tr key={appt.id} className="transition-colors hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium text-foreground">
                      {appt.patient?.full_name ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {appt.doctor?.full_name ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-foreground">
                      {formatDateTime(appt.starts_at)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {appt.treatment_type ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={appt.status} />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {appt.duration_minutes} min
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3">
            <p className="text-sm text-muted-foreground">
              Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, count)} of {count}
            </p>
            <div className="flex gap-1">
              <button
                onClick={() => setPage(Math.max(0, page - 1))}
                disabled={page === 0}
                className="rounded-lg border border-border p-2 text-muted-foreground hover:bg-muted disabled:opacity-50"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                disabled={page >= totalPages - 1}
                className="rounded-lg border border-border p-2 text-muted-foreground hover:bg-muted disabled:opacity-50"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      <CreateAppointmentDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => {
          fetchAppointments()
          fetchStats()
        }}
      />
    </div>
  )
}
