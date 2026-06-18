import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts'
import { getSites, getSensors, getReadings, getWells } from './api'

type Tab = 'river' | 'wells'
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

  const hasWells = WELLS_SITES.includes(selectedSite)
  const effectiveTab: Tab = (!hasWells && activeTab === 'wells') ? 'river' : activeTab
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
            <label className="block text-[11px] font-medium text-stone-400 uppercase tracking-wider mb-1.5">Site</label>
            <select
              className="w-full bg-stone-700 border border-stone-600 rounded-lg px-3 py-2 text-sm text-stone-100 focus:outline-none focus:border-green-500 transition"
              value={selectedSite}
              onChange={e => { setSelectedSite(e.target.value); setActiveTab('wells'); setSelectedSensor('') }}
            >
              <option value="">Select site...</option>
              {sites.map(site => <option key={site} value={site}>{site}</option>)}
            </select>
          </div>

          {hasWells && sensors.length > 0 && (
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

        {selectedSite && (
          <div className="flex flex-col gap-1">
            <label className="block text-[11px] font-medium text-stone-400 uppercase tracking-wider mb-1">Data Source</label>
            {hasWells && (
              <button
                onClick={() => setActiveTab('wells')}
                className={`text-left px-3 py-2 rounded-lg text-sm transition ${effectiveTab === 'wells' ? 'bg-green-800/40 text-green-300 font-medium' : 'text-stone-400 hover:bg-stone-700 hover:text-stone-200'}`}
              >
                Wells / Telemetered
              </button>
            )}
            <button
              onClick={() => setActiveTab('river')}
              className={`text-left px-3 py-2 rounded-lg text-sm transition ${effectiveTab === 'river' ? 'bg-green-800/40 text-green-300 font-medium' : 'text-stone-400 hover:bg-stone-700 hover:text-stone-200'}`}
            >
              River / Combined
            </button>
          </div>
        )}

        <div className="mt-auto text-[10px] text-stone-600">
          IoC Automated Pipeline v1.0
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 p-8 overflow-auto">

        {(!selectedSite || !hasDates || !hasSensor) && (
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

        {selectedSite && hasDates && hasSensor && (
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

            {/* Charts — Wells */}
            {effectiveTab === 'wells' && activeData.length > 0 && (
              <div className="flex flex-col gap-6">
                <ChartCard title="Compensated Level (m)" color="text-sky-400">
                  <ResponsiveContainer width="100%" height={280}>
                    <AreaChart data={chartData}>
                      <defs><linearGradient id="levelGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#0284c7" stopOpacity={0.25} /><stop offset="95%" stopColor="#0284c7" stopOpacity={0} /></linearGradient></defs>
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
                      <defs><linearGradient id="tempGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#15803d" stopOpacity={0.25} /><stop offset="95%" stopColor="#15803d" stopOpacity={0} /></linearGradient></defs>
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
                      <defs><linearGradient id="spcGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#b45309" stopOpacity={0.25} /><stop offset="95%" stopColor="#b45309" stopOpacity={0} /></linearGradient></defs>
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
                      <defs><linearGradient id="gwGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#2dd4bf" stopOpacity={0.25} /><stop offset="95%" stopColor="#2dd4bf" stopOpacity={0} /></linearGradient></defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#44403c" />
                      <XAxis dataKey="reading_datetime" tick={{ fontSize: 10, fill: '#78716c' }} tickFormatter={tickFormat} />
                      <YAxis tick={{ fontSize: 10, fill: '#78716c' }} domain={[(min: number) => min - (min * 0.002), 'dataMax']} tickFormatter={(v: number) => v.toFixed(3)} />
                      <Tooltip contentStyle={tooltipStyle} formatter={tooltipFormatter} />
                      <Area type="monotone" dataKey="gw_elevation_masl" stroke="#2dd4bf" fill="url(#gwGrad)" strokeWidth={1.5} dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </ChartCard>

                <ChartCard title="Barometric Pressure (mbar)" color="text-stone-400">
                  <ResponsiveContainer width="100%" height={280}>
                    <AreaChart data={chartData}>
                      <defs><linearGradient id="baroGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#78716c" stopOpacity={0.25} /><stop offset="95%" stopColor="#78716c" stopOpacity={0} /></linearGradient></defs>
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
            {effectiveTab === 'river' && activeData.length > 0 && (
              <div className="flex flex-col gap-6">
                <ChartCard title="Stage (m)" color="text-sky-400">
                  <ResponsiveContainer width="100%" height={280}>
                    <AreaChart data={chartData}>
                      <defs><linearGradient id="stageGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#0284c7" stopOpacity={0.25} /><stop offset="95%" stopColor="#0284c7" stopOpacity={0} /></linearGradient></defs>
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
                      <defs><linearGradient id="rtempGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#15803d" stopOpacity={0.25} /><stop offset="95%" stopColor="#15803d" stopOpacity={0} /></linearGradient></defs>
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
                      <defs><linearGradient id="rspcGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#b45309" stopOpacity={0.25} /><stop offset="95%" stopColor="#b45309" stopOpacity={0} /></linearGradient></defs>
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
                      <defs><linearGradient id="rbaroGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#78716c" stopOpacity={0.25} /><stop offset="95%" stopColor="#78716c" stopOpacity={0} /></linearGradient></defs>
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
      </main>
    </div>
  )
}
