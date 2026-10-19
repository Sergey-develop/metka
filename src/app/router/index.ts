import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { isOnboarded, markOnboarded } from '@/features/onboarding/onboardingState'
import { useAuthStore } from '@/stores/auth'
import { useProfileStore } from '@/stores/profile'

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean
    guestOnly?: boolean
    /** registration step shown in the auth layout (1 account, 2 confirmation, 3 game profile) */
    step?: number
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
  {
    path: '/auth',
    component: () => import('@/app/layouts/AuthLayout.vue'),
    children: [
      { path: 'login', name: 'login', component: () => import('@/features/auth/LoginView.vue'), meta: { guestOnly: true } },
      { path: 'register', name: 'register', component: () => import('@/features/auth/RegisterView.vue'), meta: { guestOnly: true, step: 1 } },
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
      { path: 'results', name: 'results', component: () => import('@/features/results/ResultsView.vue') },
      // quests live on the profile page now; keep old links working
      { path: 'quests', redirect: '/profile' },
      { path: 'collection', name: 'collection', component: () => import('@/features/collection/CollectionView.vue') },
      { path: 'album', name: 'album', component: () => import('@/features/album/AlbumView.vue') },
      { path: 'profile', name: 'profile', component: () => import('@/features/profile/ProfileView.vue') },
      { path: 'clan', name: 'clan', component: () => import('@/features/clans/ClanView.vue') },
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

export const router = createRouter({ history: createWebHistory(import.meta.env.BASE_URL), routes })

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
  if (to.name === 'register' && !isOnboarded()) return { name: 'welcome' }
  return true
})
