/* Soundscapes gerados 100% via Web Audio API (sem arquivos externos). */

export type SoundId = 'brown' | 'rain' | 'binaural'

class Soundscapes {
  private ctx: AudioContext | null = null
  private gains: Partial<Record<SoundId, GainNode>> = {}

  private ensure() {
    if (!this.ctx) this.ctx = new AudioContext()
    if (this.ctx.state === 'suspended') this.ctx.resume()
    return this.ctx
  }

  private noiseBuffer(ctx: AudioContext, kind: 'white' | 'brown') {
    const len = ctx.sampleRate * 6
    const buf = ctx.createBuffer(2, len, ctx.sampleRate)
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch)
      let last = 0
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1
        if (kind === 'brown') {
          last = (last + 0.02 * w) / 1.02
          d[i] = last * 3.5
        } else d[i] = w
      }
    }
    return buf
  }

  private build(id: SoundId) {
    const ctx = this.ensure()
    const out = ctx.createGain()
    out.gain.value = 0
    out.connect(ctx.destination)
    if (id === 'brown') {
      const src = ctx.createBufferSource()
      src.buffer = this.noiseBuffer(ctx, 'brown')
      src.loop = true
      src.connect(out)
      src.start()
    } else if (id === 'rain') {
      const src = ctx.createBufferSource()
      src.buffer = this.noiseBuffer(ctx, 'white')
      src.loop = true
      const hp = ctx.createBiquadFilter()
      hp.type = 'highpass'
      hp.frequency.value = 900
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 7000
      const body = ctx.createGain()
      body.gain.value = 0.35
      // leve oscilação de intensidade, como rajadas de chuva
      const lfo = ctx.createOscillator()
      lfo.frequency.value = 0.13
      const lfoGain = ctx.createGain()
      lfoGain.gain.value = 0.1
      lfo.connect(lfoGain).connect(body.gain)
      lfo.start()
      src.connect(hp).connect(lp).connect(body).connect(out)
      // "trovão distante" / grave
      const rumble = ctx.createBiquadFilter()
      rumble.type = 'lowpass'
      rumble.frequency.value = 300
      const rg = ctx.createGain()
      rg.gain.value = 0.25
      src.connect(rumble).connect(rg).connect(out)
      src.start()
    } else {
      // batida binaural 40 Hz: 200 Hz no ouvido esquerdo, 240 Hz no direito
      const mk = (freq: number, pan: number) => {
        const o = ctx.createOscillator()
        o.frequency.value = freq
        const p = ctx.createStereoPanner()
        p.pan.value = pan
        const g = ctx.createGain()
        g.gain.value = 0.3
        o.connect(g).connect(p).connect(out)
        o.start()
      }
      mk(200, -1)
      mk(240, 1)
    }
    this.gains[id] = out
    return out
  }

  set(id: SoundId, volume: number) {
    if (volume <= 0 && !this.gains[id]) return
    const g = this.gains[id] ?? this.build(id)
    const ctx = this.ensure()
    g.gain.setTargetAtTime(volume, ctx.currentTime, 0.15)
  }

  beep(times = 3) {
    const ctx = this.ensure()
    for (let i = 0; i < times; i++) {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'sine'
      o.frequency.value = i === times - 1 ? 1046 : 784
      const t = ctx.currentTime + i * 0.28
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24)
      o.connect(g).connect(ctx.destination)
      o.start(t)
      o.stop(t + 0.26)
    }
  }
}

export const soundscapes = new Soundscapes()
