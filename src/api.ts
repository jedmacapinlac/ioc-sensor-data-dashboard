import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://54.218.50.244:8000',
})

export const getSites = () =>
  api.get('/api/sites').then(r => r.data.sites as string[])

export const getReadings = (site: string, start?: string, end?: string) =>
  api.get('/api/readings', { params: { site, start, end } }).then(r => r.data)

export const getWells = (site: string, start?: string, end?: string) =>
  api.get('/api/wells', { params: { site, start, end } }).then(r => r.data)