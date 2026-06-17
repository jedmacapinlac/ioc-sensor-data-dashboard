import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://34.211.59.149:8000',
})

export const getSites = () =>
  api.get('/api/sites').then(r => r.data.sites as string[])

export const getSensors = (site: string) =>
  api.get('/api/sensors', { params: { site } }).then(r => r.data.sensors as string[])

export const getReadings = (site: string, start?: string, end?: string) =>
  api.get('/api/readings', { params: { site, start, end } }).then(r => r.data)

export const getWells = (site: string, sensor?: string, start?: string, end?: string) =>
  api.get('/api/wells', { params: { site, sensor, start, end } }).then(r => r.data)
