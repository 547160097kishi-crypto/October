/** 后轮扬尘验证：把车放在有 rateFactor 的段落并给速度 */
export default async ({ page, wait, shot, log }) => {
  await page.goto(`http://localhost:3000/?t=${Date.now()}`)
  await wait(1500)
  await page.eval(`document.querySelector('.center')?.click(); return 1`)
  await page.eval(`
    for (let i = 0; i < 80; i++) {
      if (window.__mola3d?.game) return true
      await new Promise(r => setTimeout(r, 250))
    }
    return false
  `)
  await wait(1000)

  const info = await page.eval(`
    const m = window.__mola3d
    m.phi = 3.64; m.targetPhi = 3.64
    m.bikeSpeed = -0.006
    for (let i = 0; i < 90; i++) {
      m.targetPhi = m.phi - 0.004   // 持续给速度，dust 才会持续出粒
      await new Promise(r => setTimeout(r, 33))
    }
    const a = m.dust.object.geometry.attributes
    let alive = 0
    for (let i = 0; i < a.aAlpha.array.length; i++) if (a.aAlpha.array[i] > 0.01) alive++
    return { seq: +m.theatre.sequence.position.toFixed(2), rateFactor: m.dustObj.value.rateFactor,
             dustColor: JSON.stringify(m.dustObj.value.color), alive,
             dustParent: m.dust.object.parent?.name || m.dust.object.parent?.type }
  `)
  log('dust:', JSON.stringify(info))
  await wait(200)
  await shot('d1-dust')
}
