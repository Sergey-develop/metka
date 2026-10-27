import type { ScanFailure } from '@/stores/scan'
import type { RecognitionResult } from '@/services/recognition/types'
import type { ScanRejectReason } from '@/types/game'
import { formatDistance } from '@/utils/geo'

export interface UiMessage {
  title: string
  text: string
  /** technical detail, small under the text */
  detail?: string
  /** whether "try again" makes sense */
  retryable: boolean
}

export function failureMessage(f: ScanFailure): UiMessage {
  switch (f.kind) {
    case 'building_unknown':
      return { title: 'Здание не найдено', text: 'Вернитесь на карту и выберите здание заново.', retryable: false }
    case 'recognition_unavailable':
      return {
        title: 'Распознавание недоступно',
        text: 'В этой сборке не подключена модель распознавания зданий. Открытие зданий временно невозможно.',
        retryable: false,
      }
    case 'camera_denied':
      return {
        title: 'Нет доступа к камере',
        text: 'Разрешите доступ к камере в настройках устройства и вернитесь в приложение.',
        retryable: true,
      }
    case 'camera_unavailable':
      return { title: 'Камера недоступна', text: 'На устройстве не найдена камера или она занята другим приложением.', retryable: true }
    case 'camera_failed':
      return { title: 'Не удалось сделать снимок', text: 'Попробуйте ещё раз.', detail: f.detail, retryable: true }
    case 'location_denied':
      return {
        title: 'Нет доступа к геолокации',
        text: 'Разрешите доступ к местоположению в настройках — без него нельзя подтвердить, что вы у здания.',
        retryable: true,
      }
    case 'gps_disabled':
      return { title: 'Геолокация выключена', text: 'Включите службы геолокации на устройстве.', retryable: true }
    case 'gps_unavailable':
      return { title: 'Не удалось определить местоположение', text: 'Выйдите на открытое место и попробуйте снова.', retryable: true }
    case 'gps_inaccurate':
      return {
        title: 'Слишком неточный GPS',
        text: `Точность сейчас ±${f.accuracyM} м. Подождите немного на открытом месте.`,
        retryable: true,
      }
    case 'too_far':
      return {
        title: 'Вы слишком далеко',
        text: `До здания ${formatDistance(f.distanceM)}. Подойдите ближе, чем на ${formatDistance(f.allowedM)}.`,
        retryable: true,
      }
    case 'recognition_timeout':
      return { title: 'Распознавание заняло слишком много времени', text: 'Попробуйте ещё раз.', retryable: true }
    case 'recognition_failed':
      return { title: 'Ошибка распознавания', text: 'Не удалось обработать снимок. Попробуйте ещё раз.', retryable: true }
    case 'offline':
      return { title: 'Нет подключения к сети', text: 'Подключитесь к интернету — снимок будет отправлен повторно.', retryable: true }
    case 'network':
      return { title: 'Сбой сети', text: 'Сервер не ответил. Отправим тот же результат ещё раз.', retryable: true }
    case 'server':
      return { title: 'Ошибка сервера', text: 'Попробуйте позже.', retryable: true }
  }
}

export function recognitionMessage(r: RecognitionResult): UiMessage | null {
  switch (r.status) {
    case 'poor_quality': {
      const issues = r.quality?.issues ?? []
      if (issues.includes('too_dark')) return { title: 'Слишком темно', text: 'Снимите фасад при лучшем освещении.', retryable: true }
      if (issues.includes('overexposed')) return { title: 'Пересвет', text: 'Не снимайте против солнца.', retryable: true }
      return { title: 'Снимок размыт', text: 'Держите телефон неподвижно и снимите ещё раз.', retryable: true }
    }
    case 'not_recognized':
      return { title: 'Здание не распознано', text: 'Снимите фасад целиком, ближе и прямо.', retryable: true }
    case 'other_building': {
      const other = r.candidates[0]
      return {
        title: 'Похоже, это другое здание',
        text: other ? `На снимке скорее «${other.name}». Наведите камеру на выбранное здание.` : 'Наведите камеру на выбранное здание.',
        retryable: true,
      }
    }
    default:
      return null
  }
}

const REJECT_TEXT: Record<ScanRejectReason, string> = {
  rate_limited: 'Слишком много попыток. Подождите минуту.',
  invalid_location: 'Некорректные координаты.',
  building_not_found: 'Здание отсутствует в каталоге.',
  location_inaccurate: 'Слишком неточное местоположение.',
  too_far: 'Сервер считает, что вы слишком далеко от здания.',
  recognition_unavailable: 'Для этого здания пока нет эталонов распознавания.',
  invalid_embedding: 'Результат распознавания повреждён.',
  invalid_request: 'Некорректный запрос.',
  duplicate_image: 'Этот снимок уже использовался.',
  suspicious_embedding: 'Результат распознавания отклонён проверкой.',
  other_building: 'На снимке другое здание.',
  not_recognized: 'Сервер не узнал здание на снимке.',
  ambiguous: 'Здание узнано неуверенно — снимите ближе и под другим углом.',
}

export function rejectMessage(reason: ScanRejectReason | null): string {
  return reason ? REJECT_TEXT[reason] : 'Сканирование отклонено.'
}
