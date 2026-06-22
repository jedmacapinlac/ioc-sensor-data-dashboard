import { useState, useMemo, useEffect, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts'
import { getSites, getSensors, getReadings, getWells, getS3Inbox, runMainPipeline, runManualPipeline, getPipelineStatus, getPipelineRuns, getGdriveFolders, getGdriveFiles } from './api'

type Tab = 'river' | 'wells' | 'pipeline'
type Frequency = '15m' | '1h' | '1d' | '1w'

const WELLS_SITES = ['KBWOZS']
const MAX_CHART_POINTS = 1000

function downsample<T>(data: T[], maxPoints: number): T[] {
  if (data.length <= maxPoints) return data
  const step = data.length / maxPoints
  const result: T[] = []
  for (let i = 0; i < maxPoints - 1; i++) {
    result.push(data[Math.round(i * step)])
  }
  result.push(data[data.length - 1])
  return result
}

function aggregateByDay(data: any[]): any[] {
  const groups: Record<string, any[]> = {}
  for (const row of data) {
    const day = row.reading_datetime?.slice(0, 10)
    if (!day) continue
    if (!groups[day]) groups[day] = []
    groups[day].push(row)
  }
  return Object.entries(groups).map(([day, rows]) => {
    const result: any = { reading_datetime: day }
    const numericKeys = Object.keys(rows[0]).filter(k => k !== 'reading_datetime' && typeof rows[0][k] === 'number')
    for (const key of numericKeys) {
      const vals = rows.map(r => r[key]).filter((v: any) => v != null)
      result[key] = vals.length ? vals.reduce((a: number, b: number) => a + b, 0) / vals.length : null
    }
    return result
  })
}

function aggregateByWeek(data: any[]): any[] {
  const groups: Record<string, any[]> = {}
  for (const row of data) {
    const dt = row.reading_datetime?.slice(0, 10)
    if (!dt) continue
    const d = new Date(dt)
    const startOfWeek = new Date(d)
    startOfWeek.setDate(d.getDate() - d.getDay())
    const weekKey = startOfWeek.toISOString().slice(0, 10)
    if (!groups[weekKey]) groups[weekKey] = []
    groups[weekKey].push(row)
  }
  return Object.entries(groups).map(([week, rows]) => {
    const result: any = { reading_datetime: week }
    const numericKeys = Object.keys(rows[0]).filter(k => k !== 'reading_datetime' && typeof rows[0][k] === 'number')
    for (const key of numericKeys) {
      const vals = rows.map(r => r[key]).filter((v: any) => v != null)
      result[key] = vals.length ? vals.reduce((a: number, b: number) => a + b, 0) / vals.length : null
    }
    return result
  })
}

function StatCard({ label, value, unit, sub, color }: { label: string; value: string; unit: string; sub?: string; color: string }) {
  return (
    <div className="bg-stone-800/60 rounded-2xl p-5 border border-stone-700/50 hover:border-stone-600 transition shadow-2xl shadow-black/40">
      <p className="text-[11px] font-medium text-stone-500 uppercase tracking-wider mb-2">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value} <span className="text-sm font-normal text-stone-500">{unit}</span></p>
      {sub && <p className="text-xs text-stone-500 mt-1">{sub}</p>}
    </div>
  )
}

function ChartCard({ title, children, color }: { title: string; children: React.ReactNode; color: string }) {
  return (
    <div className="bg-stone-800/60 rounded-2xl p-5 border border-stone-700/50 shadow-2xl shadow-black/40">
      <h3 className={`text-sm font-semibold mb-4 ${color} uppercase tracking-wider`}>{title}</h3>
      {children}
    </div>
  )
}

export default function App() {
  const [selectedSite, setSelectedSite] = useState<string>('')
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')
  const [activeTab, setActiveTab] = useState<Tab>('wells')
  const [frequency, setFrequency] = useState<Frequency>('1h')
  const [selectedSensor, setSelectedSensor] = useState<string>('')
  const [lookupDatetime, setLookupDatetime] = useState<string>('')
  const [viewMode, setViewMode] = useState<'charts' | 'table'>('charts')
  const [activeRunId, setActiveRunId] = useState<string | null>(null)

  const queryClient = useQueryClient()
  const hasWells = WELLS_SITES.includes(selectedSite)
  const effectiveTab: Tab = (activeTab === 'pipeline') ? 'pipeline' : (!hasWells && activeTab === 'wells') ? 'river' : activeTab
  const hasDates = !!startDate && !!endDate
  const hasSensor = effectiveTab === 'river' || !!selectedSensor

  const { data: sites = [] } = useQuery({ queryKey: ['sites'], queryFn: getSites })

  const { data: sensors = [] } = useQuery({
    queryKey: ['sensors', selectedSite],
    queryFn: () => getSensors(selectedSite),
    enabled: !!selectedSite && hasWells,
  })

  const { data: readings = [], isLoading: loadingRiver } = useQuery({
    queryKey: ['readings', selectedSite, startDate, endDate],
    queryFn: () => getReadings(selectedSite, startDate || undefined, endDate || undefined),
    enabled: !!selectedSite && hasDates && effectiveTab === 'river',
  })

  const { data: wells = [], isLoading: loadingWells } = useQuery({
    queryKey: ['wells', selectedSite, selectedSensor, startDate, endDate],
    queryFn: () => getWells(selectedSite, selectedSensor || undefined, startDate || undefined, endDate || undefined),
    enabled: !!selectedSite && hasDates && !!selectedSensor && effectiveTab === 'wells' && hasWells,
  })

  const { data: s3Inbox } = useQuery({
    queryKey: ['s3-inbox'],
    queryFn: getS3Inbox,
    enabled: effectiveTab === 'pipeline',
  })

  // GDrive browser state
  const [gdSensorType, setGdSensorType] = useState('')
  const [gdSite, setGdSite] = useState('')
  const [gdYear, setGdYear] = useState('')
  const [gdFolderType, setGdFolderType] = useState('')

  const { data: gdriveFolders } = useQuery({
    queryKey: ['gdrive-folders'],
    queryFn: getGdriveFolders,
    enabled: effectiveTab === 'pipeline',
  })

  // Derive dropdown options from the folder structure
  const gdSensorTypes = gdriveFolders ? Object.keys(gdriveFolders) : []
  const gdSites = (gdriveFolders && gdSensorType) ? Object.keys(gdriveFolders[gdSensorType] || {}) : []
  const gdYears = (gdriveFolders && gdSensorType && gdSite) ? Object.keys(gdriveFolders[gdSensorType]?.[gdSite] || {}) : []
  const gdFolderTypes = (gdriveFolders && gdSensorType && gdSite && gdYear) ? Object.keys(gdriveFolders[gdSensorType]?.[gdSite]?.[gdYear] || {}) : []

  const { data: gdriveFiles } = useQuery({
    queryKey: ['gdrive-files', gdSensorType, gdSite, gdYear, gdFolderType],
    queryFn: () => getGdriveFiles(gdSensorType, gdSite, gdYear, gdFolderType),
    enabled: !!gdSensorType && !!gdSite && !!gdYear && !!gdFolderType,
  })

  const isLoading = loadingRiver || loadingWells
  const fullData = effectiveTab === 'river' ? readings : wells

  const activeData = useMemo(() => {
    if (!fullData.length) return []
    switch (frequency) {
      case '15m': return fullData
      case '1h': return fullData.filter((_: any, i: number) => i % 4 === 0)
      case '1d': return aggregateByDay(fullData)
      case '1w': return aggregateByWeek(fullData)
      default: return fullData
    }
  }, [fullData, frequency])

  const roundedData = useMemo(() => activeData.map((row: any) => {
    const out: any = {}
    for (const [k, v] of Object.entries(row)) {
      out[k] = typeof v === 'number' ? Math.round(v * 1000) / 1000 : v
    }
    return out
  }), [activeData])

  const chartData = useMemo(() => downsample(roundedData, MAX_CHART_POINTS), [roundedData])

  const lookupResult = useMemo(() => {
    if (!lookupDatetime || !fullData.length) return null
    const target = new Date(lookupDatetime).getTime()
    let closest = fullData[0]
    let closestDiff = Infinity
    for (const row of fullData) {
      const dt = new Date(row.reading_datetime).getTime()
      const diff = Math.abs(dt - target)
      if (diff < closestDiff) {
        closestDiff = diff
        closest = row
      }
    }
    const diffMins = Math.round(closestDiff / 60000)
    return { data: closest, diffMins }
  }, [lookupDatetime, fullData])

  const fmt = (v: number, d = 2) => v != null ? v.toFixed(d) : 'N/A'
  const min = (arr: number[]) => arr.length ? Math.min(...arr) : 0
  const max = (arr: number[]) => arr.length ? Math.max(...arr) : 0
  const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0

  const tooltipStyle = { backgroundColor: '#292524', border: '1px solid #44403c', borderRadius: '8px', color: '#d6d3d1' }
  const tooltipFormatter = (value: any) => typeof value === 'number' ? value.toFixed(3) : value

  const tickFormat = (v: string) => {
    if (frequency === '15m' || frequency === '1h') return v.slice(11, 16) || v.slice(0, 10)
    return v.slice(0, 10)
  }

  return (
    <div className="min-h-screen bg-stone-900 text-stone-200 flex">

      {/* Sidebar */}
      <aside className="w-64 bg-stone-800 p-6 flex flex-col gap-8 shrink-0 shadow-2xl shadow-black/50">
        <div>
          <h1 className="text-lg font-bold text-stone-100 tracking-tight">Stream Team</h1>
          <p className="text-xs text-stone-400 mt-0.5">IoC Sensor Monitoring</p>
        </div>

        <div className="flex flex-col gap-5">
          <div>
            <label className="block text-[11px] font-medium text-stone-400 uppercase tracking-wider mb-1.5">Data Source</label>
            <div className="flex flex-col gap-1">
              <button
                onClick={() => { setActiveTab('wells'); setSelectedSite('KBWOZS'); setSelectedSensor('') }}
                className={`text-left px-3 py-2 rounded-lg text-sm transition ${effectiveTab === 'wells' ? 'bg-green-800/40 text-green-300 font-medium' : 'text-stone-400 hover:bg-stone-700 hover:text-stone-200'}`}
              >
                Wells (KBWOZS)
              </button>
              <button
                onClick={() => { setActiveTab('river'); setSelectedSite(''); setSelectedSensor('') }}
                className={`text-left px-3 py-2 rounded-lg text-sm transition ${effectiveTab === 'river' ? 'bg-green-800/40 text-green-300 font-medium' : 'text-stone-400 hover:bg-stone-700 hover:text-stone-200'}`}
              >
                Rivers
              </button>
              <button
                onClick={() => setActiveTab('pipeline')}
                className={`text-left px-3 py-2 rounded-lg text-sm transition ${effectiveTab === 'pipeline' ? 'bg-green-800/40 text-green-300 font-medium' : 'text-stone-400 hover:bg-stone-700 hover:text-stone-200'}`}
              >
                Pipeline
              </button>
            </div>
          </div>

          {effectiveTab === 'river' && (
            <div>
              <label className="block text-[11px] font-medium text-stone-400 uppercase tracking-wider mb-1.5">Site</label>
              <select
                className="w-full bg-stone-700 border border-stone-600 rounded-lg px-3 py-2 text-sm text-stone-100 focus:outline-none focus:border-green-500 transition"
                value={selectedSite}
                onChange={e => { setSelectedSite(e.target.value); setSelectedSensor('') }}
              >
                <option value="">Select site...</option>
                {sites.map(site => <option key={site} value={site}>{site}</option>)}
              </select>
            </div>
          )}

          {effectiveTab === 'wells' && hasWells && sensors.length > 0 && (
            <div>
              <label className="block text-[11px] font-medium text-stone-400 uppercase tracking-wider mb-1.5">Sensor</label>
              <select
                className="w-full bg-stone-700 border border-stone-600 rounded-lg px-3 py-2 text-sm text-stone-100 focus:outline-none focus:border-green-500 transition"
                value={selectedSensor}
                onChange={e => setSelectedSensor(e.target.value)}
              >
                <option value="">Select sensor...</option>
                {sensors.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className="block text-[11px] font-medium text-stone-400 uppercase tracking-wider mb-1.5">Start Date</label>
            <input type="date" className="w-full bg-stone-700 border border-stone-600 rounded-lg px-3 py-2 text-sm text-stone-100 focus:outline-none focus:border-green-500 transition" value={startDate} onChange={e => setStartDate(e.target.value)} />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-stone-400 uppercase tracking-wider mb-1.5">End Date</label>
            <input type="date" className="w-full bg-stone-700 border border-stone-600 rounded-lg px-3 py-2 text-sm text-stone-100 focus:outline-none focus:border-green-500 transition" value={endDate} onChange={e => setEndDate(e.target.value)} />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-stone-400 uppercase tracking-wider mb-1.5">Sample Frequency</label>
            <div className="grid grid-cols-2 gap-1.5">
              {([['15m', '15 min'], ['1h', '1 hour'], ['1d', '1 day'], ['1w', '1 week']] as [Frequency, string][]).map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => setFrequency(val)}
                  className={`px-2 py-1.5 rounded-lg text-xs font-medium transition ${
                    frequency === val
                      ? 'bg-green-700 text-green-100'
                      : 'bg-stone-700 text-stone-400 hover:text-stone-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>


        {fullData.length > 0 && (
          <div className="flex flex-col gap-2">
            <label className="block text-[11px] font-medium text-stone-400 uppercase tracking-wider">Lookup Point</label>
            <input
              type="datetime-local"
              className="w-full bg-stone-700 border border-stone-600 rounded-lg px-3 py-2 text-sm text-stone-100 focus:outline-none focus:border-green-500 transition"
              value={lookupDatetime}
              onChange={e => setLookupDatetime(e.target.value)}
            />
            {lookupResult && (
              <div className="bg-stone-700/50 rounded-lg p-3 text-xs space-y-1">
                <p className="text-stone-400">
                  Closest: <span className="text-stone-200">{lookupResult.data.reading_datetime}</span>
                </p>
                <p className="text-stone-500">{lookupResult.diffMins} min from requested</p>
                <hr className="border-stone-600 my-1" />
                {Object.entries(lookupResult.data)
                  .filter(([k]) => k !== 'reading_datetime' && k !== 'sensor_id')
                  .map(([k, v]) => (
                    <p key={k} className="flex justify-between">
                      <span className="text-stone-400">{k}</span>
                      <span className="text-stone-200">{typeof v === 'number' ? v.toFixed(3) : String(v)}</span>
                    </p>
                  ))}
              </div>
            )}
            {lookupDatetime && (
              <button className="text-xs text-stone-500 hover:text-stone-300 transition" onClick={() => setLookupDatetime('')}>
                Clear lookup
              </button>
            )}
          </div>
        )}

        <div className="mt-auto text-[10px] text-stone-600">
          IoC Automated Pipeline v1.0
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 p-8 overflow-auto">

        {effectiveTab !== 'pipeline' && (!selectedSite || !hasDates || !hasSensor) && (
          <div className="flex items-center justify-center h-full text-stone-400">
            <div className="text-center">
              <p className="text-xl font-medium text-stone-500 mb-2">
                {!selectedSite ? 'No site selected' : !hasDates ? 'Select a date range' : 'Select a sensor'}
              </p>
              <p className="text-sm text-stone-400">
                {!selectedSite
                  ? 'Choose a site from the sidebar to get started.'
                  : !hasDates
                  ? 'Pick a start and end date to view sensor data.'
                  : 'Choose a sensor from the sidebar to view well data.'}
              </p>
            </div>
          </div>
        )}

        {effectiveTab !== 'pipeline' && selectedSite && hasDates && hasSensor && (
          <>
            {/* Top bar */}
            <div className="flex items-baseline justify-between mb-6">
              <div>
                <h2 className="text-2xl font-bold text-stone-100">{selectedSite}</h2>
                <p className="text-sm text-stone-500 mt-0.5">
                  {effectiveTab === 'wells' ? 'Wells / Telemetered' : 'River / Combined'}
                  {activeData.length > 0 && ` — ${activeData.length.toLocaleString()} points`}
                  {fullData.length !== activeData.length && ` (${fullData.length.toLocaleString()} raw)`}
                </p>
              </div>
              <p className="text-xs text-stone-400">{startDate} to {endDate}</p>
            </div>

            {isLoading && (
              <div className="flex items-center gap-3 text-stone-500 mb-8">
                <div className="w-4 h-4 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
                Loading readings...
              </div>
            )}

            {/* Stats */}
            {activeData.length > 0 && effectiveTab === 'wells' && (() => {
              const latest = activeData[activeData.length - 1]
              const levels = activeData.map((r: any) => r.compensated_level_m).filter((v: any) => v != null)
              const temps = activeData.map((r: any) => r.temperature_c).filter((v: any) => v != null)
              const spcs = activeData.map((r: any) => r.specific_conductance_ms_cm).filter((v: any) => v != null)
              return (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                  <StatCard label="Latest Level" value={fmt(latest.compensated_level_m)} unit="m" sub={latest.reading_datetime?.slice(0, 16)} color="text-sky-400" />
                  <StatCard label="Level Range" value={`${fmt(min(levels))} - ${fmt(max(levels))}`} unit="m" sub="min / max" color="text-sky-300" />
                  <StatCard label="Avg Temperature" value={fmt(avg(temps), 1)} unit="C" sub={`${fmt(min(temps), 1)} - ${fmt(max(temps), 1)} range`} color="text-green-400" />
                  <StatCard label="Avg Sp. Conductance" value={fmt(avg(spcs), 2)} unit="mS/cm" sub={`${fmt(min(spcs), 2)} - ${fmt(max(spcs), 2)} range`} color="text-amber-400" />
                </div>
              )
            })()}

            {activeData.length > 0 && effectiveTab === 'river' && (() => {
              const latest = activeData[activeData.length - 1]
              const stages = activeData.map((r: any) => r.stage_m).filter((v: any) => v != null)
              const temps = activeData.map((r: any) => r.temp_c_river).filter((v: any) => v != null)
              const spcs = activeData.map((r: any) => r.specific_conductance_ms_cm).filter((v: any) => v != null)
              return (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                  <StatCard label="Latest Stage" value={fmt(latest.stage_m)} unit="m" sub={latest.reading_datetime?.slice(0, 16)} color="text-sky-400" />
                  <StatCard label="Stage Range" value={`${fmt(min(stages))} - ${fmt(max(stages))}`} unit="m" sub="min / max" color="text-sky-300" />
                  <StatCard label="Avg Temperature" value={fmt(avg(temps), 1)} unit="C" sub={`${fmt(min(temps), 1)} - ${fmt(max(temps), 1)} range`} color="text-green-400" />
                  <StatCard label="Avg Sp. Conductance" value={fmt(avg(spcs), 2)} unit="mS/cm" sub={`${fmt(min(spcs), 2)} - ${fmt(max(spcs), 2)} range`} color="text-amber-400" />
                </div>
              )
            })()}

            {/* View toggle */}
            {activeData.length > 0 && (
              <div className="flex gap-2 mb-6">
                <button
                  onClick={() => setViewMode('charts')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition ${viewMode === 'charts' ? 'bg-green-700 text-green-100' : 'bg-stone-800 text-stone-400 hover:text-stone-200'}`}
                >
                  Charts
                </button>
                <button
                  onClick={() => setViewMode('table')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition ${viewMode === 'table' ? 'bg-green-700 text-green-100' : 'bg-stone-800 text-stone-400 hover:text-stone-200'}`}
                >
                  Table
                </button>
              </div>
            )}

            {/* Table view */}
            {viewMode === 'table' && activeData.length > 0 && (
              <div className="bg-stone-800/60 rounded-2xl border border-stone-700/50 shadow-2xl shadow-black/40 overflow-hidden">
                <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-stone-800">
                      <tr>
                        {Object.keys(activeData[0]).filter(k => k !== 'sensor_id').map(col => (
                          <th key={col} className="px-4 py-3 text-left text-[11px] font-medium text-stone-400 uppercase tracking-wider whitespace-nowrap border-b border-stone-700">
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {activeData.map((row: any, i: number) => (
                        <tr key={i} className={i % 2 === 0 ? 'bg-stone-800/30' : ''}>
                          {Object.entries(row).filter(([k]) => k !== 'sensor_id').map(([k, v]) => (
                            <td key={k} className="px-4 py-2 text-stone-300 whitespace-nowrap border-b border-stone-800">
                              {typeof v === 'number' ? v.toFixed(3) : String(v ?? '')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Charts — Wells */}
            {viewMode === 'charts' && effectiveTab === 'wells' && activeData.length > 0 && (
              <div className="flex flex-col gap-6">
                <ChartCard title="Compensated Level (m)" color="text-sky-400">
                  <ResponsiveContainer width="100%" height={280}>
                    <AreaChart data={chartData}>
                      <defs><linearGradient id="levelGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#0284c7" stopOpacity={0.5} /><stop offset="100%" stopColor="#0284c7" stopOpacity={0.05} /></linearGradient></defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#44403c" />
                      <XAxis dataKey="reading_datetime" tick={{ fontSize: 10, fill: '#78716c' }} tickFormatter={tickFormat} />
                      <YAxis tick={{ fontSize: 10, fill: '#78716c' }} domain={[(min: number) => min - (min * 0.002), 'dataMax']} tickFormatter={(v: number) => v.toFixed(3)} />
                      <Tooltip contentStyle={tooltipStyle} formatter={tooltipFormatter} labelFormatter={v => `${v}`} />
                      <Area type="monotone" dataKey="compensated_level_m" stroke="#0284c7" fill="url(#levelGrad)" strokeWidth={1.5} dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </ChartCard>

                <ChartCard title="Temperature (C)" color="text-green-400">
                  <ResponsiveContainer width="100%" height={280}>
                    <AreaChart data={chartData}>
                      <defs><linearGradient id="tempGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#15803d" stopOpacity={0.5} /><stop offset="100%" stopColor="#15803d" stopOpacity={0.05} /></linearGradient></defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#44403c" />
                      <XAxis dataKey="reading_datetime" tick={{ fontSize: 10, fill: '#78716c' }} tickFormatter={tickFormat} />
                      <YAxis tick={{ fontSize: 10, fill: '#78716c' }} domain={[(min: number) => min - (min * 0.002), 'dataMax']} tickFormatter={(v: number) => v.toFixed(3)} />
                      <Tooltip contentStyle={tooltipStyle} formatter={tooltipFormatter} />
                      <Area type="monotone" dataKey="temperature_c" stroke="#15803d" fill="url(#tempGrad)" strokeWidth={1.5} dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </ChartCard>

                <ChartCard title="Specific Conductance (mS/cm)" color="text-amber-400">
                  <ResponsiveContainer width="100%" height={280}>
                    <AreaChart data={chartData}>
                      <defs><linearGradient id="spcGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#b45309" stopOpacity={0.5} /><stop offset="100%" stopColor="#b45309" stopOpacity={0.05} /></linearGradient></defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#44403c" />
                      <XAxis dataKey="reading_datetime" tick={{ fontSize: 10, fill: '#78716c' }} tickFormatter={tickFormat} />
                      <YAxis tick={{ fontSize: 10, fill: '#78716c' }} domain={[(min: number) => min - (min * 0.002), 'dataMax']} tickFormatter={(v: number) => v.toFixed(3)} />
                      <Tooltip contentStyle={tooltipStyle} formatter={tooltipFormatter} />
                      <Area type="monotone" dataKey="specific_conductance_ms_cm" stroke="#b45309" fill="url(#spcGrad)" strokeWidth={1.5} dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </ChartCard>

                <ChartCard title="GW Elevation (masl)" color="text-teal-400">
                  <ResponsiveContainer width="100%" height={280}>
                    <AreaChart data={chartData}>
                      <defs><linearGradient id="gwGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#2dd4bf" stopOpacity={0.5} /><stop offset="100%" stopColor="#2dd4bf" stopOpacity={0.05} /></linearGradient></defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#44403c" />
                      <XAxis dataKey="reading_datetime" tick={{ fontSize: 10, fill: '#78716c' }} tickFormatter={tickFormat} />
                      <YAxis tick={{ fontSize: 10, fill: '#78716c' }} domain={[(min: number) => min - (min * 0.002), 'dataMax']} tickFormatter={(v: number) => v.toFixed(3)} />
                      <Tooltip contentStyle={tooltipStyle} formatter={tooltipFormatter} />
                      <Area type="monotone" dataKey="gw_elevation_masl" stroke="#2dd4bf" fill="url(#gwGrad)" strokeWidth={1.5} dot={false} baseValue="dataMin" />
                    </AreaChart>
                  </ResponsiveContainer>
                </ChartCard>

                <ChartCard title="Barometric Pressure (mbar)" color="text-stone-400">
                  <ResponsiveContainer width="100%" height={280}>
                    <AreaChart data={chartData}>
                      <defs><linearGradient id="baroGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#78716c" stopOpacity={0.5} /><stop offset="100%" stopColor="#78716c" stopOpacity={0.05} /></linearGradient></defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#44403c" />
                      <XAxis dataKey="reading_datetime" tick={{ fontSize: 10, fill: '#78716c' }} tickFormatter={tickFormat} />
                      <YAxis tick={{ fontSize: 10, fill: '#78716c' }} domain={[(min: number) => min - (min * 0.002), 'dataMax']} tickFormatter={(v: number) => v.toFixed(3)} />
                      <Tooltip contentStyle={tooltipStyle} formatter={tooltipFormatter} />
                      <Area type="monotone" dataKey="barometer_mbar" stroke="#78716c" fill="url(#baroGrad)" strokeWidth={1.5} dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </ChartCard>
              </div>
            )}

            {/* Charts — River */}
            {viewMode === 'charts' && effectiveTab === 'river' && activeData.length > 0 && (
              <div className="flex flex-col gap-6">
                <ChartCard title="Stage (m)" color="text-sky-400">
                  <ResponsiveContainer width="100%" height={280}>
                    <AreaChart data={chartData}>
                      <defs><linearGradient id="stageGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#0284c7" stopOpacity={0.5} /><stop offset="100%" stopColor="#0284c7" stopOpacity={0.05} /></linearGradient></defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#44403c" />
                      <XAxis dataKey="reading_datetime" tick={{ fontSize: 10, fill: '#78716c' }} tickFormatter={tickFormat} />
                      <YAxis tick={{ fontSize: 10, fill: '#78716c' }} domain={[(min: number) => min - (min * 0.002), 'dataMax']} tickFormatter={(v: number) => v.toFixed(3)} />
                      <Tooltip contentStyle={tooltipStyle} formatter={tooltipFormatter} labelFormatter={v => `${v}`} />
                      <Area type="monotone" dataKey="stage_m" stroke="#0284c7" fill="url(#stageGrad)" strokeWidth={1.5} dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </ChartCard>

                <ChartCard title="Temperature (C)" color="text-green-400">
                  <ResponsiveContainer width="100%" height={280}>
                    <AreaChart data={chartData}>
                      <defs><linearGradient id="rtempGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#15803d" stopOpacity={0.5} /><stop offset="100%" stopColor="#15803d" stopOpacity={0.05} /></linearGradient></defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#44403c" />
                      <XAxis dataKey="reading_datetime" tick={{ fontSize: 10, fill: '#78716c' }} tickFormatter={tickFormat} />
                      <YAxis tick={{ fontSize: 10, fill: '#78716c' }} domain={[(min: number) => min - (min * 0.002), 'dataMax']} tickFormatter={(v: number) => v.toFixed(3)} />
                      <Tooltip contentStyle={tooltipStyle} formatter={tooltipFormatter} />
                      <Area type="monotone" dataKey="temp_c_river" stroke="#15803d" fill="url(#rtempGrad)" strokeWidth={1.5} dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </ChartCard>

                <ChartCard title="Specific Conductance (mS/cm)" color="text-amber-400">
                  <ResponsiveContainer width="100%" height={280}>
                    <AreaChart data={chartData}>
                      <defs><linearGradient id="rspcGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#b45309" stopOpacity={0.5} /><stop offset="100%" stopColor="#b45309" stopOpacity={0.05} /></linearGradient></defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#44403c" />
                      <XAxis dataKey="reading_datetime" tick={{ fontSize: 10, fill: '#78716c' }} tickFormatter={tickFormat} />
                      <YAxis tick={{ fontSize: 10, fill: '#78716c' }} domain={[(min: number) => min - (min * 0.002), 'dataMax']} tickFormatter={(v: number) => v.toFixed(3)} />
                      <Tooltip contentStyle={tooltipStyle} formatter={tooltipFormatter} />
                      <Area type="monotone" dataKey="specific_conductance_ms_cm" stroke="#b45309" fill="url(#rspcGrad)" strokeWidth={1.5} dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </ChartCard>

                <ChartCard title="Barometric Pressure (mbar)" color="text-stone-400">
                  <ResponsiveContainer width="100%" height={280}>
                    <AreaChart data={chartData}>
                      <defs><linearGradient id="rbaroGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#78716c" stopOpacity={0.5} /><stop offset="100%" stopColor="#78716c" stopOpacity={0.05} /></linearGradient></defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#44403c" />
                      <XAxis dataKey="reading_datetime" tick={{ fontSize: 10, fill: '#78716c' }} tickFormatter={tickFormat} />
                      <YAxis tick={{ fontSize: 10, fill: '#78716c' }} domain={[(min: number) => min - (min * 0.002), 'dataMax']} tickFormatter={(v: number) => v.toFixed(3)} />
                      <Tooltip contentStyle={tooltipStyle} formatter={tooltipFormatter} />
                      <Area type="monotone" dataKey="abs_pres_mbar" stroke="#78716c" fill="url(#rbaroGrad)" strokeWidth={1.5} dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </ChartCard>
              </div>
            )}

            {!isLoading && activeData.length === 0 && (
              <p className="text-stone-400 text-center mt-16">No readings found for {selectedSite} in this date range.</p>
            )}
          </>
        )}

        {effectiveTab === 'pipeline' && (
          <div className="space-y-6">
            <h2 className="text-xl font-bold text-stone-100">Pipeline Control</h2>

            {/* Section 1: S3 Inbox */}
            <div className="bg-stone-800/60 rounded-2xl p-5 border border-stone-700/50">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-sky-400 uppercase tracking-wider">S3 Inbox — Unprocessed Files</h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => queryClient.invalidateQueries({ queryKey: ['s3-inbox'] })}
                    className="px-3 py-1.5 bg-stone-700 hover:bg-stone-600 text-stone-300 text-xs rounded-lg transition"
                  >
                    Refresh
                  </button>
                  <button
                    onClick={async () => {
                      if (!confirm('Run the automated pipeline? This will process all files in the inbox.')) return
                      const res = await runMainPipeline()
                      setActiveRunId(res.run_id)
                    }}
                    disabled={!s3Inbox?.files?.length}
                    className="px-3 py-1.5 bg-green-700 hover:bg-green-600 disabled:bg-stone-700 disabled:text-stone-500 text-green-100 text-xs rounded-lg transition"
                  >
                    Run Automated Pipeline
                  </button>
                </div>
              </div>
              {s3Inbox?.files?.length > 0 ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-stone-500 text-xs uppercase tracking-wider">
                      <th className="pb-2">Filename</th>
                      <th className="pb-2">Size</th>
                      <th className="pb-2">Uploaded</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s3Inbox.files.map((f: any) => (
                      <tr key={f.filename} className="border-t border-stone-700/50">
                        <td className="py-2 text-stone-200 font-mono text-xs">{f.filename}</td>
                        <td className="py-2 text-stone-400">{f.size_kb} KB</td>
                        <td className="py-2 text-stone-400">{new Date(f.last_modified).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-stone-500 text-sm">No unprocessed files in the inbox.</p>
              )}
            </div>

            {/* Section 2: Google Drive Browser */}
            <div className="bg-stone-800/60 rounded-2xl p-5 border border-stone-700/50">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-amber-400 uppercase tracking-wider">Google Drive Browser</h3>
                <button
                  onClick={async () => {
                    if (!gdSite || !gdYear) return
                    if (!confirm(`Run manual pipeline for ${gdSite} (${gdYear})?`)) return
                    const res = await runManualPipeline(gdSite, gdYear)
                    setActiveRunId(res.run_id)
                  }}
                  disabled={!gdSite || !gdYear}
                  className="px-3 py-1.5 bg-green-700 hover:bg-green-600 disabled:bg-stone-700 disabled:text-stone-500 text-green-100 text-xs rounded-lg transition"
                >
                  Run Manual Pipeline
                </button>
              </div>

              {/* Cascading dropdowns */}
              <div className="grid grid-cols-4 gap-3 mb-4">
                <div>
                  <label className="block text-[11px] font-medium text-stone-500 uppercase tracking-wider mb-1">Type</label>
                  <select
                    className="w-full bg-stone-700 border border-stone-600 rounded-lg px-2 py-1.5 text-sm text-stone-100 focus:outline-none focus:border-amber-500 transition"
                    value={gdSensorType}
                    onChange={e => { setGdSensorType(e.target.value); setGdSite(''); setGdYear(''); setGdFolderType('') }}
                  >
                    <option value="">Select...</option>
                    {gdSensorTypes.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-stone-500 uppercase tracking-wider mb-1">Site</label>
                  <select
                    className="w-full bg-stone-700 border border-stone-600 rounded-lg px-2 py-1.5 text-sm text-stone-100 focus:outline-none focus:border-amber-500 transition"
                    value={gdSite}
                    onChange={e => { setGdSite(e.target.value); setGdYear(''); setGdFolderType('') }}
                    disabled={!gdSensorType}
                  >
                    <option value="">Select...</option>
                    {gdSites.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-stone-500 uppercase tracking-wider mb-1">Year</label>
                  <select
                    className="w-full bg-stone-700 border border-stone-600 rounded-lg px-2 py-1.5 text-sm text-stone-100 focus:outline-none focus:border-amber-500 transition"
                    value={gdYear}
                    onChange={e => { setGdYear(e.target.value); setGdFolderType('') }}
                    disabled={!gdSite}
                  >
                    <option value="">Select...</option>
                    {gdYears.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-stone-500 uppercase tracking-wider mb-1">Folder</label>
                  <select
                    className="w-full bg-stone-700 border border-stone-600 rounded-lg px-2 py-1.5 text-sm text-stone-100 focus:outline-none focus:border-amber-500 transition"
                    value={gdFolderType}
                    onChange={e => setGdFolderType(e.target.value)}
                    disabled={!gdYear}
                  >
                    <option value="">Select...</option>
                    {gdFolderTypes.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
              </div>

              {/* File list */}
              {gdFolderType && gdriveFiles?.files?.length > 0 ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-stone-500 text-xs uppercase tracking-wider">
                      <th className="pb-2">Filename</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gdriveFiles.files.map((f: any) => (
                      <tr key={f.id} className="border-t border-stone-700/50">
                        <td className="py-2 text-stone-200 font-mono text-xs">{f.name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : gdFolderType ? (
                <p className="text-stone-500 text-sm">No files in this folder.</p>
              ) : (
                <p className="text-stone-500 text-sm">Select a type, site, year, and folder to browse files.</p>
              )}
            </div>

            {/* Section 3: Pipeline Runs */}
            <div className="bg-stone-800/60 rounded-2xl p-5 border border-stone-700/50">
              <h3 className="text-sm font-semibold text-green-400 uppercase tracking-wider mb-4">Pipeline Runs</h3>
              <p className="text-stone-500 text-sm">Coming next...</p>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
