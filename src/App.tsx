import { useState, useMemo, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts'
import { getSites, getSensors, getReadings, getWells, getS3Inbox, runMainPipeline, runManualPipeline, getPipelineStatus, getPipelineRuns, getGdriveFolders, getGdriveFiles, getGdrivePreview, getGdriveDownloadUrl, getS3Preview, getS3DownloadUrl } from './api'

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


function ChartCard({ title, children, color }: { title: string; children: React.ReactNode; color: string }) {
  return (
    <div className="bg-stone-800/60 rounded-2xl p-5 border border-stone-700/50 shadow-2xl shadow-black/40">
      <h3 className={`text-sm font-semibold mb-4 ${color} uppercase tracking-wider`}>{title}</h3>
      {children}
    </div>
  )
}

function DetailCard({ title, dataKey, data, unit, color }: { title: string; dataKey: string; data: any[]; unit: string; color: string }) {
  const values = data.map(r => ({ v: r[dataKey], dt: r.reading_datetime })).filter(r => r.v != null)
  if (!values.length) return null

  const latest = values[values.length - 1]
  const highEntry = values.reduce((a, b) => b.v > a.v ? b : a)
  const lowEntry = values.reduce((a, b) => b.v < a.v ? b : a)
  const avg = values.reduce((s, r) => s + r.v, 0) / values.length
  const range = highEntry.v - lowEntry.v

  const fmtDate = (dt: string) => {
    if (!dt) return ''
    return dt.slice(0, 16).replace('T', ' ')
  }

  return (
    <div className="bg-stone-800/60 rounded-2xl p-4 border border-stone-700/50 shadow-2xl shadow-black/40 flex flex-col min-w-[200px] w-[220px] shrink-0">
      <h3 className={`text-xs font-semibold ${color} uppercase tracking-wider mb-3`}>{title}</h3>
      <div className="space-y-2 text-sm flex-1 flex flex-col justify-evenly">
        <div>
          <p className="text-[10px] text-stone-500 uppercase">Latest</p>
          <p className={`text-xl font-bold ${color}`}>{latest.v.toFixed(3)} <span className="text-xs font-normal text-stone-500">{unit}</span></p>
          <p className="text-[10px] text-stone-600">{fmtDate(latest.dt)}</p>
        </div>
        <hr className="border-stone-700/50" />
        <div className="flex justify-between">
          <div>
            <p className="text-[10px] text-stone-500 uppercase">High</p>
            <p className="text-stone-200 font-medium">{highEntry.v.toFixed(3)}</p>
            <p className="text-[10px] text-stone-600">{fmtDate(highEntry.dt)}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-stone-500 uppercase">Low</p>
            <p className="text-stone-200 font-medium">{lowEntry.v.toFixed(3)}</p>
            <p className="text-[10px] text-stone-600">{fmtDate(lowEntry.dt)}</p>
          </div>
        </div>
        <hr className="border-stone-700/50" />
        <div className="flex justify-between">
          <div>
            <p className="text-[10px] text-stone-500 uppercase">Average</p>
            <p className="text-stone-300">{avg.toFixed(3)}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-stone-500 uppercase">Range</p>
            <p className="text-stone-300">{range.toFixed(3)}</p>
          </div>
        </div>
      </div>
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
  const [pipelineRuns, setPipelineRuns] = useState<any[]>([])
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null)
  const [s3InboxOpen, setS3InboxOpen] = useState(false)
  const [gdriveFilesOpen, setGdriveFilesOpen] = useState(false)
  const [preview, setPreview] = useState<{ title: string; columns: string[]; rows: any[]; totalLines: number } | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

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

  // Poll active run status + refresh runs list
  useEffect(() => {
    if (!activeRunId) return
    const interval = setInterval(async () => {
      try {
        const status = await getPipelineStatus(activeRunId)
        setPipelineRuns(prev => {
          const exists = prev.find(r => r.run_id === status.run_id)
          if (exists) return prev.map(r => r.run_id === status.run_id ? status : r)
          return [status, ...prev]
        })
        if (status.status === 'completed' || status.status === 'failed') {
          setActiveRunId(null)
          queryClient.invalidateQueries({ queryKey: ['s3-inbox'] })
        }
      } catch (e) { /* ignore poll errors */ }
    }, 3000)
    return () => clearInterval(interval)
  }, [activeRunId])

  // Load existing runs on mount
  useEffect(() => {
    if (effectiveTab === 'pipeline') {
      getPipelineRuns().then(setPipelineRuns).catch(() => {})
    }
  }, [effectiveTab])

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

  const tooltipStyle = { backgroundColor: '#292524', border: '1px solid #44403c', borderRadius: '8px', color: '#d6d3d1' }
  const tooltipFormatter = (value: any) => typeof value === 'number' ? value.toFixed(3) : value

  const tickFormat = (v: string) => {
    if (frequency === '15m' || frequency === '1h') return v.slice(11, 16) || v.slice(0, 10)
    return v.slice(0, 10)
  }

  return (
    <div className="min-h-screen bg-stone-900 text-stone-200">

      {/* Top Nav */}
      <nav className="bg-stone-800 border-b border-stone-700 px-8 py-3 flex items-center justify-between sticky top-0 z-40">
        <div>
          <h1 className="text-lg font-bold text-stone-100 tracking-tight">Stream Team</h1>
        </div>

        {/* Tab selector — active tab grows, others shrink */}
        <div className="bg-stone-900/80 rounded-xl p-1 flex items-center justify-center">
          {([['wells', 'Wells'], ['river', 'Rivers'], ['pipeline', 'Pipeline']] as [Tab, string][]).map(([tab, label]) => (
            <button
              key={tab}
              onClick={() => {
                setActiveTab(tab)
                if (tab === 'wells') { setSelectedSite('KBWOZS'); setSelectedSensor('') }
                if (tab === 'river') { setSelectedSite(''); setSelectedSensor('') }
              }}
              className={`rounded-lg font-medium ${
                effectiveTab === tab
                  ? 'bg-green-700 text-green-100'
                  : 'text-stone-500 hover:text-stone-300'
              }`}
              style={{
                padding: effectiveTab === tab ? '10px 32px' : '8px 16px',
                fontSize: effectiveTab === tab ? '14px' : '12px',
                transform: effectiveTab === tab ? 'scale(1.05)' : 'scale(0.95)',
                opacity: effectiveTab === tab ? 1 : 0.6,
                transition: 'all 400ms cubic-bezier(0.34, 1.56, 0.64, 1)',
              }}
            >{label}</button>
          ))}
        </div>

        <p className="text-[10px] text-stone-1000">IoC Automated Pipeline Dashboard</p>
      </nav>

      {/* Main content */}
      <main className="px-8 py-6">

        {/* Inline controls for Wells/Rivers */}
        {effectiveTab !== 'pipeline' && (
          <div key={effectiveTab} className="animate-in bg-stone-800/60 rounded-2xl p-4 border border-stone-700/50 mb-6">
            <div className="flex items-center justify-center gap-4 flex-wrap">
              {effectiveTab === 'river' && (
                <div className="flex items-center gap-2">
                  <label className="text-[11px] font-medium text-stone-500 uppercase tracking-wider">Site</label>
                  <select
                    className="bg-stone-700 border border-stone-600 rounded-lg px-3 py-2 text-sm text-stone-100 focus:outline-none focus:border-green-500 transition"
                    value={selectedSite}
                    onChange={e => { setSelectedSite(e.target.value); setSelectedSensor('') }}
                  >
                    <option value="">Select site...</option>
                    {sites.map(site => <option key={site} value={site}>{site}</option>)}
                  </select>
                </div>
              )}

              {effectiveTab === 'wells' && sensors.length > 0 && (
                <div className="flex items-center gap-2">
                  <label className="text-[11px] font-medium text-stone-500 uppercase tracking-wider">Sensor</label>
                  <select
                    className="bg-stone-700 border border-stone-600 rounded-lg px-3 py-2 text-sm text-stone-100 focus:outline-none focus:border-green-500 transition"
                    value={selectedSensor}
                    onChange={e => setSelectedSensor(e.target.value)}
                  >
                    <option value="">Select sensor...</option>
                    {sensors.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              )}

              <span className="text-stone-700">|</span>

              <div className="flex items-center gap-2">
                <label className="text-[11px] font-medium text-stone-500 uppercase tracking-wider">Start</label>
                <input type="date" className="bg-stone-700 border border-stone-600 rounded-lg px-3 py-2 text-sm text-stone-100 focus:outline-none focus:border-green-500 transition" value={startDate} onChange={e => setStartDate(e.target.value)} />
              </div>

              <div className="flex items-center gap-2">
                <label className="text-[11px] font-medium text-stone-500 uppercase tracking-wider">End</label>
                <input type="date" className="bg-stone-700 border border-stone-600 rounded-lg px-3 py-2 text-sm text-stone-100 focus:outline-none focus:border-green-500 transition" value={endDate} onChange={e => setEndDate(e.target.value)} />
              </div>

              <span className="text-stone-700">|</span>

              <div className="flex items-center gap-1">
                {([['15m', '15m'], ['1h', '1h'], ['1d', '1d'], ['1w', '1w']] as [Frequency, string][]).map(([val, label]) => (
                  <button
                    key={val}
                    onClick={() => setFrequency(val)}
                    className={`px-3 py-2 rounded-lg text-xs font-medium transition ${
                      frequency === val
                        ? 'bg-green-700 text-green-100'
                        : 'bg-stone-700 text-stone-400 hover:text-stone-200'
                    }`}
                  >{label}</button>
                ))}
              </div>

              <span className="text-stone-700">|</span>

              <div className="flex items-center gap-1">
                <button onClick={() => setViewMode('charts')} className={`px-3 py-2 rounded-lg text-xs font-medium transition ${viewMode === 'charts' ? 'bg-green-700 text-green-100' : 'bg-stone-700 text-stone-400 hover:text-stone-200'}`}>Charts</button>
                <button onClick={() => setViewMode('table')} className={`px-3 py-2 rounded-lg text-xs font-medium transition ${viewMode === 'table' ? 'bg-green-700 text-green-100' : 'bg-stone-700 text-stone-400 hover:text-stone-200'}`}>Table</button>
              </div>

              {fullData.length > 0 && (
                <>
                  <span className="text-stone-700">|</span>
                  <div className="flex items-center gap-2">
                    <label className="text-[11px] font-medium text-stone-500 uppercase tracking-wider">Lookup</label>
                    <input type="datetime-local" className="bg-stone-700 border border-stone-600 rounded-lg px-3 py-2 text-sm text-stone-100 focus:outline-none focus:border-green-500 transition" value={lookupDatetime} onChange={e => setLookupDatetime(e.target.value)} />
                    {lookupDatetime && <button className="text-xs text-stone-500 hover:text-stone-300 transition" onClick={() => setLookupDatetime('')}>Clear</button>}
                  </div>
                </>
              )}
            </div>

            {lookupResult && (
              <div className="mt-3 bg-stone-700/50 rounded-lg p-3 text-xs flex justify-center flex-wrap gap-x-6 gap-y-1">
                <span className="text-stone-400">Closest: <span className="text-stone-200">{lookupResult.data.reading_datetime}</span> ({lookupResult.diffMins} min away)</span>
                {Object.entries(lookupResult.data)
                  .filter(([k]) => k !== 'reading_datetime' && k !== 'sensor_id')
                  .map(([k, v]) => (
                    <span key={k} className="text-stone-400">{k}: <span className="text-stone-200">{typeof v === 'number' ? v.toFixed(3) : String(v)}</span></span>
                  ))}
              </div>
            )}
          </div>
        )}

        {/* Data header */}
        {effectiveTab !== 'pipeline' && selectedSite && hasDates && hasSensor && (
          <div className="animate-in">
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

            {/* Table view */}
            {viewMode === 'table' && activeData.length > 0 && (
              <div className="bg-stone-800/60 rounded-2xl border border-stone-700/50 shadow-2xl shadow-black/40 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-stone-700">
                  <p className="text-xs text-stone-500">{activeData.length.toLocaleString()} rows</p>
                  <button
                    onClick={() => {
                      const cols = Object.keys(activeData[0]).filter(k => k !== 'sensor_id')
                      const header = cols.join(',')
                      const rows = activeData.map((row: any) => cols.map(c => {
                        const v = row[c]
                        return typeof v === 'string' && v.includes(',') ? `"${v}"` : String(v ?? '')
                      }).join(','))
                      const csv = [header, ...rows].join('\n')
                      const blob = new Blob([csv], { type: 'text/csv' })
                      const url = URL.createObjectURL(blob)
                      const a = document.createElement('a')
                      a.href = url
                      a.download = `${selectedSite}_${effectiveTab}_${startDate}_${endDate}.csv`
                      a.click()
                      URL.revokeObjectURL(url)
                    }}
                    className="px-3 py-1.5 bg-green-700 hover:bg-green-600 text-green-100 text-xs rounded-lg transition"
                  >Export CSV</button>
                </div>
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
                <div className="flex gap-4">
                  <div className="flex-1">
                    <ChartCard title="Compensated Level (m)" color="text-sky-400">
                      <ResponsiveContainer width="100%" height={360}>
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
                  </div>
                  <DetailCard title="Comp. Level" dataKey="compensated_level_m" data={activeData} unit="m" color="text-sky-400" />
                </div>

                <div className="flex gap-4">
                  <div className="flex-1">
                    <ChartCard title="Temperature (C)" color="text-green-400">
                      <ResponsiveContainer width="100%" height={360}>
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
                  </div>
                  <DetailCard title="Temperature" dataKey="temperature_c" data={activeData} unit="°C" color="text-green-400" />
                </div>

                <div className="flex gap-4">
                  <div className="flex-1">
                    <ChartCard title="Specific Conductance (mS/cm)" color="text-amber-400">
                      <ResponsiveContainer width="100%" height={360}>
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
                  </div>
                  <DetailCard title="Sp. Conductance" dataKey="specific_conductance_ms_cm" data={activeData} unit="mS/cm" color="text-amber-400" />
                </div>

                <div className="flex gap-4">
                  <div className="flex-1">
                    <ChartCard title="GW Elevation (masl)" color="text-teal-400">
                      <ResponsiveContainer width="100%" height={360}>
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
                  </div>
                  <DetailCard title="GW Elevation" dataKey="gw_elevation_masl" data={activeData} unit="masl" color="text-teal-400" />
                </div>

                <div className="flex gap-4">
                  <div className="flex-1">
                    <ChartCard title="Barometric Pressure (mbar)" color="text-stone-400">
                      <ResponsiveContainer width="100%" height={360}>
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
                  <DetailCard title="Baro Pressure" dataKey="barometer_mbar" data={activeData} unit="mbar" color="text-stone-400" />
                </div>
              </div>
            )}

            {/* Charts — River */}
            {viewMode === 'charts' && effectiveTab === 'river' && activeData.length > 0 && (
              <div className="flex flex-col gap-6">
                <div className="flex gap-4">
                  <div className="flex-1">
                    <ChartCard title="Stage (m)" color="text-sky-400">
                      <ResponsiveContainer width="100%" height={360}>
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
                  </div>
                  <DetailCard title="Stage" dataKey="stage_m" data={activeData} unit="m" color="text-sky-400" />
                </div>

                <div className="flex gap-4">
                  <div className="flex-1">
                    <ChartCard title="River Temperature (C)" color="text-green-400">
                      <ResponsiveContainer width="100%" height={360}>
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
                  </div>
                  <DetailCard title="River Temp" dataKey="temp_c_river" data={activeData} unit="°C" color="text-green-400" />
                </div>

                <div className="flex gap-4">
                  <div className="flex-1">
                    <ChartCard title="Baro Temperature (C)" color="text-emerald-400">
                      <ResponsiveContainer width="100%" height={360}>
                        <AreaChart data={chartData}>
                          <defs><linearGradient id="btempGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#059669" stopOpacity={0.5} /><stop offset="100%" stopColor="#059669" stopOpacity={0.05} /></linearGradient></defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#44403c" />
                          <XAxis dataKey="reading_datetime" tick={{ fontSize: 10, fill: '#78716c' }} tickFormatter={tickFormat} />
                          <YAxis tick={{ fontSize: 10, fill: '#78716c' }} domain={[(min: number) => min - (min * 0.002), 'dataMax']} tickFormatter={(v: number) => v.toFixed(3)} />
                          <Tooltip contentStyle={tooltipStyle} formatter={tooltipFormatter} />
                          <Area type="monotone" dataKey="temp_c_baro" stroke="#059669" fill="url(#btempGrad)" strokeWidth={1.5} dot={false} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </ChartCard>
                  </div>
                  <DetailCard title="Baro Temp" dataKey="temp_c_baro" data={activeData} unit="°C" color="text-emerald-400" />
                </div>

                <div className="flex gap-4">
                  <div className="flex-1">
                    <ChartCard title="Specific Conductance (mS/cm)" color="text-amber-400">
                      <ResponsiveContainer width="100%" height={360}>
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
                  </div>
                  <DetailCard title="Sp. Conductance" dataKey="specific_conductance_ms_cm" data={activeData} unit="mS/cm" color="text-amber-400" />
                </div>

                <div className="flex gap-4">
                  <div className="flex-1">
                    <ChartCard title="Barometric Pressure (mbar)" color="text-stone-400">
                      <ResponsiveContainer width="100%" height={360}>
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
                  <DetailCard title="Baro Pressure" dataKey="abs_pres_mbar" data={activeData} unit="mbar" color="text-stone-400" />
                </div>
              </div>
            )}

            {!isLoading && activeData.length === 0 && (
              <p className="text-stone-400 text-center mt-16">No readings found for {selectedSite} in this date range.</p>
            )}
          </div>
        )}

        {effectiveTab === 'pipeline' && (
          <div className="animate-in space-y-6">
            <h2 className="text-xl font-bold text-stone-100">Pipeline Control</h2>

            {/* Section 1: S3 Inbox */}
            <div className="bg-stone-800/60 rounded-2xl p-5 border border-stone-700/50">
              <div className="flex items-center justify-between">
                <button onClick={() => setS3InboxOpen(!s3InboxOpen)} className="flex items-center gap-2 group">
                  <span className="text-stone-500 text-xs transition group-hover:text-stone-300">{s3InboxOpen ? '▼' : '▶'}</span>
                  <h3 className="text-sm font-semibold text-sky-400 uppercase tracking-wider">
                    S3 Inbox — Unprocessed Files {s3Inbox?.count > 0 && `(${s3Inbox.count})`}
                  </h3>
                </button>
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
              {s3InboxOpen && (
                <div className="mt-4">
                  {s3Inbox?.files?.length > 0 ? (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-stone-500 text-xs uppercase tracking-wider">
                          <th className="pb-2">Filename</th>
                          <th className="pb-2">Size</th>
                          <th className="pb-2">Uploaded</th>
                          <th className="pb-2"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {s3Inbox.files.map((f: any) => (
                          <tr key={f.filename} className="border-t border-stone-700/50">
                            <td className="py-2 text-stone-200 font-mono text-xs">{f.filename}</td>
                            <td className="py-2 text-stone-400">{f.size_kb} KB</td>
                            <td className="py-2 text-stone-400">{new Date(f.last_modified).toLocaleString()}</td>
                            <td className="py-2 text-right">
                              <button
                                onClick={async () => {
                                  setPreviewLoading(true)
                                  try {
                                    const data = await getS3Preview(f.filename)
                                    setPreview({ title: f.filename, columns: data.columns, rows: data.rows, totalLines: data.total_lines })
                                  } finally { setPreviewLoading(false) }
                                }}
                                className="text-sky-400 hover:text-sky-300 text-xs mr-3 transition"
                              >Preview</button>
                              <a href={getS3DownloadUrl(f.filename)} className="text-green-400 hover:text-green-300 text-xs transition">Download</a>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="text-stone-500 text-sm">No unprocessed files in the inbox.</p>
                  )}
                </div>
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
              {gdFolderType ? (
                gdriveFiles?.files?.length > 0 ? (
                  <div>
                    <button onClick={() => setGdriveFilesOpen(!gdriveFilesOpen)} className="flex items-center gap-2 group mb-2">
                      <span className="text-stone-500 text-xs transition group-hover:text-stone-300">{gdriveFilesOpen ? '▼' : '▶'}</span>
                      <span className="text-sm text-stone-300">{gdriveFiles.count} file(s)</span>
                    </button>
                    {gdriveFilesOpen && (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-stone-500 text-xs uppercase tracking-wider">
                            <th className="pb-2">Filename</th>
                            <th className="pb-2"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {gdriveFiles.files.map((f: any) => (
                            <tr key={f.id} className="border-t border-stone-700/50">
                              <td className="py-2 text-stone-200 font-mono text-xs">{f.name}</td>
                              <td className="py-2 text-right">
                                <button
                                  onClick={async () => {
                                    setPreviewLoading(true)
                                    try {
                                      const data = await getGdrivePreview(f.id)
                                      setPreview({ title: f.name, columns: data.columns, rows: data.rows, totalLines: data.total_lines })
                                    } finally { setPreviewLoading(false) }
                                  }}
                                  className="text-sky-400 hover:text-sky-300 text-xs mr-3 transition"
                                >Preview</button>
                                <a href={getGdriveDownloadUrl(f.id, f.name)} className="text-green-400 hover:text-green-300 text-xs transition">Download</a>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                ) : (
                  <p className="text-stone-500 text-sm">No files in this folder.</p>
                )
              ) : (
                <p className="text-stone-500 text-sm">Select a type, site, year, and folder to browse files.</p>
              )}
            </div>

            {/* Section 3: Pipeline Runs */}
            <div className="bg-stone-800/60 rounded-2xl p-5 border border-stone-700/50">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-green-400 uppercase tracking-wider">Pipeline Runs</h3>
                {activeRunId && (
                  <div className="flex items-center gap-2 text-xs text-green-400">
                    <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                    Running...
                  </div>
                )}
              </div>
              {pipelineRuns.length > 0 ? (
                <div className="space-y-2">
                  {pipelineRuns.map((run: any) => (
                    <div key={run.run_id} className="border border-stone-700/50 rounded-lg overflow-hidden">
                      <button
                        onClick={() => setExpandedRunId(expandedRunId === run.run_id ? null : run.run_id)}
                        className="w-full flex items-center justify-between px-4 py-3 hover:bg-stone-700/30 transition text-left"
                      >
                        <div className="flex items-center gap-3">
                          <span className={`w-2 h-2 rounded-full ${
                            run.status === 'completed' ? 'bg-green-500' :
                            run.status === 'failed' ? 'bg-red-500' :
                            run.status === 'running' ? 'bg-yellow-500 animate-pulse' :
                            'bg-stone-500'
                          }`} />
                          <span className="text-xs font-mono text-stone-400">{run.run_id}</span>
                          <span className="text-xs text-stone-300 font-medium">{run.pipeline}</span>
                          {run.params?.site && (
                            <span className="text-xs text-stone-500">{run.params.site} ({run.params.year})</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <span className={`text-xs font-medium ${
                            run.status === 'completed' ? 'text-green-400' :
                            run.status === 'failed' ? 'text-red-400' :
                            run.status === 'running' ? 'text-yellow-400' :
                            'text-stone-500'
                          }`}>{run.status}</span>
                          <span className="text-[10px] text-stone-600">{run.started_at?.slice(0, 19).replace('T', ' ')}</span>
                          {run.finished_at && run.started_at && (
                            <span className="text-[10px] text-stone-600">
                              {Math.round((new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) / 1000)}s
                            </span>
                          )}
                          <span className="text-stone-500 text-xs">{expandedRunId === run.run_id ? '▼' : '▶'}</span>
                        </div>
                      </button>
                      {expandedRunId === run.run_id && (
                        <div className="border-t border-stone-700/50 bg-stone-900/50 px-4 py-3 max-h-[300px] overflow-y-auto">
                          {run.error && (
                            <p className="text-red-400 text-xs mb-2">Error: {run.error}</p>
                          )}
                          {run.logs?.length > 0 ? (
                            <pre className="text-[11px] text-stone-400 font-mono whitespace-pre-wrap leading-relaxed">
                              {run.logs.join('\n')}
                            </pre>
                          ) : (
                            <p className="text-stone-600 text-xs">{run.status === 'running' ? 'Logs will appear when the run finishes...' : 'No logs captured.'}</p>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-stone-500 text-sm">No pipeline runs yet. Use the buttons above to start one.</p>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Preview Modal */}
      {(preview || previewLoading) && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-8" onClick={() => { setPreview(null); setPreviewLoading(false) }}>
          <div className="bg-stone-800 rounded-2xl border border-stone-700 shadow-2xl w-full max-w-5xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-stone-700">
              <h3 className="text-sm font-semibold text-stone-200 font-mono">{preview?.title || 'Loading...'}</h3>
              <div className="flex items-center gap-3">
                {preview && <span className="text-xs text-stone-500">Showing {preview.rows.length} of {preview.totalLines} lines</span>}
                <button onClick={() => { setPreview(null); setPreviewLoading(false) }} className="text-stone-400 hover:text-stone-200 text-lg transition">✕</button>
              </div>
            </div>
            <div className="overflow-auto flex-1 p-4">
              {previewLoading && !preview && (
                <p className="text-stone-400 text-center py-8">Loading preview...</p>
              )}
              {preview && (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-stone-500 uppercase tracking-wider">
                      {preview.columns.map(col => <th key={col} className="pb-2 pr-4 whitespace-nowrap">{col}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row: any, i: number) => (
                      <tr key={i} className="border-t border-stone-700/30 hover:bg-stone-700/30">
                        {preview.columns.map(col => (
                          <td key={col} className="py-1.5 pr-4 text-stone-300 whitespace-nowrap">{String(row[col] ?? '')}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
