// interneting: a table for interneting, where pages are sheets you open,
// cut up, connect and lay out.
//
// Pages are live iframes at their real addresses, which the add-on
// (extension/) lets the canvas show; inject.js runs in each, connecting it to
// the canvas. A link followed opens its page beside the one it came from,
// joined by a thin line. Anything on a page can be clipped out (the element
// itself, still a piece of web page), and links, images and text can be
// pasted or dragged onto the canvas. The canvas is saved in localStorage.

// ---------------------------------------------------------------- the add-on
// The add-on lets sites be framed and runs inject.js in them (see
// extension/background.js for what else it can do). Without it the canvas
// can't show pages: it says what it needs (#addon), and starts once the
// add-on is there.
let bridged = false // the add-on has readied this tab, and the canvas started with it
const NEEDS = ['frame', 'script', 'rules'] // what the canvas asks of the add-on
const bridgeHere = () => document.documentElement.hasAttribute('data-canvas-bridge') // (set by the add-on, see announce.js)
// The add-on readies this tab: the script it runs in pages, and the rules
// for what loads in it. False if it can't do all the canvas needs (an older
// one), or doesn't answer. (Just installed, it may not be listening yet for
// a moment: it is asked again.)
async function readyBridge() {
  for (let tries = 3; tries--; ) {
    try {
      const { abilities } = await bridge('hello', { script: 'inject.js' }, 10_000)
      if (!NEEDS.every(a => abilities.includes(a))) return false
      await bridge('rules', { set: RULES })
      return true
    } catch (err) {
      console.warn('the add-on:', err.message)
      await new Promise(r => setTimeout(r, 500))
    }
  }
  return false
}
const readable = { type: 'modifyHeaders', responseHeaders: [{ header: 'access-control-allow-origin', operation: 'set', value: '*' }] }
const RULES = {
  // pages' fonts, for cut pieces and the copies of sleeping pages, which are
  // frames of no site or of the canvas's (a font is never asked for with
  // cookies, so anyone may read it)
  fonts: { action: readable, condition: { resourceTypes: ['font'] } },
  // a stylesheet a page reads (inject.js, for a cut's fonts) where its server says nothing of who may
  sheets: { action: readable, condition: { resourceTypes: ['xmlhttprequest'], responseHeaders: [{ header: 'content-type', values: ['text/css*'] }], excludedResponseHeaders: [{ header: 'access-control-allow-origin' }] } },
}
// Asking the add-on (through announce.js, in this page).
const asked = new Map() // ask id -> what waits for its answer
function bridge(type, ask = {}, ms = 30_000) {
  return new Promise((resolve, reject) => {
    const id = Math.random().toString(36).slice(2)
    asked.set(id, { resolve, reject })
    postMessage({ canvasBridge: 'ask', id, ask: { ...ask, type } }, location.origin)
    setTimeout(() => asked.delete(id) && reject(new Error(`${type}: no answer`)), ms)
  })
}
addEventListener('message', e => {
  const d = e.data
  if (e.source !== window || d?.canvasBridge !== 'answer' || !asked.has(d.id)) return
  const { resolve, reject } = asked.get(d.id)
  asked.delete(d.id)
  'error' in d ? reject(new Error(d.error)) : resolve(d.value)
})
// The add-on arriving (or updated) while the canvas is open: the canvas
// readies its tab again; if it was waiting for it, it starts.
document.addEventListener('canvas-bridge', () => bridged && readyBridge())
// Without the add-on: what it is, and how to add it. Waits until it's there.
function needAddon() {
  const name = document.title
  const box = document.querySelector('#addon')
  box.querySelector('.download').download = `${name}.zip`
  box.querySelector('.copy').addEventListener('click', () => navigator.clipboard.writeText('chrome://extensions').then(() => toast('copied')))
  box.classList.toggle('other', !navigator.userAgentData?.brands?.some(b => b.brand === 'Chromium')) // (the add-on is for chromium browsers only, for now)
  box.hidden = false
  document.body.classList.add('addon')
  return new Promise(done => {
    const arrived = async () => {
      if (!bridgeHere()) return
      if (!(await readyBridge())) return box.classList.add('older') // here, but it can't do all the canvas needs
      document.removeEventListener('canvas-bridge', arrived)
      box.remove()
      document.body.classList.remove('addon')
      done()
    }
    document.addEventListener('canvas-bridge', arrived)
    arrived() // (it may have come meanwhile)
  })
}

const addonReady = (async () => {
  if (!(bridgeHere() && (await readyBridge()))) await needAddon()
  bridged = true
})()

// A new page is as big as a tab would be on this screen, less a margin that
// keeps the canvas in view around it; reading it shows it at exactly 100%.
const FRAME = { side: 56, top: 64, bottom: 56 }
// a page is read at 100%, as large as the window less its margins: on one
// side the band where the page you came from lies (BAND, see DESK)
const pageSize = () => ({ w: Math.max(600, innerWidth - FRAME.side - BAND), h: Math.max(400, innerHeight - FRAME.top - FRAME.bottom) })
const MIN_Z = 0.08 // a tab-size page is then about 100 px: a thumbnail (further out only to see everything)
const MAX_Z = 2.5
const OVERVIEW_Z = 0.25 // below this pages are too small to read: they become pictures you move
const STORE = 'canvas-browser:walk'
const SEARCH = q => `https://duckduckgo.com/?q=${encodeURIComponent(q)}` // (a whole-web search; its bangs are the ones the box knows: !g for Google)
const TRAILHEADS = [
  'https://syllabusproject.org/syllabus-for-taking-an-internet-walk/',
  'https://liiibrary.space/',
  'https://blogroll.org/',
  'https://en.wikipedia.org/wiki/Special:Random',
].map(url => [url.replace(/^https:\/\//, '').replace(/\/$/, ''), url]) // (named by their addresses)
// A page can't open alert/confirm dialogs: one would stop the whole canvas
// until answered (a page calling alert() as it loads froze it).
const PAGE_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-pointer-lock allow-presentation'
const ALLOW = 'autoplay; fullscreen; clipboard-write; encrypted-media; picture-in-picture'
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches

// ------------------------------------------------------------------ helpers

const $ = s => document.querySelector(s)
const canvas = $('#canvas')
const world = $('#world')
const edgesSvg = $('#edges')
const bar = $('#bar')
const input = $('#go')

function el(tag, cls, text) {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text != null) e.textContent = text
  return e
}
const uid = () => Math.random().toString(36).slice(2, 9)
const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
// Where a page is loaded from: its own address. A canvas at an https address
// can't show a page over plain http (the browser blocks it): it is asked for
// over https, as a browser first tries for a tab.
function frameAddress(url) {
  return location.protocol === 'https:' && url.startsWith('http:') ? `https:${url.slice(5)}` : url
}
// Addresses that come from pages are only used if they are web
// addresses: a javascript: one would run as the canvas, and a page at
// something that isn't an address at all could never be shown (nor could the
// canvas start with it).
const webOnly = url => (/^https?:$/.test(URL.parse(url)?.protocol) ? url : undefined)
function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}
// A web address as a person would write it. On the small web the address is
// the place (whose home, how it's arranged, where you are in it), so nothing is
// dropped but the default https:// — http:// stays (it says something about
// the site), and so do www., the path, the query and the fragment.
// A link's text directive (#:~:text=…, "scroll to these words") is an
// instruction to the browser, not part of the address: it isn't shown.
const hashShown = u => u.hash.replace(/:~:.*$/, '').replace(/^#$/, '')
function addressOf(url) {
  try {
    const u = new URL(url)
    let rest = u.pathname + u.search + hashShown(u)
    try {
      rest = decodeURI(rest)
    } catch {}
    return (u.protocol === 'https:' ? '' : `${u.protocol}//`) + u.host + (rest === '/' ? '' : rest)
  } catch {
    return url || ''
  }
}
// The address in its levels (the site, then each folder; on the site's front
// page, the domain it is within), with a chance to break after each slash, so
// it wraps rather than being cut. Each level above the page itself is a way
// up: it carries the address it stands for.
function addressParts(url) {
  let u
  try {
    u = new URL(url)
  } catch {
    return [addressOf(url)]
  }
  const decode = s => {
    try {
      return decodeURI(s)
    } catch {
      return s
    }
  }
  const tail = decode(u.search + hashShown(u))
  const scheme = u.protocol === 'https:' ? '' : `${u.protocol}//`
  if (u.pathname === '/' && !tail) return [scheme, ...hostParts(u)]
  const folders = u.pathname.split('/').slice(1)
  const levels = [scheme + u.host, ...folders.map(decode)]
  // the page itself: its last level (or the folder it is, for an address ending in /)
  const here = levels.at(-1) + tail ? levels.length - 1 : levels.length - 2
  return levels.flatMap((name, i) => {
    const last = i === levels.length - 1
    const span = el('span', null, last ? name + tail : `${name}/`)
    const up = `${u.origin}/${folders.slice(0, i).join('/')}${i ? '/' : ''}`
    if (!last && !sameDoc(up, url)) {
      span.classList.add('up')
      span.dataset.url = up
    }
    // which part is which, for the name zoomed out (style.css): the site, the folders between, the page itself
    span.classList.toggle('site', i === 0 && here > 0)
    span.classList.toggle('between', i > 0 && i < here)
    span.classList.toggle('after-skip', i === here && here > 1)
    return last ? [span] : [span, el('wbr')]
  })
}
const sameUrl = (a, b) => !!a && !!b && a.replace(/\/$/, '') === b.replace(/\/$/, '')
const sameDoc = (a, b) => !!a && !!b && sameUrl(a.split('#')[0], b.split('#')[0])
const isEditing = t => !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
// Bangs, as DuckDuckGo keeps them (!w psychogeography, !lb parasite, !yt …):
// their list (app/bangs.json, bang → [address with {{{s}}}, name, site]) is
// fetched the first time a "!" is typed, then looked up here, so a bang goes
// straight to the site. A bang alone goes to the site's front page.
let bangs = null
const loadBangs = () => (bangs ||= fetch('bangs.json').then(r => r.json()).catch(() => ({})))
let bangList = {}
const bangOf = t => /^!(\S+)\s*(.*)$/.exec(t) || (m => m && [m[0], m[2], m[1]])(/^(.*?)\s+!(\S+)$/.exec(t))
function bangUrl(t) {
  const m = bangOf(t)
  const b = m && bangList[m[1].toLowerCase()]
  if (!b) return null
  return m[2] ? b[0].replace('{{{s}}}', encodeURIComponent(m[2])) : `https://${b[2]}`
}
// Typed text: an address, a bang, or a small-web search.
// Which names end in a real top-level domain (IANA's list, app/tlds.txt), to
// tell an address (spencer.place) from a file or a word with a dot (node.js).
let tlds = null
fetch('tlds.txt').then(r => r.text()).then(t => (tlds = new Set(t.split('\n').filter(l => l && !l.startsWith('#'))))).catch(() => {})
const realHost = h => !tlds || /^\d+(\.\d+){3}$/.test(h) || tlds.has(h.split('.').at(-1).toLowerCase())
// Where a site's own name begins (bbc.co.uk, not co.uk): the suffixes under
// which names are registered (the Public Suffix List's ICANN part,
// app/suffixes.txt: its rules of more than one label; any one label is one).
let suffixes = null
fetch('suffixes.txt')
  .then(r => r.text())
  .then(t => {
    suffixes = new Set(t.split('\n').filter(l => l && !l.startsWith('#')))
    for (const [id, v] of views) (v.named = null), updateName(id) // (addresses shown before it came gain their domains)
  })
  .catch(() => {})
function ownName(hostname) {
  const labels = hostname.split('.')
  for (let i = 0; i < labels.length - 1; i++) {
    const rest = labels.slice(i).join('.')
    if (suffixes.has(`!${rest}`)) return rest
    if (suffixes.has(rest) || suffixes.has(`*.${labels.slice(i + 1).join('.')}`)) return i ? labels.slice(i - 1).join('.') : null
  }
  return labels.length > 1 ? labels.slice(-2).join('.') : null
}
// The domain a site's host is within, if it isn't its own name already:
// notes.mmm.page → mmm.page, a.b.example.co.uk → b.example.co.uk (and from
// there, example.co.uk). A www. in front is the site itself. It is a place
// too, as tilde.club is above tilde.club/~ford.
function domainAbove(hostname) {
  if (!suffixes || /^[\d.]+$|[:[]/.test(hostname)) return null
  const own = ownName(hostname)?.split('.').length
  const labels = hostname.replace(/^www\./, '').split('.')
  return own && labels.length > own ? labels.slice(1).join('.') : null
}
// A site's front page: its host, the domain it is within a way up inside it.
// (Only there: on its other pages the host is the way up to the front page.)
function hostParts(u) {
  const above = domainAbove(u.hostname)
  if (!above) return [u.host]
  const span = el('span', 'up', above)
  span.dataset.url = `${u.protocol}//${above}/`
  return [u.hostname.slice(0, -above.length), span, u.port ? `:${u.port}` : '']
}
const hostWritten = t => t.split(/[/:?#]/)[0]
function toUrl(text) {
  const t = text.trim()
  if (/^https?:\/\//i.test(t)) return webOnly(t) || SEARCH(t)
  if (bangUrl(t)) return bangUrl(t)
  if (!/\s/.test(t) && /^[\w-]+(\.[\w-]+)+(:\d+)?([/?#].*)?$/.test(t) && realHost(hostWritten(t)) && webOnly(`https://${t}`)) return `https://${t}`
  return SEARCH(t)
}
const looksLikeUrl = t => /^https?:\/\/\S+$/i.test(t) || (!/\s/.test(t) && /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(t) && realHost(hostWritten(t)))

// A button you click doesn't keep the keys (Chrome gives it focus, Safari
// doesn't), so Enter doesn't press it again: they stay where they were.
addEventListener('mousedown', e => e.target.closest?.('button') && e.preventDefault(), true)

let toastTimer
// A short message at the bottom; with an action (like Undo) it stays a little longer.
function toast(text, action) {
  const t = $('#toast')
  t.replaceChildren(text)
  if (action) {
    const b = el('button', null, action.label)
    b.addEventListener('click', () => {
      t.classList.remove('show')
      action.run()
    })
    t.append(b)
  }
  t.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => t.classList.remove('show'), action ? 4500 : 2200)
}
// Things are taught once, the first time they matter, then never again.
const TAUGHT = 'canvas-browser:taught'
function teach(what, text) {
  const taught = JSON.parse(localStorage.getItem(TAUGHT) || '[]')
  if (taught.includes(what)) return
  localStorage.setItem(TAUGHT, JSON.stringify([...taught, what]))
  setTimeout(() => toast(text), 900)
}

// -------------------------------------------------------------------- state
//
// nodes: { id: { id, type, x, y, w, h, z, ... } }, by type:
//   page   url, title, favicon, sx, sy (scroll position)
//   clip   html, fonts, bg, url (its page), title, favicon, selector (of each piece in it, a list)
//   embed  src, url, title, favicon, selector, ratio? (a page that turned out to be a player: its shape), sized?
//   image  src, url?, title?, favicon?, selector?, sized? (a size given to it, not its picture's)
//   note   text, url? (set when it is a quote from a page)
// edges: [{ id, from, to, kind: 'link' | 'clip', url?, fromUrl, selector? }]

const saved = JSON.parse(localStorage.getItem(STORE) || 'null')
const state = { nodes: saved?.nodes || {}, edges: saved?.edges || [], camera: saved?.camera || { x: 0, y: 0, z: 1 } }
const cam = state.camera
const views = new Map() // node id -> its DOM and live state
let selected = null
let restoring = false // pages restored at startup (or brought back by undo) load as they come within reach
let topZ = Math.max(0, ...Object.values(state.nodes).map(n => n.z || 0))

let saveTimer = 0
function save() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(flush, 300)
}
// localStorage holds 5 MB, which clips and pasted images would fill: the
// canvas is kept there light, and each thing's heavy content (a clip's copied
// page, a pasted image) once in IndexedDB, brought back at start.
function flush() {
  clearTimeout(saveTimer)
  saveTimer = 0
  if (writer !== STORE) return
  try {
    localStorage.setItem(STORE, JSON.stringify({ ...state, nodes: Object.fromEntries(Object.values(state.nodes).map(n => [n.id, light(n)])) }))
  } catch (err) {
    console.warn('canvas not saved', err)
    toast("couldn't save: storage is full")
  }
}
// One tab writes a canvas: the first to open it, while
// it is open. Each saves the whole canvas, so a second tab on the same canvas
// would write over what the first did: it says so, and keeps nothing.
let writer = null // the canvas this tab writes, once it holds its lock (false: another tab holds it)
let letGoOfCanvas = () => {}
const ELSEWHERE = 'open in another tab: not saving here'
function own() {
  letGoOfCanvas()
  writer = null
  if (!navigator.locks) return (writer = STORE) // (a browser without locks: as before)
  const name = STORE
  navigator.locks.request(name, { ifAvailable: true }, lock => {
    if (name !== STORE) return // (moved on to another canvas meanwhile)
    if (!lock) {
      writer = false
      return toast(ELSEWHERE)
    }
    writer = name
    save() // what was done while asking
    return new Promise(done => (letGoOfCanvas = () => ((writer = null), done()))) // held until let go of
  })
}
own()
// A change made just before the tab is closed or hidden is not lost. A tab
// put away (closed, or kept in the back-forward cache) lets go of its canvas;
// brought back, it starts again from what is saved (another tab may have
// written it meanwhile).
addEventListener('pagehide', () => {
  if (saveTimer) flush()
  letGoOfCanvas()
})
addEventListener('pageshow', e => e.persisted && location.reload())
document.addEventListener('visibilitychange', () => document.hidden && saveTimer && flush())

// Undo steps back through what you did (not the camera). A step is what you
// decide about each thing: where it is, the size you give it, what you write,
// what it is stuck to, and which things and lines are on the canvas at all.
// What pages and measuring report isn't a step, so undo leaves it as it is
// now: where a page has gone since and its title, icon and scroll, when you
// last read it, stacking, a note's or a clip's height (they follow their
// content), an image's size from its picture and a player's height from its
// shape (until you give them one), a page that turned out to be a player,
// where a link landed. A thing brought back comes back as it was when it
// went. So a step keeps the things themselves (a thing is always the same
// object, the one its view holds) with what was decided about them then;
// its `key` tells whether anything was.
const past = []
const future = []
// What was decided about a thing that hasn't changed since the last step is
// the very same object (and text) as then, so the steps share it: a step adds
// only what changed. Its `key` (each thing's decisions as text, then the
// lines) tells it from the one before.
let decided = new Map() // id -> { json, made } at the last step taken
function snapshot() {
  const nodes = Object.values(state.nodes)
  const made = []
  const key = []
  const now = new Map()
  for (const n of nodes) {
    const m = madeOf(n)
    const json = JSON.stringify(m)
    const was = decided.get(n.id)
    const d = was?.json === json ? was : { json, made: m }
    now.set(n.id, d)
    made.push(d.made)
    key.push(d.json)
  }
  decided = now
  key.push(state.edges.map(e => e.id).join(' '))
  return { key, nodes, made, edges: [...state.edges] }
}
const sameStep = (a, b) => a.key.length === b.key.length && a.key.every((k, i) => k === b.key[i])
// What is yours about a thing. An image's size comes from its picture, and a
// page that turned out to be a player has its shape, until you give them one
// (`sized`, see resize); a note's and a clip's height follow their content.
const fromContent = n => n.type === 'image' || !!n.ratio
function madeKeys(n) {
  const measured = fromContent(n) && !n.sized
  return ['x', 'y', ...(measured && n.type === 'image' ? [] : ['w']), ...(measured || n.type === 'note' || n.type === 'clip' ? [] : ['h']), ...(n.type === 'note' ? ['text', 'on', 'dx', 'dy'] : []), 'sized']
}
function madeOf(n) {
  const made = { id: n.id }
  for (const k of madeKeys(n)) if (k in n) made[k] = n[k]
  return made
}
// a thing as it was decided at a step; the rest of it stays as it is
function restoreMade(n, made) {
  made.sized ? (n.sized = true) : delete n.sized // first: it says which sizes are yours
  for (const k of madeKeys(n)) k in made ? (n[k] = made[k]) : delete n[k]
}
let lastSnap = null // the canvas as it starts (start), then after each step
// `what` describes the change for the walk's history (see below).
function commit(what) {
  if (what) soundFor(what)
  const s = snapshot()
  if (!sameStep(s, lastSnap)) {
    past.push(lastSnap)
    if (past.length > 100) past.shift()
    future.length = 0
    lastSnap = s
  }
  if (writer === false) toast(ELSEWHERE)
  save()
  refreshChrome()
}
function restore(s) {
  const was = state.nodes
  const there = new Set(s.nodes.map(n => n.id))
  for (const id in was) if (!there.has(id)) unmark(id) // (while its lines are still there)
  state.nodes = {}
  s.nodes.forEach((n, i) => {
    if (lost(n)) return
    restoreMade(n, s.made[i])
    state.nodes[n.id] = n
  })
  state.edges = s.edges.filter(e => state.nodes[e.from] && state.nodes[e.to])
  lastSnap = s
  for (const id of [...views.keys()]) if (!state.nodes[id]) unmount(id)
  if (selected && !state.nodes[selected]) selected = null
  if (focused && !state.nodes[focused]) setFocused(null)
  // what comes back loads as at the start: live within reach, else (as its
  // kept copy, if it slept) when it comes near
  const back = Object.values(state.nodes).filter(n => !views.has(n.id))
  restoring = true
  for (const n of Object.values(state.nodes)) {
    fitContent(n)
    views.has(n.id) ? place(n) : mount(n)
  }
  restoring = false
  for (const n of back) if (n.type === 'page' && !views.get(n.id).frame) idb('stills', 'readonly', st => st.get(copyKey(n.id))).then(c => c?.url === n.url && showCopy(n.id, c), () => {})
  const came = new Set(back.map(n => n.id))
  for (const n of Object.values(state.nodes)) if (n.type === 'page') markTaken(n.id, came)
  for (const node of Object.values(state.nodes)) if (node.type === 'note') showWriting(node.id) // its words may be as they were
  for (const node of Object.values(state.nodes)) if (node.type === 'note') place(node) // (measured with them)
  knowDoors()
  drawEdges()
  save()
  refreshChrome()
}
// Undo and redo take you to what they change: what they bring back (a page
// closed, a piece cut), or, taking a thing away (a page opened), the page it
// came from. You are there as one you travel to: selected and in focus.
function undo() {
  if (past.length) step(past, future)
}
function redo() {
  if (future.length) step(future, past)
}
function step(from, to) {
  const had = new Set(Object.keys(state.nodes))
  const edges = state.edges
  to.push(lastSnap)
  restore(from.pop())
  const came = Object.keys(state.nodes).find(id => !had.has(id))
  const origin = edges.find(e => !state.nodes[e.to] && state.nodes[e.from])?.from
  if (came || origin) travel(came || origin)
}

// ------------------------------------------------------------------ storage
// The heavy content of clips and pasted images is kept in IndexedDB, once per
// thing, not in every save.

const HEAVY = ['html', 'fonts', 'bg']
// Opened at whatever version it already is, so the canvas never waits for an
// upgrade (which another tab, or a page kept in the back-forward cache, would
// hold up forever). Copies of sleeping pages live in a database of their own
// for the same reason. A connection asked to step aside for an upgrade does.
function openDb(name, make) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(name)
    open.onupgradeneeded = () => make(open.result)
    open.onsuccess = () => {
      open.result.onversionchange = () => open.result.close()
      resolve(open.result)
    }
    open.onerror = () => reject(open.error)
  })
}
const dbs = {
  main: openDb('canvas-browser', d => {
    d.createObjectStore('content')
  }),
  stills: openDb('canvas-browser-copies', d => d.createObjectStore('stills')), // page -> its last sleeping copy
}
async function idb(store, mode, fn) {
  const tx = (await (store === 'stills' ? dbs.stills : dbs.main)).transaction(store, mode)
  const result = fn(tx.objectStore(store))
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(result.result ?? result)
    tx.onerror = () => reject(tx.error)
  })
}
// A thing's heavy content: a clip's copied page, and a picture kept in the
// canvas itself (a data: address, as a pasted image's). It never changes once
// made, so it is kept once.
function heavyOf(n) {
  const content = {}
  for (const k of HEAVY) if (k in n) content[k] = n[k]
  if (/^data:/.test(n.src || '')) content.src = n.src
  return content
}
const heavyContent = new Map() // node id -> its heavy fields, once (they never change)
function light(node) {
  const n = { ...node }
  const content = heavyOf(n)
  if (!Object.keys(content).length) return n
  if (!heavyContent.has(n.id)) {
    heavyContent.set(n.id, content)
    idb('content', 'readwrite', s => s.put(content, n.id))
  }
  for (const k of HEAVY) delete n[k]
  if (content.src) n.src = 'content'
  n.held = true // its content is in heavyContent and IndexedDB
  return n
}
// a light node made whole again
function heavy(n) {
  if (n.held && heavyContent.has(n.id)) {
    Object.assign(n, heavyContent.get(n.id))
    delete n.held
  }
  return n
}
// a clip made by an earlier version (a window onto a page), or whose content
// didn't come back from storage, can't be shown; nor can a page without a web
// address (one taken from a page before addresses were checked)
const lost = n => (n.type === 'clip' && !n.html) || n.src === 'content' || ((n.type === 'page' || n.type === 'ghost') && !webOnly(n.url))

// ------------------------------------------------------------------- camera
// While the camera moves, the world is one GPU layer that is moved and scaled
// as a picture; when it stops, pages render sharp again at the new zoom.

let camAnim = 0
let lastZ = null
let settleTimer = 0
// ms: while fingers move or glide, a gesture's events come every frame or
// two; this long without one, it is over. The view settles (drawn sharp,
// pages in reach woken) only then, never in the middle of a gesture.
const STILL = 250
// Things that keep their size on screen (page names, handles, captions) are
// sized by --z. Changing it restyles all of them, so it changes once a zoom
// settles, not at every step (that was the whole of the zoom stutter): while
// zooming they scale with the canvas for a moment.
function settleZoom() {
  if (world.style.getPropertyValue('--z') !== String(cam.z)) world.style.setProperty('--z', cam.z)
}
const MAT_CM = 96 / 2.54 // a centimetre in CSS pixels (96 to the inch): the mat's square at 100%
function applyCamera() {
  // A view that isn't a real position can't be drawn or moved, and saved it
  // would come back that way on every reload; it goes back to the last real one.
  if (![cam.x, cam.y, cam.z].every(Number.isFinite) || cam.z <= 0) Object.assign(cam, lastGoodCam)
  lastGoodCam = { ...cam }
  // on whole device pixels, so a page at 100% is drawn sharp
  const px = v => Math.round(v * devicePixelRatio) / devicePixelRatio
  world.style.transform = `translate(${px(cam.x)}px, ${px(cam.y)}px) scale(${cam.z})`
  // the paper's grain moves with it
  canvas.style.setProperty('--mx', `${px(cam.x)}px`)
  canvas.style.setProperty('--my', `${px(cam.y)}px`)
  document.body.classList.add('moving')
  clearTimeout(settleTimer)
  settleTimer = setTimeout(() => {
    document.body.classList.remove('moving')
    settleZoom()
    tend()
    hoverAtPointer()
    if (selected && state.nodes[selected] && !inView(state.nodes[selected])) select(null) // (what you picked, out of sight, is let go)
  }, STILL)
  if (lastZ === null) settleZoom()
  if (cam.z !== lastZ) {
    lastZ = cam.z
    document.body.classList.toggle('overview', cam.z < OVERVIEW_Z)
  }
  save()
}
let lastGoodCam = { x: 0, y: 0, z: 1 }
const toWorld = (sx, sy) => ({ x: (sx - cam.x) / cam.z, y: (sy - cam.y) / cam.z })
const toScreen = (wx, wy) => ({ x: wx * cam.z + cam.x, y: wy * cam.z + cam.y })
// A point inside a node's frame (page coordinates) on the canvas.
// (a page's frame lies within its paper: PRINT.side in from its left edge)
function frameToWorld(id, fx, fy) {
  const n = state.nodes[id]
  return { x: n.x + fx + (n.type === 'page' ? PRINT.side : 0), y: n.y + fy }
}
// A page's paper round the site printed on it, at its sides and foot (its
// head is NAME; style.css --side)
const PRINT = { side: 9 }

function stopCamera() {
  cancelAnimationFrame(camAnim)
  camAnim = 0
}
function zoomAt(sx, sy, factor, pinch) {
  if (![sx, sy, factor].every(Number.isFinite) || factor <= 0) return // never turn the view into a non-number
  stopCamera()
  endFocus()
  // out to MIN_Z, or further if that's what it takes to see everything (and
  // never in, from out there, unless a pinch went out past it)
  const want = cam.z * factor
  const lo = want < MIN_Z ? Math.min(MIN_Z, everything()?.z ?? MIN_Z) : MIN_Z
  const floor = stretched ? lo : Math.min(lo, cam.z)
  let z = clamp(want, floor, MAX_Z)
  // A pinch goes on past a limit, harder the further it goes, and the view
  // springs back to it when the pinch is over (see scroll and pinch).
  if (pinch && z !== want) {
    const limit = want > MAX_Z ? MAX_Z : floor
    const away = want > MAX_Z ? factor > 1 : factor < 1
    const past = Math.max(0, Math.log(limit === MAX_Z ? cam.z / limit : limit / cam.z)) / STRETCH // 0 at the limit, 1 at the furthest
    z = away ? cam.z * factor ** Math.max(0, 1 - past) ** 2 : want
    stretched = { limit, x: sx, y: sy }
  }
  const p = toWorld(sx, sy)
  cam.x = sx - p.x * z
  cam.y = sy - p.y * z
  cam.z = z
  applyCamera()
}
const STRETCH = Math.log(1.25) // how far past a limit a pinch can go: a quarter
let stretched = null // the limit a pinch went past, and where
function springBack() {
  if (!stretched) return
  const { limit, x, y } = stretched
  stretched = null
  if ((limit === MAX_Z) !== (cam.z > limit)) return // (back within it already)
  const p = toWorld(x, y)
  animateCamera({ z: limit, x: x - p.x * limit, y: y - p.y * limit })
}
function panBy(dx, dy) {
  stopCamera()
  endFocus()
  cam.x -= dx
  cam.y -= dy
  applyCamera()
}
// A flicked canvas keeps going and slows to a stop, like a sheet slid across
// a table: the speed of the last tenth of a second carries on, losing most of
// it in about half a second. Anything you do stops it.
function glide(trail = []) {
  const last = trail.at(-1)
  const first = trail[0]
  if (reduceMotion || !last || last === first || performance.now() - last.t > 50) return
  let vx = (last.x - first.x) / (last.t - first.t)
  let vy = (last.y - first.y) / (last.t - first.t)
  if (Math.hypot(vx, vy) < 0.25) return // a slow drag ends where it was put down
  let t0 = performance.now()
  const step = t => {
    const dt = Math.min(32, t - t0)
    t0 = t
    cam.x += vx * dt
    cam.y += vy * dt
    applyCamera()
    const keep = Math.pow(0.995, dt)
    vx *= keep
    vy *= keep
    camAnim = Math.hypot(vx, vy) > 0.02 ? requestAnimationFrame(step) : 0
  }
  camAnim = requestAnimationFrame(step)
}
// Moves the world point at the centre of the screen, and zooms on a log scale.
function animateCamera(to, ms = 480) {
  stopCamera()
  if (reduceMotion) ms = 1
  const cx = innerWidth / 2
  const cy = innerHeight / 2
  const from = { ...cam }
  const c0 = { x: (cx - from.x) / from.z, y: (cy - from.y) / from.z }
  const c1 = { x: (cx - to.x) / to.z, y: (cy - to.y) / to.z }
  const t0 = performance.now()
  const step = now => {
    const t = Math.min(1, (now - t0) / ms)
    const k = 1 - Math.pow(1 - t, 3)
    cam.z = Math.exp(Math.log(from.z) + (Math.log(to.z) - Math.log(from.z)) * k)
    cam.x = cx - (c0.x + (c1.x - c0.x) * k) * cam.z
    cam.y = cy - (c0.y + (c1.y - c0.y) * k) * cam.z
    if (t === 1) Object.assign(cam, { x: to.x, y: to.y, z: to.z }) // exactly there (the sums above can be a hair off it)
    applyCamera()
    camAnim = t < 1 ? requestAnimationFrame(step) : 0
  }
  camAnim = requestAnimationFrame(step)
}
const cameraOn = (box, z) => ({ z, x: innerWidth / 2 - (box.x + box.w / 2) * z, y: innerHeight / 2 - (box.y + box.h / 2) * z })

// Moves the camera as little as possible to bring a node on screen.
function reveal(id, margin = 64) {
  const n = state.nodes[id]
  if (!n) return
  const fit = Math.min((innerWidth - 2 * margin) / n.w, (innerHeight - 2 * margin) / (n.h + 30))
  if (cam.z > fit) return animateCamera(cameraOn(n, Math.max(fit, MIN_Z)))
  let { x, y } = cam
  const l = n.x * cam.z + x
  const r = (n.x + n.w) * cam.z + x
  const t = (n.y - 30) * cam.z + y
  const b = (n.y + n.h) * cam.z + y
  if (l < margin) x += margin - l
  else if (r > innerWidth - margin) x -= r - (innerWidth - margin)
  if (t < margin) y += margin - t
  else if (b > innerHeight - margin) y -= b - (innerHeight - margin)
  if (x !== cam.x || y !== cam.y) animateCamera({ z: cam.z, x, y })
}

// Everything on the canvas, and the zoom that shows all of it
function everything() {
  const nodes = Object.values(state.nodes)
  if (!nodes.length) return null
  const x0 = Math.min(...nodes.map(n => n.x))
  const y0 = Math.min(...nodes.map(n => n.y)) - 30
  const x1 = Math.max(...nodes.map(n => n.x + n.w))
  const y1 = Math.max(...nodes.map(n => n.y + n.h))
  return { box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, z: Math.min((innerWidth - 144) / (x1 - x0), (innerHeight - 144) / (y1 - y0)) }
}
function fitAll() {
  const all = everything()
  if (all) animateCamera(cameraOn(all.box, Math.min(all.z, 1)))
}

// Reading focus. Opening a page (or double-clicking its name) brings it to
// the screen at a size for reading, with a margin of canvas around it: on
// one side the band where the page you came from lies, in the corner of
// your eye, the line from it running across; the rest fades back. Moving the
// canvas yourself, clicking elsewhere, or esc ends it (esc also goes back to
// where you were).
let focusReturn = null
let focused = null
let beside = null // { id, edge }: the page kept in view beside the one read (if one can be), and the line between them
// (`from`: the page you are coming from, by default the one being read)
function focusNode(id, { toggle = true, from = focused } = {}) {
  if (toggle && focused === id) return unfocus()
  const n = state.nodes[id]
  if (!n) return
  n.seen = Date.now() // for "recent" in /
  touch(id)
  wake(id)
  if (!focused) focusReturn = { cam: { ...cam }, id } // the view you were in, and the page you began reading from it
  keepBeside(id, from)
  setFocused(id)
  keysTo(id)
  animateCamera(framing(n, state.nodes[beside?.id]))
}
// The view that frames a thing for reading: never past 100% (an enlarged
// page has soft text), on whole pixels. At 100% it leaves the band on the
// side of `o`, the page kept beside it; else it is centred.
function framing(n, o) {
  const room = { w: innerWidth - 2 * FRAME.side, h: innerHeight - FRAME.top - FRAME.bottom }
  if (o && over(n, o)) {
    // the page you came from above or below: the page read goes to the far
    // side, a little smaller if it must, so that as much of that one as
    // DESK shows stays in view across the gap (and its tab)
    const gap = Math.max(n.y - (o.y + o.h), o.y - (n.y + n.h))
    const z = clamp(Math.min(room.w / n.w, room.h / (n.h + gap + NAME + DESK.show), 1), MIN_Z, 1)
    const top = o.y < n.y ? FRAME.top + room.h - n.h * z : FRAME.top
    return { z, x: Math.round((innerWidth - n.w * z) / 2 - n.x * z), y: Math.round(top - n.y * z) }
  }
  // the page you came from level with it: as above or below, across
  const gap = o ? Math.max(n.x - (o.x + o.w), o.x - (n.x + n.w)) : 0
  const z = clamp(Math.min(room.w / (n.w + (o ? gap + DESK.show : 0)), room.h / n.h, 1), MIN_Z, 1)
  const left = !o ? (innerWidth - n.w * z) / 2 : o.x < n.x ? FRAME.side + room.w - n.w * z : FRAME.side
  return { z, x: Math.round(left - n.x * z), y: Math.round(FRAME.top + (room.h - n.h * z) / 2 - n.y * z) }
}
// What is kept in view beside a page you go to: the page you come to it
// from, if a line joins them (a link followed, or back along one), else the
// one it was opened from, else the newest page opened from it (the walk goes
// on there); only one that lies beside it, so in the band, and near: where a
// page opened from it is laid (within LAID), not one moved far off. When none
// can be, the line from where it came from is still kept, coming in from the
// edge.
function keepBeside(id, from) {
  const n = state.nodes[id]
  const line = o => state.edges.find(e => (e.from === o && e.to === id) || (e.from === id && e.to === o))
  const joined = o => o && o !== id && state.nodes[o] && !views.get(o)?.closing && line(o)
  const origin = state.edges.find(e => e.to === id && state.nodes[e.from])?.from
  const opened = state.edges.filter(e => e.from === id && state.nodes[e.to]?.type === 'page').map(e => state.nodes[e.to]).sort((a, b) => (b.created || 0) - (a.created || 0)).map(c => c.id)
  const o = [from, origin, ...opened].find(o => joined(o) && inBand(n, state.nodes[o]) && apart(n, state.nodes[o]) <= LAID)
  const thread = o || [from, origin].find(joined)
  beside = thread ? { id: o || null, edge: line(thread).id } : null
}
// whether `o` lies beside `n` so that it can be in view while `n` is read:
// level with it, or above or below it (see framing)
function inBand(n, o) {
  const gap = Math.max(n.x - (o.x + o.w), o.x - (n.x + n.w))
  const level = Math.min(n.y + n.h, o.y + o.h) - Math.max(n.y, o.y)
  return (gap >= 0 && level >= DESK.least) || over(n, o)
}
// how far apart two things lie, edge to edge (0 if they overlap)
const apart = (n, o) => Math.max(0, n.x - (o.x + o.w), o.x - (n.x + n.w), n.y - (o.y + o.h), o.y - (n.y + n.h))
// whether `o` lies above or below `n`, overlapping it across
const over = (n, o) => Math.max(n.y - (o.y + o.h), o.y - (n.y + n.h)) >= 0 && Math.min(n.x + n.w, o.x + o.w) - Math.max(n.x, o.x) >= DESK.least
// The page kept beside the one read is as it is, not faded with the rest;
// nor is the line between them.
function markBeside() {
  if (!focused) beside = null
  for (const [id, v] of views) v.el.classList.toggle('beside', id === beside?.id)
  drawEdges()
}
// The window changing size (resized, full screen) while you read a page: the
// page is read as a tab, so it becomes a tab of the new size (reflowed, still
// at 100%, not scaled), centred, its name in view. Anything else you're
// looking at is only framed again.
let resizing = 0
addEventListener('resize', () => {
  cancelAnimationFrame(resizing)
  resizing = requestAnimationFrame(() => {
    const n = focused && state.nodes[focused]
    if (!n) return
    if (n.type === 'page') {
      Object.assign(n, pageSize())
      place(n)
      carry(n)
      drawEdges()
      save()
    }
    stopCamera()
    Object.assign(cam, framing(n, state.nodes[beside?.id]))
    applyCamera()
  })
})
function setFocused(id) {
  if (focused) views.get(focused)?.el.classList.remove('focused')
  focused = id && state.nodes[id] ? id : null
  if (focused) views.get(focused).el.classList.add('focused')
  markReading()
  markBeside()
  document.body.classList.toggle('focusing', !!focused)
}
// What belongs to the page being read is seen as it is while the rest fades:
// the notes stuck on it and the pieces cut from it.
function markReading() {
  for (const v of views.values()) v.el.classList.remove('on-focused')
  if (!focused) return
  for (const note of notesOn(focused)) views.get(note.id)?.el.classList.add('on-focused')
  for (const e of state.edges) if (e.from === focused && e.kind === 'clip') views.get(e.to)?.el.classList.add('on-focused')
}
function endFocus() {
  if (focused) setFocused(null)
}
function unfocus() {
  if (!focused) return false
  const id = focused
  setFocused(null)
  // Back to the view you were in when you began reading this page. If you
  // have walked on since, that view is behind you: you step back from the
  // page you are on, to see it among the pages it joins.
  animateCamera(focusReturn?.id === id ? focusReturn.cam : around(id))
  focusReturn = null
  return true
}
// The page a key means: the one under the pointer, else the one the keys are
// in (`from`), else the one nearest the middle of the view.
let hovered = null // the thing under the pointer (the canvas sees no moves inside a page, but sees it come in)
function hover(id) {
  if (hovered === id) return
  if (hovered) views.get(hovered)?.el.classList.remove('under')
  if (hovered && state.nodes[hovered]) hot(hovered, false)
  hovered = id
  if (id) views.get(id)?.el.classList.add('under')
  if (id) hot(id, true)
}
// what is under the pointer once things have moved under it (the browser
// tells the canvas only when the pointer moves)
function hoverAtPointer() {
  if (pointerAt) hover(document.elementFromPoint(pointerAt.x, pointerAt.y)?.closest('.node')?.dataset.id ?? null)
}
function pageNear(from) {
  if (state.nodes[hovered]?.type === 'page') return hovered
  if (from) return from
  const pages = Object.values(state.nodes).filter(n => n.type === 'page')
  const c = toWorld(innerWidth / 2, innerHeight / 2)
  return pages.filter(n => inView(n) > 0).sort((a, b) => Math.hypot(centreOf(a).x - c.x, centreOf(a).y - c.y) - Math.hypot(centreOf(b).x - c.x, centreOf(b).y - c.y))[0]?.id
}
// A page among the pages it joins (where it came from, where it led), with
// the room the canvas keeps around a place on every side
function around(id) {
  const near = [id, ...state.edges.filter(e => e.from === id || e.to === id).flatMap(e => [e.from, e.to])].map(x => state.nodes[x]).filter(Boolean)
  const x = Math.min(...near.map(n => n.x)) - PLACE.gap
  const y = Math.min(...near.map(n => n.y)) - NAME - PLACE.gap
  const box = { x, y, w: Math.max(...near.map(n => n.x + n.w)) + PLACE.gap - x, h: Math.max(...near.map(n => n.y + n.h)) + PLACE.gap - y }
  return cameraOn(box, clamp(Math.min(innerWidth / box.w, innerHeight / box.h), MIN_Z, 1))
}

// ------------------------------------------------------------------- layout
// Things flow outward. A page opened from another goes on in the direction
// the walk is heading (away from where that page itself came from), with a
// clear line back to where it came from.

// It is a workbench for internet paper: pages lie on it as sheets. A page
// opened from another is laid down close beside it, by the line you were
// reading, so the page you came from stays in the corner of your eye while
// you read the new one (spotBeside); the desk makes room for it. What is
// taken out of a page (a clip, an image, a quote) is laid close to it too.
// Places that aren't opened from another keep their room apart.
// Every distance on the table is in squares of the mat (SQ: MAT_CM, a
// centimetre at 100%, the grid you see), so they all fit together.
const SQ = MAT_CM
const sq = n => Math.round(n * SQ) // n squares, in whole pixels (a sheet at a fraction of one would blur)
const ROOM = sq(1) // around a piece, beside its page (and twice that between a piece and its page)
const PLACE = { gap: sq(12), room: sq(5) } // between places: far enough apart to read as separate walks, zoomed out
// A page opened from another and the page it came from, as sheets on a desk
const DESK = {
  gap: sq(1), // between them: a square of the mat, enough for the line from the link to read as a line across it
  show: sq(1), // of the page you came from, in view while you read: enough to know it is there, the page read stays the one in front of you
  least: sq(1 / 3), // less of it than this in view reads as a stray line at the window's edge, not a page
}
// Every distance a hand sets down is in squares of the mat (MAT_CM, a
// centimetre at 100%, the grid you see): the gap a square, its
// unsureness across the gap a quarter of that, along the sheet beside it
// eight squares; a piece within half a square.
// A sheet set down by hand lands near where it is aimed, never exactly there:
// within about a centimetre along the sheet beside it (a hand on a desk is
// that sure, no surer), and a couple of pixels nearer or further, so the gap
// between them stays the least that shows. Where it landed is kept, as any
// place is.
const HAND = sq(1)
const NEAR = DESK.gap / 4
const ALONG = sq(8) // along the sheet beside it: up to eight squares either way, so no two land alike (the gap between them stays as it is)
const byHand = (most = HAND) => Math.round((Math.random() * 2 - 1) * most)
// A page within four squares of the one it came from was laid beside it
// (sheets laid before 3 Nov 2026 lie up to 128 px apart)
const LAID = sq(4)
const BAND = DESK.gap + DESK.show // the band of the window beside the page read, for the page you came from

const NAME = sq(0.75) // the height of a page's tab above it (style.css: --tab-h)
function overlaps(r, room = ROOM) {
  for (const n of Object.values(state.nodes)) {
    if (r.x < n.x + n.w + room && r.x + r.w + room > n.x && r.y - NAME < n.y + n.h + room && r.y + r.h + room > n.y - NAME) return true
  }
  return false
}
const centreOf = n => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 })
// The direction to grow in from a node: away from the thing it came from.
function outward(from) {
  const edge = state.edges.find(e => e.to === from.id && state.nodes[e.from])
  if (!edge) return { x: 1, y: 0 }
  const a = centreOf(state.nodes[edge.from])
  const b = centreOf(from)
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
  return { x: (b.x - a.x) / len, y: (b.y - a.y) / len }
}
// Where something of `size` coming out of `from` belongs: on along the
// trail's direction, tilted toward `towardY` (a height on the canvas, e.g.
// the link that was clicked).
function aim(from, size, towardY, gap) {
  const dir = outward(from)
  const c = centreOf(from)
  const tilt = towardY == null ? 0 : clamp(Math.atan2(towardY - c.y, from.w) * 0.6, -0.5, 0.5)
  const base = Math.atan2(dir.y, dir.x) + (Math.abs(dir.x) > 0.7 ? Math.sign(dir.x) * tilt : 0)
  const reach = (Math.abs(Math.cos(base)) * (from.w + size.w) + Math.abs(Math.sin(base)) * (from.h + size.h)) / 2 + gap
  return { c, dir, base, reach, across: Math.abs(dir.x) >= Math.abs(dir.y) ? 'y' : 'x' }
}
// A free spot for something of `size` coming out of `from`: where it belongs
// if that is free, else fanning out from there.
function spotFrom(from, size, towardY, { gap = ROOM * 2, room = ROOM } = {}) {
  const { c, base, reach } = aim(from, size, towardY, gap)
  let fallback = null
  const turns = [0]
  for (let t = 0.2; t <= 2.6; t += 0.2) turns.push(t, -t)
  for (let ring = 0; ring < 8; ring++) {
    for (const turn of turns) {
      const a = base + turn
      const d = reach + ring * (Math.max(size.w, size.h) * 0.5 + room)
      const r = { x: Math.round(c.x + Math.cos(a) * d - size.w / 2), y: Math.round(c.y + Math.sin(a) * d - size.h / 2), ...size }
      if (overlaps(r, room)) continue
      if (!blocked(from, r)) return r
      fallback ??= r
    }
  }
  return fallback || spotFree(c.x + reach, c.y - size.h / 2, size, room)
}
// Where a page opened from another goes when the space beside it is taken by
// what is the page's own (see spotBeside): into the nearest open space
// around the page it came from. First the side its link points to,
// then on round the page (corners, above and below), last the side that page
// itself came from. Spaces taken by this walk are passed over, so pages opened
// one after another spread around their page instead of piling up. Anything
// else in that space slides away from the new page, outward in whatever
// direction it already lies, just enough to make the space; a walk that is
// pushed moves as a whole, so its shape is kept.
function spotAround(from, size, towardY, { gap, room }) {
  const walk = walkOf(from.id)
  const { base } = aim(from, size, towardY, gap)
  const cx = from.x + from.w / 2
  const cy = from.y + from.h / 2
  // the spaces around the page: a grid of page-sized spaces a gap apart
  const colX = i => (i === 0 ? cx - size.w / 2 : i > 0 ? from.x + from.w + gap + (i - 1) * (size.w + gap) : from.x - gap - size.w + (i + 1) * (size.w + gap))
  const rowY = j => (j === 0 ? cy - size.h / 2 : j > 0 ? from.y + from.h + gap + NAME + (j - 1) * (size.h + gap + NAME) : from.y - gap - NAME - size.h + (j + 1) * (size.h + gap + NAME))
  const turn = a => Math.abs(Math.atan2(Math.sin(a - base), Math.cos(a - base))) // how far round from the link's side
  const taken = box => Object.values(state.nodes).some(n => walk.has(n.id) && overlap(box, n, roomBetween(box, n, room)))
  for (let ring = 1; ring < 50; ring++) {
    const spaces = []
    for (let i = -ring; i <= ring; i++) for (let j = -ring; j <= ring; j++) if (Math.max(Math.abs(i), Math.abs(j)) === ring) spaces.push({ x: Math.round(colX(i)), y: Math.round(rowY(j)), ...size, type: 'page' })
    spaces.sort((a, b) => turn(Math.atan2(a.y + a.h / 2 - cy, a.x + a.w / 2 - cx)) - turn(Math.atan2(b.y + b.h / 2 - cy, b.x + b.w / 2 - cx)))
    const space = spaces.find(sp => !taken(sp))
    if (!space) continue
    slide(makeRoom(space, walk, room))
    return { x: space.x, y: space.y, ...size }
  }
  return spotFrom(from, size, towardY, { gap, room })
}
// A page opened from another is set down right beside it, as a hand puts a
// sheet down by the one being read: a desk's gap from it, in the first of the
// eight spaces around it that is free (nothing of this walk there; anything
// else there moves out of the way): the one nearest the link (`at`, where
// the hand is), or now and then the next nearest, so a walk turns and
// spreads over the table instead of running off in a line. Beside it, its
// top is a name's height above the line you were reading (`linkY`, where the
// link was in view), so that the line from the link runs straight across
// into it, beside its first lines: at most half a page lower, so that at
// least half of the page you came from stays beside the one you read. When
// all eight are taken, it goes on the side the walk is heading anyway:
// the pages opened from that page before, and the rest of the walk below
// them, move down just enough to make the space, as a row opens in an
// outline, so the newest is always the nearest and the walk keeps its shape.
// (When what is beside is the page's own, a piece cut from it, or where it
// came from, it goes into the nearest open space further round.)
function spotBeside(from, size, at, linkY) {
  const walk = walkOf(from.id)
  const side = outward(from).x < 0 ? -1 : 1
  const aimed = linkY == null ? from.y : from.y + clamp(Math.round(linkY - from.y - NAME), 0, Math.round(from.h / 2))
  const col = i => (i > 0 ? from.x + from.w + DESK.gap : i < 0 ? from.x - DESK.gap - size.w : from.x + Math.round((from.w - size.w) / 2))
  const row = j => (j > 0 ? from.y + from.h + DESK.gap + NAME : j < 0 ? from.y - DESK.gap - NAME - size.h : aimed)
  const spaces = []
  for (const i of [-1, 0, 1]) for (const j of [-1, 0, 1]) if (i || j) spaces.push({ i, j, x: col(i), y: row(j) })
  // how far the hand goes from the link to put it there (to its nearest edge)
  const far = s => Math.hypot(Math.max(s.x - at.x, 0, at.x - s.x - size.w), Math.max(s.y - at.y, 0, at.y - s.y - size.h))
  spaces.sort((a, b) => far(a) - far(b))
  // set down by hand: a little along the page's edge (never so low beside it
  // that the line from the link misses it), a pixel or two nearer or further
  const laid = s => {
    const y = s.y + byHand(s.j ? NEAR : ALONG)
    return { type: 'page', x: s.x + byHand(s.i ? NEAR : ALONG), y: s.j || linkY == null ? y : Math.min(y, Math.round(at.y) - DESK.least), ...size }
  }
  const taken = s => Object.values(state.nodes).some(n => walk.has(n.id) && overlap(s, n, DESK.gap / 2))
  // the free ones, nearest first; a hand takes the nearest, or now and then
  // (one time in three) the next nearest: the walk turns, as on a table
  const free = spaces.map(s => [laid(s), { type: 'page', x: s.x, y: s.y, ...size }].find(p => !taken(p))).filter(Boolean)
  if (free.length) {
    const space = free[free.length > 1 && Math.random() < 1 / 3 ? 1 : 0]
    slide(makeRoom(space, walk, PLACE.room))
    return { x: space.x, y: space.y, ...size }
  }
  const space = laid(spaces.find(s => s.i === side && !s.j))
  const { nodes, owner, fixed } = rows(from)
  // in the way: a page within half a desk's gap of the space (as when free); a piece within its room
  const near = n => n.id !== from.id && overlap(space, n, n.type === 'page' ? DESK.gap / 2 : ROOM)
  const inWay = nodes.filter(n => walk.has(n.id) && near(n))
  if (inWay.some(fixed)) return spotAround(from, size, at.y, { gap: DESK.gap, room: DESK.gap / 2 })
  const all = new Map() // id -> how far it moves
  const move = moved => {
    for (const [id, { dx, dy }] of moved) {
      const n = state.nodes[id]
      n.x += dx
      n.y += dy
      const m = all.get(id) || { dx: 0, dy: 0 }
      all.set(id, { dx: m.dx + dx, dy: m.dy + dy })
    }
  }
  if (inWay.length) {
    // the row opens at the top of what is in the space: all of the walk from
    // there down goes down together, just far enough to clear it by a desk's
    // gap (as sheets pushed aside on a desk)
    const line = Math.min(...inWay.map(n => owner(n).y))
    const going = nodes.filter(n => !fixed(n) && owner(n).y >= line)
    const across = n => n.x < space.x + space.w + DESK.gap && n.x + n.w + DESK.gap > space.x
    const dy = Math.max(0, ...going.filter(across).map(n => space.y + space.h + DESK.gap + NAME - n.y))
    move(new Map(going.map(n => [n.id, { dx: 0, dy }])))
  }
  // what else is in the space, or where the walk went, moves out of the way
  move(makeRoom(space, walk, PLACE.room))
  for (const id of [...all.keys()]) if (walk.has(id) && state.nodes[id].type === 'page') move(makeRoom(state.nodes[id], walk, PLACE.room))
  for (const [id, { dx, dy }] of all) Object.assign(state.nodes[id], { x: state.nodes[id].x - dx, y: state.nodes[id].y - dy })
  slide(all) // (from where they are shown)
  return { x: space.x, y: space.y, ...size }
}
// The rows of a walk, seen from a page in it (as it will be without `skip`):
// whose each thing is (a piece is the page's it was cut from, a note what it
// is stuck on's), and what stays put when a row opens or closes beside it
// (the page and those it came from, with what is theirs).
function rows(from, skip) {
  const walk = walkOf(from.id, skip)
  const nodes = Object.values(state.nodes).filter(n => n.id !== skip)
  const owner = n => {
    for (let i = 0; i < nodes.length; i++) {
      const by = n.on ? state.nodes[n.on] : n.type !== 'page' && state.nodes[state.edges.find(e => e.to === n.id && e.kind === 'clip')?.from]
      if (!by || by.id === skip) return n
      n = by
    }
    return n
  }
  const stays = new Set([from.id])
  for (let at = from.id, e; (e = state.edges.find(e => e.to === at && state.nodes[e.from])) && !stays.has(e.from); at = e.from) stays.add(e.from)
  return { walk, nodes, owner, fixed: n => !walk.has(n.id) || stays.has(owner(n).id) }
}
// Closing a page laid beside the page it came from closes its row, as
// opening it opened one: the walk below moves back up into its place,
// unless something left in the row (or anything else) is in the way.
function closeRow(id) {
  const n = state.nodes[id]
  const from = state.nodes[state.edges.find(e => e.to === id && state.nodes[e.from])?.from]
  if (!n || !from) return
  const laid = Math.max(n.x - (from.x + from.w), from.x - (n.x + n.w)) <= LAID && Math.min(n.y + n.h, from.y + from.h) - Math.max(n.y, from.y) >= DESK.least
  if (!laid) return
  const { nodes, owner, fixed } = rows(from, id)
  const below = nodes.filter(m => !fixed(m) && owner(m).y > n.y)
  if (!below.length) return
  const dy = n.y - Math.min(...below.map(m => owner(m).y))
  const going = new Set(below.map(m => m.id))
  const there = below.map(m => ({ ...m, y: m.y + dy }))
  if (there.some(m => nodes.some(o => !going.has(o.id) && overlap(m, o, roomBetween(m, o, DESK.gap))))) return
  slide(new Map(below.map(m => [m.id, { dx: 0, dy }])))
}
const roomBetween = (a, b, room) => (a.type === 'page' && b.type === 'page' ? room : ROOM) // places keep apart; pieces sit close
const overlap = (a, b, r) => a.x < b.x + b.w + r && a.x + a.w + r > b.x && a.y - NAME < b.y + b.h + r && a.y + a.h + r > b.y - NAME
// Everything connected to a thing: its walk (both ways along every line) and the notes stuck on it
// (without `skip`: as it will be once that is gone).
function walkOf(id, skip) {
  const walk = new Set([id])
  for (const at of walk) {
    for (const e of state.edges) {
      if (e.from === at && state.nodes[e.to] && e.to !== skip) walk.add(e.to)
      if (e.to === at && state.nodes[e.from] && e.from !== skip) walk.add(e.from)
    }
    const n = state.nodes[at]
    if (n?.on && state.nodes[n.on]) walk.add(n.on)
    for (const note of notesOn(at)) walk.add(note.id)
  }
  return walk
}
// The space opens at a point: what is in it moves straight away from there,
// as far as it must, and pushes on what it meets the same way. The space and
// `keep` (the walk it is for) never move. A pushed walk moves as a whole and
// goes on until all of it is clear of them and of the walk that pushed it.
function makeRoom(box, keep, room) {
  const moved = new Map() // id -> { dx, dy }
  const o = { x: box.x + box.w / 2, y: box.y + box.h / 2 }
  const stays = [box, ...[...keep].map(id => state.nodes[id])]
  const at = n => (m => ({ type: n.type, x: n.x + (m?.dx || 0), y: n.y + (m?.dy || 0), w: n.w, h: n.h }))(moved.get(n.id))
  // how far along d (a unit direction) b must go to be clear of a
  const clear = (a, b, d, r) => Math.min(
    d.x > 0 ? (a.x + a.w + r - b.x) / d.x : d.x < 0 ? (a.x - r - (b.x + b.w)) / d.x : Infinity,
    d.y > 0 ? (a.y + a.h + r + NAME - b.y) / d.y : d.y < 0 ? (a.y - NAME - r - (b.y + b.h)) / d.y : Infinity,
  )
  const queue = [{ b: box, own: new Set() }]
  let budget = 8 * Object.keys(state.nodes).length // each thing can be pushed a few times; never forever
  while (queue.length && budget-- > 0) {
    const { b, own } = queue.shift()
    const past = [...stays, ...[...own].map(g => at(state.nodes[g]))]
    for (const n of Object.values(state.nodes)) {
      if (keep.has(n.id) || n.on || own.has(n.id)) continue // a stuck note goes with what it's on; a walk doesn't push itself
      const nb = at(n)
      if (!overlap(b, nb, roomBetween(b, nb, room))) continue
      const group = walkOf(n.id)
      // straight away from where the space opens, or along the sides if that is
      // a shorter way out; on past anything that stays, never through it
      const len = Math.hypot(nb.x + nb.w / 2 - o.x, nb.y + nb.h / 2 - o.y)
      const ways = [len ? { x: (nb.x + nb.w / 2 - o.x) / len, y: (nb.y + nb.h / 2 - o.y) / len } : { x: 0, y: -1 }, { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]
      const cost = d => {
        let t = clear(b, nb, d, roomBetween(b, nb, room))
        if (!(t > 0) || !isFinite(t)) return { d, t: Infinity }
        for (let k = 0; k < 20; k++) {
          const more = Math.max(0, ...[...group].flatMap(g => {
            const gb = at(state.nodes[g])
            const shifted = { ...gb, x: gb.x + d.x * t, y: gb.y + d.y * t }
            return past.filter(s => overlap(shifted, s, roomBetween(shifted, s, room))).map(s => clear(s, shifted, d, roomBetween(s, shifted, room)))
          }))
          if (!(more > 0)) break
          t += more
        }
        return { d, t }
      }
      const { d, t } = ways.map(cost).reduce((best, w) => (w.t < best.t ? w : best))
      if (!isFinite(t)) continue
      for (const g of group) {
        const m = moved.get(g) || { dx: 0, dy: 0 }
        moved.set(g, { dx: m.dx + d.x * t, dy: m.dy + d.y * t })
      }
      for (const g of group) if (!state.nodes[g].on) queue.push({ b: at(state.nodes[g]), own: group })
    }
  }
  return moved
}
// Things slide to where they now are, in step with the newcomer's arrival;
// their lines follow them.
const sliding = new Map() // id -> where it is shown while it slides
function slide(moved) {
  for (const [id, { dx, dy }] of moved) {
    const n = state.nodes[id]
    n.x = Math.round(n.x + dx)
    n.y = Math.round(n.y + dy)
    place(n)
    if (reduceMotion) continue
    const run = views.get(id).el.animate([{ translate: `${-dx}px ${-dy}px` }, { translate: '0 0' }], { duration: 460, easing: 'cubic-bezier(.2,.9,.25,1)' })
    sliding.set(id, { run, dx, dy })
  }
  if (!sliding.size) return drawEdges()
  followSlides()
}
// lines follow what slides, a frame at a time, until it has all arrived
let following = false
function followSlides() {
  if (following) return
  following = true
  const follow = () => {
    for (const [id, s] of sliding) if (s.run.playState === 'finished' || s.run.playState === 'idle' || !state.nodes[id]) sliding.delete(id)
    renderEdges()
    if (sliding.size) requestAnimationFrame(follow)
    else following = false
  }
  requestAnimationFrame(follow)
}
// where a node is shown: during a slide, partway there
function shownAt(n) {
  const s = sliding.get(n.id)
  if (!s) return n
  const t = s.run.effect.getComputedTiming().progress ?? 1
  return { ...n, x: n.x - s.dx * (1 - t), y: n.y - s.dy * (1 - t) }
}

// The open spot nearest to (x, y), searched outward in rings.
function spotFree(x, y, size, room = ROOM) {
  const step = Math.max(48, room / 2)
  for (let r = 0; r <= 60; r++) {
    const ring = []
    if (!r) ring.push([0, 0])
    else for (let i = -r; i <= r; i++) ring.push([i, -r], [i, r], [-r, i], [r, i])
    ring.sort((a, b) => a[0] ** 2 + 1.4 * a[1] ** 2 - (b[0] ** 2 + 1.4 * b[1] ** 2))
    for (const [i, j] of ring) {
      const c = { x: Math.round(x + i * step), y: Math.round(y + j * step), ...size }
      if (!overlaps(c, room)) return c
    }
  }
  return { x: Math.round(x), y: Math.round(y), ...size }
}
// Whether the line between two boxes' centres passes through any other node.
function blocked(a, b) {
  const p = centreOf(a)
  const q = centreOf(b)
  const m = 24
  return Object.values(state.nodes).some(n => n.id !== a.id && segmentHitsBox(p.x, p.y, q.x, q.y, n.x - m, n.y - m, n.x + n.w + m, n.y + n.h + m))
}
// Liang–Barsky clipping of a segment against a box.
function segmentHitsBox(x1, y1, x2, y2, l, t, r, b) {
  let t0 = 0
  let t1 = 1
  const dx = x2 - x1
  const dy = y2 - y1
  for (const [p, q] of [[-dx, x1 - l], [dx, r - x1], [-dy, y1 - t], [dy, b - y1]]) {
    if (p === 0) {
      if (q < 0) return false
    } else {
      const u = q / p
      if (p < 0) t0 = Math.max(t0, u)
      else t1 = Math.min(t1, u)
      if (t0 > t1) return false
    }
  }
  return true
}

// --------------------------------------------------------------- nodes: data

function addNode(data) {
  const node = { id: uid(), z: ++topZ, created: Date.now(), ...data }
  state.nodes[node.id] = node
  mount(node)
  return node
}
function addEdge(data) {
  const edge = { id: uid(), ...data }
  state.edges.push(edge)
  bornAt.set(edge.id, performance.now())
  drawEdges()
  if (edge.from === focused && edge.kind === 'clip') markReading() // cut from the page being read
  return edge
}
function removeNode(id) {
  const gone = state.nodes[id]
  if (!gone) return
  const from = gone.type === 'page' && between(id) && state.nodes[state.edges.find(e => e.to === id && state.nodes[e.from]).from]
  const side = from && sideOf(from, gone)
  const at = from && ghostAt(gone, side)
  const closing = from && closeUp(id, from.id, at, side, gone)
  const ghost = from ? addNode({ type: 'ghost', url: gone.url, title: gone.title, favicon: gone.favicon, bg: gone.bg, z: gone.z, ...at, ...GHOST, was: { w: gone.w, h: gone.h } }) : null
  drop(id, ghost?.id)
  if (ghost) appear(ghost.id)
  if (closing?.size) slide(closing)
  for (let g; (g = Object.values(state.nodes).find(n => n.type === 'ghost' && !between(n.id))); ) drop(g.id) // (one left at an end goes)
  drawEdges()
  knowDoors()
  commit({ kind: 'close', node: id, url: gone.url, title: gone.title })
}
// A thing off the canvas. Its lines go with it, or to `into`, which takes its
// place (and its mark in the page they come from).
function drop(id, into) {
  unmark(id)
  for (const note of notesOn(id)) unstick(note)
  state.edges = into ? state.edges.map(e => (e.from === id ? { ...e, from: into } : e.to === id ? { ...e, to: into } : e)) : state.edges.filter(e => e.from !== id && e.to !== id)
  delete state.nodes[id]
  unmount(id)
  if (selected === id) selected = null
  if (focused === id) setFocused(null)
  if (into) for (const e of state.edges) if (e.to === into) markTaken(e.from, new Set([into]))
}
// A ghost takes up only its own room: it lies where the page's thread came
// in (its pin level with the pins of the pages either side), and what the
// page led on to moves back up by the room the page no longer needs, as far
// as it can without running into anything else.
function sideOf(from, n) {
  const dx = centreOf(n).x - centreOf(from).x
  const dy = centreOf(n).y - centreOf(from).y
  return Math.abs(dx) >= Math.abs(dy) ? { x: Math.sign(dx) || 1, y: 0 } : { x: 0, y: Math.sign(dy) || 1 }
}
function ghostAt(n, side) {
  const level = n.y - NAME / 2 - GHOST.h / 2 // (its pin where the page's was)
  if (side.x > 0) return { x: n.x, y: Math.round(level) }
  if (side.x < 0) return { x: n.x + n.w - GHOST.w, y: Math.round(level) }
  return { x: Math.round(n.x + n.w / 2 - GHOST.w / 2), y: Math.round(side.y > 0 ? level : n.y + n.h - GHOST.h) }
}
// the room a page frees, shrunk to a ghost at `g`, on the side its walk goes on
function freedBy(n, g, side) {
  if (side.x > 0) return { dx: -(n.x + n.w - (g.x + GHOST.w)), dy: 0 }
  if (side.x < 0) return { dx: g.x - n.x, dy: 0 }
  if (side.y > 0) return { dx: 0, dy: -(n.y + n.h - (g.y + GHOST.h)) }
  return { dx: 0, dy: g.y - (n.y - NAME) }
}
// what a thing leads on to, and not back to where it came from
function onward(id, from) {
  const back = walkOf(from, id)
  return [...walkOf(id)].filter(o => o !== id && !back.has(o) && state.nodes[o].on !== id) // (a note stuck on it is left where it was)
}
function closeUp(id, from, at, side, n) {
  const going = onward(id, from)
  if (!going.length) return null
  const freed = freedBy(n, at, side)
  const ghost = { type: 'ghost', ...at, ...GHOST }
  const still = [ghost, ...Object.values(state.nodes).filter(o => o.id !== id && !going.includes(o.id))]
  for (const f of [1, 0.75, 0.5, 0.25]) {
    const dx = Math.round(freed.dx * f)
    const dy = Math.round(freed.dy * f)
    const fits = going.every(g => {
      const o = state.nodes[g]
      const there = { ...o, x: o.x + dx, y: o.y + dy }
      return !still.some(s => overlap(there, s, roomBetween(there, s, DESK.gap / 2)))
    })
    if (fits) return new Map(going.map(g => [g, { dx, dy }]))
  }
  return null
}
// A page closed from the middle of a trail (one led to it and it led on)
// leaves its name where it lay, so the trail still shows how you came to what
// came after. A ghost stands between two things: left at an end, it goes. A
// click opens the page again where it was.
const between = id => state.edges.some(e => e.to === id && state.nodes[e.from]) && state.edges.some(e => e.from === id && state.nodes[e.to])
// Pulled off its pin, a scrap of the page's margin tears round the pin, its
// address printed on it.
const GHOST = { w: sq(6), h: sq(0.75), pin: sq(0.4) }
function mountGhost(node, view) {
  const pin = el('span', 'pin')
  const fav = el('img', 'fav')
  fav.onerror = () => fav.remove()
  fav.src = node.favicon || iconOf(node.url)
  pin.append(fav)
  const scrap = el('span', 'scrap', addressOf(node.url))
  scrap.style.setProperty('--tear', `${(tabAt(node.id) - 0.5) * 8}deg`) // (each tears its own way)
  view.el.title = node.title || addressOf(node.url)
  view.el.append(scrap, pin)
  paintTab(node, view)
}
function reopen(id) {
  const g = state.nodes[id]
  const w = g.was?.w || pageSize().w
  const h = g.was?.h || pageSize().h
  const from = state.nodes[state.edges.find(e => e.to === id && state.nodes[e.from])?.from]
  const side = from ? sideOf(from, g) : { x: 1, y: 0 }
  // the page opens out from where its ghost is pinned, away from where it was
  // come to from; what it led on to moves back out of its way
  const box = { type: 'page', w, h, x: Math.round(side.x > 0 ? g.x : side.x < 0 ? g.x + g.w - w : g.x + g.w / 2 - w / 2), y: Math.round(side.y < 0 ? g.y + g.h - h : g.y + g.h / 2 + NAME / 2) }
  const freed = freedBy(box, g, side)
  const moved = from ? new Map(onward(id, from.id).map(o => [o, { dx: -freed.dx, dy: -freed.dy }])) : new Map()
  const page = addNode({ type: 'page', url: g.url, title: g.title, favicon: g.favicon, bg: g.bg, x: box.x, y: box.y, w, h })
  drop(id, page.id)
  slide(moved)
  slide(makeRoom(page, walkOf(page.id), PLACE.room)) // (anything else there makes way)
  drawEdges()
  appear(page.id)
  commit({ kind: 'open', node: page.id, url: page.url })
  travel(page.id)
}
// Starting over: the canvas empties in one step, and Undo brings it all back
// (the canvas's history keeps it either way).
function reset() {
  cutWith(false) // (starting over puts the tools down)
  placeNote(false)
  if (!Object.keys(state.nodes).length) return
  for (const id of Object.keys(state.nodes)) unmount(id)
  state.nodes = {}
  state.edges = []
  selected = null
  setFocused(null)
  drawEdges()
  input.value = '' // starting over starts with an empty box
  commit({ kind: 'reset' })
  toast('started over', { label: 'undo', run: undo })
}
// Closing something by hand: gone, with a moment to take it back.
function close(id) {
  const n = state.nodes[id]
  const v = views.get(id)
  if (!n || !v || v.closing) return
  const from = state.nodes[state.edges.find(e => e.to === id)?.from]
  // Closing what you are looking at doesn't leave you facing an empty table:
  // the page you are reading, or anything with nothing else left in view (a
  // piece you were looking at, say). You go back along the trail to where it
  // came from, as it shrinks back into it (else to the page you read before).
  const reading = focused === id || coverage(n) > 0.5
  const alone = !Object.values(state.nodes).some(o => o.id !== id && inView(o) >= 0.5) // (nothing else even half in view)
  const back = (reading || alone) && (from?.id || Object.values(state.nodes).filter(p => p.type === 'page' && p.id !== id && p.seen).sort((a, b) => b.seen - a.seen)[0]?.id)
  const gone = () => removeNode(id)
  v.closing = true // (from here it is going: nothing keeps it in view beside another)
  if (!(n.type === 'page' && between(id))) closeRow(id) // (first, so that going back frames things where they will be; a page leaving a ghost closes up its own way)
  if (back) {
    select(back)
    focusNode(back, { toggle: false })
  }
  if (reduceMotion) return gone()
  // back into where it came from (the page it was opened or cut from), the
  // way it grew out of it; things with no origin just shrink where they are,
  // as does a page that leaves a ghost (into its ghost)
  const ghosting = from && n.type === 'page' && between(id)
  const to = ghosting ? (g => ({ x: g.x + GHOST.w / 2, y: g.y + GHOST.h / 2 }))(ghostAt(n, sideOf(from, n))) : from ? exitPoint(from, centreOf(from), centreOf(n), 0) : centreOf(n)
  v.el.style.pointerEvents = 'none'
  v.el.animate(
    [
      { transformOrigin: '0 0', transform: 'none', opacity: 1 },
      { transformOrigin: '0 0', opacity: 1, offset: 0.6 },
      { transformOrigin: '0 0', transform: `translate(${to.x - n.x}px, ${to.y - n.y}px) scale(0.06)`, opacity: 0 },
    ],
    { duration: 260, easing: 'cubic-bezier(.5,0,.75,0)', fill: 'forwards' },
  ).finished.then(gone, gone)
}
// how much of a thing is on the screen, 0 to 1
function inView(n) {
  const a = toScreen(n.x, n.y)
  const w = Math.max(0, Math.min(innerWidth, a.x + n.w * cam.z) - Math.max(0, a.x))
  const h = Math.max(0, Math.min(innerHeight, a.y + n.h * cam.z) - Math.max(0, a.y))
  return (w * h) / (n.w * n.h * cam.z * cam.z || 1)
}
// how much of the screen a thing covers, 0 to 1
function coverage(n) {
  const a = toScreen(n.x, n.y)
  const w = Math.max(0, Math.min(innerWidth, a.x + n.w * cam.z) - Math.max(0, a.x))
  const h = Math.max(0, Math.min(innerHeight, a.y + n.h * cam.z) - Math.max(0, a.y))
  return (w * h) / (innerWidth * innerHeight)
}
function post(id, msg) {
  views.get(id)?.frame?.contentWindow?.postMessage({ cb: 1, ...msg }, '*')
}
function select(id) {
  if (selected === id) return
  if (selected) views.get(selected)?.el.classList.remove('selected')
  selected = id
  if (id) views.get(id)?.el.classList.add('selected')
  // the keys go with what's selected: a page left behind doesn't keep them
  if (!(id && views.get(id)?.el.contains(document.activeElement))) keysToCanvas()
}
// Where the keys are. A page you arrive at gets them, as a tab you go to does
// (so space and the arrows scroll it); one you leave gives them back to the
// canvas. Never while you're typing in the canvas's own find box or a note.
function keysTo(id) {
  const frame = state.nodes[id]?.type === 'page' && views.get(id)?.listening && views.get(id).frame
  if (!frame) return keysToCanvas()
  const active = document.activeElement
  if (active === input ? !bar.hidden : isEditing(active)) return
  // The canvas can't see whether a page has the keys: the frame can be the
  // active element after the keys have left it (Chrome: a press on the canvas
  // that it keeps for itself, or a loading page arriving). Focusing it again
  // then does nothing, so it lets go of it first.
  if (active === frame) frame.blur()
  frame.focus({ preventScroll: true })
}
function keysToCanvas() {
  const active = document.activeElement
  if (active?.tagName !== 'IFRAME') return // the canvas has them
  active.blur()
  window.focus() // (WebKit: a frame that a click put the keys in keeps them when blurred)
}

function front(id) {
  const n = state.nodes[id]
  if (!n) return
  if (n.z !== topZ) {
    n.z = ++topZ
    views.get(id).el.style.zIndex = n.z
  }
  // what is stuck to a thing stays on top of it
  for (const note of notesOn(id)) {
    note.z = ++topZ
    views.get(note.id).el.style.zIndex = note.z
  }
  save()
}

// ---------------------------------------------------------------- nodes: DOM

function mount(node) {
  const root = el('div', `node ${node.type}`)
  const view = { el: root, history: [], docReady: false, restored: restoring }
  views.set(node.id, view)
  if (node.type === 'page') mountPage(node, view)
  else if (node.type === 'clip') mountClip(node, view)
  else if (node.type === 'embed') mountEmbed(node, view)
  else if (node.type === 'note') mountNote(node, view)
  else if (node.type === 'image') mountImage(node, view)
  else if (node.type === 'ghost') mountGhost(node, view)
  root.dataset.id = node.id
  const sides = node.type === 'ghost' ? [] : node.type === 'note' || node.type === 'clip' ? ['e', 'w'] : node.type === 'image' ? ['ne', 'nw', 'se', 'sw'] : ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']
  for (const dir of sides) {
    const handle = el('div', `rz rz-${dir}`)
    handle.addEventListener('pointerdown', e => startResize(e, node.id, dir))
    root.append(handle)
  }
  root.addEventListener('pointerdown', e => nodePointerDown(e, node.id))
  root.addEventListener('dblclick', e => nodeDoubleClick(e, node.id))
  root.addEventListener('pointerenter', () => hover(node.id))
  root.addEventListener('pointerleave', () => hovered === node.id && hover(null))
  world.append(root)
  place(node)
  updateName(node.id)
  return view
}
function unmount(id) {
  const v = views.get(id)
  views.delete(id) // (first: taking a note out while it is being written blurs it, and an empty note goes on blur)
  v?.el.remove()
  // (its kept copy stays while undo can bring it back: copies of pages gone
  // from the canvas are let go at the next start, when undo starts afresh)
}
function place(node) {
  const v = views.get(node.id)
  const auto = node.type === 'note'
  if (auto) v.el.classList.toggle('stuck', !!node.on) // (on something, its bottom curls off it: style.css)
  Object.assign(v.el.style, { left: `${node.x}px`, top: `${node.y}px`, width: `${node.w}px`, height: auto ? '' : `${node.h}px`, zIndex: node.z })
  // a note is as tall as its words; when the canvas is restored (at start, on
  // undo) notes are measured together once all is in place: one layout of
  // the canvas, not one for each note
  if (auto && !restoring) node.h = v.el.offsetHeight || node.h
}
function frame(sandbox, src) {
  const f = el('iframe')
  f.setAttribute('sandbox', sandbox)
  f.setAttribute('allow', ALLOW)
  if (src) f.src = src
  return f
}
function grabHandle() {
  const g = el('div', 'grab')
  g.title = 'Drag to move'
  return g
}

// A page is a printout: a sheet of paper, the site printed on it, one line
// printed at its head as a browser prints one, its title at the left and its
// address at the right; held to the board by a pin through its head, its
// site's icon. The head is where you hold it.
// Its pin's head is in the page's own colour (as last seen: a page coming
// back has it before it loads).
const COLOUR = /^rgba?\([\d., ]+\)$/
function paintTab(n, v) {
  v.el.style.setProperty('--tab', COLOUR.test(n.bg) ? n.bg : '')
}
// Where a page's pin goes in: at the middle of its head, by hand, a quarter
// of a square either side at most, the same for a page each time (from its id).
const tabAt = id => 0.25 + 0.5 * ([...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 1000) / 1000
function mountPage(node, view) {
  const name = el('div', 'bar')
  view.el.style.setProperty('--tab-at', tabAt(node.id))
  const fav = el('img', 'fav')
  fav.style.visibility = 'hidden'
  fav.onload = () => ((fav.style.visibility = ''), views.get(node.id)?.el.classList.add('has-icon')) // (zoomed out, the icon stands for the site)
  fav.onerror = () => ((fav.style.visibility = 'hidden'), views.get(node.id)?.el.classList.remove('has-icon'))
  const address = el('div', 'address') // its levels above the page are places to go up to (style.css)
  const pin = el('span', 'pin') // (the site's icon is its pin: style.css)
  pin.append(fav)
  const title = el('div', 'title')
  name.append(pin, title, address)
  const body = el('div', 'body')
  const kept = restoring && keptCopies.get(node.id)
  // restored out of reach: it loads when it comes within reach (tend), by the
  // app's own rule (a browser's lazy loading differs: Safari waits until on screen)
  const f = kept || (restoring && !inReach(node)) ? null : liveFrame(node)
  // until the page first shows itself: which place this is, not a white void
  const arriving = el('div', 'arriving')
  const mark = el('img')
  mark.onerror = () => mark.remove()
  mark.src = node.favicon || iconOf(node.url)
  const label = el('span', null, addressOf(node.url))
  label.prepend(mark) // (beside the name, not taking room: the name stays where it is whether the icon comes or not)
  arriving.append(label)
  body.append(...(f ? [f] : []), arriving)
  view.el.append(name, body)
  paintTab(node, view)
  Object.assign(view, { frame: f, body, fav, title, address, when })
  view.el.classList.add('loading')
  if (kept) showCopy(node.id, kept)
  touch(node.id)
  body.addEventListener('pointerdown', () => view.frame || wake(node.id))
}
// A page opened from a page is asked for as from that page, as a link
// followed in a tab is: a webring's "next" knows whose site you were on. The
// add-on is given a rule for it first: what the canvas asks of that site in a
// frame (the page, and where the site sends it on to) carries it, until the
// page has loaded.
const cameFrom = new Map() // page address -> the telling, and then what takes it back
function tellFrom(url, from) {
  const referrer = referrerOf(from, url)
  if (!referrer) return null
  const name = `from ${uid()}`
  const rule = { action: { type: 'modifyHeaders', requestHeaders: [{ header: 'referer', operation: 'set', value: referrer }] }, condition: { resourceTypes: ['sub_frame'], requestDomains: [new URL(url).hostname], initiatorDomains: [location.hostname] } }
  let told = true
  const untell = () => told && ((told = false), bridge('rules', { remove: [name] }).catch(() => {}))
  return bridge('rules', { set: { [name]: rule } }, 2000).then(() => untell, () => {})
}
// What a browser tells a site about the page a link on it was followed from
// (its default policy): within a site the whole address, else only the site;
// nothing from https to http.
function referrerOf(from, to) {
  const f = URL.parse(from)
  const t = URL.parse(to)
  if (!f || !t || (f.protocol === 'https:' && t.protocol === 'http:')) return null
  f.hash = ''
  return f.origin === t.origin ? f.href : `${f.origin}/`
}
const PAGE_NAME = 'canvas-browser-page' // the add-on runs inject.js in frames named so, and in frames inside them
function liveFrame(node) {
  const f = frame(PAGE_SANDBOX)
  f.name = PAGE_NAME
  const told = cameFrom.get(node.url)
  cameFrom.delete(node.url)
  const go = untell => {
    f.src = frameAddress(node.url)
    if (!untell) return
    f.addEventListener('load', untell, { once: true })
    setTimeout(untell, 10_000) // (a page that never finishes loading)
  }
  told ? told.then(go) : go()
  // whether the page in it hands the keys over (inject.js): a page that
  // couldn't load (the browser's own error page) has nothing in it that does
  f.addEventListener('load', () => {
    const v = views.get(node.id)
    if (v) [v.listening, v.heard] = [!!v.heard, false]
    setLoading(node.id, false)
  })
  return f
}

// ------------------------------------------------------------------- sleep
// A live page costs about 120 MB. One you can't see and aren't using sleeps:
// its own script hands over a copy of itself as it is (markup and live
// styles, no scripts, scrolled to where it was), the copy stands in where
// nothing can run, and the live page unloads. Coming near wakes it: the live
// page loads behind the copy and replaces it once it is ready and scrolled
// to the same place. If waking is unnoticeable there is nothing to gain by
// keeping a page you can't see awake, so there is no count of pages to keep.
// Never asleep: the page being read or selected, anything playing.
//   Out of reach = more than a screen away: one pan or flick moves you about
//   a screen, and a page takes a second or two to wake, so nearer than that
//   it might not be ready when you get there.
//   AWAY = how long a page must be out of reach before it sleeps, so that
//   glancing away and straight back doesn't sleep and wake it for nothing.
//   ?sleeptest makes it 0, to try to catch sleeping pages; ⌥S then shows
//   which pages are asleep.
const AWAY = 30_000
const away = new Map() // page id -> since when it has been out of reach
const playing = new Set()
const touch = id => away.delete(id)
function sleep(id) {
  const v = views.get(id)
  if (!v?.frame || v.still || !v.docReady || v.sleeping) return
  v.sleeping = true
  post(id, { type: 'snapshot' })
  v.unanswered = setTimeout(() => (v.sleeping = false), 6000) // a page that doesn't answer stays awake
}
function stillFrom(id, d) {
  const v = views.get(id)
  if (!v?.frame || v.still || !v.sleeping) return
  // It answered. Its copy loads its pictures and fonts from the site, which
  // can take longer than the page took to answer: that is waited for.
  clearTimeout(v.unanswered)
  if (d.busy) {
    v.sleeping = false
    away.set(id, Date.now()) // still changing: alive, so it stays awake a while longer
    return
  }
  const { still, exact } = copyFrame(d)
  still.addEventListener('load', () => {
    requestAnimationFrame(() => {
      // gone, or come back to while its copy was made: it stays as it is
      if (!state.nodes[id] || !maySleep(state.nodes[id])) {
        still.remove()
        if (v.still === still) v.still = null
        v.sleeping = false
        return
      }
      v.frame.remove()
      v.frame = null
      v.docReady = false
      v.sleeping = false
      v.el.classList.add('asleep')
      v.pageText = { url: state.nodes[id].url, text: d.text } // what it said as it fell asleep
      keepCopy(id, d, exact)
    })
  }, { once: true })
  v.still = still
  v.body.append(still)
}
// A page's copy as it was: the exact one (XHTML) if the page could give one
// (it checks that it reads back), else the HTML one; scripts can't run in it;
// scrolled to where the page was.
function copyFrame(d) {
  const still = frame('allow-same-origin')
  still.className = 'still'
  const exact = !!d.xml
  if (exact) {
    still.src = URL.createObjectURL(new Blob([d.xml], { type: 'application/xhtml+xml' }))
    still.addEventListener('load', () => URL.revokeObjectURL(still.src), { once: true })
  } else {
    // as a document of its own, not srcdoc: a srcdoc document is never in
    // quirks mode, and an old page without a doctype is laid out by quirks
    still.src = URL.createObjectURL(new Blob([d.html], { type: 'text/html' }))
    still.addEventListener('load', () => URL.revokeObjectURL(still.src), { once: true })
  }
  still.addEventListener('load', () => still.contentWindow.scrollTo(d.sx, d.sy), { once: true })
  return { still, exact }
}
// Copies outlive a reload: a page restored later shows as it was at once,
// instead of loading from nothing when you reach it, and / finds it by its
// words. One per page; only used while the page is still at the same address.
const keptCopies = new Map() // page id -> its copy, read at start
const copyKey = id => `${STORE} ${id}` // each canvas keeps its own
function keepCopy(id, d, exact) {
  const n = state.nodes[id]
  if (!n || writer !== STORE) return // (another tab keeps this canvas: see own)
  idb('stills', 'readwrite', s => s.put({ url: n.url, ...(exact ? { xml: d.xml } : { html: d.html }), sx: d.sx, sy: d.sy, text: d.text }, copyKey(id))).catch(() => {})
}
// the copies of pages no longer on this canvas
function forgetCopies() {
  idb('stills', 'readwrite', s => {
    const keys = s.getAllKeys()
    keys.onsuccess = () => keys.result.forEach(k => k.startsWith(`${STORE} `) && !state.nodes[k.slice(STORE.length + 1)] && s.delete(k))
    return keys
  }).catch(() => {})
}
// A page not loaded (restored, or brought back by undo, out of reach) shown
// as its kept copy until it wakes.
function showCopy(id, kept) {
  const v = views.get(id)
  if (!v?.body || v.frame || v.still) return
  v.still = copyFrame(kept).still
  v.pageText = { url: kept.url, text: kept.text || '' }
  v.body.append(v.still)
  v.el.classList.remove('loading')
  v.el.classList.add('asleep', 'arrived')
}
function wake(id) {
  const v = views.get(id)
  const n = state.nodes[id]
  if (!v || v.frame || n?.type !== 'page') return
  if (!v.still) {
    // restored and never loaded (it was out of reach): it loads now
    v.frame = liveFrame(n)
    v.body.prepend(v.frame)
    return touch(id)
  }
  v.restored = true // scrolls to where it was when it says it's ready
  v.frame = liveFrame(n)
  v.body.prepend(v.frame) // behind the copy
  touch(id)
}
// The copy goes once the live page is ready and has scrolled to where it
// was. Woken to go to words found further on, the live page shows another
// place than its copy: the copy goes at once, a jump, rather than blur two
// places of the page together.
function awake(id, elsewhere) {
  const v = views.get(id)
  const still = v?.still
  if (!still) return
  v.still = null
  v.el.classList.remove('asleep')
  setTimeout(() => (elsewhere ? still.remove() : still.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160 }).finished.then(() => still.remove())), 250)
}
// Within reach: no more than a screen away from what's in view.
function inReach(n) {
  const margin = Math.max(innerWidth, innerHeight) / cam.z // a screen away, in canvas units
  const view = { x: -cam.x / cam.z - margin, y: -cam.y / cam.z - margin, w: innerWidth / cam.z + 2 * margin, h: innerHeight / cam.z + 2 * margin }
  return n.x < view.x + view.w && n.x + n.w > view.x && n.y < view.y + view.h && n.y + n.h > view.y
}
const maySleep = n => !inReach(n) && n.id !== focused && n.id !== selected && !playing.has(n.id)
function tend() {
  const now = Date.now()
  const pages = Object.values(state.nodes).filter(n => n.type === 'page' && views.get(n.id))
  // zoomed out, pages are pictures: a sleeping one's copy will do until you come back in
  for (const n of pages) if (inReach(n) && !views.get(n.id).frame && (cam.z >= OVERVIEW_Z || !views.get(n.id).still)) wake(n.id)
  for (const n of pages) {
    if (!maySleep(n)) away.delete(n.id)
    else if (!away.has(n.id)) away.set(n.id, now)
    else if (views.get(n.id).frame && now - away.get(n.id) >= AWAY) sleep(n.id)
  }
}
setInterval(tend, 10_000)

// A clipped element: a copy of it with its computed styles and the page's
// fonts. It is still a piece of web page: text selects, links open beside it.
const CLIP_SCRIPT = `(() => {
  const send = (type, d = {}) => parent.postMessage({ cb: 1, type, ...d }, '*')
  addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('a[href]')
    if (!a || !/^https?:/.test(a.href)) return
    e.preventDefault()
    const r = a.getBoundingClientRect()
    send('open', { url: a.href, text: (a.textContent || '').trim().slice(0, 120), rect: { x: r.left, y: r.top, w: r.width, h: r.height }, quiet: e.metaKey || e.ctrlKey })
  }, true)
  addEventListener('pointerdown', () => send('touch'), true)
  addEventListener('wheel', e => {
    if (!e.ctrlKey) return
    e.preventDefault()
    send('zoom', { dy: e.deltaY, x: e.clientX, y: e.clientY })
  }, { passive: false })
  // a box of its own that was scrolled in the page is scrolled as it was (again once its pictures have their sizes)
  const scrolled = () => document.querySelectorAll('[data-cb-scroll]').forEach(e => e.scrollTo(...e.getAttribute('data-cb-scroll').split(' ').map(Number)))
  scrolled()
  addEventListener('load', scrolled)
  // the clip's height follows its content (including the element's margins)
  const root = document.body.firstElementChild
  if (!root) return
  const size = () => send('size', { h: Math.ceil(root.getBoundingClientRect().bottom + (parseFloat(getComputedStyle(root).marginBottom) || 0)) })
  new ResizeObserver(size).observe(root)
  addEventListener('load', size)
})()`
const escAttr = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
// Clips are kept as XHTML (an element serialised as XML, which names its
// namespace), parsed back exactly; older clips were kept as HTML.
const XHTML = /^<[^>]*\sxmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/
function clipDocument(n) {
  const fonts = (n.fonts || '').replace(/<\//g, '<\\/')
  const bg = String(n.bg || 'transparent').replace(/[<>;{}]/g, '')
  const html = n.html
  const content = XHTML.test(html)
    ? `<script>{const x=${JSON.stringify(html).replace(/</g, '\\u003c')};const d=new DOMParser().parseFromString(x,'application/xhtml+xml');if(d.querySelector('parsererror'))document.body.innerHTML=x;else document.body.prepend(document.importNode(d.documentElement,true))}<\/script>`
    : html
  return `<!doctype html><html><head><meta charset="utf-8"><base href="${escAttr(n.url)}" target="_blank"><style>${fonts}</style><style>html,body{margin:0;padding:0}body{background:${bg};overflow:hidden}</style></head><body>${content}<script>${CLIP_SCRIPT}<\/script></body></html>`
}
function mountClip(node, view) {
  // A world of its own (no allow-same-origin): whatever a clip holds can't
  // reach the canvas, only send it messages.
  // Its fonts still load: the add-on lets any origin read font files (see RULES).
  const f = frame('allow-scripts allow-popups allow-popups-to-escape-sandbox allow-presentation')
  if (node.html) f.srcdoc = clipDocument(node)
  view.el.append(f, sourceChip(node), grabHandle())
  view.frame = f
}
// An embedded player or widget (YouTube, Bandcamp, ...) clipped from a page.
function mountEmbed(node, view) {
  // only a real web address: a javascript: one would run as the canvas
  const f = frame('allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation allow-forms', webOnly(node.src))
  view.el.append(f, sourceChip(node), grabHandle())
  view.frame = f
}
function mountNote(node, view) {
  if (node.url) view.el.classList.add('quote')
  view.el.style.setProperty('--tilt', `${(tabAt(node.id) - 0.5) * 6}deg`) // (stuck down by hand: never quite straight)
  const text = el('div', 'text', node.text || '')
  text.contentEditable = 'plaintext-only'
  text.spellcheck = false
  text.addEventListener('input', () => {
    view.shown = null // its words are now as typed (see showWriting)
    node.text = text.innerText
    node.h = view.el.offsetHeight
    drawEdges()
    save()
  })
  text.addEventListener('blur', () => {
    if (!state.nodes[node.id]) return
    if (!(node.text || '').trim()) return removeNode(node.id)
    commit({ kind: 'write', node: node.id, text: node.text.slice(0, 200) })
    showWriting(node.id)
    if (kindOf(node) === 'collect') teach('collect', 'copies gather here')
  })
  view.el.append(text)
  if (node.url) view.el.append(sourceChip(node))
  view.text = text
  showWriting(node.id)
}

// A note says what it is with its first line: "collect" gathers what you copy
// from pages. Addresses written in a note are doors: a click goes to the place,
// where it already is on the canvas, else beside the note. Shown when the note
// isn't being written in; writing it is plain text.
const KINDS = ['collect']
const kindOf = n => (k => (KINDS.includes(k) ? k : null))((n.text || '').split('\n')[0].trim().toLowerCase())
const WRITTEN = /\bhttps?:\/\/[^\s<>"]+|\b(?:[a-z0-9-]+\.)+[a-z][a-z0-9-]+(?:[/?#][^\s<>"]*)?/gi
function showWriting(id) {
  const n = state.nodes[id]
  const v = views.get(id)
  if (n?.type !== 'note' || !v?.text || document.activeElement === v.text) return
  v.el.classList.toggle('kind', !!kindOf(n))
  const s = n.text || ''
  // words already shown this way stay as they are (an undo shows every note again)
  const shown = `${!!tlds} ${s}`
  if (v.shown === shown) return
  const parts = []
  let at = 0
  for (const m of s.matchAll(WRITTEN)) {
    const written = m[0].replace(/[.,;:!?)\]'"”’]+$/, '')
    const url = /^https?:/i.test(written) ? written : `https://${written}`
    if (s[m.index - 1] === '@' || !realHost(hostWritten(written.replace(/^https?:\/\//i, '')))) continue // an email, or not a real domain
    const door = el('span', 'door', written)
    door.dataset.url = url
    parts.push(s.slice(at, m.index), door)
    at = m.index + written.length
  }
  parts.push(s.slice(at))
  v.text.replaceChildren(...parts.filter(p => p !== ''))
  v.shown = shown
  knowDoors(v.text)
}
// what the canvas knows of an address: whether it is here, and its title
function knowDoors(root = world) {
  const doors = root.querySelectorAll('.door')
  if (!doors.length) return
  // the pages by their document's address, as sameDoc compares them (the first page wins, as with find)
  const docOf = url => url.split('#')[0].replace(/\/$/, '')
  const pages = new Map()
  for (const n of Object.values(state.nodes)) if (n.type === 'page' && n.url && !pages.has(docOf(n.url))) pages.set(docOf(n.url), n)
  for (const door of doors) {
    const page = door.dataset.url && pages.get(docOf(door.dataset.url))
    door.classList.toggle('here', !!page)
    const title = page ? `${page.title || addressOf(page.url)} · on the canvas` : `Open ${addressOf(door.dataset.url)} beside`
    if (door.title !== title) door.title = title
  }
}
function throughDoor(noteId, url, stay) {
  const page = pageAt(url, state.nodes[noteId])
  if (page) goToPage(page.id, stay)
  else openBeside(noteId, { url, quiet: stay })
}
// What you copy from a page joins the collect note touched last, with the
// address it came from (an address, so it is a door back).
function collect(fromId, text) {
  const note = Object.values(state.nodes).filter(n => n.type === 'note' && kindOf(n) === 'collect').sort((a, b) => (b.z || 0) - (a.z || 0))[0]
  const from = state.nodes[fromId]
  text = (text || '').trim()
  if (!note || !text || !from?.url) return
  const entry = `${text}\n— ${addressOf(from.url).replace(/\s/g, encodeURIComponent)}` // (a space would end it as a door)
  if (note.text.trimEnd().endsWith(entry)) return
  note.text = `${note.text.trimEnd()}\n\n${entry}`
  const v = views.get(note.id)
  if (v) {
    if (document.activeElement === v.text) v.text.textContent = note.text
    showWriting(note.id)
    place(note)
    drawEdges()
    pulse(note.id)
  }
  if (!onScreen(note)) toast('kept in your collect note', { label: 'show', run: () => travel(note.id) })
  commit({ kind: 'collect', node: note.id, from: fromId, text: text.slice(0, 200) })
}
const onScreen = n => (a => a.x < innerWidth && a.y < innerHeight && a.x + n.w * cam.z > 0 && a.y + n.h * cam.z > 0)(toScreen(n.x, n.y))
function mountImage(node, view) {
  // what a transparent image sat on in its page, so it looks as it did there
  if (node.bg && node.bg !== 'transparent') view.el.style.background = node.bg
  const img = el('img')
  img.draggable = false
  // shown as its page showed it (else it fills the frame, cropped to fit)
  const look = node.look || {}
  Object.assign(img.style, { objectFit: look.fit || '', objectPosition: look.at || '', imageRendering: look.rendering || '', filter: look.filter || '' })
  if (node.src) img.src = node.src
  view.el.classList.add('loading')
  img.onload = () => {
    if (views.get(node.id) !== view) return // gone from the canvas meanwhile
    view.el.classList.remove('loading')
    if (node.sized) return
    fitContent(node)
    place(node)
    drawEdges()
    save()
  }
  view.el.append(img)
  view.img = img
  if (node.url) view.el.append(sourceChip(node))
}
// A size that comes from what a thing shows, until you give it one (resize):
// an image's from its picture (no wider than 420), a player's height from its
// shape at its width. (A note's and a clip's height follow their content: see
// place, and 'size'.)
function fitContent(n) {
  if (n.sized) return
  const img = n.type === 'image' && views.get(n.id)?.img
  if (img?.naturalWidth) {
    n.w = Math.min(img.naturalWidth, 420)
    n.h = Math.round((n.w * img.naturalHeight) / img.naturalWidth) || n.h
  } else if (n.ratio) n.h = Math.round(n.w * n.ratio)
}

// Clips, images and quotes are taped down where you put them, with washi in
// the colour of the page they came from, their source typed on it: click it
// to go to the page. Each strip is stuck on a little differently (its id).
function sourceChip(node) {
  const chip = el('button', 'chip')
  chip.append(el('span', null, 'from ' + hostOf(node.url))) // (the site; the whole address on hover)
  chip.title = node.url
  if (COLOUR.test(node.tape)) chip.style.setProperty('--washi', node.tape)
  chip.style.setProperty('--tilt', `${(tabAt(node.id) - 0.5) * 6}deg`)
  chip.addEventListener('pointerdown', e => e.stopPropagation())
  chip.addEventListener('click', e => {
    e.stopPropagation()
    goToSource(node.id)
  })
  return chip
}
function goToSource(id) {
  const edge = state.edges.find(e => e.to === id && state.nodes[e.from])
  if (edge) {
    select(edge.from)
    front(edge.from)
    reveal(edge.from)
    post(edge.from, { type: 'reveal', child: id })
    flash(edge.from, id)
    return
  }
  const n = state.nodes[id]
  if (!webOnly(n.url)) return
  const page = addNode({ type: 'page', url: n.url, title: n.title || '', ...spotFree(n.x - pageSize().w - PLACE.gap, n.y, pageSize(), PLACE.room) })
  addEdge({ from: page.id, to: id, kind: 'clip', fromUrl: n.url, selector: n.selector })
  appear(page.id)
  select(page.id)
  reveal(page.id)
  commit({ kind: 'open', node: page.id, url: n.url, why: 'source of a clip' })
}
// Briefly marks, in the source page, where something came from (the
// pointer leaving it as the view goes to the page doesn't end that: see hot).
const flashing = new Set() // the things whose source is marking them for a moment
function flash(sourceId, childId) {
  flashing.add(childId)
  post(sourceId, { type: 'flash', child: childId, on: true })
  setTimeout(() => {
    flashing.delete(childId)
    if (!hotNodes.has(childId)) post(sourceId, { type: 'flash', child: childId, on: false })
  }, 1400)
}

function updateName(id) {
  const n = state.nodes[id]
  const v = views.get(id)
  if (!n || !v) return
  if (n.type !== 'page') return
  // the address is the page's name (its title: what the page itself says, and
  // in /); rebuilt only when it changed: a page tells the canvas its name often
  if (v.named !== n.url) {
    v.named = n.url
    v.address.replaceChildren(...addressParts(n.url))
    v.address.title = (() => { try { return decodeURI(n.url) } catch { return n.url } })() // (the whole of it, where one line can't hold it)
  }
  // its title printed at its head, as a browser prints a page (its address until it says one)
  const title = n.title || addressOf(n.url)
  if (v.title.textContent !== title) v.title.textContent = title
  if (n.favicon && v.fav.getAttribute('src') !== n.favicon) v.fav.src = n.favicon
  // doors in notes say whether this place is here and what it is called
  if (v.door !== `${n.url} ${n.title}`) {
    v.door = `${n.url} ${n.title}`
    knowDoors()
  }
}
function reload(id) {
  const v = views.get(id)
  if (!v?.frame) return
  v.frame.src = frameAddress(state.nodes[id].url)
  setLoading(id, true)
}
// Up to a level of the page's address: the page there, if it is on the
// canvas already, else a new place beside, as a link opens (with ⌘, without
// going there).
function climb(id, url, stay) {
  const there = pageAt(url, state.nodes[id])
  if (there) goToPage(there.id, stay)
  else openBeside(id, { url, quiet: stay })
}
// A place is on the canvas once: going to an address that is here already goes
// to its page (the one nearest `near`, if it is here twice).
function pageAt(url, near) {
  const c = { x: near.x + near.w / 2, y: near.y + near.h / 2 }
  const away = n => Math.hypot(n.x + n.w / 2 - c.x, n.y + n.h / 2 - c.y)
  return Object.values(state.nodes)
    .filter(n => n.type === 'page' && n !== near && samePlace(n.url, url))
    .sort((a, b) => away(a) - away(b))[0]
}
// (with ⌘ you stay, and it shows where it is)
function goToPage(id, stay) {
  front(id)
  pulse(id)
  if (!stay) travel(id)
  else if (!onScreen(state.nodes[id])) toast('already on your canvas', { label: 'show', run: () => travel(id) })
}
function setLoading(id, on) {
  const el = views.get(id)?.el
  el?.classList.toggle('loading', on)
  if (!on) el?.classList.add('arrived')
}

// -------------------------------------------------------------------- sound

// Sounds (sound.js) only for your own actions, timed to what is seen: a page
// taps down as it lands; a clip is cut, then settles; what is closed slides
// away. On, quietly, until turned off with the speaker button.
const SOUND_KEY = 'canvas-browser:sound'
let soundOn = localStorage.getItem(SOUND_KEY) !== 'off'
const LANDS = { 'open-beside': 0.26, open: 0.1, paste: 0.1, drop: 0.1 } // when each kind of arrival lands
function soundFor(what) {
  if (!soundOn || document.hidden) return
  if (what.kind in LANDS) SOUND.play('lay', { delay: LANDS[what.kind] })
  else if (what.kind === 'take') {
    SOUND.play('snip')
    SOUND.play('settle', { delay: 0.42 })
  } else if (what.kind === 'close') SOUND.play('away')
}
function setSound(on) {
  soundOn = on
  localStorage.setItem(SOUND_KEY, on ? 'on' : 'off')
  $('#sound').classList.toggle('off', !on)
  $('#sound').title = on ? 'sounds on' : 'sounds off'
  if (on) SOUND.play('lay')
}

// ------------------------------------------------------------------- motion

function appear(id) {
  if (!reduceMotion) views.get(id)?.el.animate([{ opacity: 0, transform: 'scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2,.9,.3,1)' })
}
// A page opened beside is set down by hand: held a little above the table
// (its shadow further below it), it comes from the link it was opened from,
// a hand's short move however far it lies, and lands in the time the sheets
// moving over for it take; then it lies flat.
function layDown(id, p) {
  if (reduceMotion) return
  const n = state.nodes[id]
  const el = views.get(id).el
  const k = Math.min(1, LAID / (Math.hypot(p.x - n.x, p.y - n.y) || 1))
  el.classList.add('lifted')
  el.animate(
    [
      { transform: `translate(${Math.round((p.x - n.x) * k)}px, ${Math.round((p.y - n.y) * k)}px)`, opacity: 0 },
      { opacity: 1, offset: 0.3 },
      { transform: 'none', opacity: 1 },
    ],
    { duration: 460, easing: 'cubic-bezier(.2,.9,.25,1)' },
  ).finished.then(() => gesture?.node === id || el.classList.remove('lifted'), () => {})
}
// A clip lifts out of its page and settles where it lands.
function liftFrom(id, p) {
  if (reduceMotion) return
  const n = state.nodes[id]
  const dx = p.x - n.x
  const dy = p.y - n.y
  views.get(id).el.animate(
    [
      { transform: `translate(${dx}px, ${dy}px)` },
      { transform: `translate(${dx * 0.85}px, ${dy * 0.85 - 18}px) scale(1.04)`, offset: 0.25 },
      { transform: 'none' },
    ],
    { duration: 640, easing: 'cubic-bezier(.2,.9,.25,1)' },
  )
}
function pulse(id) {
  if (!reduceMotion) views.get(id)?.el.animate([{ transform: 'none' }, { transform: 'scale(1.015)' }, { transform: 'none' }], { duration: 360, easing: 'ease-out' })
}

// -------------------------------------------------------------------- lines
// A connection: a thin straight line joining two things (a page and the page
// whose link opened it, a piece and the page it was cut from, a page and its
// past), touching both, as a thread between them would. It lies on the table
// under them and follows both ends.

const SVG = 'http://www.w3.org/2000/svg'
const bornAt = new Map() // edge id -> when it was made, to fade new lines in
const hotNodes = new Set()

let edgeFrame = 0
// A line is a way: clicked, it takes you to its other end (the end further
// from where you clicked: near where a link was followed, to where it led;
// near where it led, back). A press that moved is a pan, not a click.
let pressedAt = null
edgesSvg.addEventListener('pointerdown', e => (pressedAt = { x: e.clientX, y: e.clientY }))
edgesSvg.addEventListener('click', e => {
  const edge = state.edges.find(x => x.id === e.target.closest('g')?.dataset.id)
  const g = edge && geometry(edge)
  if (!g || !pressedAt || Math.hypot(e.clientX - pressedAt.x, e.clientY - pressedAt.y) > 3) return
  const p = toWorld(e.clientX, e.clientY)
  travel(Math.hypot(p.x - g.x1, p.y - g.y1) < Math.hypot(p.x - g.x2, p.y - g.y2) ? edge.to : edge.from)
})
function drawEdges() {
  if (!edgeFrame) edgeFrame = requestAnimationFrame(renderEdges)
}
// Each line as drawn (its group and what was last written to it), so a frame
// only touches the lines that changed: while things slide or are carried, the
// rest of the canvas's lines stay as they are.
const drawn = new Map() // edge id -> { group, cls, line, head }
function renderEdges() {
  edgeFrame = 0
  const seen = new Set()
  const lineOf = lines()
  for (const edge of state.edges) {
    const g = geometry(edge)
    if (!g) continue
    seen.add(edge.id)
    let d = drawn.get(edge.id)
    if (!d) {
      const group = document.createElementNS(SVG, 'g')
      group.dataset.id = edge.id
      group.innerHTML = '<path class="shade"/><path class="line"/><path class="way"/>' // (shade: on the board below it; way: where a pointer takes the thread, wider than it)
      edgesSvg.append(group)
      if (!reduceMotion && performance.now() - (bornAt.get(edge.id) || 0) < 300) group.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 380, delay: 140, fill: 'backwards' })
      d = { group }
      drawn.set(edge.id, d)
    }
    const colour = edge.kind === 'clip' ? '' : lineOf(edge.from)
    if (d.colour !== colour) d.group.style.setProperty('--thread', (d.colour = colour))
    const cls = `${edge.kind}${hotNodes.has(edge.from) || hotNodes.has(edge.to) ? ' hot' : ''}${beside?.edge === edge.id ? ' beside' : ''}`
    if (d.cls !== cls) d.group.setAttribute('class', (d.cls = cls))
    const line = `M${g.x1},${g.y1} Q${g.mx},${g.my} ${g.x2},${g.y2}`
    if (d.line !== line) for (const path of d.group.querySelectorAll('path')) path.setAttribute('d', (d.line = line))
  }
  for (const [id, d] of drawn) {
    if (seen.has(id)) continue
    d.group.remove()
    drawn.delete(id)
  }
}
// Each walk is a line of its own colour, as a city's train lines are: a page
// you started from (one nothing led to: an address typed, a search) takes
// the colour least in use, and everything followed from it keeps it, branches
// and all. Its threads are in it, so you can tell one walk from another
// across the board. (Pieces keep their linen thread: cut, not followed.)
const LINES = ['#93352b', '#2f4f86', '#4d6b2a', '#a8741a', '#6d3b6e', '#21706b', '#b4532a']
function lines() {
  const root = new Map()
  const startOf = id => {
    if (root.has(id)) return root.get(id)
    const seen = new Set()
    let at = id
    for (let e; !seen.has(at) && (e = state.edges.find(e => e.to === at && e.kind !== 'clip' && state.nodes[e.from])); at = e.from) seen.add(at)
    root.set(id, at)
    return at
  }
  return id => {
    const r = state.nodes[startOf(id)]
    if (!r) return LINES[0]
    if (r.line == null) {
      const used = LINES.map(() => 0)
      for (const n of Object.values(state.nodes)) if (n.line != null) used[n.line % LINES.length]++
      r.line = used.indexOf(Math.min(...used))
    }
    return LINES[r.line % LINES.length]
  }
}
// A thread is wound round pins: from the pin of the page a link was followed
// in to the pin of the page it led to (a page's pin is in its top margin; a
// ghost keeps its pin). A piece is taped at its top edge: its thread runs
// back from there to its page's pin. Under its own weight a thread sags a
// little, a fiftieth of its length at most a quarter square, each its own.
function pinOf(n) {
  if (n.type === 'page') return { x: n.x + n.w / 2 + SQ * (tabAt(n.id) - 0.5), y: n.y - NAME / 2 }
  if (n.type === 'ghost') return { x: n.x + GHOST.pin, y: n.y + n.h / 2 }
  return { x: n.x + n.w / 2, y: n.y } // (where its tape is)
}
function geometry(edge) {
  const from = state.nodes[edge.from] && shownAt(state.nodes[edge.from])
  const to = state.nodes[edge.to] && shownAt(state.nodes[edge.to])
  if (!from || !to) return null
  const a = pinOf(from)
  const b = pinOf(to)
  const sag = Math.min(SQ / 4, Math.hypot(b.x - a.x, b.y - a.y) / 50) * (0.8 + 0.4 * tabAt(edge.id))
  return { x1: a.x, y1: a.y, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 + sag, x2: b.x, y2: b.y }
}
function exitPoint(n, from, to, gap) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const t = Math.min(dx ? (n.w / 2 + gap) / Math.abs(dx) : Infinity, dy ? (n.h / 2 + gap) / Math.abs(dy) : Infinity)
  return { x: from.x + dx * t, y: from.y + dy * t }
}
// Hovering a thing lights up its lines and, in its source page, where it came from.
function hot(id, on) {
  on ? hotNodes.add(id) : hotNodes.delete(id)
  if (on || !flashing.has(id)) for (const e of state.edges) if (e.to === id) post(e.from, { type: 'flash', child: id, on })
  drawEdges()
}
// A page marks what was taken from it that is on the canvas (links followed,
// pieces cut): all of it once the page is ready, or `only` what has just come
// back (undo, redo).
function markTaken(id, only) {
  const n = state.nodes[id]
  if (!views.get(id)?.docReady) return // (marked once it is)
  for (const edge of state.edges) {
    if (edge.from !== id || !state.nodes[edge.to] || !sameDoc(edge.fromUrl, n.url) || (only && !only.has(edge.to))) continue
    if (edge.selector) post(id, { type: 'track', child: edge.to, selector: edge.selector })
    else if (edge.url) post(id, { type: 'track', child: edge.to, url: edge.url, link: edge.kind === 'link' })
  }
}
// A thing leaving the canvas: the page it came from lets go of its mark (and
// of its outline, if it was under the pointer).
function unmark(id) {
  if (hotNodes.has(id)) hot(id, false)
  for (const e of state.edges) if (e.to === id && state.nodes[e.from]) post(e.from, { type: 'untrack', child: id })
}

// ------------------------------------------------- opening beside, clipping

// A link that lands at its own path names a place (http becoming https, the
// site's new domain, a trailing slash don't change that); one that lands at
// another path ("random", a webring's "next", or the page moved on since) may
// land somewhere else next time.
const pathOf = url => { try { return new URL(url).pathname.replace(/\/$/, '') } catch { return url } }
const landsAsLinked = (link, now) => pathOf(link) === pathOf(now)
function openBeside(parentId, d) {
  const parent = state.nodes[parentId]
  if (!parent || !webOnly(d.url)) return
  // a link this page already opened, to a page still where it landed: that
  // page, not a second one. Unless the link went somewhere other than its own
  // path ("random", a ring's "next"): it may land elsewhere this time.
  const kind = 'link'
  const existing = state.edges.find(e => {
    const child = state.nodes[e.to]
    return e.from === parentId && e.kind === kind && sameUrl(e.url, d.url) && child && sameUrl(child.url, e.landed || child.url) && landsAsLinked(e.url, child.url)
  })
  if (existing) {
    if (d.req) post(parentId, { type: 'track', child: existing.to, req: d.req, link: true })
    front(existing.to)
    pulse(existing.to)
    if (d.quiet) return existing.to // ⌘-click stays where you are
    select(existing.to)
    focusNode(existing.to, { toggle: false })
    return existing.to
  }
  const at = d.rect ? frameToWorld(parentId, d.rect.x + d.rect.w, d.rect.y + d.rect.h / 2) : { x: parent.x + parent.w, y: parent.y + 40 }
  // a link to a place already on the canvas: a line to that page, not a
  // second one (one line between two pages, whichever way it was first walked)
  const there = pageAt(d.url, parent)
  if (there) {
    if (!state.edges.some(e => (e.from === parentId && e.to === there.id) || (e.from === there.id && e.to === parentId))) {
      addEdge({ from: parentId, to: there.id, kind, url: d.url, fromUrl: parent.url, linkText: d.text || undefined, linkY: Math.round(at.y - parent.y) })
      commit({ kind: 'link', from: parentId, node: there.id, url: d.url })
    }
    if (d.req && state.edges.some(e => e.from === parentId && e.to === there.id)) post(parentId, { type: 'track', child: there.id, req: d.req, link: true })
    goToPage(there.id, d.quiet)
    return there.id
  }
  const spot = spotBeside(parent, pageSize(), at, d.rect && at.y)
  if (parent.type === 'page') cameFrom.set(d.url, tellFrom(d.url, parent.url))
  const child = addNode({ type: 'page', url: d.url, title: d.text || '', ...spot })
  addEdge({ from: parentId, to: child.id, kind, url: d.url, fromUrl: parent.url, linkText: d.text || undefined, linkY: Math.round(at.y - parent.y) })
  if (d.req) post(parentId, { type: 'track', child: child.id, req: d.req, link: true })
  layDown(child.id, at)
  if (!d.quiet) {
    select(child.id)
    focusNode(child.id, { toggle: false })
  }
  commit({ kind: 'open-beside', node: child.id, from: parentId, url: d.url, link: d.text || undefined })
  teach('clip', 'C cuts from any page')
  return child.id
}

// Cutting is one tool, not a button on each page: picked up (the ✂ below,
// C), any page shows what is under the pointer to cut, until it is put
// down (the ✂ again, Esc). A page starting meanwhile is told too (see hello).
let cutting = false
function cutWith(on) {
  cutting = on
  for (const [id, v] of views) if (v.frame && v.docReady) post(id, { type: on ? 'clip-start' : 'clip-stop', quiet: true })
}
const startClip = () => cutWith(!cutting) // (as C)

// A note is put anywhere: the note picked up (the note below), the next click
// puts it there, stuck to the page or piece under it (at that spot) or on the
// canvas by itself.
let placingNote = false
function placeNote(on) {
  placingNote = on
  document.body.classList.toggle('placing-note', on)
}
addEventListener('pointerdown', e => {
  if (!placingNote || e.button !== 0 || e.target.closest('#hud')) return
  e.preventDefault()
  e.stopPropagation()
  placeNote(false)
  const p = toWorld(e.clientX, e.clientY)
  const note = addNode({ type: 'note', text: '', x: Math.round(p.x - 20), y: Math.round(p.y - 20), w: NOTE_W, h: 60, z: ++topZ })
  const on = underNote(note)
  if (on) stick(note, on)
  appear(note.id)
  select(note.id)
  views.get(note.id).text.focus()
}, true)

// Puts something taken from a page (a clip, an image, a quote) beside it.
// Cut while holding ⌥ (`stay`): the view doesn't move, so you can keep reading
// and cutting; the piece flies out to its place and the page marks what went.
function takeOut(sourceId, data, rect, size, { stay } = {}) {
  const src = state.nodes[sourceId]
  const from = rect ? frameToWorld(sourceId, rect.x, rect.y) : { x: src.x + src.w, y: src.y + 40 }
  const spot = spotFrom(src, size, from.y)
  spot.x += byHand(HAND / 2) // (set down by hand, as a page is)
  spot.y += byHand(HAND / 2)
  const node = addNode({ url: src.url, title: src.title, favicon: src.favicon, tape: COLOUR.test(src.bg) ? src.bg : undefined, ...data, ...spot })
  addEdge({ from: sourceId, to: node.id, kind: 'clip', fromUrl: src.url, selector: data.selector })
  if (data.selector) post(sourceId, { type: 'track', child: node.id, selector: data.selector })
  if (rect) liftFrom(node.id, from)
  else appear(node.id)
  if (!stay) {
    select(node.id)
    reveal(node.id)
  }
  commit({ kind: 'take', node: node.id, as: data.type, from: sourceId, url: src.url, text: data.text?.slice(0, 200) })
  if (stay) teach('held', 'let go of ⌥ to stop')
  else if (data.selector) teach('hold', '⌥-click cuts too')
  else teach('note', 'N adds a note')
  return node
}
function makeClip(sourceId, d) {
  const size = { w: Math.max(40, d.w), h: Math.max(24, d.h) }
  const common = { url: d.url, text: d.text, selector: d.selector }
  const how = { stay: !!d.held }
  if (d.kind === 'words') return takeOut(sourceId, { type: 'note', text: d.text }, d.rect, { w: 320, h: 100 }, how)
  if (d.kind === 'image') takeOut(sourceId, { type: 'image', src: d.src, bg: d.bg, look: d.look, sized: true, ...common }, d.rect, size, how)
  else if (d.kind === 'embed') takeOut(sourceId, { type: 'embed', src: d.src, ...common }, d.rect, size, how)
  else takeOut(sourceId, { type: 'clip', html: d.html, fonts: d.fonts, bg: d.bg, ...common }, d.rect, size, how)
}

// A page that says it is a video or music page and names its embeddable
// player (og:video / twitter:player) is shown as that player: the site made
// it for exactly this, and the full page is one click away (open in a tab).
function showPlayer(id, d) {
  const n = state.nodes[id]
  const ratio = d.player.w && d.player.h ? d.player.h / d.player.w : 9 / 16
  unmount(id)
  Object.assign(n, { type: 'embed', src: d.player.src, url: d.url, title: d.title || n.title, favicon: d.favicon || n.favicon, ratio })
  fitContent(n)
  delete n.sx
  delete n.sy
  mount(n)
  knowDoors() // no longer a page for doors to lead to
  if (focused === id) {
    setFocused(null)
    focusNode(id, { toggle: false })
  }
  select(id)
  drawEdges()
  save()
}

// ---------------------------------------------------------------- places
// the same place, however its address was written (scheme, www., escapes, a last slash)
function samePlace(a, b) {
  const key = url => {
    try {
      const u = new URL(url)
      return (u.host.replace(/^www\./, '') + decodeURI(u.pathname).replace(/\/$/, '') + u.search).toLowerCase()
    } catch {
      return url
    }
  }
  return key(a) === key(b)
}
// The icon of a place whose page names none: its site's /favicon.ico
const iconOf = url => `https://${hostOf(url)}/favicon.ico`

// ------------------------------------------------------------- pointer input

let gesture = null
function beginGesture(e, data) {
  gesture = { id: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false, ...data }
  document.body.classList.add('busy')
  canvas.setPointerCapture?.(e.pointerId)
}

// Pages, clips and embeds are live: they are moved by their name or handle
// (or from anywhere when zoomed far out). Notes and images move from anywhere.
function nodePointerDown(e, id) {
  if (e.button !== 0 || space) return
  const n = state.nodes[id]
  // the page kept beside the one read is a way back to it, not a page to use from there
  if (focused && id === beside?.id && !e.target.closest('.bar, .rz')) {
    e.preventDefault()
    e.stopPropagation()
    select(id)
    return focusNode(id, { toggle: false })
  }
  select(id)
  keysToCanvas() // a press on its name (or on it from far out) handles it as a thing: Backspace closes it
  front(id)
  const live = n.type === 'page' || n.type === 'clip' || n.type === 'embed'
  if (live && !e.target.closest('.bar, .grab') && cam.z >= OVERVIEW_Z) return
  if (n.type === 'note' && document.activeElement === views.get(id).text) return
  e.preventDefault()
  e.stopPropagation()
  const door = n.type === 'note' || cam.z >= OVERVIEW_Z ? e.target.closest('.up, .door') : null // a way up from any page big enough to read (zoomed out, a name moves its page)
  beginGesture(e, { kind: 'move', node: id, x0: n.x, y0: n.y, to: door?.dataset.url })
}
function nodeDoubleClick(e, id) {
  if (e.target.closest('.chip, .door') || (cam.z >= OVERVIEW_Z && e.target.closest('.up'))) return // (a way up, where the levels are)
  const n = state.nodes[id]
  if (e.target.closest('.bar') || n.type === 'image' || cam.z < OVERVIEW_Z) focusNode(id)
}

function startResize(e, id, dir) {
  if (e.button !== 0) return
  e.preventDefault()
  e.stopPropagation()
  const n = state.nodes[id]
  select(id)
  front(id)
  beginGesture(e, { kind: 'resize', node: id, dir, x0: n.x, y0: n.y, w0: n.w, h0: n.h })
}
// From any edge or corner, like a window. Images keep their proportions;
// clips and notes only change width (their height follows their content).
function resize(n, g, dx, dy) {
  const { dir, x0, y0, w0, h0 } = g
  const [minW, minH] = { page: [360, 240], clip: [80, 0], embed: [160, 90], note: [140, 0], image: [60, 40] }[n.type]
  let w = w0
  let h = h0
  if (dir.includes('e')) w = w0 + dx
  if (dir.includes('w')) w = w0 - dx
  if (dir.includes('s')) h = h0 + dy
  if (dir.includes('n')) h = h0 - dy
  w = Math.max(minW, Math.round(w))
  h = n.type === 'image' ? Math.round((w * h0) / w0) : Math.max(minH, Math.round(h))
  if (fromContent(n)) n.sized = true // its size is yours now
  n.w = w
  n.x = dir.includes('w') ? x0 + w0 - w : x0
  if (n.type === 'note' || n.type === 'clip') return
  n.h = h
  n.y = dir.includes('n') ? y0 + h0 - h : y0
}

const onEmptyCanvas = e => e.target === canvas || e.target === world || e.target === edgesSvg
canvas.addEventListener('pointerdown', e => {
  if ((e.button !== 0 && e.button !== 1) || (!onEmptyCanvas(e) && !space)) return
  if (isEditing(document.activeElement)) document.activeElement.blur()
  beginGesture(e, { kind: 'pan' })
  document.body.classList.add('panning')
})
addEventListener('pointermove', e => {
  if (!gesture || e.pointerId !== gesture.id) return
  const dx = e.clientX - gesture.sx
  const dy = e.clientY - gesture.sy
  if (!gesture.moved && Math.hypot(dx, dy) < 3) return
  gesture.moved = true
  if (gesture.kind === 'pan') {
    stopCamera()
    endFocus()
    // the canvas moves as far as the pointer has since it was pressed (Safari
    // merges pointer events and keeps only the last one's movement, so adding
    // up movements falls behind)
    gesture.from ||= { x: cam.x - gesture.sx, y: cam.y - gesture.sy }
    cam.x = gesture.from.x + e.clientX
    cam.y = gesture.from.y + e.clientY
    applyCamera()
    const now = performance.now()
    gesture.trail = [...(gesture.trail || []).filter(p => now - p.t < 100), { t: now, x: e.clientX, y: e.clientY }]
    return
  }
  // a thing being carried is lifted off the table
  if (gesture.kind === 'move' && !gesture.lifted) {
    gesture.lifted = true
    views.get(gesture.node)?.el.classList.add('lifted')
  }
  const n = state.nodes[gesture.node]
  if (!n) return
  if (gesture.kind === 'move') {
    n.x = Math.round(gesture.x0 + dx / cam.z)
    n.y = Math.round(gesture.y0 + dy / cam.z)
  } else resize(n, gesture, dx / cam.z, dy / cam.z)
  place(n)
  carry(n)
  drawEdges()
})
addEventListener('pointerup', e => {
  if (!gesture || e.pointerId !== gesture.id) return
  const g = gesture
  gesture = null
  document.body.classList.remove('busy', 'panning')
  if (g.kind === 'pan' && !g.moved) {
    select(null)
    endFocus()
    if (Object.keys(state.nodes).length) closeBar()
  }
  if (g.kind === 'pan' && g.moved) glide(g.trail)
  // and set down again
  if (g.lifted) views.get(g.node)?.el.classList.remove('lifted')
  const at = state.nodes[g.node]
  if (g.kind === 'move' && !g.moved && g.to) at?.type === 'note' ? throughDoor(g.node, g.to, e.metaKey || e.ctrlKey) : climb(g.node, g.to, e.metaKey || e.ctrlKey)
  else if (g.kind === 'move' && !g.moved && at?.type === 'ghost') reopen(g.node)
  else if (g.kind === 'move' && !g.moved && at?.type === 'note') {
    const t = views.get(g.node).text
    t.focus()
    placeCaret(t, e.clientX, e.clientY)
  }
  const moved = state.nodes[g.node]
  if (g.moved && g.kind === 'move' && moved?.type === 'note' && !moved.url) {
    const target = underNote(moved)
    if (target) {
      stick(moved, target)
      front(target)
    } else unstick(moved)
  }
  if (g.moved && g.kind !== 'pan') commit({ kind: g.kind, node: g.node })
})
function placeCaret(t, x, y) {
  const pos = document.caretPositionFromPoint?.(x, y)
  const range = document.createRange()
  if (pos && t.contains(pos.offsetNode)) range.setStart(pos.offsetNode, pos.offset)
  else {
    range.selectNodeContents(t)
    range.collapse(false)
  }
  getSelection().removeAllRanges()
  getSelection().addRange(range)
}

// Text written straight onto the canvas: double-click empty canvas, or the
// text button (it lands in the middle of the screen).
// --------------------------------------------------------- along the trail
// [ goes back up the trail to the page this one was opened (or cut) from;
// ⌥→ goes down again, to what you came back from (or the newest page opened here).
const cameBackFrom = new Map()
function stepTrail(dir) {
  const here = focused || selected
  if (!here || !state.nodes[here]) return
  let to = null
  if (dir < 0) {
    to = state.edges.find(e => e.to === here && state.nodes[e.from])?.from
    if (to) cameBackFrom.set(to, here)
  } else {
    const down = state.edges.filter(e => e.from === here && state.nodes[e.to])
    const back = cameBackFrom.get(here)
    to = down.some(e => e.to === back) ? back : down.filter(e => e.kind === 'link').map(e => e.to).sort((a, b) => (state.nodes[b].created || 0) - (state.nodes[a].created || 0))[0]
  }
  if (!to) return
  select(to)
  focusNode(to, { toggle: false })
}

// ------------------------------------------------------------- sticky notes
// A note is a small sheet of paper. Stuck to a thing (a page, a clip, an
// image) it sits over that thing's corner and moves with it; dragged off, it
// lies loose on the table; dragged onto something, it sticks there. When the
// thing it was on is closed, the note stays, loose: nothing written is lost.
const NOTE_W = 200
const notesOn = id => Object.values(state.nodes).filter(n => n.type === 'note' && n.on === id)
function stick(note, target) {
  Object.assign(note, { on: target.id, dx: note.x - target.x, dy: note.y - target.y })
  markReading()
}
function unstick(note) {
  delete note.on
  delete note.dx
  delete note.dy
  markReading()
}
// keeps the notes on a thing with it as it moves or changes size
function carry(target) {
  for (const note of notesOn(target.id)) {
    note.x = target.x + Math.min(note.dx, target.w - 40)
    note.y = target.y + note.dy
    place(note)
  }
}
// what a note dropped here sticks to: the topmost thing under its middle
function underNote(note) {
  const cx = note.x + note.w / 2
  const cy = note.y + Math.min(note.h / 2, 30)
  return Object.values(state.nodes)
    .filter(n => n.type !== 'note' && cx >= n.x && cx <= n.x + n.w && cy >= n.y - 20 && cy <= n.y + n.h)
    .sort((a, b) => (b.z || 0) - (a.z || 0))[0]
}
canvas.addEventListener('dblclick', e => {
  if (!onEmptyCanvas(e)) return // a thing's own double-click
  // pressing a thing hands the pointer to the canvas (so it can be carried),
  // so a double-click on it lands here too: what's under the pointer decides
  const under = document.elementFromPoint(e.clientX, e.clientY)
  const root = under?.closest('.node')
  const id = root && [...views].find(([, v]) => v.el === root)?.[0]
  if (id) nodeDoubleClick({ target: under }, id)
})

// The canvas only moves by its camera. The browser would otherwise scroll it
// to bring a focused page into view (a click, a clip, a page focusing its
// own search box), shifting everything out from under the pointer.
for (const scroller of [canvas, document.documentElement, document.body]) {
  scroller.addEventListener('scroll', () => {
    if (scroller.scrollTop || scroller.scrollLeft) scroller.scrollTo(0, 0)
  })
}
addEventListener('scroll', () => {
  if (scrollX || scrollY) scrollTo(0, 0)
})

// ---------------------------------------------------------- scroll and pinch
// What the browser does, which all of this follows: it sends a scroll (the
// fingers' and the glide after) to what it began on, the canvas or one page's
// frame, and a page only while the pointer is over it.
// So a scroll goes to what it begins over, as a Mac's scroll goes to the
// window under the pointer, and is that's until it is over:
//   over a page: it scrolls the page (the page under the pointer takes it;
//     style.css).
//   anywhere else: it pans the mat. No page takes the pointer meanwhile, so
//     none catches the scroll moving under the fingers, nor one begun while
//     the mat still glides, until the hand moves the pointer (aiming at
//     something new).
//   zoomed far out (overview), where pages are pictures: it pans the mat.
// A pinch anywhere zooms the mat, about the pointer (so what it began on stays
// under it), and past a zoom limit springs back when it is over.
canvas.addEventListener('wheel', e => {
  e.preventDefault()
  if (e.ctrlKey) zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01), true)
  else panBy(e.deltaX, e.deltaY)
  scrolled(true)
}, { passive: false })
let scrollEnd = 0
function scrolled(onMat) {
  if (onMat) document.body.classList.add('scrolling')
  clearTimeout(scrollEnd)
  scrollEnd = setTimeout(scrollOver, STILL)
}
function scrollOver() {
  clearTimeout(scrollEnd)
  document.body.classList.remove('scrolling')
  hoverAtPointer()
  springBack()
}
// the hand moving the pointer (not the browser saying where it is now that
// things moved under it, which is no movement)
addEventListener('pointermove', e => {
  if ((e.movementX || e.movementY) && document.body.classList.contains('scrolling')) scrollOver()
}, { passive: true })

// Holding space pans from anywhere, even over pages.
let space = false
addEventListener('keydown', e => {
  if (e.code !== 'Space' || e.repeat || isEditing(e.target)) return
  e.preventDefault()
  space = true
  document.body.classList.add('space')
})
addEventListener('keyup', e => {
  if (e.code !== 'Space') return
  space = false
  document.body.classList.remove('space')
})
addEventListener('pointerdown', e => {
  if (!space) return
  e.preventDefault()
  e.stopPropagation()
  beginGesture(e, { kind: 'pan' })
}, true)

// ------------------------------------------------------------------ keyboard

// A key press by name: 'c', '[', 'z', 'shift+z',
// A letter or digit as typed, or by the key it is on where ⌥ or ⇧
// changed what it types (⌥N types a tilde, ⇧2 an @); other characters as
// typed, ⇧ included (⌘+ is 'mod++'). inject.js names them the same way.
function keyName(e) {
  const on = /^(?:Key|Digit)(.)$/.exec(e.code)?.[1].toLowerCase()
  const key = /^[a-z0-9]$/i.test(e.key) ? e.key.toLowerCase() : on || (e.key || '').toLowerCase() // (autofill's keydown has no key)
  const typed = key.length === 1 && !on
  return [(e.metaKey || e.ctrlKey) && 'mod', e.altKey && 'alt', e.shiftKey && !typed && 'shift', key].filter(Boolean).join('+')
}
// The canvas's commands. They work wherever the keys are: on the canvas, and
// in a page, which hands them over (inject.js; the canvas tells each page
// which they are). Where text is being typed (the find box, a note, a text
// field in a page) only those marked `typing` do: there ⌘Z undoes the typing
// and C types a C.
const COMMANDS = {
  // the tools are a key each, as at a desk: C the ✂, N a note, / where to go
  c: { run: () => cutWith(!cutting) },
  n: { run: () => placeNote(!placingNote) },
  '/': { run: () => openBar() },
  f: { run: from => { const id = pageNear(from); if (id) focusNode(id) } }, // read it (F again: back)
  r: { run: from => { const id = pageNear(from); if (id) reload(id) } }, // load it again
  x: { run: from => { const id = (state.nodes[hovered] && hovered) || from || selected || pageNear(); if (id) close(id) } }, // put away what is under the pointer (Z brings it back)
  l: { run: from => { const id = pageNear(from); if (id) chooseAddress(id) } }, // its link, copied
  // ⌘+ ⌘− ⌘0 are the browser's zoom: here they zoom the canvas (else the
  // browser would scale the whole app, tools and all). Not on the keys sheet:
  // zooming is the trackpad's.
  'mod+=': { typing: true, run: () => zoomAt(innerWidth / 2, innerHeight / 2, 1.25) },
  'mod++': { typing: true, run: () => zoomAt(innerWidth / 2, innerHeight / 2, 1.25) },
  'mod+-': { typing: true, run: () => zoomAt(innerWidth / 2, innerHeight / 2, 0.8) },
  'mod+0': {
    typing: true,
    run: () => {
      const p = toWorld(innerWidth / 2, innerHeight / 2)
      animateCamera({ z: 1, x: innerWidth / 2 - p.x, y: innerHeight / 2 - p.y })
    },
  },
  // back and forward along the trail: [ ]
  '[': { run: () => stepTrail(-1) },
  ']': { run: () => stepTrail(1) },
  z: { run: () => undo() },
  'shift+z': { run: () => redo() },
  '?': { run: () => showKeys(document.querySelector('#keys').hidden) },
}
// L copies a page's link: its whole address, printed in its head and
// selected, as text is, shows what was copied. It can't be edited: a page's address is
// where it is (/ goes somewhere else). Choosing anything else, a click, or Esc
// lets it go.
let linked = null
function chooseAddress(id) {
  const n = state.nodes[id]
  const v = views.get(id)
  if (!v?.address) return
  letGoAddress()
  linked = id
  keysToCanvas() // (so it is copied here, and ⌘C copies it again, not something in the page)
  v.address.classList.add('chosen')
  v.address.textContent = (() => { try { return decodeURI(n.url) } catch { return n.url } })()
  const range = document.createRange()
  range.selectNodeContents(v.address)
  getSelection().removeAllRanges()
  getSelection().addRange(range)
  navigator.clipboard.writeText(n.url).then(() => toast('link copied'), () => document.execCommand('copy')) // (else as ⌘C would, below)
}
function letGoAddress() {
  const v = views.get(linked)
  const n = state.nodes[linked]
  linked = null
  if (!v?.address) return
  v.address.classList.remove('chosen')
  if (n) v.address.replaceChildren(...addressParts(n.url))
}
document.addEventListener('selectionchange', () => {
  if (linked && !views.get(linked)?.address.contains(getSelection().anchorNode)) letGoAddress()
})
// copied, it is the address itself (not as it reads, decoded)
addEventListener('copy', e => {
  const n = state.nodes[linked]
  if (!n || !e.clipboardData) return
  e.preventDefault()
  e.clipboardData.setData('text/plain', n.url)
  toast('link copied')
})
// The keys, on a sheet: ? shows it, ? again, Esc or a click anywhere puts it away.
function showKeys(on) {
  document.querySelector('#keys').hidden = !on
  if (on) keysToCanvas() // (so Esc, pressed with the keys in a page, reaches the sheet)
}
addEventListener('pointerdown', e => e.target.closest?.('#help') || showKeys(false), true)
document.querySelector('#help').addEventListener('click', () => showKeys(document.querySelector('#keys').hidden))
// what a page is told: each command's name, and whether it works while typing
const PAGE_KEYS = Object.fromEntries(Object.entries(COMMANDS).map(([name, c]) => [name, !!c.typing]))
addEventListener('keydown', e => {
  const mod = e.metaKey || e.ctrlKey
  const command = COMMANDS[keyName(e)]
  if (command && (command.typing || !isEditing(e.target))) {
    e.preventDefault()
    return command.run()
  }
  if (e.target === input) return
  // ⌫ puts away what is selected, from the canvas only: never from inside a
  // page, where it is pressed meaning the page's own (Z brings it back)
  if ((e.key === 'Backspace' || e.key === 'Delete') && selected && !isEditing(e.target)) {
    e.preventDefault()
    return close(selected)
  }
  if (isEditing(e.target)) {
    if (e.key === 'Escape') {
      e.target.blur()
      keysTo(focused) // done writing: back to what you're reading
    }
    return
  }
  if (e.key === 'Escape' && !document.querySelector('#keys').hidden) return showKeys(false)
  if (e.key === 'Escape' && (cutting || placingNote)) return cutWith(false), placeNote(false) // a tool put down
  if (e.key === 'Escape' && !unfocus()) select(null)
  if (e.key === 'Escape' && linked) return getSelection().removeAllRanges()
})

// ------------------------------------------------------- messages from frames

// What stands for something you did in a page (following a link, a
// cut, a copy, dragging something out) is taken only from the page you are
// doing it in, while you do it: the canvas is active (a click or key in a page
// activates its ancestors too, per HTML: for about 5 s in Chrome and Safari;
// a page's script acting on its own has none), and the page has the keys (a
// press in a page gives it them: see inject.js). So a click elsewhere doesn't
// let another page act. (A drag that only passes over a page carries nothing:
// that is heard any time.)
const byYou = d => ['open', 'clip', 'copied'].includes(d.type) || (d.type === 'drag' && !!(d.url || d.img || d.text))
// which thing a message came from: its frame's window, remembered once found
const senders = new WeakMap() // window -> node id
addEventListener('message', e => {
  const d = e.data
  if (!d || d.cb !== 1 || typeof d.type !== 'string') return
  let id = senders.get(e.source) ?? null
  if (!id || views.get(id)?.frame?.contentWindow !== e.source) {
    id = null
    for (const [nid, v] of views) if (v.frame?.contentWindow === e.source) id = nid
    if (id) senders.set(e.source, id)
  }
  const n = id && state.nodes[id]
  if (!n) return
  const v = views.get(id)
  if (byYou(d) && !(navigator.userActivation?.isActive && document.activeElement === v.frame)) return

  switch (d.type) {
    case 'meta': {
      if (n.type !== 'page' || !webOnly(d.url)) break
      if (d.player?.src && /^https:/.test(d.player.src)) {
        showPlayer(id, d)
        break
      }
      // the page's own history, to know whether it went somewhere within itself
      if (v.history.at(-2) === d.url) v.history.pop()
      else if (v.history.at(-1) !== d.url) v.history.push(d.url)
      n.url = d.url
      const into = state.edges.find(e => e.to === id && e.kind === 'link' && !e.landed)
      if (into) into.landed = d.url // where its link led (openBeside: is it still there)
      n.title = d.title || n.title
      n.favicon = d.favicon || n.favicon
      if (COLOUR.test(d.bg)) n.bg = d.bg
      paintTab(n, v)
      updateName(id)
      setLoading(id, false)
      if (!v.docReady) {
        v.docReady = true
        teach('beside', '⌘-click opens without going · [ goes back')
        if (v.seek) post(id, { type: 'find', pattern: v.seek }) // words chosen in /, in place of where it was
        else if (v.restored && (n.sx || n.sy)) post(id, { type: 'scroll-to', x: n.sx || 0, y: n.sy || 0 })
        v.restored = false
        awake(id, !!v.seek)
        v.seek = null
        markTaken(id)
      }
      save()
      break
    }
    case 'text': // what it says, for /
      v.pageText = { url: d.url, text: String(d.text) }
      break
    case 'hello': // a page starting is told the canvas's commands, which it hands over when pressed in it
      v.heard = v.listening = true
      if (cutting) post(id, { type: 'clip-start', quiet: true }) // (the ✂ in hand: this page shows what to cut too)
      post(id, { type: 'keys', keys: PAGE_KEYS })
      if (id === focused) keysTo(id) // the page you're reading, arrived: the keys it was given while loading
      break
    case 'navigating':
      v.docReady = false
      v.el.classList.remove('cutting') // (the page's ✂ goes with it)
      setLoading(id, true)
      break
    case 'took-focus': {
      // a page took the keys without a press in it: they go back where they
      // were (the find box being typed in, the note or page selected, else the canvas)
      const owner = selected || focused
      if (!bar.hidden) input.focus({ preventScroll: true })
      else if (owner !== id) views.get(owner)?.text ? views.get(owner).text.focus({ preventScroll: true }) : keysTo(owner)
      break
    }
    case 'cutting':
      v.el.classList.toggle('cutting', !!d.on)
      // the ✂ put down in a page is put down everywhere; after a cut it is still in hand
      if (!d.on && cutting) d.why === 'cut' ? post(id, { type: 'clip-start', quiet: true }) : d.why === 'put-down' && cutWith(false)
      break
    case 'touch':
      touch(id)
      showKeys(false) // (a press in a page, as one on the canvas)
      if (!gesture) releaseHolds()
      if (focused && focused !== id) endFocus()
      select(id)
      front(id)
      if (Object.keys(state.nodes).length) closeBar()
      break
    case 'snapshot':
      stillFrom(id, d)
      break
    case 'copied':
      collect(id, d.text)
      break
    case 'holding':
      holdingIn = id
      break
    case 'show-piece':
      if (!state.nodes[d.child]) break
      select(d.child)
      reveal(d.child)
      pulse(d.child)
      break
    case 'media':
      d.playing ? playing.add(id) : playing.delete(id)
      break
    case 'scroll':
      Object.assign(n, { sx: d.x, sy: d.y })
      save()
      break
    case 'open':
      openBeside(id, d)
      break
    case 'zoom': {
      const p = Number.isFinite(d.x) && Number.isFinite(d.y) ? (w => toScreen(w.x, w.y))(frameToWorld(id, d.x, d.y)) : pointerAt || { x: innerWidth / 2, y: innerHeight / 2 }
      zoomAt(p.x, p.y, Math.exp(-d.dy * 0.01), true)
      scrolled(false)
      break
    }
    case 'key': // one of the canvas's commands, pressed in the page (a press: not the page's own script)
      if (!Object.hasOwn(COMMANDS, d.key) || !navigator.userActivation?.isActive) break
      COMMANDS[d.key].run(id) // (the page it was pressed in is where it acts; what's selected stays as you chose)
      break
    case 'clip':
      makeClip(id, d)
      break
    case 'size':
      if (n.type === 'clip' && d.h > 0 && Math.abs(d.h - n.h) > 1) {
        n.h = d.h
        place(n)
        drawEdges()
        save()
      }
      break
    case 'drag':
      if (d.url || d.img || d.text) dragging = { from: id, ...d }
      document.body.classList.add('dragging')
      break
    case 'dragend':
      setTimeout(() => {
        document.body.classList.remove('dragging')
        dragging = null
      }, 60)
      break
  }
})

// Letting go of ⌥ while the canvas has the keys: the page holding a frame lets go too.
let holdingIn = null
addEventListener('keyup', e => {
  if (e.key !== 'Alt' || !holdingIn) return
  post(holdingIn, { type: 'let-go' })
  holdingIn = null
})

// ----------------------------------------------------- dropping and pasting

let dragging = null // what is being dragged out of a page, as that page reported it
addEventListener('dragenter', () => document.body.classList.add('dragging'))
addEventListener('dragleave', e => {
  if (!e.relatedTarget && !dragging) document.body.classList.remove('dragging')
})
// Pages stop taking the pointer only while something is held (space, a
// drag, a move or resize). If the end of that is missed (the key or button
// was released over a page, or the window lost focus), any later pointer
// movement or scroll in the canvas ends it, so pages never stay dead.
function releaseHolds() {
  if (gesture) return
  space = false
  dragging = null
  document.body.classList.remove('space', 'dragging', 'busy', 'panning')
}
addEventListener('blur', releaseHolds)
// A press in a page (the canvas sees only its keys leave for the page's
// frame): that page is the one picked, as a click on its name picks it.
// Unless nothing in it hands the keys over (a page that couldn't load):
// they come back, so X and the rest still work.
addEventListener('blur', () => setTimeout(() => {
  const f = document.activeElement
  if (f?.tagName !== 'IFRAME' || !document.hasFocus()) return
  const id = f.closest('.node')?.dataset.id
  const v = views.get(id)
  if (!v || v.frame !== f) return
  if (state.nodes[id].type === 'page' && !v.listening) keysToCanvas()
  else if (navigator.userActivation?.isActive) select(id), front(id)
}))
addEventListener('pointermove', e => {
  if (!e.buttons && !space) releaseHolds()
}, { passive: true })
addEventListener('pointercancel', () => {
  gesture = null
  releaseHolds()
})
addEventListener('dragover', e => {
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
})
addEventListener('drop', e => {
  e.preventDefault()
  document.body.classList.remove('dragging')
  const info = dragging || {}
  dragging = null
  let { url, img, text } = info
  const dt = e.dataTransfer
  if (!url && !img && !text && dt) {
    const file = [...dt.files].find(f => f.type.startsWith('image/'))
    if (file) return addImageFile(file, toWorld(e.clientX, e.clientY))
    const uri = dt.getData('text/uri-list').split('\n').find(l => l && !l.startsWith('#'))
    const plain = dt.getData('text/plain').trim()
    const src = /<img[^>]+src="([^"]+)"/i.exec(dt.getData('text/html'))?.[1]
    if (src && !uri) img = src
    else if (uri) url = uri
    else if (looksLikeUrl(plain)) url = toUrl(plain)
    else text = plain
  }
  const p = toWorld(e.clientX, e.clientY)
  const from = info.from && state.nodes[info.from] ? info.from : null
  const fromUrl = from ? state.nodes[from].url : undefined
  let node
  if (webOnly(url)) {
    node = addNode({ type: 'page', url, title: info.label || '', x: Math.round(p.x - 60), y: Math.round(p.y - 12), ...pageSize() })
    if (from) {
      addEdge({ from, to: node.id, kind: 'link', url, fromUrl })
      post(from, { type: 'track', child: node.id, url, link: true })
    }
  } else if (img) {
    node = addNode({ type: 'image', src: img, url: fromUrl, x: Math.round(p.x - 120), y: Math.round(p.y - 80), w: 240, h: 160 })
    if (from) addEdge({ from, to: node.id, kind: 'clip', fromUrl })
  } else if (text) {
    node = addNode({ type: 'note', text, url: fromUrl, x: Math.round(p.x - 140), y: Math.round(p.y - 30), w: 320, h: 80 })
    if (from) addEdge({ from, to: node.id, kind: 'clip', fromUrl })
  }
  if (!node) return
  appear(node.id)
  select(node.id)
  commit({ kind: 'drop', node: node.id, as: node.type, url: node.url || node.src, from: from || undefined })
})

// Paste a link, image or text onto the canvas, where the pointer is.
let pointerAt = null
addEventListener('pointermove', e => (pointerAt = { x: e.clientX, y: e.clientY }), { passive: true })
addEventListener('paste', e => {
  if (isEditing(e.target) || !e.clipboardData) return
  e.preventDefault()
  const at = pointerAt || { x: innerWidth / 2, y: innerHeight / 2 }
  const p = toWorld(at.x, at.y)
  const file = [...e.clipboardData.files].find(f => f.type.startsWith('image/'))
  if (file) return addImageFile(file, p)
  const text = e.clipboardData.getData('text/plain').trim()
  if (!text) return
  const node = looksLikeUrl(text)
    ? addNode({ type: 'page', url: toUrl(text), title: '', ...spotFree(p.x - pageSize().w / 2, p.y - pageSize().h / 3, pageSize(), PLACE.room) })
    : addNode({ type: 'note', text, x: Math.round(p.x - 20), y: Math.round(p.y - 20), w: 280, h: 60 })
  appear(node.id)
  select(node.id)
  closeBar(true)
  if (node.type === 'page') focusNode(node.id, { toggle: false })
  commit({ kind: 'paste', node: node.id, as: node.type, url: node.url, text: node.text?.slice(0, 200) })
})
// Images from the clipboard or Finder are stored in the canvas, scaled down.
function addImageFile(file, p) {
  const img = new Image()
  img.onload = () => {
    const scale = Math.min(1, 1400 / img.naturalWidth)
    const c = document.createElement('canvas')
    c.width = Math.round(img.naturalWidth * scale)
    c.height = Math.round(img.naturalHeight * scale)
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
    URL.revokeObjectURL(img.src)
    const w = Math.min(420, c.width)
    const node = addNode({ type: 'image', src: c.toDataURL('image/webp', 0.86), sized: true, x: Math.round(p.x - 20), y: Math.round(p.y - 20), w, h: Math.round((w * c.height) / c.width) })
    appear(node.id)
    select(node.id)
    closeBar(true)
    commit({ kind: 'paste', node: node.id, as: 'image' })
  }
  img.src = URL.createObjectURL(file)
}

// ------------------------------------------------------------- the open bar

function setupBar() {
  const heads = bar.querySelector('.heads')
  heads.append(el('div', 'lead', 'Or start somewhere:'))
  for (const [label, url] of TRAILHEADS) {
    const b = el('button', null, label)
    b.addEventListener('click', () => go(url))
    heads.append(b)
  }
  input.addEventListener('input', showFinds)
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      choose(chosen + (e.key === 'ArrowDown' ? 1 : -1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      finds[chosen]?.go()
    } else if (e.key === 'Escape') {
      closeBar()
      keysTo(focused) // back to what you're reading
    }
  })
  input.addEventListener('blur', () =>
    setTimeout(() => {
      if (document.activeElement !== input && Object.keys(state.nodes).length) closeBar()
    }, 120),
  )
  $('#reset').addEventListener('click', reset)
  $('#sound').addEventListener('click', () => setSound(!soundOn))
  $('#sound').classList.toggle('off', !soundOn)
  $('#sound').title = soundOn ? 'sounds on' : 'sounds off'
}
function go(text) {
  input.value = ''
  const c = toWorld(innerWidth / 2, innerHeight / 2)
  // a new walk: in the middle of what you see if that is free, else in the
  // nearest space a page's width clear of everything (forty times the gap
  // between pages of a walk), so it starts a cluster of its own and doesn't
  // read as part of the walk beside it
  const node = addNode({ type: 'page', url: toUrl(text), title: '', ...spotFree(c.x - pageSize().w / 2, c.y - pageSize().h / 2, pageSize(), Math.max(PLACE.gap, pageSize().w)) })
  appear(node.id)
  select(node.id)
  closeBar(true)
  focusNode(node.id, { toggle: false })
  commit({ kind: 'open', node: node.id, url: node.url, typed: text.trim() })
}
function openBar() {
  bar.hidden = false
  bar.classList.toggle('home', !Object.keys(state.nodes).length)
  input.focus()
  input.select()
  showFinds()
}

// ---------------------------------------------------- finding anything (/)
// One box: what you type is matched against everything on the canvas (names,
// addresses, the link words that led to a page, notes, the text of clips),
// then against the words inside its pages, and Enter flies there. With
// nothing typed it shows where you were last. The last row is always the
// web: the address typed, or a small-web search.
const KIND = { page: 'page', clip: 'clip', note: 'note', image: 'image', embed: 'player' }
let finds = []
let chosen = 0
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// What was typed, as a page may have it written: in any case, with any space
// between its words, straight or curly quotes, from the start of a word.
const typedIn = q => new RegExp(`(?<![\\p{L}\\p{N}])${q.trim().split(/\s+/).map(w => escRe(w).replace(/'/g, "['‘’]").replace(/"/g, '["“”]')).join('\\s+')}`, 'iu')
// What a page says (the live page's words, or its sleeping copy's), while it
// is still at the address it said them at.
const textOf = n => (t => (t && sameDoc(t.url, n.url) ? t.text : ''))(views.get(n.id)?.pageText)
// A thing's name: its own words (a note's, what a clip or a picture says),
// else its page's title or address. The page a piece came from is where it
// is from: still found by, after its name.
function words(n) {
  const via = state.edges.find(e => e.to === n.id && e.linkText)?.linkText || ''
  const where = n.url ? addressOf(n.url) : ''
  const own = n.type === 'page' ? '' : n.text || ''
  return { name: own || n.title || where, rest: [where, via, own && (n.title || '')].join(' ') }
}
// what can be gone to: what is on the canvas (while it starts, what it keeps isn't yet)
const shown = () => Object.values(state.nodes).filter(n => views.has(n.id))
// Things found, best first: { n, hit } (hit: where in a page's words, for those found only there).
function findOnCanvas(q) {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean)
  const typed = typedIn(q)
  // An address typed is a place: the page at it comes before everything that
  // has the words (a page further in, a note that mentions it). Its fragment
  // doesn't matter, nor its scheme when none was typed.
  const bare = !/^https?:\/\//i.test(q)
  const asTyped = url => (a => (bare ? a.replace(/^http:\/\//, '') : a))(addressOf(url.split('#')[0]))
  const place = looksLikeUrl(q) && asTyped(toUrl(q))
  const at = []
  const scored = []
  const inText = [] // found only in a page's words: after everything found by its name, address, notes
  for (const n of shown()) {
    const recent = (n.seen || n.created || 0) / 1e13
    if (place && n.type === 'page' && asTyped(n.url) === place) {
      at.push({ n, score: recent })
      continue
    }
    const { name, rest } = words(n)
    const nameL = name.toLowerCase()
    const all = `${nameL} ${rest.toLowerCase()}`
    if (!terms.every(t => all.includes(t))) {
      const text = textOf(n)
      const m = text && typed.exec(text)
      if (m) inText.push({ n, score: recent, hit: { text, at: m.index, length: m[0].length } })
      continue
    }
    // in the name beats elsewhere; at the start of a word beats inside one
    let score = 0
    for (const t of terms) score += nameL.includes(t) ? (new RegExp(`(^|\\W)${escRe(t)}`).test(nameL) ? 3 : 2) : 1
    scored.push({ n, score: score + recent })
  }
  const best = list => list.sort((a, b) => b.score - a.score)
  return [...best(at), ...best(scored), ...best(inText)]
}
function showFinds() {
  const q = input.value.trim()
  const list = bar.querySelector('.finds')
  const things = q ? findOnCanvas(q) : shown().filter(n => n.seen).sort((a, b) => b.seen - a.seen).map(n => ({ n }))
  // the same page in two places is one row (two would look the same): it goes to the nearer one
  const centre = toWorld(innerWidth / 2, innerHeight / 2)
  const away = n => Math.hypot(n.x + n.w / 2 - centre.x, n.y + n.h / 2 - centre.y)
  const rows = new Map()
  for (const f of things) {
    const key = f.n.type === 'page' ? addressOf(f.n.url) : f.n.id
    if (!rows.has(key) || away(f.n) < away(rows.get(key).n)) rows.set(key, f)
  }
  finds = [...rows.values()].slice(0, 7).map(({ n, hit }) => ({ n, hit, go: () => (travel(n.id), hit && seek(n.id, typedIn(q))) }))
  const bang = bangOf(q)
  if (bang && !bangs) loadBangs().then(list => ((bangList = list), showFinds()))
  const known = bang && bangList[bang[1].toLowerCase()]
  const label = looksLikeUrl(q) ? `Go to ${q}` : known ? (bang[2] ? `${known[1]}: “${bang[2]}”` : `Go to ${known[1]}`) : `Search the small web for “${q}”`
  if (q) finds.push({ web: true, go: () => (bang && !bangs ? loadBangs().then(list => ((bangList = list), go(q))) : go(q)), label })
  list.replaceChildren(...finds.map((f, i) => {
    const row = el('button', 'find')
    if (f.web) row.append(el('span', 'glyph', looksLikeUrl(q) ? '↗' : '⌕'), el('span', 'name', f.label))
    else {
      const { name } = words(f.n)
      const mark = f.n.favicon && f.n.type !== 'note' ? Object.assign(el('img', 'fav'), { src: f.n.favicon, onerror() { this.replaceWith(el('span', 'glyph', '·')) } }) : el('span', 'glyph', f.n.type === 'note' ? '✎' : f.n.type === 'clip' ? '✂' : '·')
      row.append(mark, el('span', 'name', name.replace(/\s+/g, ' ').slice(0, 90)), whereOf(f.n))
      if (f.hit) row.append(inContext(f.hit))
    }
    row.addEventListener('pointerenter', () => choose(i))
    row.addEventListener('mousedown', e => e.preventDefault()) // keep the typing where it is
    row.addEventListener('click', () => f.go())
    return row
  }))
  list.classList.toggle('recent', !q && finds.length > 0)
  choose(0)
}
// Words found in a page, in their sentence: from where it starts if that is
// near, else from a few words before them, so they come early in the line
// (a third of it at most), then on to the end of what the line shows.
const LINE = 90 // characters a row's line holds
function inContext({ text, at, length }) {
  const before = text.slice(Math.max(0, at - LINE / 3), at)
  // where the sentence starts: after a line break, or a stop and a capital (not "e.g. this")
  const start = Math.max(before.lastIndexOf('\n') + 1, ...[...before.matchAll(/[.!?]\s+(?=\p{Lu})/gu)].map(m => m.index + m[0].length))
  const lead = start ? before.slice(start) : at > LINE / 3 ? `…${before.replace(/^\S*\s?/, '')}` : before
  const said = el('span', 'said', lead.replace(/\s+/g, ' ').trimStart())
  said.append(el('mark', null, text.slice(at, at + length).replace(/\s+/g, ' ')), text.slice(at + length, at + length + LINE).split('\n')[0].replace(/\s+/g, ' '))
  return said
}
// what kind of thing it is, and its whole address
function whereOf(n) {
  const where = el('span', 'where', `${KIND[n.type] || ''}${n.url ? ' · ' : ''}`)
  if (n.url) where.append(...addressParts(n.url))
  return where
}
function choose(i) {
  if (!finds.length) return
  chosen = (i + finds.length) % finds.length
  bar.querySelectorAll('.find').forEach((r, j) => r.classList.toggle('chosen', j === chosen))
}
function travel(id) {
  input.value = ''
  closeBar(true)
  select(id)
  front(id)
  focusNode(id, { toggle: false })
}
// Words found in a page: it brings them to its middle and marks them, as a
// link to words in a page (#:~:text=) does; a page that is asleep or still
// loading does it as soon as it's ready.
function seek(id, typed) {
  const v = views.get(id)
  if (v?.docReady) post(id, { type: 'find', pattern: typed.source })
  else if (v) v.seek = typed.source
}
function closeBar(force) {
  if (force || Object.keys(state.nodes).length) bar.hidden = true
}
function refreshChrome() {
  if (!Object.keys(state.nodes).length) openBar()
  // things arrived: the empty canvas's start box
  // goes, unless something is being typed in it
  else if (!bar.hidden && bar.classList.contains('home') && !input.value) closeBar()
}

// -------------------------------------------------------------------- start

setupBar()
const ready = start()
async function start() {
  // Starting waits for storage, and what you do meanwhile (typing opens the
  // bar) is a step from the canvas as it starts.
  lastSnap = snapshot()
  // the heavy content kept in IndexedDB comes back first
  const held = Object.values(state.nodes).filter(n => n.held)
  const contents = await Promise.all(held.map(n => idb('content', 'readonly', s => s.get(n.id)).catch(() => null)))
  held.forEach((n, i) => {
    if (!contents[i]) return
    heavyContent.set(n.id, contents[i])
    heavy(n)
  })
  for (const node of Object.values(state.nodes)) if (lost(node)) delete state.nodes[node.id]
  state.edges = state.edges.filter(e => state.nodes[e.from] && state.nodes[e.to])
  lastSnap = snapshot() // (less what can't be shown)
  const pages = Object.values(state.nodes).filter(n => n.type === 'page')
  const copies = await Promise.all(pages.map(n => idb('stills', 'readonly', s => s.get(copyKey(n.id))).catch(() => null)))
  pages.forEach((n, i) => copies[i]?.url === n.url && keptCopies.set(n.id, copies[i]))
  await addonReady // pages can be shown (see the add-on)
  teach('keys', '? shows the keys')
  // Each thing on its own: one that can't be shown (an unforeseen bug, or
  // data no check above knows) is left out, with a warning, and the rest start.
  const before = Object.keys(state.nodes).length
  restoring = true
  for (const node of Object.values(state.nodes)) {
    if (views.has(node.id)) continue // (what was made meanwhile is there already)
    try {
      mount(node)
    } catch (err) {
      console.warn('not shown:', node.type, node.id, err)
      unmount(node.id)
      delete state.nodes[node.id]
    }
  }
  restoring = false
  for (const node of Object.values(state.nodes)) if (node.type === 'note') place(node) // one layout for all of them
  if (Object.keys(state.nodes).length < before) {
    state.edges = state.edges.filter(e => state.nodes[e.from] && state.nodes[e.to])
    lastSnap = snapshot() // (less what couldn't be shown)
  }
  keptCopies.clear()
  applyCamera()
  drawEdges()
  refreshChrome()
  tend() // what's in view wakes now, behind its copy
  forgetCopies()
}
