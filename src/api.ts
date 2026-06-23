import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://34.211.59.149',
})

export const getSites = () =>
  api.get('/api/sites').then(r => r.data.sites as string[])

export const getSensors = (site: string) =>
  api.get('/api/sensors', { params: { site } }).then(r => r.data.sensors as string[])

export const getReadings = (site: string, start?: string, end?: string) =>
  api.get('/api/readings', { params: { site, start, end } }).then(r => r.data)

export const getWells = (site: string, sensor?: string, start?: string, end?: string) =>
  api.get('/api/wells', { params: { site, sensor, start, end } }).then(r => r.data)

// Pipeline endpoints

export const getS3Inbox = () =>
  api.get('/api/s3-inbox').then(r => r.data)

export const runMainPipeline = () =>
  api.post('/api/run-main').then(r => r.data)

export const runManualPipeline = (site: string, year: string) =>
  api.post('/api/run-manual', null, { params: { site, year } }).then(r => r.data)

export const getPipelineStatus = (runId: string) =>
  api.get(`/api/pipeline-status/${runId}`).then(r => r.data)

export const getPipelineRuns = () =>
  api.get('/api/pipeline-runs').then(r => r.data)

export const getGdriveFolders = () =>
  api.get('/api/gdrive-folders').then(r => r.data)

export const getGdriveFiles = (sensorType: string, site: string, year: string, folderType: string) =>
  api.get('/api/gdrive-files', { params: { sensor_type: sensorType, site, year, folder_type: folderType } }).then(r => r.data)

// Preview & Download

export const getGdrivePreview = (fileId: string) =>
  api.get('/api/gdrive-preview', { params: { file_id: fileId } }).then(r => r.data)

export const getGdriveDownloadUrl = (fileId: string, filename: string) =>
  `${api.defaults.baseURL}/api/gdrive-download?file_id=${fileId}&filename=${encodeURIComponent(filename)}`

export const getS3Preview = (key: string) =>
  api.get('/api/s3-preview', { params: { key } }).then(r => r.data)

export const getS3DownloadUrl = (key: string) =>
  `${api.defaults.baseURL}/api/s3-download?key=${encodeURIComponent(key)}`
