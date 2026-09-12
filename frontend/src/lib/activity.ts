import type { Delivery } from '../api/types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function parseActivity(data: unknown): { pilot: string; deliveries: Delivery[] } {
  if (!isRecord(data)) {
    return { pilot: '', deliveries: [] }
  }
  const deliveries = Array.isArray(data.deliveries) ? (data.deliveries as Delivery[]) : []
  if (typeof data.pilot === 'string') {
    return { pilot: data.pilot, deliveries }
  }
  if (isRecord(data.pilot) && typeof data.pilot.pilot === 'string') {
    return { pilot: data.pilot.pilot, deliveries }
  }
  return { pilot: '', deliveries }
}
