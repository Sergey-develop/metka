import type { RouteLocationNormalizedLoaded } from 'vue-router'

/** pages that lie over a tab page (PageOverlay): the map has its own copies of them, named `map-…` */
type Stacked = 'place' | 'location' | 'route' | 'collection'

/**
 * The route name to open a place / building / quest / the collection from the current page: over the map
 * when this page itself lies over the map (or is the map with its sheets), so the player stays in that stack
 * and comes back to the map as it was.
 */
export function stackedName(current: RouteLocationNormalizedLoaded, name: Stacked): string {
  return current.matched[1]?.name === 'map' ? `map-${name}` : name
}

/** the tab page this page lies over ('/map', '/locations'), or null for a page of its own */
export function parentPath(current: RouteLocationNormalizedLoaded): string | null {
  return current.matched.length > 2 ? current.matched[current.matched.length - 2]!.path : null
}
