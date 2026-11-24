import core from '@theatre/core'
import { readFileSync } from 'fs'

const state = JSON.parse(readFileSync('public/assets/scenes/3d/state_v9.json', 'utf8'))

try {
  const project = core.getProject('Molazone', { state })
  project.ready.then(() => {
    console.log('project ready OK')
    const sheet = project.sheet('Orbital Sequence')
    const seq = sheet.sequence
    console.log('sequence length:', seq.length)
    const obj = sheet.object('Camera / Views / HomeDesktop', {
      positionX: 0, positionY: 0, positionZ: 0,
      lookAtX: 0, lookAtY: 0, lookAtZ: 0,
      fov: 55, far: 100
    })
    obj.onValuesChange((v) => {
      console.log('values:', JSON.stringify(v))
    })
    setTimeout(async () => {
      try {
        await seq.play({ iterationCount: 1, rate: 10 })
        console.log('play finished OK')
      } catch (e) {
        console.error('PLAY FAIL:', e.message)
      }
      process.exit(0)
    }, 500)
  }).catch(e => { console.error('READY FAIL:', e.message); process.exit(1) })
} catch (e) {
  console.error('INIT FAIL:', e.message)
  process.exit(1)
}
