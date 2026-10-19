import type { SupabaseClient } from '@supabase/supabase-js'
import { toApiError } from '@/services/api/errors'
import { arr, bool, obj, oneOf, str, strOrNull, type Json } from '@/services/api/parse'
import type { Impression, Memory, MemoryDraft, Rarity } from '@/types/game'

const BUCKET = 'memory-photos'
const SIGNED_URL_TTL_S = 3600
const RARITIES = ['common', 'rare', 'epic', 'legendary'] as const satisfies readonly Rarity[]
const IMPRESSIONS = ['liked', 'wow', 'meh'] as const satisfies readonly Impression[]

/** The unlocked building a memory is about (shown in the album). */
export type MemoryPlace = Pick<Memory, 'buildingName' | 'address' | 'rarity'>

/** Album of memories: the player's notes/photos about unlocked buildings (migration 010). */
export interface MemoriesService {
  list(): Promise<Memory[]>
  /** Creates or updates the memory for draft.buildingId; uploads/replaces the photo if given. */
  save(userId: string, draft: MemoryDraft, current: Memory | null, place: MemoryPlace): Promise<Memory>
  remove(buildingId: string): Promise<void>
  /** Short-lived URLs for private photos (path → url). */
  photoUrls(paths: string[]): Promise<Map<string, string>>
}

interface Result {
  data: unknown
  error: unknown
}

async function unwrap(request: PromiseLike<Result>): Promise<unknown> {
  let result: Result
  try {
    result = await request
  } catch (e) {
    throw toApiError(e)
  }
  if (result.error) throw toApiError(result.error)
  return result.data
}

function parseMemory(o: Json, building: Json): Memory {
  return {
    id: str(o, 'id'),
    buildingId: str(o, 'building_id'),
    buildingName: str(building, 'name'),
    address: strOrNull(building, 'address'),
    rarity: oneOf(building, 'rarity', RARITIES),
    note: strOrNull(o, 'note'),
    visitedOn: strOrNull(o, 'visited_on'),
    impression: o.impression === null || o.impression === undefined ? null : oneOf(o, 'impression', IMPRESSIONS),
    isFavorite: bool(o, 'is_favorite'),
    photoPath: strOrNull(o, 'photo_path'),
    updatedAt: str(o, 'updated_at'),
  }
}

const COLUMNS = 'id, building_id, note, visited_on, impression, is_favorite, photo_path, updated_at, buildings(name, address, rarity)'

export class SupabaseMemoriesService implements MemoriesService {
  constructor(
    private readonly client: SupabaseClient,
    /** re-encodes a picked photo (drops EXIF/GPS); injected for tests */
    private readonly preparePhoto: (file: Blob) => Promise<Blob>,
  ) {}

  async list(): Promise<Memory[]> {
    const data = await unwrap(this.client.from('memories').select(COLUMNS).order('updated_at', { ascending: false }))
    return arr(data).flatMap((row) => {
      const o = obj(row, 'memory')
      if (o.buildings === null) return [] // building removed from the catalog
      return [parseMemory(o, obj(o.buildings, 'buildings'))]
    })
  }

  async save(userId: string, draft: MemoryDraft, current: Memory | null, place: MemoryPlace): Promise<Memory> {
    const bucket = this.client.storage.from(BUCKET)
    let uploaded: string | null = null
    if (draft.photo) {
      const image = await this.preparePhoto(draft.photo)
      const path = `${userId}/${crypto.randomUUID()}.${image.type === 'image/webp' ? 'webp' : 'jpg'}`
      const { error } = await bucket.upload(path, image, { contentType: image.type, upsert: false })
      if (error) throw toApiError(error)
      uploaded = path
    }
    const photoPath = uploaded ?? (draft.removePhoto ? null : (current?.photoPath ?? null))

    let saved: Json
    try {
      saved = obj(
        await unwrap(
          this.client.rpc('save_memory', {
            p_building_id: draft.buildingId,
            p_note: draft.note,
            p_visited_on: draft.visitedOn,
            p_impression: draft.impression,
            p_is_favorite: draft.isFavorite,
            p_photo_path: photoPath,
          }),
        ),
        'saved',
      )
    } catch (e) {
      if (uploaded) await bucket.remove([uploaded]) // no orphan photo
      throw e
    }
    const previous = saved.previousPhotoPath
    if (typeof previous === 'string') await bucket.remove([previous]) // best effort
    const memory = obj(saved.memory, 'memory')
    return parseMemory(memory, { name: place.buildingName, address: place.address, rarity: place.rarity })
  }

  async remove(buildingId: string): Promise<void> {
    const path = await unwrap(this.client.rpc('delete_memory', { p_building_id: buildingId }))
    if (typeof path === 'string') await this.client.storage.from(BUCKET).remove([path])
  }

  async photoUrls(paths: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>()
    if (paths.length === 0) return out
    const { data, error } = await this.client.storage.from(BUCKET).createSignedUrls(paths, SIGNED_URL_TTL_S)
    if (error) throw toApiError(error)
    for (const item of data ?? []) if (item.path && item.signedUrl) out.set(item.path, item.signedUrl)
    return out
  }
}
