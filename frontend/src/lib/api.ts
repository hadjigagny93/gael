import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:8000',
})

export default api

export interface Bank {
  id: number
  name: string
  color: string
  column_mapping: Record<string, string> | null
}

export interface Tag {
  id: number
  name: string
  parent_id: number | null
}

export interface Transaction {
  id: number
  statement_id: number
  date: string
  label: string
  amount: string
  currency: string
  verified: boolean
  tags: Tag[]
}

export interface UploadResult {
  statement_id: number
  columns: string[]
  preview: Record<string, string>[]
  total_rows: number
  existing_mapping: Record<string, string> | null
}
