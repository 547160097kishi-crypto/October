<template>
  <div v-if="state && state.mode === 'game'" class="gameHud">
    <!-- 原站 HUD：底部换道提示 -->
    <p v-if="!state.crashed" class="hudHint">
      PRESS <span class="key">[&larr;]</span> <span class="key">[&rarr;]</span> TO CHANGE LANES
    </p>

    <!-- 原站 HUD：右下 SPEED / YOUR SCORE -->
    <div class="hudStats">
      <div class="stat">
        <span class="label">SPEED</span>
        <span class="num">{{ pad(speedLevel) }}</span>
      </div>
      <div class="stat">
        <span class="label">YOUR SCORE</span>
        <span class="num">{{ pad(state.score) }}</span>
      </div>
      <div class="stat">
        <span class="label">BEST SCORE</span>
        <span class="num">{{ pad(state.bestScore) }}</span>
      </div>
    </div>

    <!-- 撞车后停下（对应原站 DeathInterface：loose 文案 + Best/Your score + Restart/Quit） -->
    <div v-if="state.crashed" class="deathOverlay">
      <div class="deathPanel">
        <h2>NICE ONE!<br />TRY AGAIN</h2>
        <div class="deathStats">
          <div class="stat">
            <span class="label">BEST SCORE</span>
            <span class="num">{{ pad(state.bestScore) }}</span>
          </div>
          <div class="stat">
            <span class="label">YOUR SCORE</span>
            <span class="num">{{ pad(state.score) }}</span>
          </div>
        </div>
        <div class="actions">
          <button type="button" class="primary" @click="emit('restart')">RESTART</button>
          <button type="button" @click="emit('quit')">QUIT</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { GAME_CONFIG, type GameHudState } from '~/utils/mola3d/gameMode'

const props = defineProps<{ state: GameHudState }>()
const emit = defineEmits<{
  (e: 'restart'): void
  (e: 'quit'): void
}>()

const pad = (n: number) => String(Math.max(0, Math.floor(n))).padStart(5, '0')
const speedLevel = computed(() => Math.round(props.state.speed / GAME_CONFIG.INITIAL_SPEED))
</script>

<style scoped>
.gameHud {
  position: fixed;
  inset: 0;
  z-index: 6;
  pointer-events: none;
  color: #fff;
  font-size: 9px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
}
.hudHint {
  position: absolute;
  left: 50%;
  bottom: 78px;
  transform: translateX(-50%);
  margin: 0;
  white-space: nowrap;
  opacity: 0.72;
}
.hudHint .key { opacity: 0.95; }
.hudStats {
  position: absolute;
  right: 42px;
  bottom: 78px;
  display: flex;
  gap: 26px;
  text-align: right;
}
.stat { display: flex; flex-direction: column; gap: 5px; }
.stat .label { opacity: 0.6; font-size: 8px; }
.stat .num { font-size: 12px; letter-spacing: 0.16em; font-variant-numeric: tabular-nums; }

.deathOverlay {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgba(11, 11, 12, 0.52);
  pointer-events: auto;
  animation: fade 0.35s ease-out;
}
.deathPanel {
  min-width: 330px;
  padding: 38px 44px 34px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  background: rgba(11, 11, 12, 0.88);
  text-align: center;
}
.deathPanel h2 {
  margin: 0 0 26px;
  font-size: 24px;
  font-weight: 400;
  line-height: 1.35;
  letter-spacing: 0.16em;
}
.deathStats {
  display: flex;
  justify-content: center;
  gap: 34px;
  margin-bottom: 30px;
}
.actions { display: flex; gap: 10px; justify-content: center; }
.actions button {
  padding: 11px 22px;
  border: 1px solid rgba(255, 255, 255, 0.35);
  background: transparent;
  color: #fff;
  font: inherit;
  font-size: 9px;
  letter-spacing: 0.2em;
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
}
.actions button:hover { background: rgba(255, 255, 255, 0.14); }
.actions button.primary { background: #fff; color: #0b0b0c; }
.actions button.primary:hover { background: #e8e5de; }
@keyframes fade { from { opacity: 0; } to { opacity: 1; } }

@media (max-width: 768px) {
  .hudStats { right: 16px; bottom: 66px; gap: 14px; }
  .hudHint { bottom: 112px; font-size: 8px; }
  .deathPanel { min-width: 0; width: min(88vw, 330px); padding: 28px 22px; }
}
</style>
