/**
 * Photos of Zavidovo (src/assets/zavidovo, from the owner on 2026-10-27), named by the key they
 * illustrate: a place id (`zav-bay`), a route slug (`zav-catch-wave`) or a step slug (`wave-4`).
 * Bundled with the app: the URLs are resolved at build time, the files load only when shown.
 */
import type { AreaPlace, QuestRoute, RouteStep } from '@/types/game'

const files = import.meta.glob<string>('@/assets/zavidovo/*.webp', { eager: true, import: 'default' })
const BY_KEY = new Map(Object.entries(files).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1, -'.webp'.length), url]))

/** places shown with another key's photo: the residences are part of the Radisson complex */
const SAME_AS: Record<string, string> = { 'zav-radisson-residences': 'zav-radisson' }

export const placePhoto = (p: AreaPlace | null): string | null =>
  p ? (BY_KEY.get(p.id) ?? BY_KEY.get(SAME_AS[p.id] ?? '') ?? null) : null

/**
 * Photos from Wikimedia Commons: the licence asks for the author and the licence next to the photo.
 * `example`: a typical photo of such a place, not of this very one (no free photo of it exists).
 */
const CREDITS: Record<string, { author: string; license: string; url: string; example?: true }> = {
  'zav-memorial': {
    author: 'Kohomologie',
    license: 'CC BY-SA 4.0',
    url: 'https://commons.wikimedia.org/wiki/File:Братская_могила_Вараксино_общий_вид_01.jpg',
  },
  'zav-minigolf': {
    author: 'Wolf1949H',
    license: 'CC0',
    url: 'https://commons.wikimedia.org/wiki/File:Horner_Rennbahn_Minigolfanlage_2026.JPG',
    example: true,
  },
  'zav-alpaca': {
    author: 'AnRo0002',
    license: 'CC0',
    url: 'https://commons.wikimedia.org/wiki/File:20170619Vicugna_pacos1.jpg',
    example: true,
  },
  // 2026-10-27: typical photos for the places that had none
  'zav-barhan': {
    author: 'Vyacheslav Argenberg',
    license: 'CC BY 4.0',
    url: 'https://commons.wikimedia.org/wiki/File:Krasnoyarsk,_Yurt_interior,_Cafe,_Tea_house,_Russia.jpg',
    example: true,
  },
  'zav-basketball': {
    author: 'Mertbiol',
    license: 'CC0',
    url: 'https://commons.wikimedia.org/wiki/File:Outdoor_basketball_court,_Hurst_Park,_Molesey,_Surrey_02.jpg',
    example: true,
  },
  'zav-evrika': {
    author: 'Max Kuznetsov, Inna Ismailova',
    license: 'CC BY-SA 4.0',
    url: 'https://commons.wikimedia.org/wiki/File:Reality_Fairytale_of_the_Horse_and_the_Deer_children_craft_workshop_at_folk_fair_in_Berendeyevo_2013.jpg',
    example: true,
  },
  'zav-fishing': {
    author: 'Дмитрий Скляренко',
    license: 'CC BY 3.0',
    url: 'https://commons.wikimedia.org/wiki/File:Клевое_место_-_panoramio.jpg',
    example: true,
  },
  'zav-football': {
    author: 'Wpcpey',
    license: 'CC BY 4.0',
    url: 'https://commons.wikimedia.org/wiki/File:Kwu_Tung_Grass_Pitch_201708.jpg',
    example: true,
  },
  'zav-gastrobar': {
    author: 'BrokenSphere',
    license: 'CC BY-SA 3.0',
    url: 'https://commons.wikimedia.org/wiki/File:Elephant_Bar,_Serramonte_interior_2.JPG',
    example: true,
  },
  'zav-spa-village': {
    author: 'Tevfik Teker',
    license: 'CC BY 3.0',
    url: 'https://commons.wikimedia.org/wiki/File:Lake_Inari_-_panoramio_(10).jpg',
    example: true,
  },
  'zav-syrzavod': {
    author: 'Martin Thurnherr',
    license: 'CC BY-SA 4.0',
    url: 'https://commons.wikimedia.org/wiki/File:Obere_Bundalp_BE_Käsekeller_01.jpg',
    example: true,
  },
  'zav-tennis': {
    author: 'Seyhan668',
    license: 'CC BY-SA 4.0',
    url: 'https://commons.wikimedia.org/wiki/File:AEC_Outdoor_Tennis_Courts.png',
    example: true,
  },
  'zav-tent': {
    author: 'Acabashi',
    license: 'CC BY-SA 4.0',
    url: 'https://commons.wikimedia.org/wiki/File:Easton_Lodge_Gardens_Tudor_Open_Day_Little_Easton_Essex_England.jpg',
    example: true,
  },
  'zav-toboggan': {
    author: 'Seemannsheide',
    license: 'CC BY-SA 4.0',
    url: 'https://commons.wikimedia.org/wiki/File:Z_MrSnow_Tubing_MariaAlm_xs.jpg',
    example: true,
  },
  'zav-traktir': {
    author: 'Ninaras',
    license: 'CC BY 4.0',
    url: 'https://commons.wikimedia.org/wiki/File:Interior_of_new_Espilä_restaurant.jpg',
    example: true,
  },
  'zav-tsarevna': {
    author: 'Eugene Kim',
    license: 'CC BY 2.0',
    url: 'https://commons.wikimedia.org/wiki/File:Pelmeni_Russian.jpg',
    example: true,
  },
  'zav-zhukovka': {
    author: 'Alex Sirac',
    license: 'CC BY 4.0',
    url: 'https://commons.wikimedia.org/wiki/File:Terrace_of_a_restaurant_on_the_sides_of_lake_Bled.jpg',
    example: true,
  },
}
export const photoCredit = (p: AreaPlace | null) => (p ? (CREDITS[p.id] ?? null) : null)

/** the step's own photo, else its place's */
export const stepPhoto = (s: RouteStep): string | null => BY_KEY.get(s.slug) ?? placePhoto(s.place)

/** the route's cover, else the photo of its first step that has one */
export function routePhoto(r: QuestRoute): string | null {
  return BY_KEY.get(r.slug) ?? r.steps.map(stepPhoto).find((url) => url !== null) ?? null
}
