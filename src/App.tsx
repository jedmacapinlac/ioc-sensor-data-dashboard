import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { getSites, getReadings, getWells } from './api'

type Tab = 'river' | 'wells'

const WELLS_SITES = ['KBWOZS']  // sites that have telemetered wells data

export default function App() {
  const [selectedSite, setSelectedSite] = useState<string>('')
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')
  const [activeTab, setActiveTab] = useState<Tab>('river')

  const hasWells = WELLS_SITES.includes(selectedSite)

  const { data: sites = [] } = useQuery({
    queryKey: ['sites'],
    queryFn: getSites,
  })

  const { data: readings = [], isLoading: loadingRiver } = useQuery({
    queryKey: ['readings', selectedSite, startDate, endDate],
    queryFn: () => getReadings(selectedSite, startDate || undefined, endDate || undefined),
    enabled: !!selectedSite && activeTab === 'river',
  })

  const { data: wells = [], isLoading: loadingWells } = useQuery({
    queryKey: ['wells', selectedSite, startDate, endDate],
    queryFn: () => getWells(selectedSite, startDate || undefined, endDate || undefined),
    enabled: !!selectedSite && activeTab === 'wells' && hasWells,
  })

  // if user switches to a non-wells site while on wells tab, snap back to river
  const effectiveTab: Tab = (!hasWells && activeTab === 'wells') ? 'river' : activeTab

  const isLoading = loadingRiver || loadingWells
  const activeData = effectiveTab === 'river' ? readings : wells

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-6xl mx-auto px-6 py-8">

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-blue-400">IoC Stream Team</h1>
          <p className="text-gray-400 mt-1">Groundwater & River Monitoring Dashboard</p>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap gap-6 mb-8 items-end">
          <div>
            <label className="block text-sm text-gray-400 mb-2">Site</label>
            <select
              className="bg-gray-800 border border-gray-700 rounded px-4 py-2 text-white"
              value={selectedSite}
              onChange={e => {
                setSelectedSite(e.target.value)
                setActiveTab('river')  // always reset to river on site change
              }}
            >
              <option value="">-- choose a site --</option>
              {sites.map(site => (
                <option key={site} value={site}>{site}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">Start Date</label>
            <input
              type="date"
              className="bg-gray-800 border border-gray-700 rounded px-4 py-2 text-white"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">End Date</label>
            <input
              type="date"
              className="bg-gray-800 border border-gray-700 rounded px-4 py-2 text-white"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
            />
          </div>

          {(startDate || endDate) && (
            <button
              className="px-4 py-2 text-sm text-gray-400 border border-gray-700 rounded hover:border-gray-500 hover:text-white transition"
              onClick={() => { setStartDate(''); setEndDate('') }}
            >
              Clear dates
            </button>
          )}
        </div>

        {/* Tabs — only show wells tab for WOZS */}
        {selectedSite && (
          <div className="flex gap-2 mb-6">
            <button
              onClick={() => setActiveTab('river')}
              className={`px-5 py-2 rounded-lg text-sm font-medium transition ${
                effectiveTab === 'river'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:text-white'
              }`}
            >
              River / Combined
            </button>
            {hasWells && (
              <button
                onClick={() => setActiveTab('wells')}
                className={`px-5 py-2 rounded-lg text-sm font-medium transition ${
                  effectiveTab === 'wells'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:text-white'
                }`}
              >
                Wells / Telemetered
              </button>
            )}
          </div>
        )}

        {/* Record count */}
        {activeData.length > 0 && (
          <p className="text-gray-500 text-sm mb-6">
            Showing {activeData.length} readings for {selectedSite}
            {startDate && ` from ${startDate}`}
            {endDate && ` to ${endDate}`}
          </p>
        )}

        {/* Stats cards */}
        {activeData.length > 0 && (() => {
          const latest = activeData[activeData.length - 1]
          const fmt = (v: number, d = 3) => v != null ? v.toFixed(d) : 'N/A'
          const min = (arr: number[]) => Math.min(...arr)
          const max = (arr: number[]) => Math.max(...arr)
          const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length

          if (effectiveTab === 'river') {
            const stages = activeData.map((r: any) => r.stage_m).filter((v: any) => v != null)
            const temps = activeData.map((r: any) => r.temp_c_river).filter((v: any) => v != null)
            const spcs = activeData.map((r: any) => r.specific_conductance_ms_cm).filter((v: any) => v != null)
            return (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
                  <p className="text-xs text-gray-500 mb-1">Latest Stage</p>
                  <p className="text-2xl font-bold text-blue-400">{fmt(latest.stage_m)} m</p>
                  <p className="text-xs text-gray-600 mt-1">{latest.reading_datetime.slice(0, 16)}</p>
                </div>
                <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
                  <p className="text-xs text-gray-500 mb-1">Stage Range</p>
                  <p className="text-lg font-bold text-blue-300">{fmt(min(stages))} – {fmt(max(stages))} m</p>
                  <p className="text-xs text-gray-600 mt-1">min / max</p>
                </div>
                <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
                  <p className="text-xs text-gray-500 mb-1">Avg Temperature</p>
                  <p className="text-2xl font-bold text-green-400">{fmt(avg(temps), 1)} °C</p>
                  <p className="text-xs text-gray-600 mt-1">{fmt(min(temps), 1)} – {fmt(max(temps), 1)} range</p>
                </div>
                <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
                  <p className="text-xs text-gray-500 mb-1">Avg Sp. Conductance</p>
                  <p className="text-2xl font-bold text-purple-400">{fmt(avg(spcs), 3)} mS/cm</p>
                  <p className="text-xs text-gray-600 mt-1">{fmt(min(spcs), 3)} – {fmt(max(spcs), 3)} range</p>
                </div>
              </div>
            )
          } else {
            const levels = activeData.map((r: any) => r.compensated_level_m).filter((v: any) => v != null)
            const temps = activeData.map((r: any) => r.temperature_c).filter((v: any) => v != null)
            const spcs = activeData.map((r: any) => r.specific_conductance_ms_cm).filter((v: any) => v != null)
            return (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
                  <p className="text-xs text-gray-500 mb-1">Latest Level</p>
                  <p className="text-2xl font-bold text-blue-400">{fmt(latest.compensated_level_m)} m</p>
                  <p className="text-xs text-gray-600 mt-1">{latest.reading_datetime.slice(0, 16)}</p>
                </div>
                <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
                  <p className="text-xs text-gray-500 mb-1">Level Range</p>
                  <p className="text-lg font-bold text-blue-300">{fmt(min(levels))} – {fmt(max(levels))} m</p>
                  <p className="text-xs text-gray-600 mt-1">min / max</p>
                </div>
                <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
                  <p className="text-xs text-gray-500 mb-1">Avg Temperature</p>
                  <p className="text-2xl font-bold text-green-400">{fmt(avg(temps), 1)} °C</p>
                  <p className="text-xs text-gray-600 mt-1">{fmt(min(temps), 1)} – {fmt(max(temps), 1)} range</p>
                </div>
                <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
                  <p className="text-xs text-gray-500 mb-1">Avg Sp. Conductance</p>
                  <p className="text-2xl font-bold text-purple-400">{fmt(avg(spcs), 3)} mS/cm</p>
                  <p className="text-xs text-gray-600 mt-1">{fmt(min(spcs), 3)} – {fmt(max(spcs), 3)} range</p>
                </div>
              </div>
            )
          }
        })()}

        {/* Loading */}
        {isLoading && <p className="text-gray-400">Loading readings...</p>}

        {/* River charts */}
        {effectiveTab === 'river' && readings.length > 0 && (
          <div className="space-y-8">
            <div className="bg-gray-900 rounded-xl p-6">
              <h2 className="text-lg font-semibold mb-4 text-blue-300">Stage (m)</h2>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={readings}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="reading_datetime" tick={{ fontSize: 10, fill: '#9CA3AF' }} tickFormatter={v => v.slice(5, 16)} />
                  <YAxis tick={{ fontSize: 11, fill: '#9CA3AF' }} />
                  <Tooltip contentStyle={{ backgroundColor: '#1F2937', border: 'none' }} labelFormatter={v => `Time: ${v}`} />
                  <Line type="monotone" dataKey="stage_m" stroke="#60A5FA" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="bg-gray-900 rounded-xl p-6">
              <h2 className="text-lg font-semibold mb-4 text-green-300">Temperature °C</h2>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={readings}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="reading_datetime" tick={{ fontSize: 10, fill: '#9CA3AF' }} tickFormatter={v => v.slice(5, 16)} />
                  <YAxis tick={{ fontSize: 11, fill: '#9CA3AF' }} />
                  <Tooltip contentStyle={{ backgroundColor: '#1F2937', border: 'none' }} />
                  <Line type="monotone" dataKey="temp_c_river" stroke="#34D399" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="bg-gray-900 rounded-xl p-6">
              <h2 className="text-lg font-semibold mb-4 text-purple-300">Specific Conductance (mS/cm)</h2>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={readings}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="reading_datetime" tick={{ fontSize: 10, fill: '#9CA3AF' }} tickFormatter={v => v.slice(5, 16)} />
                  <YAxis tick={{ fontSize: 11, fill: '#9CA3AF' }} />
                  <Tooltip contentStyle={{ backgroundColor: '#1F2937', border: 'none' }} />
                  <Line type="monotone" dataKey="specific_conductance_ms_cm" stroke="#A78BFA" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Wells charts */}
        {effectiveTab === 'wells' && wells.length > 0 && (
          <div className="space-y-8">
            <div className="bg-gray-900 rounded-xl p-6">
              <h2 className="text-lg font-semibold mb-4 text-blue-300">Compensated Level (m)</h2>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={wells}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="reading_datetime" tick={{ fontSize: 10, fill: '#9CA3AF' }} tickFormatter={v => v.slice(5, 16)} />
                  <YAxis tick={{ fontSize: 11, fill: '#9CA3AF' }} />
                  <Tooltip contentStyle={{ backgroundColor: '#1F2937', border: 'none' }} labelFormatter={v => `Time: ${v}`} />
                  <Line type="monotone" dataKey="compensated_level_m" stroke="#60A5FA" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="bg-gray-900 rounded-xl p-6">
              <h2 className="text-lg font-semibold mb-4 text-green-300">Temperature °C</h2>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={wells}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="reading_datetime" tick={{ fontSize: 10, fill: '#9CA3AF' }} tickFormatter={v => v.slice(5, 16)} />
                  <YAxis tick={{ fontSize: 11, fill: '#9CA3AF' }} />
                  <Tooltip contentStyle={{ backgroundColor: '#1F2937', border: 'none' }} />
                  <Line type="monotone" dataKey="temperature_c" stroke="#34D399" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="bg-gray-900 rounded-xl p-6">
              <h2 className="text-lg font-semibold mb-4 text-purple-300">Specific Conductance (mS/cm)</h2>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={wells}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="reading_datetime" tick={{ fontSize: 10, fill: '#9CA3AF' }} tickFormatter={v => v.slice(5, 16)} />
                  <YAxis tick={{ fontSize: 11, fill: '#9CA3AF' }} />
                  <Tooltip contentStyle={{ backgroundColor: '#1F2937', border: 'none' }} />
                  <Line type="monotone" dataKey="specific_conductance_ms_cm" stroke="#A78BFA" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {!isLoading && selectedSite && activeData.length === 0 && (
          <p className="text-gray-500">No readings found for {selectedSite}.</p>
        )}

      </div>
    </div>
  )
}