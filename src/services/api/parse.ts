import { ApiError } from './errors'

/** Tiny runtime readers for untyped JSON coming from PostgREST/RPC. */

export type Json = Record<string, unknown>

function fail(path: string, expected: string): never {
  throw new ApiError('invalid_response', `${path}: expected ${expected}`)
}

export function obj(value: unknown, path = 'value'): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path, 'object')
  return value as Json
}

export function arr(value: unknown, path = 'value'): unknown[] {
  if (!Array.isArray(value)) fail(path, 'array')
  return value
}

export function str(o: Json, key: string): string {
  const v = o[key]
  if (typeof v !== 'string') fail(key, 'string')
  return v
}

export function strOrNull(o: Json, key: string): string | null {
  const v = o[key]
  if (v === null || v === undefined) return null
  if (typeof v !== 'string') fail(key, 'string|null')
  return v
}

export function num(o: Json, key: string): number {
  const v = o[key]
  // bigint columns arrive as strings from PostgREST
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  if (typeof n !== 'number' || !Number.isFinite(n)) fail(key, 'number')
  return n
}

export function numOrNull(o: Json, key: string): number | null {
  const v = o[key]
  if (v === null || v === undefined) return null
  return num(o, key)
}

export function bool(o: Json, key: string): boolean {
  const v = o[key]
  if (typeof v !== 'boolean') fail(key, 'boolean')
  return v
}

export function oneOf<T extends string>(o: Json, key: string, allowed: readonly T[]): T {
  const v = str(o, key)
  if (!(allowed as readonly string[]).includes(v)) fail(key, allowed.join('|'))
  return v as T
}
