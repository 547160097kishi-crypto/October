<template>
  <div class="app dark">
    <slot />
  </div>
</template>

<style scoped>
.app {
  position: relative;
  width: 100%;
  height: 100dvh;
  overflow: hidden;
  background: var(--c-secondary);
  color: var(--c-primary);
}
</style>
