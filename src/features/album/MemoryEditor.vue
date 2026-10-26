<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import type { MemoryPlace } from '@/services/memories/memoriesService'
import { useMemoriesStore } from '@/stores/memories'
import type { Impression, Memory } from '@/types/game'
import { useScrollLock } from '@/utils/scrollLock'
import MemorySticker from './MemorySticker.vue'

// the page behind stays still while this is open
useScrollLock()

/** Bottom sheet: create/edit the memory of an unlocked building. */
const props = defineProps<{
  buildingId: string
  place: MemoryPlace
  /** the building's photo shown elsewhere (scan photo / catalog image), used when the memory has none */
  fallbackPhoto?: string | null
}>()
const emit = defineEmits<{ close: []; saved: [memory: Memory] }>()

// opens with a slide up (CSS, on mount); closing plays the slide down first, then tells the parent
const LEAVE_MS = 260
const leaving = ref(false)
let leaveTimer: ReturnType<typeof setTimeout> | null = null
function close(): void {
  if (leaving.value) return
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduced) return emit('close')
  leaving.value = true
  leaveTimer = setTimeout(() => emit('close'), LEAVE_MS)
}
onBeforeUnmount(() => {
  if (leaveTimer) clearTimeout(leaveTimer)
})

const memories = useMemoriesStore()
const current = computed(() => memories.byBuilding.get(props.buildingId) ?? null)

const today = new Date().toISOString().slice(0, 10)
const note = ref(current.value?.note ?? '')
const visitedOn = ref(current.value?.visitedOn ?? today)
const impression = ref<Impression | null>(current.value?.impression ?? null)
const isFavorite = ref(current.value?.isFavorite ?? false)
const photo = ref<File | null>(null)
const removePhoto = ref(false)
const saving = ref(false)
const deleting = ref(false)
const error = ref<string | null>(null)

const localPreview = ref<string | null>(null)
/** the memory's own photo (picked now or saved before) */
const ownPhoto = computed(() => {
  if (localPreview.value) return localPreview.value
  if (removePhoto.value || !current.value?.photoPath) return null
  return memories.photoUrls.get(current.value.photoPath) ?? null
})
// one photo per building: without its own photo the memory shows the same image as the card
const preview = computed(() => ownPhoto.value ?? props.fallbackPhoto ?? null)

const IMPRESSIONS: { value: Impression; label: string }[] = [
  { value: 'liked', label: 'Понравилось' },
  { value: 'wow', label: 'Вау' },
  { value: 'meh', label: 'Не впечатлило' },
]

const ERRORS: Record<string, string> = {
  building_locked: 'Сначала откройте это здание сканированием.',
  invalid_photo: 'Не удалось прикрепить фото, попробуйте другое.',
  invalid_memory: 'Проверьте заметку (до 2000 символов) и дату.',
  offline: 'Нет сети — воспоминание не сохранено.',
}

function pickPhoto(event: Event): void {
  const file = (event.target as HTMLInputElement).files?.[0] ?? null
  if (!file) return
  if (localPreview.value) URL.revokeObjectURL(localPreview.value)
  photo.value = file
  removePhoto.value = false
  localPreview.value = URL.createObjectURL(file)
}

function dropPhoto(): void {
  if (localPreview.value) URL.revokeObjectURL(localPreview.value)
  localPreview.value = null
  photo.value = null
  removePhoto.value = true
}

async function save(): Promise<void> {
  saving.value = true
  error.value = null
  try {
    const saved = await memories.save(
      {
        buildingId: props.buildingId,
        note: note.value,
        visitedOn: visitedOn.value || null,
        impression: impression.value,
        isFavorite: isFavorite.value,
        photo: photo.value,
        removePhoto: removePhoto.value,
      },
      props.place,
    )
    emit('saved', saved)
    close()
  } catch (e) {
    const code = e instanceof Error && 'code' in e ? String((e as { code: unknown }).code) : ''
    error.value = ERRORS[code] ?? 'Не удалось сохранить, попробуйте ещё раз.'
  } finally {
    saving.value = false
  }
}

async function remove(): Promise<void> {
  deleting.value = true
  error.value = null
  try {
    await memories.remove(props.buildingId)
    close()
  } catch {
    error.value = 'Не удалось удалить, попробуйте ещё раз.'
  } finally {
    deleting.value = false
  }
}

onBeforeUnmount(() => {
  if (localPreview.value) URL.revokeObjectURL(localPreview.value)
})
</script>

<template>
  <!-- to the body: opened inside a sheet (diary, map) it would sit under the tab bar (its z-index 50 counts only there) -->
  <Teleport to="body">
    <div class="backdrop" :class="{ 'backdrop--leaving': leaving }" @click.self="close">
      <form class="editor card" aria-label="Воспоминание" @submit.prevent="save">
        <header class="editor__head">
          <div>
            <p class="editor__kind">Воспоминание</p>
            <h2 class="editor__title">{{ place.buildingName }}</h2>
            <p v-if="place.address" class="editor__address">{{ place.address }}</p>
          </div>
          <button type="button" class="editor__close" aria-label="Закрыть" @click="close">
            <AppIcon name="close" :size="16" />
          </button>
        </header>

        <div class="photo">
          <img v-if="preview" :src="preview" :alt="place.buildingName" class="photo__img" />
          <label class="photo__pick">
            <input type="file" accept="image/*" class="visually-hidden" @change="pickPhoto" />
            {{ preview ? 'Заменить фото' : 'Добавить фото' }}
          </label>
          <button v-if="ownPhoto" type="button" class="photo__remove" @click="dropPhoto">
            {{ fallbackPhoto ? 'Вернуть прежнее фото' : 'Убрать' }}
          </button>
        </div>

        <fieldset class="impressions">
          <legend>Впечатление</legend>
          <button
            v-for="i in IMPRESSIONS"
            :key="i.value"
            type="button"
            class="impression"
            :class="{ 'impression--on': impression === i.value }"
            :aria-pressed="impression === i.value"
            @click="impression = impression === i.value ? null : i.value"
          >
            <MemorySticker :impression="i.value" />
            {{ i.label }}
          </button>
        </fieldset>

        <button
          type="button"
          class="favorite"
          :class="{ 'favorite--on': isFavorite }"
          :aria-pressed="isFavorite"
          @click="isFavorite = !isFavorite"
        >
          <span aria-hidden="true">{{ isFavorite ? '♥' : '♡' }}</span> Любимое место
        </button>

        <label class="field">
          <span>Дата посещения</span>
          <input v-model="visitedOn" type="date" :max="today" />
        </label>
        <label class="field">
          <span>Заметка</span>
          <textarea v-model="note" rows="3" maxlength="2000" placeholder="Что запомнилось?" />
        </label>

        <p v-if="error" class="editor__error" role="alert">{{ error }}</p>
        <AppButton type="submit" block :loading="saving">Сохранить</AppButton>
        <AppButton v-if="current" variant="ghost" block :loading="deleting" @click="remove">Удалить воспоминание</AppButton>
      </form>
    </div>
  </Teleport>
</template>

<style scoped lang="scss">
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  background: rgb(0 0 0 / 35%);
  display: flex;
  align-items: flex-end;
  // iOS-like sheet: the dim fades in, the card slides up from the bottom edge (no overshoot)
  animation: editor-dim-in 0.34s cubic-bezier(0.22, 1, 0.36, 1) both;
  .editor {
    animation: editor-up 0.4s cubic-bezier(0.22, 1, 0.36, 1) both;
  }
}
.backdrop--leaving {
  animation: editor-dim-out 0.26s ease-in both;
  pointer-events: none;
  .editor {
    animation: editor-down 0.26s cubic-bezier(0.4, 0, 1, 1) both;
  }
}
@keyframes editor-dim-in {
  from {
    background-color: rgb(0 0 0 / 0%);
  }
}
@keyframes editor-dim-out {
  to {
    background-color: rgb(0 0 0 / 0%);
  }
}
@keyframes editor-up {
  from {
    transform: translateY(100%);
  }
}
@keyframes editor-down {
  to {
    transform: translateY(100%);
  }
}
@media (prefers-reduced-motion: reduce) {
  .backdrop,
  .backdrop .editor {
    animation: none;
  }
}
.editor {
  width: 100%;
  max-height: 92vh;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 18px 16px calc(16px + var(--safe-bottom));
  border-radius: 24px 24px 0 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
  animation: rise 0.25s var(--ease);

  /* Scroll the sheet instead of squashing children (buttons kept shrinking below 52px). */
  > * {
    flex-shrink: 0;
  }
}
.editor__head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.editor__kind {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--c-text-2);
}
.editor__title {
  font-size: 20px;
  font-weight: 700;
}
.editor__address {
  color: var(--c-text-2);
  font-size: 14px;
}
.editor__close {
  flex: none;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--c-bg);
  color: var(--c-text-2);
}
.photo {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.photo__img {
  width: 100%;
  max-height: 220px;
  object-fit: cover;
  border-radius: 16px;
}
.photo__pick,
.photo__remove {
  padding: 8px 14px;
  border-radius: var(--r-pill);
  background: var(--c-surface-2);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.photo__pick {
  color: var(--c-accent-strong);
}
.photo__remove {
  border: 0;
  color: var(--c-text-2);
}
.impressions {
  border: 0;
  padding: 0;
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  legend {
    font-size: 13px;
    color: var(--c-text-2);
    margin-bottom: 6px;
  }
}
.impression,
.favorite {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px 6px 6px;
  border: 2px solid transparent;
  border-radius: var(--r-pill);
  background: var(--c-surface-2);
  font-size: 14px;
  &--on {
    border-color: var(--c-accent);
    background: var(--c-accent-soft);
  }
}
.favorite {
  align-self: flex-start;
  padding: 8px 14px;
  span {
    color: #ff4f7b;
    font-size: 16px;
  }
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: var(--c-text-2);
  input,
  textarea {
    font: inherit;
    font-size: 16px; /* ≥16px: iOS Safari does not zoom into the field */
    color: var(--c-text);
    padding: 10px 12px;
    border: 1px solid var(--c-surface-2);
    border-radius: 12px;
    background: var(--c-bg);
  }
}
.editor__error {
  color: var(--c-danger);
  font-size: 14px;
}
</style>
