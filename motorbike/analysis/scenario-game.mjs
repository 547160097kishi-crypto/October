/**
 * 游戏模式逐项验证：进入 / 换道 / 障碍 / 碰撞 / RESTART / QUIT
 * 运行：node scripts/dev-browser.mjs analysis/scenario-game.mjs http://localhost:3000/
 */
export default async ({ page, wait, shot, log }) => {
  const errors = []
  await page.goto(`http://localhost:3000/?t=${Date.now()}`)
  await wait(1500)

  // 1) 进入 3D 场景
  log('enter scene:', await page.eval(`
    const c = document.querySelector('.center')
    if (c) c.click()
    return !!c
  `))

  // 等场景 + 游戏运行时就绪
  const ready = await page.eval(`
    for (let i = 0; i < 80; i++) {
      if (window.__mola3d && window.__mola3d.game) return true
      await new Promise(r => setTimeout(r, 250))
    }
    return false
  `)
  log('runtime ready:', ready)
  await wait(800)

  // 2) 点击 PLAY 进入游戏
  log('click play:', await page.eval(`
    const b = document.querySelector('.play-btn button')
    if (!b) return 'no-button'
    b.click()
    return b.textContent.trim()
  `))
  await wait(4500)

  const st1 = await page.eval(`
    const m = window.__mola3d, g = m.game
    const inst = []
    g.pools.forEach((p, i) => inst.push({ zone: i, mesh: p.instanced.length, inactive: p.inactive.length }))
    return {
      mode: g.mode, alive: g.alive, crashed: g.crashed,
      score: g.score, speed: +g.speed.toFixed(5), column: g.column,
      pools: inst, active: g.active.length,
      decorVisible: g.decorGroup.visible, decorY: g.decorGroup.position.y,
      helperVisible: g.helperGroup ? g.helperGroup.visible : null,
      fov: +m.camera.fov.toFixed(1),
      camLocal: m.camAnchor.position.toArray().map(n => +n.toFixed(2)),
      bikeX: +m.bike.getObjectByName('root').position.x.toFixed(3),
      phi: +m.phi.toFixed(3),
      activePhi: g.active.map(s => +s.initialPhi.toFixed(2)),
      hud: document.querySelector('.hudStats') ? document.querySelector('.hudStats').textContent.replace(/\\s+/g, ' ').trim() : null
    }
  `)
  log('after enter:', JSON.stringify(st1))
  await shot('g1-enter')

  // 3) 换道：左 → 右
  await page.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))`)
  await wait(900)
  const left = await page.eval(`
    const g = window.__mola3d.game
    return { column: g.column, bikeX: +g.bikeRoot.position.x.toFixed(3), camX: +window.__mola3d.camAnchor.position.x.toFixed(3) }
  `)
  log('after ArrowLeft:', JSON.stringify(left))
  await shot('g2-left')

  await page.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))`)
  await wait(300)
  await page.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))`)
  await wait(900)
  const right = await page.eval(`
    const g = window.__mola3d.game
    return { column: g.column, bikeX: +g.bikeRoot.position.x.toFixed(3) }
  `)
  log('after ArrowRight x2:', JSON.stringify(right))

  // 4) 障碍：等到有活跃障碍，并确认它升出地面
  const obst = await page.eval(`
    const g = window.__mola3d.game
    for (let i = 0; i < 40; i++) {
      if (g.active.length >= 2) break
      await new Promise(r => setTimeout(r, 250))
    }
    const rows = g.active.map(s => ({ col: s.column, phi: +s.initialPhi.toFixed(3), spawnT: +s.spawnT.toFixed(2), y: +s.instance.getMatrixAt ? 0 : 0 }))
    return { active: g.active.length, rows }
  `)
  log('obstacles:', JSON.stringify(obst))
  await shot('g3-obstacles')

  // 5) 强制碰撞：把摩托挪到某个障碍所在的列，等它撞上
  const crash = await page.eval(`
    const g = window.__mola3d.game
    if (!g.active.length) return { error: 'no active obstacle' }
    const slot = g.active[0]
    g.column = slot.column
    g.columnTween = null
    g.bikeRoot.position.x = (slot.column - 1) * -2
    for (let i = 0; i < 80; i++) {
      if (g.crashed) break
      await new Promise(r => setTimeout(r, 100))
    }
    return { crashed: g.crashed, alive: g.alive, speed: g.speed, score: g.score,
             panel: !!document.querySelector('.deathPanel'),
             text: document.querySelector('.deathPanel') ? document.querySelector('.deathPanel').innerText.replace(/\\n+/g, ' | ') : null }
  `)
  log('crash:', JSON.stringify(crash))
  await wait(600)
  await shot('g4-crash')

  // 6) RESTART
  const restarted = await page.eval(`
    const btn = [...document.querySelectorAll('.deathPanel button')].find(b => /restart/i.test(b.textContent))
    if (!btn) return { error: 'no restart button' }
    btn.click()
    await new Promise(r => setTimeout(r, 1800))
    const g = window.__mola3d.game
    return { crashed: g.crashed, alive: g.alive, score: g.score, mode: g.mode,
             column: g.column, active: g.active.length, decorVisible: g.decorGroup.visible,
             panelGone: !document.querySelector('.deathPanel') }
  `)
  log('restart:', JSON.stringify(restarted))
  await shot('g5-restart')

  // 7) QUIT 返回首页
  const quit = await page.eval(`
    const b = document.querySelector('.play-btn button')
    if (!b) return { error: 'no header button' }
    const label = b.textContent.trim()
    b.click()
    await new Promise(r => setTimeout(r, 2200))
    const g = window.__mola3d.game
    return { label, mode: g.mode, alive: g.alive, score: g.score,
             decorVisible: g.decorGroup.visible,
             helperVisible: g.helperGroup ? g.helperGroup.visible : null,
             hudGone: !document.querySelector('.gameHud'),
             fov: +window.__mola3d.camera.fov.toFixed(1),
             bikeX: +window.__mola3d.bike.getObjectByName('root').position.x.toFixed(3) }
  `)
  log('quit:', JSON.stringify(quit))
  await wait(1200)
  await shot('g6-quit')
}
