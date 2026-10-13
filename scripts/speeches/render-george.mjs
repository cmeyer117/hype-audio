// Renders the 7 original hype lines with local Kokoro (zero cost) to mp3s in ./speeches-audio.
// Usage: node render-lines.mjs [voice]
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const voice = process.argv[2] || 'am_michael'
const out = path.join(here, 'speeches-george-wav')
fs.mkdirSync(out, { recursive: true })

const { KokoroTTS } = await import(pathToFileURL('C:/Users/gregm/claude-workspace/node_modules/kokoro-js/dist/kokoro.js').href)

const lines = JSON.parse(fs.readFileSync(path.join(here, 'hist-speeches.json'), 'utf8')).map((d) => ({ n: d.n, title: d.title, reflect: d.reflect, voice: d.voice, speed: d.speed, text: d.lines }))

const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'fp32', device: 'cpu' })

function wavBuffer(samples, rate) {
  const buf = Buffer.alloc(44 + samples.length * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples.length * 2, 4); buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(samples.length * 2, 40)
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(Math.max(-1, Math.min(1, samples[i])) * 32767 | 0, 44 + i * 2)
  return buf
}

for (const l of lines) {
  const reflect = l.reflect
  const GAP_SECONDS = reflect ? 0.7 : 0.45
  const speed = l.speed
  const parts = []
  let rate = 24000
  for (const text of l.text) {
    const a = await tts.generate(text, { voice: 'bm_george', speed })
    rate = a.sampling_rate
    parts.push(a.audio, new Float32Array(Math.round(rate * GAP_SECONDS)))
  }
  const total = parts.reduce((n, p) => n + p.length, 0)
  const all = new Float32Array(total)
  let o = 0
  for (const p of parts) { all.set(p, o); o += p.length }
  const wav = path.join(out, `speech-${l.n}.wav`)
  const mp3 = path.join(out, `speech-${l.n}.mp3`)
  fs.writeFileSync(wav, wavBuffer(all, rate))
  fs.writeFileSync(path.join(out, `speech-${l.n}.json`), JSON.stringify({ n: l.n, title: l.title, reflect, seconds: Math.round(total / rate), text: l.text.join('\n') }))
  console.log(l.n, l.title, reflect ? 'reflect' : 'charge', Math.round(total / rate) + 's')
}
