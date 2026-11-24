/** 雾 / 昼夜 / 区域轨道抽查：把 phi 推到森林-宫殿段，看雾与夜景是否生效 */
export default async ({ page, wait, shot, log }) => {
  await page.goto(`http://localhost:3000/?t=${Date.now()}`)
  await wait(1500)
  await page.eval(`document.querySelector('.center')?.click(); return 1`)
  await page.eval(`
    for (let i = 0; i < 80; i++) {
      if (window.__mola3d && window.__mola3d.game) return true
      await new Promise(r => setTimeout(r, 250))
    }
    return false
  `)
  await wait(1200)

  log('keys:', await page.eval(`return Object.keys(window.__mola3d).join(',')`))

  // 森林段（sequence t≈4.7 → 雾 intensity=1、夜景 mix=1）
  log('jump 1:', await page.eval(`
    const m = window.__mola3d
    m.phi = 2.95; m.targetPhi = 2.95; m.bikeSpeed = 0
    await new Promise(r => setTimeout(r, 1500))
    return { phi: +m.phi.toFixed(2), seq: +m.theatre.sequence.position.toFixed(2),
             fog: JSON.stringify(m.fogObj?.value ?? null),
             dayNight: m.dayNightObj?.value?.mix }
  `))
  await shot('f1-fog-forest')

  // 宫殿段（t≈7 → 雾 0、白天）
  log('jump 2:', await page.eval(`
    const m = window.__mola3d
    m.phi = 4.4; m.targetPhi = 4.4
    await new Promise(r => setTimeout(r, 1500))
    return { phi: +m.phi.toFixed(2), seq: +m.theatre.sequence.position.toFixed(2),
             fog: JSON.stringify(m.fogObj?.value ?? null) }
  `))
  await shot('f2-nofog-palace')

  // 白天沙漠
  await page.eval(`
    const m = window.__mola3d
    m.phi = 5.9; m.targetPhi = 5.9
    await new Promise(r => setTimeout(r, 1200))
    return 1
  `)
  await shot('f3-home')
}
