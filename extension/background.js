// The add-on: a few general abilities for the canvas, a web page at one of
// CANVASES, in the canvas's own tab only. What the canvas does with them is
// the canvas's (its files say), so it can change while this stays as it is:
// this is installed by hand, and should never need to be again.
//
//   frame    sites may be shown in the canvas's frames: the headers by which
//            a site refuses to be framed (X-Frame-Options, and a
//            Content-Security-Policy's frame-ancestors) are taken off what
//            loads into a frame there
//   script   a script of the canvas's (it names it: inject.js) runs in every
//            page in its frames and every frame inside one, in the page's own
//            world, as soon as the page is there
//   rules    the canvas may change the headers of what loads in its tab (as
//            declarativeNetRequest's modifyHeaders rules: see headerRule)
//
// The canvas asks through announce.js, which this puts on every canvas page.
// Nothing else in the browser is touched.
import { CANVASES } from './canvases.js'

const ABILITIES = ['frame', 'script', 'rules']
const { name, version } = chrome.runtime.getManifest()
const canvasOf = url => CANVASES.find(c => url?.startsWith(c))
const PATTERNS = CANVASES.map(c => `${c}*`)

// What is known about the canvas tabs, kept for the browser's session (the
// service worker stops when idle and starts again for the next event; the
// rules it set stay):
//   tabs   tab -> { canvas: its address, script: the script it named }
//   pages  tab -> its frames that are pages, or inside one
//   rules  tab -> { the canvas's name for a rule: the rule's id }
//   next   the next rule id
const store = chrome.storage.session
let known
const loaded = store.get(['tabs', 'pages', 'rules', 'next']).then(async s => {
  known = { tabs: s.tabs || {}, pages: s.pages || {}, rules: s.rules || {}, next: s.next || FIRST }
  // tabs that went (or moved away) while this was stopped
  for (const tab of Object.keys(known.tabs)) {
    const t = await chrome.tabs.get(Number(tab)).catch(() => null)
    if (!canvasOf(t?.url)) await leave(tab)
  }
})
const keep = () => store.set(known)

// ------------------------------------------------------------------ frame

const FRAMED = 1 // the one rule for all canvas tabs
const FIRST = 2 // the canvases' own rules are numbered from here
const frameRule = tabIds => ({
  id: FRAMED,
  action: { type: 'modifyHeaders', responseHeaders: [{ header: 'x-frame-options', operation: 'remove' }, { header: 'content-security-policy', operation: 'remove' }] },
  condition: { tabIds, resourceTypes: ['sub_frame'] },
})
function setFrameRule() {
  const tabIds = Object.keys(known.tabs).map(Number)
  return chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [FRAMED], addRules: tabIds.length ? [frameRule(tabIds)] : [] })
}

// ------------------------------------------------------------------ rules
// A rule the canvas gives, checked: it only changes headers, of what loads in
// its own tab, never cookies (the canvas doesn't get to read or set anyone's).
const TOKEN = /^[!#$%&'*+.^_`|~0-9a-z-]+$/i // a header's name
const NEVER = new Set(['cookie', 'set-cookie', 'cookie2', 'set-cookie2'])
const CONDITIONS = new Set(['urlFilter', 'regexFilter', 'isUrlFilterCaseSensitive', 'resourceTypes', 'excludedResourceTypes', 'requestMethods', 'excludedRequestMethods', 'requestDomains', 'excludedRequestDomains', 'initiatorDomains', 'excludedInitiatorDomains', 'domainType', 'responseHeaders', 'excludedResponseHeaders'])
const MOST = 200 // rules a canvas may have at once
function headerRule(rule, tab, id) {
  const { action, condition = {}, priority = 1, ...rest } = rule || {}
  const fail = why => {
    throw new Error(`rule: ${why}`)
  }
  if (Object.keys(rest).length) fail(`unknown ${Object.keys(rest)}`)
  if (action?.type !== 'modifyHeaders') fail('only modifyHeaders')
  const headers = list =>
    list?.map(h => {
      if (!TOKEN.test(h?.header) || NEVER.has(h.header.toLowerCase())) fail(`header ${h?.header}`)
      if (!['set', 'append', 'remove'].includes(h.operation)) fail(`operation ${h.operation}`)
      if (h.operation !== 'remove' && typeof h.value !== 'string') fail('value')
      return h.operation === 'remove' ? { header: h.header, operation: 'remove' } : { header: h.header, operation: h.operation, value: h.value }
    })
  const requestHeaders = headers(action.requestHeaders)
  const responseHeaders = headers(action.responseHeaders)
  if (!requestHeaders?.length && !responseHeaders?.length) fail('no headers')
  if (typeof condition !== 'object' || Object.keys(condition).some(k => !CONDITIONS.has(k))) fail('condition')
  if (!Number.isInteger(priority) || priority < 1 || priority > 100) fail('priority')
  return {
    id,
    priority,
    action: { type: 'modifyHeaders', ...(requestHeaders && { requestHeaders }), ...(responseHeaders && { responseHeaders }) },
    condition: { ...JSON.parse(JSON.stringify(condition)), tabIds: [tab] },
  }
}
// set: { name: rule } (a rule of that name is replaced), remove: [name]
async function setRules(tab, { set = {}, remove = [] }) {
  const mine = (known.rules[tab] ||= {})
  const names = [...Object.keys(set), ...remove]
  if (names.some(n => typeof n !== 'string' || n.length > 200)) throw new Error('rule: name')
  const old = names.filter(n => n in mine).map(n => mine[n])
  const adding = Object.entries(set).map(([n, rule]) => [n, headerRule(rule, tab, known.next++)])
  if (Object.keys(mine).length - old.length + adding.length > MOST) throw new Error(`rule: more than ${MOST}`)
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: old, addRules: adding.map(([, r]) => r) })
  for (const n of names) delete mine[n]
  for (const [n, r] of adding) mine[n] = r.id
  keep()
}

// ----------------------------------------------------------------- script
// Taken from the canvas's server each time the canvas starts, asked again
// (the server says whether it changed), so a reload of the canvas gets its
// latest. Kept, so a page never waits for it.
const code = {} // script address -> its text, or the asking for it
function refresh(url) {
  code[url] = fetch(url, { cache: 'no-cache', credentials: 'omit' })
    .then(r => (r.ok ? r.text() : Promise.reject(new Error(`${url}: ${r.status}`))))
    .then(text => (store.set({ [`code ${url}`]: text }), text))
    .catch(() => kept(url)) // (the server didn't answer: as it was)
  return code[url]
}
const kept = url => store.get(`code ${url}`).then(s => s[`code ${url}`] ?? null)
const codeFor = url => (code[url] ||= kept(url).then(text => text ?? refresh(url)))

// Runs in the frame, in the page's own world. A frame the canvas holds is a
// page only if it is named so (the canvas's own frames, its cut pieces, the
// copies of sleeping pages and its players, aren't); a frame inside a page is
// part of it. 'refused': the page's own policy forbids running text as
// script, in a <meta> Content-Security-Policy (as a header it is taken off).
function run(text, held) {
  if (held && window.name !== 'canvas-browser-page') return false
  try {
    ;(0, eval)(text)
  } catch (err) {
    if (err instanceof EvalError) return 'refused'
    throw err
  }
  return true
}

// Each document as it starts in a canvas tab: the earliest moment it exists.
chrome.webNavigation.onCommitted.addListener(async d => {
  await loaded
  const tab = known.tabs[d.tabId]
  if (!tab) return
  if (d.frameId === 0) {
    // the tab itself moved: away, or to a canvas again (which says hello again)
    if (!canvasOf(d.url)) return leave(d.tabId)
    known.pages[d.tabId] = []
    return keep()
  }
  const held = d.parentFrameId === 0
  const pages = (known.pages[d.tabId] ||= [])
  // a page (or what it shows: its own blank and written frames too)
  if (held ? !/^https?:/.test(d.url) : !pages.includes(d.parentFrameId) || !/^(https?:|about:)/.test(d.url)) return
  const text = await codeFor(tab.script)
  if (!text) return
  const target = { tabId: d.tabId, documentIds: [d.documentId] }
  try {
    const [done] = await chrome.scripting.executeScript({ target, world: 'MAIN', injectImmediately: true, func: run, args: [text, held] })
    // A page that refuses it gets the add-on's own copy (build.sh puts the
    // canvas's in it): a file of the add-on is let run. It is as new as the
    // add-on, so it may be behind the canvas's.
    if (done?.result === 'refused') await chrome.scripting.executeScript({ target, world: 'MAIN', injectImmediately: true, files: ['inject.js'] })
    if (done?.result && !pages.includes(d.frameId)) {
      pages.push(d.frameId)
      keep()
    }
  } catch {} // the frame went meanwhile, or can't be run in (a page the browser shows itself)
})

// ------------------------------------------------------ canvases coming and going

// A canvas starting (or starting over) in a tab: its tab is a canvas tab,
// with no rules of its own yet, and its script ready.
async function hello(tab, canvas, { script = 'inject.js' }) {
  const url = new URL(script, canvas)
  if (url.origin !== new URL(canvas).origin) throw new Error('script: not on the canvas')
  await loaded
  const theirs = Object.values(known.rules[tab] || {})
  known.tabs[tab] = { canvas, script: url.href }
  known.pages[tab] = []
  known.rules[tab] = {}
  keep()
  // (its script as last kept, if its server is slow to say whether it changed)
  const ready = Promise.race([refresh(url.href), new Promise(r => setTimeout(r, 3000))])
  await Promise.all([chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: theirs }), setFrameRule(), ready])
  return { name, version, abilities: ABILITIES }
}
async function leave(tab) {
  if (!known.tabs[tab]) return
  const theirs = Object.values(known.rules[tab] || {})
  delete known.tabs[tab]
  delete known.pages[tab]
  delete known.rules[tab]
  keep()
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: theirs })
  await setFrameRule()
}
chrome.tabs.onRemoved.addListener(tab => loaded.then(() => leave(tab)))

// Only a canvas page (through announce.js, in the tab's own page) is heard.
chrome.runtime.onMessage.addListener((ask, sender, answer) => {
  const tab = sender.tab?.id
  const canvas = canvasOf(sender.url)
  if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || tab === undefined || !canvas) return
  const doing = (async () => {
    await loaded
    if (ask?.type === 'hello') return hello(tab, canvas, ask)
    if (!known.tabs[tab]) throw new Error('hello first')
    if (ask?.type === 'rules') return setRules(tab, ask)
    throw new Error(`unknown: ${ask?.type}`)
  })()
  doing.then(value => answer({ value }), err => answer({ error: String(err?.message || err) }))
  return true // it answers when done
})

// ----------------------------------------------------------- the add-on itself

// announce.js on every canvas page as it starts, and on those already open
// (they then say hello): when the add-on arrives or is updated, and as the
// browser starts (it keeps the script from before, but a canvas it reopens
// may have started first).
async function announce() {
  await chrome.scripting.unregisterContentScripts()
  await chrome.scripting.registerContentScripts([{ id: 'announce', matches: PATTERNS, js: ['announce.js'], runAt: 'document_start' }])
  for (const t of await chrome.tabs.query({ url: PATTERNS })) chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['announce.js'] }).catch(() => {})
}
chrome.runtime.onInstalled.addListener(announce)
chrome.runtime.onStartup.addListener(announce)

// Its button opens the canvas online, or goes to it if it is open.
chrome.action.setTitle({ title: `open ${name}` })
chrome.action.onClicked.addListener(async () => {
  const [open] = await chrome.tabs.query({ url: `${CANVASES[0]}*` })
  if (!open) return chrome.tabs.create({ url: CANVASES[0] })
  await chrome.tabs.update(open.id, { active: true })
  await chrome.windows.update(open.windowId, { focused: true })
})
