import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { takeHandoffScroll } from '@/app/pageTransition'
import { isOnboarded, markOnboarded } from '@/features/onboarding/onboardingState'
import { useAuthStore } from '@/stores/auth'
import { useProfileStore } from '@/stores/profile'

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean
    guestOnly?: boolean
    /** registration step shown in the auth layout (1 account, 2 confirmation, 3 game profile) */
    step?: number
    /** the page opens like a sheet: slides up from below (app/pageTransition.ts) */
    rise?: boolean
  }
}

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/map' },
  {
    path: '/welcome',
    name: 'welcome',
    component: () => import('@/features/onboarding/OnboardingView.vue'),
    meta: { guestOnly: true },
  },
  // phone + SMS code: the main way in (full-screen, own layout)
  {
    path: '/auth/login',
    name: 'login',
    component: () => import('@/features/auth/PhoneAuthView.vue'),
    props: { mode: 'login' },
    meta: { guestOnly: true },
  },
  {
    path: '/auth/register',
    name: 'register',
    component: () => import('@/features/auth/PhoneAuthView.vue'),
    props: { mode: 'register' },
    meta: { guestOnly: true },
  },
  {
    path: '/auth',
    component: () => import('@/app/layouts/AuthLayout.vue'),
    children: [
      // email + password: fallback until an SMS provider is connected, and for existing email accounts
      { path: 'email', name: 'login-email', component: () => import('@/features/auth/LoginView.vue'), meta: { guestOnly: true } },
      { path: 'email/register', name: 'register-email', component: () => import('@/features/auth/RegisterView.vue'), meta: { guestOnly: true, step: 1 } },
      { path: 'reset', name: 'reset', component: () => import('@/features/auth/ResetPasswordView.vue'), meta: { guestOnly: true } },
      { path: 'update-password', name: 'update-password', component: () => import('@/features/auth/UpdatePasswordView.vue') },
      { path: 'callback', name: 'auth-callback', component: () => import('@/features/auth/AuthCallbackView.vue') },
      {
        path: 'confirm',
        name: 'confirm',
        component: () => import('@/features/auth/ConfirmView.vue'),
        meta: { guestOnly: true, step: 2 },
      },
      {
        path: 'setup',
        name: 'setup',
        component: () => import('@/features/auth/ProfileSetupView.vue'),
        meta: { requiresAuth: true, step: 3 },
      },
    ],
  },
  {
    path: '/',
    component: () => import('@/app/layouts/TabLayout.vue'),
    meta: { requiresAuth: true },
    children: [
      { path: 'map', name: 'map', component: () => import('@/features/map/MapView.vue') },
      // camera-first: which building is in front of the camera (approximate, GPS + compass + OSM); the tab bar stays, as in the mockup
      { path: 'scan', name: 'ar-scan', component: () => import('@/features/scanner/ArScanView.vue') },
      { path: 'results', name: 'results', component: () => import('@/features/results/ResultsView.vue') },
      // quests live on the profile page now; keep old links working
      { path: 'quests', redirect: '/profile' },
      { path: 'events', name: 'events', component: () => import('@/features/events/EventsView.vue') },
      // opens like a sheet, as the clan, tasks and diary pages
      { path: 'events/new', name: 'event-create', component: () => import('@/features/events/EventCreateView.vue'), meta: { rise: true } },
      { path: 'events/:id', name: 'event', component: () => import('@/features/events/EventDetailView.vue'), props: true },
      { path: 'locations', name: 'locations', component: () => import('@/features/locations/LocationsView.vue') },
      { path: 'locations/:id', name: 'location', component: () => import('@/features/locations/LocationDetailView.vue'), props: true },
      // Zavidovo: quest routes, places and artifacts (migration 026)
      { path: 'routes', name: 'routes', component: () => import('@/features/routes/RoutesView.vue') },
      { path: 'routes/random', name: 'random-route', component: () => import('@/features/routes/RandomRouteView.vue') },
      { path: 'places/:id', name: 'place', component: () => import('@/features/routes/PlaceDetailView.vue'), props: true },
      { path: 'routes/:slug', name: 'route', component: () => import('@/features/routes/RouteDetailView.vue'), props: true },
      { path: 'collection', name: 'collection', component: () => import('@/features/collection/CollectionView.vue') },
      { path: 'album', name: 'album', component: () => import('@/features/album/AlbumView.vue') },
      // diary: the cover of the album (mockup дневник.png)
      { path: 'diary', name: 'diary', component: () => import('@/features/album/DiaryView.vue'), meta: { rise: true } },
      { path: 'profile', name: 'profile', component: () => import('@/features/profile/ProfileView.vue') },
      // another player's profile (clanmates only, player_public_profile)
      {
        path: 'players/:id',
        name: 'player',
        component: () => import('@/features/profile/ProfileView.vue'),
        props: (route) => ({ userId: String(route.params.id) }),
        // rises over the profile / clan it was opened from, so the change of player is clear
        meta: { rise: true },
      },
      { path: 'clan', name: 'clan', component: () => import('@/features/clans/ClanView.vue'), meta: { rise: true } },
      // tasks page: the tasks sheet on the map expanded (mockup задания.png)
      { path: 'tasks', name: 'tasks', component: () => import('@/features/tasks/TasksView.vue'), meta: { rise: true } },
    ],
  },
  {
    path: '/scan/:buildingId',
    name: 'scan',
    component: () => import('@/features/scanner/ScannerView.vue'),
    meta: { requiresAuth: true },
    props: true,
  },
  { path: '/:pathMatch(.*)*', redirect: '/map' },
]

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  // a new page opens at its top (it used to keep the previous page's scroll); back restores the position;
  // a page a sheet expanded into opens at the scroll the sheet had
  scrollBehavior: (_to, _from, saved) => saved ?? { top: takeHandoffScroll() ?? 0 },
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  await auth.init()
  const requiresAuth = to.matched.some((r) => r.meta.requiresAuth)
  // someone who has signed in on this device never needs the intro again (e.g. after logout)
  if (auth.status === 'signed_in') markOnboarded()
  if (requiresAuth && auth.status !== 'signed_in') {
    // first launch: the intro is the entry point; existing users skip it via "Уже есть аккаунт"
    if (!isOnboarded()) return { name: 'welcome' }
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  if (to.meta.guestOnly && auth.status === 'signed_in') return { name: 'map' }
  if (requiresAuth && auth.status === 'signed_in') {
    // registration step "game profile": nickname + avatar before the game opens.
    // If the profile can't be loaded (offline) the game opens and shows its own error.
    const profile = await useProfileStore().ensureLoaded()
    const setupDone = !profile || profile.setupCompleted
    if (to.name === 'setup' && setupDone) return { name: 'map' }
    if (to.name !== 'setup' && !setupDone) return { name: 'setup', query: { redirect: to.fullPath } }
  }
  // login is always reachable directly; only registration starts with the intro
  if ((to.name === 'register' || to.name === 'register-email') && !isOnboarded()) return { name: 'welcome' }
  return true
})
