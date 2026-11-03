// The canvas's few sounds, from a workbench: a sheet set down taps softly,
// so what lands is heard landing; scissors cut; what is let go slides away.
// Every sheet sounds as a sheet does, wherever it lies (slightly different
// each time, never the same twice). Synthesised (struck-wood partials,
// filtered noise), no files. Each take is (context, output, start time, options), so
// it can be played live or rendered offline to measure it.
const SOUND = (() => {
  const noiseFor = new WeakMap()
  function noise(ctx) {
    if (!noiseFor.has(ctx)) {
      const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
      const d = b.getChannelData(0)
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
      noiseFor.set(ctx, b)
    }
    return noiseFor.get(ctx)
  }
  // a quick rise and a fall to silence
  function shape(ctx, out, at, attack, length, peak) {
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, at)
    g.gain.exponentialRampToValueAtTime(peak, at + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, at + length)
    g.connect(out)
    return g
  }
  // filtered noise: paper, air, the edge of a blade
  function hiss(ctx, out, at, { length, attack = 0.003, peak, type = 'bandpass', freq, to = freq, q = 1 }) {
    const src = ctx.createBufferSource()
    src.buffer = noise(ctx)
    const f = ctx.createBiquadFilter()
    f.type = type
    f.Q.value = q
    f.frequency.setValueAtTime(freq, at)
    if (to !== freq) f.frequency.exponentialRampToValueAtTime(to, at + length)
    src.connect(f).connect(shape(ctx, out, at, attack, length, peak))
    src.start(at, Math.random() * 0.5)
    src.stop(at + length + 0.02)
  }
  function partial(ctx, out, at, freq, length, peak) {
    const o = ctx.createOscillator()
    o.frequency.value = freq
    o.connect(shape(ctx, out, at, 0.002, length, peak))
    o.start(at)
    o.stop(at + length + 0.02)
  }
  // Light wood struck: a click, a tone that dies fast, and an inharmonic
  // upper partial that dies faster (that is what makes it wood, not a beep).
  function tap(ctx, out, at, { freq, peak = 0.12, ring = 0.14 }) {
    const f = freq * (1 + (Math.random() - 0.5) * 0.02) // never twice the same
    hiss(ctx, out, at, { length: 0.012, peak: peak * 0.5, freq: 3200, q: 0.8 })
    partial(ctx, out, at, f, ring, peak)
    partial(ctx, out, at, f * 2.76, ring * 0.45, peak * 0.35)
    partial(ctx, out, at, f * 5.4, ring * 0.2, peak * 0.12)
  }

  // One sound for each moment, chosen by ear (2 Nov 2026): the most frequent
  // the softest and shortest, one action one sound, all from a workbench.
  const takes = {
    // A page set down: plays as it lands, a felt-tipped mallet on wood (soft:
    // it is heard at every link).
    lay: [(c, o, t) => tap(c, o, t, { freq: 587, peak: 0.13, ring: 0.2 })],
    // Clipping: the cut, at the click, one cut: the blades slide, then meet.
    snip: [
      (c, o, t) => {
        hiss(c, o, t, { length: 0.05, attack: 0.012, peak: 0.105, freq: 6500, to: 3800, q: 2 })
        hiss(c, o, t + 0.045, { length: 0.04, peak: 0.42, freq: 5200, q: 7 })
        hiss(c, o, t + 0.045, { length: 0.03, peak: 0.18, freq: 2600, q: 4 })
      },
    ],
    // The cut-out piece landing: small, so higher and lighter than a page.
    settle: [(c, o, t) => tap(c, o, t, { freq: 1320, peak: 0.07, ring: 0.09 })],
    // Letting something go: slid off the table, briefly.
    away: [(c, o, t) => hiss(c, o, t, { length: 0.1, attack: 0.02, peak: 0.088, freq: 1800, to: 900, q: 0.8 })],
  }

  let ctx = null
  // play(name, { take, delay (s), ...options for the take })
  function play(name, { take = 0, delay = 0, ...options } = {}) {
    const f = takes[name]?.[take]
    if (!f) return
    ctx ||= new AudioContext()
    if (ctx.state === 'suspended') ctx.resume()
    f(ctx, ctx.destination, ctx.currentTime + 0.01 + delay, options)
  }
  return { takes, play }
})()
