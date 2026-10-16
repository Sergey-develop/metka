<script setup lang="ts">
defineProps<{ missing: string[] }>()
</script>

<template>
  <main class="page config">
    <h1 class="page-title">Приложение не настроено</h1>
    <p class="notice notice--error">
      Отсутствуют параметры подключения к серверу: <strong>{{ missing.join(', ') }}</strong>. Скопируйте
      <code>.env.example</code> в <code>.env</code> и укажите данные проекта Supabase.
    </p>
  </main>
</template>

<style scoped lang="scss">
.config code {
  font-size: 13px;
}
</style>
