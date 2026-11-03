// Runs inside every page on the canvas: the add-on runs it as each page
// starts (see extension/background.js), in the page's own world. It connects
// the page to the canvas, its parent window:
//
//   page -> canvas   hello, meta, text, navigating, touch, open, pan, scroll,
//                    zoom, key, clip, drag, dragend
//   canvas -> page   keys, track, untrack, flash, reveal, find, clip-start,
//                    history, scroll-to
//
// The page is the frame the canvas holds. A frame inside it (a frameset's
// frames, its own iframes) is part of the page: this runs there too, and
// talks to the canvas through the frame it is in.
;(() => {
  if (window.parent === window) return
  let PAGE = window
  while (PAGE.parent !== top) PAGE = PAGE.parent
  const inner = PAGE !== window
  const ancestors = location.ancestorOrigins
  const APP = ancestors?.[ancestors.length - 1]
  if (!APP) return
  const TRAIL = '124, 92, 255'

  // ---------------------------------------------------------------- URLs


  // the real address of anything in the page
  const toReal = href => new URL(href, document.baseURI).href
  const here = () => toReal(location.href)
  const noHash = u => u.split('#')[0]
  const siteOf = u => new URL(u).hostname
  const send = (type, data = {}) => parent.postMessage({ cb: 1, type, ...data }, inner ? ancestors?.[0] || '*' : APP)
  const rectOf = el => {
    const r = el.getClientRects()[0] || el.getBoundingClientRect()
    return { x: r.left, y: r.top, w: r.width, h: r.height }
  }

  // ------------------------------------------------------------ page info

  function favicon() {
    const link = document.querySelector('link[rel~="icon" i], link[rel="apple-touch-icon" i]')
    try {
      return link?.href ? toReal(link.href) : new URL('/favicon.ico', here()).href
    } catch {
      return ''
    }
  }
  // A video or music page that names an embeddable player (Open Graph or
  // Twitter card tags): the player's real https URL and size.
  function player() {
    const tag = name => document.querySelector(`meta[property="${name}" i], meta[name="${name}" i]`)?.content?.trim() || ''
    if (!/^(video|music)/i.test(tag('og:type'))) return null
    const src = [tag('og:video:secure_url'), tag('og:video:url'), tag('og:video'), tag('twitter:player')].map(u => (u ? toReal(u) : '')).find(u => u.startsWith('https:'))
    if (!src) return null
    const size = name => Number(tag(`og:video:${name}`) || tag(`twitter:player:${name}`)) || undefined
    return { src, w: size('width'), h: size('height') }
  }
  // The page's paper and ink (its background and its words' colour): what
  // its tab on the canvas is made of.
  // (Where the two hardly differ, as when a page's dark is drawn by
  // something other than its body, the ink is black or white, whichever reads.)
  function paper() {
    const s = [document.body, document.documentElement].filter(Boolean).map(e => getComputedStyle(e))
    const bg = s.map(x => x.backgroundColor).find(c => !/,\s*0\)$|^transparent$/.test(c)) || 'rgb(255, 255, 255)'
    const light = c => { const [r, g, b] = (c.match(/[\d.]+/g) || []).map(Number).map(v => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
    const contrast = (a, b) => (Math.max(light(a), light(b)) + 0.05) / (Math.min(light(a), light(b)) + 0.05)
    const ink = s[0]?.color && contrast(bg, s[0].color) >= 4.5 ? s[0].color : light(bg) > 0.18 ? 'rgb(29, 29, 31)' : 'rgb(255, 255, 255)'
    return { bg, ink }
  }
  let lastMeta = ''
  function meta() {
    const info = { url: here(), title: document.title || '', favicon: favicon(), ...paper() }
    if (document.readyState !== 'loading') tellText() // its document is whole, it has loaded, or it moved within itself
    const p = player()
    if (p) info.player = p
    const key = JSON.stringify(info)
    if (key === lastMeta) return
    lastMeta = key
    send('meta', info)
  }
  // (The add-on may start this after the page has parsed, or loaded: then
  // as soon as all of this has run.)
  const parsed = () => {
    meta()
    new MutationObserver(meta).observe(document.head || document.documentElement, { childList: true, subtree: true, characterData: true })
  }
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', parsed) : queueMicrotask(parsed)
  if (document.readyState !== 'complete') addEventListener('load', meta)
  // The page moving within itself (its scripts changing its address).
  window.navigation?.addEventListener('currententrychange', () => setTimeout(meta))
  addEventListener('popstate', () => setTimeout(meta))

  // What the page says (with its own frames), so that / on the canvas finds
  // it by words read on it. Taken once the page has settled: once its
  // document is whole (not waiting for pictures, which can take long on the
  // small web), again once its frames have come, and each time it moves
  // within itself; after a moment with no changes, when nothing else is
  // happening, never as it changes. Its sleeping copy takes them again.
  // Up to WORDS characters: the whole of a long essay (over an hour of
  // reading), and few enough that the canvas looks through fifty such pages
  // in a few milliseconds at each key. A page that is never idle (always
  // animating) has them taken after a second anyway: they cost a millisecond
  // or two.
  const WORDS = 100_000
  const docsOf = d => [d, ...[...d.querySelectorAll('iframe, frame')].flatMap(f => (f.contentDocument ? docsOf(f.contentDocument) : []))]
  const textOf = () => docsOf(document).map(d => d.body?.innerText || '').join('\n').slice(0, WORDS)
  const idle = f => (window.requestIdleCallback ? requestIdleCallback(f, { timeout: 1000 }) : setTimeout(f))
  let textFor = null // the documents (the page's and its frames') whose words the canvas has, or is about to
  function tellText() {
    if (inner) return
    const at = docsOf(document).map(d => noHash(d.URL)).join(' ')
    if (at === textFor) return
    textFor = at
    whenStill(() => idle(() => at === textFor && send('text', { url: here(), text: textOf() })))
  }
  addEventListener('beforeunload', () => send('navigating'))
  addEventListener('pointerdown', () => send('touch'), true)

  let scrollTimer = 0
  addEventListener('scroll', () => {
    clearTimeout(scrollTimer)
    scrollTimer = setTimeout(() => send('scroll', { x: scrollX, y: scrollY }), 300)
  }, { passive: true })

  // ----------------------------------------------------------------- links
  // On the canvas a page is a place, not a tab: following a link doesn't turn
  // this place into another, it opens the new place beside it (⌘ or the
  // middle button: beside, staying here). Back is the trail, not this page's
  // history. In place only: a spot on this same page, and what the page does
  // by itself (a redirect as it loads, a site moving within itself).
  //
  // A page with frames moves within itself too: a link that the page shows
  // in one of its frames (a frameset's menu showing a page in its main
  // frame, a link into one of its iframes, a frame's link to another page of
  // its site) stays in the page, as a frame of a page in a tab would. A link
  // to another site, or one that would replace the whole page, is another
  // place, and opens beside.
  //
  // A navigation to another page that you set going (a script acting on your
  // click) opens beside, unless it is a frame moving within its own site; one
  // the page makes on its own goes on in place.
  window.navigation?.addEventListener('navigate', event => {
    if (event.navigationType === 'traverse' || event.formData || event.downloadRequest !== null || !event.cancelable) return
    const u = new URL(event.destination.url)
    if (event.destination.sameDocument || !/^https?:$/.test(u.protocol) || noHash(toReal(u.href)) === noHash(here())) return
    if ((event.userInitiated || navigator.userActivation?.isActive) && !(inner && siteOf(u.href) === siteOf(here()))) {
      event.preventDefault()
      return openBeside(null, toReal(u.href), false)
    }
    // In place, over https if over plain http, which a canvas at an https
    // address can't show (as a browser first tries for a tab).
    if (u.protocol === 'http:' && APP.startsWith('https:')) {
      event.preventDefault()
      location.href = `https:${u.href.slice(5)}`
    }
  })

  // Where the browser would show a link: this frame, the one it is in, the
  // whole page, the page's frame with the name the link gives (nearest
  // first: inside this frame, then anywhere in the page), or, if none has
  // that name, a new window (null).
  function shownIn(a) {
    const name = a.hasAttribute('target') ? a.target : document.querySelector('base[target]')?.target || ''
    const keyword = name.toLowerCase()
    if (!name || keyword === '_self') return window
    if (keyword === '_parent') return inner ? parent : PAGE
    if (keyword === '_top') return PAGE
    if (keyword === '_blank') return null
    for (const root of [window, PAGE]) {
      const queue = [root]
      for (const w of queue) {
        for (let i = 0; i < w.length; i++) {
          const frame = w[i]
          let named
          try {
            named = frame.name === name
          } catch {
            // another site's frame: its name can't be read, but the frame it is in finds it by name
            try {
              named = w[name] === frame
            } catch {}
          }
          if (named) return frame
          queue.push(frame)
        }
      }
    }
    return null
  }
  const pageAddress = () => {
    try {
      return toReal(PAGE.location.href)
    } catch {
      return '' // another site's: not this one's
    }
  }
  // Shows a page in a frame of this page. The page itself does it: the canvas
  // holds every page in a sandboxed frame, and inside one a frame may only
  // navigate itself and the frames inside it. (Left to the browser, a
  // frameset menu's link into its main frame finds no frame it may navigate
  // by that name and opens a new window.) The page is inside nothing but the
  // canvas and holds every frame of itself, so it may navigate any of them.
  function show(frame, real) {
    const path = [] // which frame, by its place among its parent's, from the page down
    for (let w = frame; w !== PAGE; w = w.parent) {
      for (let i = 0; i < w.parent.length; i++) if (w.parent[i] === w) path.unshift(i)
    }
    inner ? send('show', { path, url: real }) : showIn(path, real)
  }
  function showIn(path, url) {
    const u = URL.parse(url)
    if (!Array.isArray(path) || !path.every(Number.isInteger) || !u || !/^https?:$/.test(u.protocol)) return
    let w = window
    for (const i of path) w = w?.[i]
    if (w) w.location.href = u.href
  }

  let seq = 0
  const pending = new Map() // request id -> the anchor that was clicked
  const tracked = new Map() // node id -> the anchor (or clipped elements) it came from

  function linkIn(event) {
    for (const n of event.composedPath()) {
      if ((n.tagName === 'A' || n.tagName === 'AREA') && n.hasAttribute('href')) return n
      if (n === document.body) break
    }
    return null
  }
  // The words of a link, which say why it led where it did. Words that label
  // links to more than one place on the page ("Permalink", "read more") don't
  // say which place this one is.
  const wordsIn = a => (a?.textContent || '').trim().replace(/\s+/g, ' ')
  function wordsOf(a) {
    const words = wordsIn(a)
    if (!words) return ''
    const places = new Set()
    for (const b of document.links) if (wordsIn(b) === words) places.add(b.href.split('#')[0])
    return places.size > 1 ? '' : words.slice(0, 120)
  }
  function openBeside(a, real, quiet) {
    const req = ++seq
    pending.set(req, a)
    send('open', { url: real, text: wordsOf(a), rect: a ? rectOf(a) : null, quiet, req })
  }

  function onClick(event) {
    if (clipping || (event.type === 'click' && onlyAlt(event))) return
    if (event.type === 'click' && event.button !== 0) return
    if (event.type === 'auxclick' && event.button !== 1) return
    const a = linkIn(event)
    if (!a || a.hasAttribute('download') || a.hasAttribute('data-cb-external')) return
    let real
    try {
      real = toReal(a.href)
    } catch {
      return
    }
    if (!/^https?:/.test(real)) return

    const there = shownIn(a)
    const quiet = event.type === 'auxclick' || ((event.metaKey || event.ctrlKey) && !event.shiftKey)
    // This page itself (a spot on it, or the whole of it again, even as a new
    // tab): it stays here, as the one place it is. A plain click goes to it,
    // as in a tab (to the spot, or loading it again); nothing opens beside.
    if (noHash(real) === noHash(here())) {
      if (there === window && !quiet) return
      event.preventDefault()
      if (!quiet) location.assign(a.href)
      return
    }
    event.preventDefault()
    // within the page: the page's own scripts still see the click, as in a tab
    if (!quiet && there && (there === PAGE ? noHash(real) === noHash(pageAddress()) : siteOf(real) === siteOf(here()))) return show(there, real)
    event.stopImmediatePropagation()
    openBeside(a, real, quiet)
  }
  addEventListener('click', onClick, true)
  addEventListener('auxclick', onClick, true)

  // A window the page opens: beside, if you set it going (a script acting on
  // your click or key); one it opens on its own is a popup, which a browser
  // would block too.
  window.open = url => {
    if (url && navigator.userActivation?.isActive) {
      try {
        openBeside(null, toReal(String(url)), false)
      } catch {}
    }
    return null
  }

  // Forms submit in place; a search you make opens beside, as a link you
  // follow does.
  addEventListener('submit', event => {
    const form = event.target
    if (!(form instanceof HTMLFormElement)) return
    const [el, name] = event.submitter?.hasAttribute('formaction') ? [event.submitter, 'formaction'] : [form, 'action']
    const action = new URL(el.getAttribute(name) || location.href, document.baseURI)
    const method = (event.submitter?.getAttribute('formmethod') || form.method || 'get').toLowerCase()
    if (method === 'get' && /^https?:$/.test(action.protocol) && navigator.userActivation?.isActive) {
      // a search: its results are a new place, beside this one
      event.preventDefault()
      action.search = new URLSearchParams(new FormData(form, event.submitter)).toString()
      return openBeside(null, toReal(action.href), false)
    }
    form.target = '_self'
  }, true)

  // What you copy is told to the canvas: a collect note there may keep it.
  addEventListener('copy', () => {
    const text = String(getSelection() || '').trim()
    if (text) send('copied', { text: text.slice(0, 4000) })
  }, true)

  // ------------------------------------------- marks for things taken out
  // Links followed to another page on the canvas are tinted, anything that
  // came from this page can be flashed or scrolled to, and words found in it
  // are marked.

  const styled = new WeakSet() // this page's documents (its own, its frames') that have the marks' style
  function addStyle(d = document) {
    if (styled.has(d)) return
    styled.add(d)
    const style = d.createElement('style')
    style.textContent = `[data-cb-trail]{background-color:rgba(${TRAIL},.15)!important;border-radius:3px;box-shadow:0 0 0 2px rgba(${TRAIL},.15)!important;-webkit-box-decoration-break:clone;box-decoration-break:clone;transition:background-color .25s,box-shadow .25s}
[data-cb-trail][data-cb-flash]{background-color:rgba(${TRAIL},.34)!important;box-shadow:0 0 0 3px rgba(${TRAIL},.34)!important}
::highlight(cb-found){background-color:rgba(${TRAIL},.34)}`
    d.documentElement.append(style)
  }

  // Words found in this page's words on the canvas (sent as the pattern they
  // were found with, so both match alike): the first place they show is
  // brought to the middle and marked, as a link to words in a page
  // (#:~:text=) does, until the next press in the page. Marked with a
  // highlight, which leaves the page itself as it is.
  let marked = null // the highlights of the document holding the mark
  function find(pattern) {
    const re = new RegExp(pattern, 'giu')
    for (const d of docsOf(document)) {
      const range = firstShown(d, re)
      if (!range) continue
      const w = d.defaultView
      const highlights = w.CSS.highlights
      marked?.delete('cb-found')
      marked = highlights
      addStyle(d)
      highlights.set('cb-found', new w.Highlight(range))
      w.addEventListener('pointerdown', () => highlights.delete('cb-found'), { capture: true, once: true })
      toMiddle(range)
      return true
    }
    return false
  }
  // Where a pattern first matches what a document shows: its text as it reads
  // (a line break at each block and <br>, nothing that isn't shown), where it
  // can be seen.
  function firstShown(d, re) {
    if (!d.body) return null
    const style = n => d.defaultView.getComputedStyle(n)
    const walk = d.createTreeWalker(d.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: n => (n.nodeType === 1 && style(n).display === 'none' ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    })
    const parts = [] // [where it starts in text, its text node]
    let text = ''
    for (let n; (n = walk.nextNode()); ) {
      if (n.nodeType === 3) {
        parts.push([text.length, n])
        text += n.data
      } else if (n.tagName === 'BR' || !style(n).display.startsWith('inline')) text += '\n'
    }
    // a match starts and ends with typed letters, so both ends are in text nodes
    const at = i => parts.findLast(([start]) => start <= i)
    for (const m of text.matchAll(re)) {
      const [from, first] = at(m.index)
      const [to, last] = at(m.index + m[0].length - 1)
      const range = d.createRange()
      range.setStart(first, m.index - from)
      range.setEnd(last, m.index + m[0].length - to)
      if (first.parentElement.checkVisibility({ visibilityProperty: true }) && range.getClientRects().length) return range
    }
    return null
  }
  // Brings a range to the middle of each box it scrolls in, innermost first:
  // boxes of its own, the page, and the frame it is in within the page.
  function toMiddle(range) {
    let it = range
    let box = range.startContainer.parentElement
    while (box) {
      const d = box.ownerDocument
      const w = d.defaultView
      for (; box; box = box.parentElement) {
        const view = box === d.scrollingElement
        if (!view && !/auto|scroll/.test(w.getComputedStyle(box).overflowY)) continue
        const r = it.getBoundingClientRect()
        const b = view ? { top: 0, height: w.innerHeight } : box.getBoundingClientRect()
        box.scrollBy({ top: r.top + r.height / 2 - (b.top + b.height / 2), behavior: 'instant' })
      }
      it = w.frameElement // null at the page itself: the canvas is another site
      box = it?.parentElement
    }
  }
  function findAnchor(url) {
    const want = url.replace(/\/$/, '')
    for (const a of document.querySelectorAll('a[href], area[href]')) {
      try {
        if (toReal(a.href).replace(/\/$/, '') === want) return a
      } catch {}
    }
    return null
  }
  // (a cut of several pieces names them all in its selector, a list)
  function track({ child, req, url, selector, link }) {
    let els = req && pending.get(req) ? [pending.get(req)] : []
    if (!els.length && selector) {
      try {
        els = [...document.querySelectorAll(selector)]
      } catch {}
    }
    if (!els.length && url) els = [findAnchor(url)].filter(Boolean)
    if (!els.length) return
    tracked.set(child, els)
    addStyle()
    if (link) for (const el of els) el.setAttribute('data-cb-trail', '')
    if (held) drawHeld() // what's framed may just have been cut
  }

  // What a thing on the canvas came from, shown while it is hovered: a link
  // followed, its tint deepened; a cut, one cut line round all of it, as it
  // was cut (one piece, however many elements).
  const flashed = new Set()
  let flashRoot = null
  function flash(child, on) {
    const els = tracked.get(child) || []
    if (els[0]?.hasAttribute('data-cb-trail')) return els.forEach(el => el.toggleAttribute('data-cb-flash', on))
    on ? flashed.add(child) : flashed.delete(child)
    if (!flashRoot) {
      const host = document.createElement('div')
      flashRoot = host.attachShadow({ mode: 'open' })
      document.documentElement.append(host)
      addEventListener('scroll', () => flashed.size && drawFlash(), true)
    }
    drawFlash()
  }
  function drawFlash() {
    flashRoot.replaceChildren()
    for (const child of flashed) {
      const rs = (tracked.get(child) || []).map(el => el.getBoundingClientRect())
      if (!rs.length) continue
      const x = Math.min(...rs.map(r => r.left)) - PAD
      const y = Math.min(...rs.map(r => r.top)) - PAD
      const line = document.createElement('div')
      line.style.cssText = `position:fixed;z-index:2147483647;pointer-events:none;box-sizing:border-box;${CUT_LINE};left:${x}px;top:${y}px;width:${Math.max(...rs.map(r => r.right)) + PAD - x}px;height:${Math.max(...rs.map(r => r.bottom)) + PAD - y}px`
      flashRoot.append(line)
    }
  }

  // ------------------------------------------------------------ keys, zoom

  // A scroll begun here is the page's (see app.js, scroll and pinch); a pinch
  // zooms the mat.
  addEventListener('wheel', event => {
    if (!event.ctrlKey) return
    event.preventDefault()
    send('zoom', { dy: event.deltaY, x: event.clientX, y: event.clientY })
  }, { capture: true, passive: false })

  // A page doesn't take the keys by itself (a popup focusing itself as the
  // page loads): only a press in it does. The canvas gives them back. And a
  // press in it always does, as in a tab, even one the page cancels (a game,
  // a drag, the ⌥-cut here): a frame whose press is cancelled would otherwise
  // leave the keys where they were. (Only the page that has the keys may act
  // for you on the canvas: see byYou in app.js.) A key it keeps is a press in
  // it too; one of the canvas's commands (below) isn't: those leave it.
  let pressed = 0
  addEventListener('pointerdown', () => {
    pressed = Date.now()
    window.focus()
  }, true)
  addEventListener('focus', () => {
    if (Date.now() - pressed > 1000) send('took-focus')
  })

  // The canvas's commands (C, N, F, /, [, Z …) work from inside the page too:
  // the page hands them over. Which they are is the canvas's to say: a page
  // asks as it starts, and answers its own frames the same way. Where text is
  // being typed only those that work while typing are handed over: there ⌘Z
  // undoes the typing and C types a C.
  let commands = {} // name -> works while typing
  const tellKeys = w => w.postMessage({ cb: 1, type: 'keys', keys: commands }, '*')
  addEventListener('message', event => {
    const d = event.data
    if (d?.cb !== 1 || d.type !== 'keys' || event.source !== parent) return
    commands = d.keys
    for (const f of document.querySelectorAll('frame, iframe')) if (f.contentWindow) tellKeys(f.contentWindow)
  })
  send('hello')
  // A key press by name, as the canvas names them (app.js keyName): 'c', 'mod+z',
  // 'shift+z', 'c', '['.
  function keyName(e) {
    const on = /^(?:Key|Digit)(.)$/.exec(e.code)?.[1].toLowerCase()
    const key = /^[a-z0-9]$/i.test(e.key) ? e.key.toLowerCase() : on || (e.key || '').toLowerCase() // (autofill's keydown has no key)
    const typed = key.length === 1 && !on
    return [(e.metaKey || e.ctrlKey) && 'mod', e.altKey && 'alt', e.shiftKey && !typed && 'shift', key].filter(Boolean).join('+')
  }
  addEventListener('keydown', event => {
    const name = keyName(event)
    const at = event.composedPath()[0] // inside a component's own (shadow) tree too
    const typing = at.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(at.tagName)
    if (clipping || held || drawing || !Object.hasOwn(commands, name) || (typing && !commands[name])) {
      if (!/^(Alt|Control|Meta|Shift)$/.test(event.key)) pressed = Date.now() // a key it keeps is a press in it (⌘ alone isn't)
      return
    }
    event.preventDefault()
    if (name === 'c') startClip() // the ✂ cuts in the frame it is pressed in
    else send('key', { key: name })
  }, true)
  // a mouse's back and forward buttons are the trail
  addEventListener('mouseup', event => {
    if (event.button === 3 || event.button === 4) send('key', { key: event.button === 3 ? '[' : ']' })
  })


  // -------------------------------------------------------------- clipping
  // A cut line goes round the element under the pointer; click to clip it, or drag a box across several to cut them
  // together (see choosing pieces by a box, below).

  let clipping = null
  let pointer = null
  addEventListener('pointermove', e => (pointer = { x: e.clientX, y: e.clientY }), { capture: true, passive: true })

  const MEDIA = /^(IMG|VIDEO|CANVAS|SVG|IFRAME|PICTURE|OBJECT|EMBED|AUDIO)$/i
  // From what is under the pointer, climb to something worth clipping.
  // Elements that are a meaningful whole: what a small piece inside them gives way to.
  const WHOLE = /^(P|LI|DT|DD|FIGURE|BLOCKQUOTE|PRE|TABLE|H[1-6]|ARTICLE|ASIDE|SECTION)$/
  function sensible(el) {
    // On a handmade page, words and links can sit straight in the body with
    // no block around them: then the one pointed at is what was meant.
    let loose = null
    while (el && el !== document.body && el !== document.documentElement) {
      const r = el.getBoundingClientRect()
      if (MEDIA.test(el.tagName) && r.width >= 24 && r.height >= 24) return el
      const display = getComputedStyle(el).display
      if (!loose && display !== 'contents') loose = el
      if (display !== 'inline' && display !== 'contents' && r.width >= 48 && r.height >= 20) {
        // a small block (a button, a badge, a word in a span) inside a paragraph
        // or list item: the paragraph or item is what was meant
        if (!WHOLE.test(el.tagName) && (r.width < 160 || r.height < 28)) {
          const whole = el.parentElement?.closest('p, li, dt, dd, figure, blockquote, pre, table, h1, h2, h3, h4, h5, h6')
          if (whole && whole !== document.body) return whole
        }
        return el
      }
      el = el.parentElement
    }
    return loose || document.body
  }
  // What is under a point, as a thing worth clipping (null: the page itself,
  // which is already on the canvas).
  function pieceAt(x, y) {
    const hits = document.elementsFromPoint(x, y).filter(n => n !== clipping?.host)
    // The topmost hit, or what is inside it there: Chrome can list a
    // scrolling element above its own content.
    let hit = hits[0]
    for (const n of hits) if (hit.contains(n)) hit = n
    const el = sensible(hit || document.body)
    return el === document.body || el === document.documentElement ? null : el
  }
  function defaultPiece() {
    const main = document.querySelector('main, article, [role="main"]')
    const r = main?.getBoundingClientRect()
    if (r && r.bottom > 0 && r.top < innerHeight) return pieceAt(Math.max(r.left, 0) + 24, Math.max(r.top, 0) + 24)
    return pieceAt(innerWidth / 2, innerHeight / 3)
  }
  const PAD = 4
  // What a cut takes is marked by a cut line around it, as on paper: pencil
  // dashes over a white line, so it shows on any page. Nothing else changes.
  const CUT_LINE = 'outline:1.5px dashed rgba(40,36,32,.9);outline-offset:0;box-shadow:0 0 0 1.5px #fff'
  const NAME_SLIP = 'padding:2px 5px;white-space:nowrap;font:500 11px/1.2 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;color:#2a2622;background:#fff;box-shadow:0 0 0 .5px rgba(0,0,0,.3)'
  function visibleRect(el) {
    const r = el.getBoundingClientRect()
    const x = Math.max(0, r.left - PAD)
    const y = Math.max(0, r.top - PAD)
    return { x, y, w: Math.min(innerWidth, r.right + PAD) - x, h: Math.min(innerHeight, r.bottom + PAD) - y }
  }

  // `quiet`: the ✂ picked up for every page: nothing is outlined here until the pointer comes in
  function startClip(quiet) {
    if (clipping) return
    const host = document.createElement('div')
    const root = host.attachShadow({ mode: 'open' })
    root.innerHTML = `<style>
      .layer{position:fixed;inset:0;z-index:2147483647;cursor:crosshair}
      .hole{position:fixed;pointer-events:none;${CUT_LINE};
        transition:left .16s cubic-bezier(.2,.8,.2,1),top .16s cubic-bezier(.2,.8,.2,1),width .16s cubic-bezier(.2,.8,.2,1),height .16s cubic-bezier(.2,.8,.2,1)}
      .name{position:absolute;left:-1.5px;bottom:100%;margin-bottom:4px;${NAME_SLIP}}
      .hole.low .name{bottom:auto;top:100%;margin:4px 0 0}
    </style><div class="layer"><div class="hole"><div class="name"></div></div></div>`
    document.documentElement.append(host)
    send('cutting', { on: true }) // (the canvas lights the page's ✂)
    pageFaces() // stylesheets from other servers start coming now, so cutting doesn't wait for them
    const layer = root.querySelector('.layer')
    clipping = { host, hole: root.querySelector('.hole'), name: root.querySelector('.name'), el: quiet ? null : pointer ? pieceAt(pointer.x, pointer.y) : defaultPiece() }
    drawHole()
    layer.addEventListener('pointermove', e => {
      const el = pieceAt(e.clientX, e.clientY)
      if (el === clipping.el) return
      clipping.el = el
      drawHole()
    })
    // the pointer gone to another page (the ✂ is in hand for all of them): nothing outlined here
    layer.addEventListener('pointerleave', () => {
      if (drawing) return
      clipping.el = null
      drawHole()
    })
    layer.addEventListener('pointerdown', e => {
      e.preventDefault()
      e.stopPropagation()
      if (e.button === 0) press(e, false, layer)
    })
    layer.addEventListener('click', e => {
      e.preventDefault()
      e.stopPropagation()
      finishClip()
    })
  }
  // What the selected element is, in words, on its outline.
  const NAMES = { IMG: 'Image', PICTURE: 'Image', SVG: 'Drawing', CANVAS: 'Drawing', VIDEO: 'Video', AUDIO: 'Audio', IFRAME: 'Embed', P: 'Paragraph', H1: 'Heading', H2: 'Heading', H3: 'Heading', H4: 'Heading', H5: 'Heading', H6: 'Heading', UL: 'List', OL: 'List', LI: 'List item', DL: 'List', FIGURE: 'Figure', BLOCKQUOTE: 'Quote', PRE: 'Code', TABLE: 'Table', TR: 'Table row', A: 'Link', ARTICLE: 'Article', SECTION: 'Section', NAV: 'Navigation', HEADER: 'Header', FOOTER: 'Footer', ASIDE: 'Aside', MAIN: 'Main content', FORM: 'Form' }
  const nameOf = el => NAMES[el.tagName.toUpperCase()] || 'Block'
  function drawHole() {
    const el = clipping.el
    clipping.hole.hidden = !el
    if (!el) return
    clipping.name.textContent = nameOf(el)
    const r = visibleRect(el)
    Object.assign(clipping.hole.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` })
    clipping.hole.classList.toggle('low', r.y < 24) // no room above: the name goes below
  }
  // why: 'cut' (something was), 'put-down' (Esc, C), else the canvas asked
  function stopClip(why) {
    if (clipping) send('cutting', { on: false, why })
    clipping?.host.remove()
    clipping = null
  }
  addEventListener('keydown', event => {
    if (!clipping) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (drawing?.host) return event.key === 'Escape' && letBoxGo() // (while a box is drawn the keys wait, but Esc lets it go)
    if (event.key === 'Escape' || keyName(event) === 'c') return stopClip('put-down') // (the ✂ put down again)
    if (event.key === 'Enter') finishClip()
  }, true)
  addEventListener('scroll', () => {
    if (!clipping || !pointer || drawing) return
    clipping.el = pieceAt(pointer.x, pointer.y)
    drawHole()
  }, { capture: true, passive: true })

  // --------------------------------------------- choosing pieces by a box
  // A box dragged across the page, with the ✂ in hand or holding ⌥, chooses
  // every piece it touches, whole: the pieces a click takes (a paragraph, a
  // picture, a list item: see sensible), however little of each it covers.
  // While it is drawn they are outlined and the rest of the page dims.
  // Letting go cuts them as one piece of the page, laid out as they were
  // (see freeze); one alone is cut as a click cuts it. Near the frame's edge
  // the page scrolls, so a box can reach past the view; its start stays where
  // it was pressed, in the page. Esc lets it go.

  // A press that moves this far either way (px) is a drag, not a click: where
  // Chrome on a Mac tells them apart (it follows the system there), so a click
  // that trembles is a click here as everywhere else.
  const DRAG = 3
  // Within this far of the frame's edge (px) the page scrolls toward the
  // pointer, and the deeper the faster, as Chrome scrolls a page while you
  // select its words past its edge (its own band, and its speed: each
  // sixtieth of a second, as far as the pointer is into the band, or past it).
  const BAND = 20
  let drawing = null // a press that may become a box: { x, y (where pressed, in the page), at (the pointer, in the view), held, id; once it is a box: host, canvas, name, atoms, pieces }
  let swallow = false // the click that ends a box (drawn or let go) cuts nothing
  const view = () => ({ w: visualViewport?.width ?? innerWidth, h: visualViewport?.height ?? innerHeight }) // (without scrollbars)

  function press(e, held, capture) {
    drawing = { x: e.clientX + scrollX, y: e.clientY + scrollY, at: { x: e.clientX, y: e.clientY }, held, id: e.pointerId }
    capture.setPointerCapture(e.pointerId) // (it goes on beyond the frame's edge)
  }
  function drag(e) {
    const d = drawing
    d.at = { x: e.clientX, y: e.clientY }
    if (d.gone) return
    if (!d.host && Math.abs(d.at.x + scrollX - d.x) < DRAG && Math.abs(d.at.y + scrollY - d.y) < DRAG) return
    if (!d.host) showBox()
    drawBox()
  }
  function showBox() {
    if (clipping) clipping.hole.hidden = true
    letGo()
    const host = document.createElement('div')
    const root = host.attachShadow({ mode: 'open' })
    root.innerHTML = `<style>
      .cover{position:fixed;inset:0;z-index:2147483647;cursor:crosshair}
      canvas{position:absolute;inset:0;width:100%;height:100%}
      .name{position:fixed;${NAME_SLIP}}
    </style><div class="cover"><canvas></canvas><div class="name" hidden></div></div>`
    document.documentElement.append(host)
    Object.assign(drawing, { host, canvas: root.querySelector('canvas'), name: root.querySelector('.name'), atoms: atoms(), pieces: [] })
    drawing.loop = requestAnimationFrame(autoscroll)
  }
  // What a box can touch: each run of words, and each thing that shows
  // without words (a picture, a drawing, a player, a field), where it is in
  // the page, with the piece a click on it takes. Read once, as the box
  // starts: the page doesn't change under a box being drawn.
  const SHOWN = /^(IMG|VIDEO|CANVAS|SVG|IFRAME|OBJECT|EMBED|AUDIO|INPUT|SELECT|TEXTAREA)$/i
  function atoms() {
    const pieceOf = new Map() // element -> the piece a click on it takes (null: none, or not shown)
    const piece = el => {
      if (!pieceOf.has(el)) {
        const p = el.checkVisibility?.({ visibilityProperty: true, opacityProperty: true }) === false ? null : sensible(el) // (not what can't be seen)
        pieceOf.set(el, p === document.body || p === document.documentElement ? null : p)
      }
      return pieceOf.get(el)
    }
    const out = [] // { piece, rects (in the page) }
    const range = document.createRange()
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT)
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      let rects
      if (n.nodeType === Node.TEXT_NODE) {
        if (!n.data.trim()) continue
        range.selectNodeContents(n)
        rects = range.getClientRects()
      } else if (SHOWN.test(n.tagName) && !n.ownerSVGElement) rects = [n.getBoundingClientRect()]
      else continue
      const p = piece(n.nodeType === Node.TEXT_NODE ? n.parentElement : n)
      if (p) out.push({ piece: p, rects: [...rects].filter(r => r.width && r.height).map(r => ({ x: r.left + scrollX, y: r.top + scrollY, r: r.right + scrollX, b: r.bottom + scrollY })) })
    }
    return out
  }
  // The box in the view now, in whole pixels: from where it was pressed (which
  // may have scrolled out of view) to the pointer, kept to what is in view and
  // in the page.
  function boxOf(d) {
    const v = view()
    const ax = d.x - scrollX
    const ay = d.y - scrollY
    const px = Math.min(Math.max(d.at.x, 0), v.w)
    const py = Math.min(Math.max(d.at.y, 0), v.h)
    const x = Math.max(Math.min(ax, px), -scrollX)
    const y = Math.max(Math.min(ay, py), -scrollY)
    return { x: Math.round(x), y: Math.round(y), w: Math.round(Math.max(ax, px)) - Math.round(x), h: Math.round(Math.max(ay, py)) - Math.round(y) }
  }
  // The pieces the box touches, in page order; a piece inside another is in it already.
  function touched(d) {
    const b = boxOf(d)
    const x = b.x + scrollX
    const y = b.y + scrollY
    const hit = new Set()
    for (const a of d.atoms) if (!hit.has(a.piece) && a.rects.some(r => r.r > x && r.x < x + b.w && r.b > y && r.y < y + b.h)) hit.add(a.piece)
    return [...hit].filter(p => ![...hit].some(q => q !== p && q.contains(p))).sort((p, q) => (p.compareDocumentPosition(q) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
  }
  // What the box has chosen, in one cut line round it all (as the ✂ marks a
  // piece), and its name: what it is, or how many. Until it has chosen
  // something, the box itself, faintly.
  function drawBox() {
    const d = drawing
    const b = boxOf(d)
    d.pieces = touched(d)
    const v = view()
    const dpr = devicePixelRatio
    const canvas = d.canvas
    if (canvas.width !== Math.round(v.w * dpr) || canvas.height !== Math.round(v.h * dpr)) Object.assign(canvas, { width: Math.round(v.w * dpr), height: Math.round(v.h * dpr) })
    const g = canvas.getContext('2d')
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, v.w, v.h)
    const cut = (x, y, w, h) => {
      g.lineWidth = 1.5
      g.setLineDash([])
      g.strokeStyle = '#fff'
      g.strokeRect(x, y, w, h)
      g.setLineDash([4.5, 3])
      g.strokeStyle = 'rgba(40,36,32,.9)'
      g.strokeRect(x, y, w, h)
    }
    if (d.pieces.length) {
      // one cut line round all it has chosen, as they are cut: one piece
      const rs = d.pieces.map(p => p.getBoundingClientRect())
      const x = Math.min(...rs.map(r => r.left)) - PAD
      const y = Math.min(...rs.map(r => r.top)) - PAD
      cut(x - 0.75, y - 0.75, Math.max(...rs.map(r => r.right)) + PAD - x + 1.5, Math.max(...rs.map(r => r.bottom)) + PAD - y + 1.5) // (just outside them, as the ✂'s line is)
    } else {
      // nothing chosen yet: the box, faintly
      g.lineWidth = 1
      g.setLineDash([2, 3])
      g.strokeStyle = 'rgba(40,36,32,.45)'
      g.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1)
      g.setLineDash([])
    }
    // its name by the edge where it was pressed (above the box, or below it
    // when pressed at its foot), 4 px off as the ✂ outline's is, kept in view
    const n = d.pieces.length
    d.name.hidden = !n
    d.name.textContent = n === 1 ? nameOf(d.pieces[0]) : `${n} pieces`
    const { offsetWidth: w, offsetHeight: h } = d.name
    const top = d.y - scrollY <= b.y ? b.y - h - 4 : b.y + b.h + 4
    Object.assign(d.name.style, { left: `${Math.min(Math.max(b.x - 2, 4), v.w - w - 4)}px`, top: `${Math.min(Math.max(top, 4), v.h - h - 4)}px` })
  }
  function autoscroll(now) {
    const d = drawing
    if (!d?.host) return
    const v = view()
    const into = (p, size) => (p < BAND ? p - BAND : p > size - BAND ? p - (size - BAND) : 0)
    const frames = d.then ? Math.min(now - d.then, 100) / (1000 / 60) : 1
    d.then = now
    // whole pixels, the rest kept for the next frame (a fraction would be lost at a high frame rate)
    d.carry = { x: (d.carry?.x || 0) + into(d.at.x, v.w) * frames, y: (d.carry?.y || 0) + into(d.at.y, v.h) * frames }
    const dx = Math.trunc(d.carry.x)
    const dy = Math.trunc(d.carry.y)
    d.carry.x -= dx
    d.carry.y -= dy
    if (dx || dy) {
      scrollBy({ left: dx, top: dy, behavior: 'instant' })
      drawBox()
    }
    d.loop = requestAnimationFrame(autoscroll)
  }
  // Letting go cuts what the box chose (nothing chosen: nothing cut, the ✂ still in hand).
  function release() {
    const d = drawing
    drawing = null
    if (!d.host && !d.gone) return
    swallow = true
    if (!d.host) return
    cancelAnimationFrame(d.loop)
    const pieces = touched(d)
    d.host.remove()
    if (!pieces.length) return clipping && drawHole()
    if (clipping) stopClip('cut')
    pieces.length === 1 ? cut(pieces[0], d.held) : cutTogether(pieces, d.held)
  }
  // Esc (or the page losing the keys) while a box is drawn: it goes, and the press cuts nothing
  function letBoxGo() {
    const d = drawing
    if (!d?.host) return false
    cancelAnimationFrame(d.loop)
    d.host.remove()
    d.host = null
    d.gone = true
    if (clipping) drawHole()
    return true
  }
  // A press whose end was never heard here (let go of elsewhere) ends with nothing cut.
  function forget() {
    letBoxGo()
    drawing = null
  }
  // While a box is drawn its pointer is the box's alone (the page doesn't see it move).
  addEventListener('pointermove', e => {
    if (!drawing || e.pointerId !== drawing.id) return
    e.stopImmediatePropagation()
    e.buttons & 1 ? drag(e) : forget()
  }, { capture: true, passive: true })
  addEventListener('pointerup', e => drawing && e.pointerId === drawing.id && release(), true)
  addEventListener('pointercancel', e => drawing && e.pointerId === drawing.id && forget(), true)
  // a new press: the last one is over, and the click that would have ended it (if it never came) is forgotten
  addEventListener('pointerdown', () => {
    if (drawing) forget()
    swallow = false
  }, true)
  addEventListener('click', e => {
    if (!swallow) return
    swallow = false
    e.preventDefault()
    e.stopImmediatePropagation()
  }, true)
  addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !drawing?.host) return
    e.preventDefault()
    e.stopImmediatePropagation()
    letBoxGo()
  }, true)
  addEventListener('blur', letBoxGo)

  // Holding ⌥ is the ✂ for as long as it is held: what is under the pointer
  // is framed (the page doesn't dim: you're still reading), a click cuts it
  // out, a drag chooses several, letting go ends it. There is no mode to
  // remember to leave. The frame shows once the pointer moves with
  // ⌥ alone held, so ⌥-keys never flash it. Selected words
  // under the pointer are what's framed, and a click takes them.
  const onlyAlt = e => e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey
  let held = null
  function hold(x, y) {
    if (clipping) return
    if (!held) {
      pageFaces() // stylesheets from other servers start coming now, so a ⌥-click cut doesn't wait for them
      const host = document.createElement('div')
      const root = host.attachShadow({ mode: 'open' })
      const glide = 'cubic-bezier(.2,.8,.2,1)'
      root.innerHTML = `<style>
        .frame{position:fixed;z-index:2147483647;pointer-events:none;box-sizing:border-box;${CUT_LINE};
          transition:left .14s ${glide},top .14s ${glide},width .14s ${glide},height .14s ${glide};animation:in .1s ease-out}
        .tag{position:absolute;left:-1.5px;bottom:100%;margin-bottom:4px;${NAME_SLIP}}
        .frame.low .tag{bottom:auto;top:100%;margin:4px 0 0}
        @keyframes in{from{opacity:0}}
      </style><div class="frame" hidden><div class="tag"></div></div>`
      document.documentElement.append(host)
      held = { host, frame: root.querySelector('.frame'), tag: root.querySelector('.tag'), el: undefined, words: null }
      send('holding')
    }
    const words = wordsAt(x, y)
    const el = words ? null : pieceAt(x, y)
    if (!words && !held.words && el === held.el) return
    Object.assign(held, { words, el })
    drawHeld()
  }
  function wordsAt(x, y) {
    const sel = getSelection()
    if (sel.isCollapsed || !sel.rangeCount || !String(sel).trim()) return null
    const range = sel.getRangeAt(0)
    for (const r of range.getClientRects()) if (x >= r.left - PAD && x <= r.right + PAD && y >= r.top - PAD && y <= r.bottom + PAD) return range
    return null
  }
  function drawHeld() {
    const el = held.el
    let r = null
    if (held.words) {
      const b = held.words.getBoundingClientRect()
      r = { x: b.left - PAD, y: b.top - PAD, w: b.width + 2 * PAD, h: b.height + 2 * PAD }
    } else if (el) r = visibleRect(el)
    held.frame.hidden = !r
    if (!r) return
    Object.assign(held.frame.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` })
    held.frame.classList.toggle('low', r.y < 24) // no room above: the name goes below
    held.tag.textContent = held.words ? 'Words' : cutAlready(el) ? `${nameOf(el)} · on the canvas` : nameOf(el)
  }
  // a piece already cut from here: cutting it again shows where it is instead
  // of copying it twice (one cut with others isn't it alone)
  const cutAlready = el => [...tracked].find(([, t]) => t.length === 1 && t[0] === el)?.[0]
  function letGo() {
    held?.host.remove()
    held = null
  }
  // the frame gives a little under the click, then the piece lifts out
  function cutHeld() {
    if (held.words) {
      const b = held.words.getBoundingClientRect()
      send('clip', { kind: 'words', held: true, url: here(), text: String(getSelection()).trim().slice(0, 4000), rect: { x: b.left, y: b.top, w: b.width, h: b.height } })
    } else if (cutAlready(held.el)) return send('show-piece', { child: cutAlready(held.el) })
    else if (held.el) cut(held.el, true)
    else return
    held.frame.animate([{ transform: 'scale(1)' }, { transform: 'scale(.985)', offset: 0.4 }, { transform: 'scale(1)' }], { duration: 180, easing: 'ease-out' })
  }
  addEventListener('pointermove', e => (onlyAlt(e) ? hold(e.clientX, e.clientY) : held && letGo()), { capture: true, passive: true })
  addEventListener('scroll', () => held && pointer && ((held.el = undefined), hold(pointer.x, pointer.y)), { capture: true, passive: true }) // (drawn again where it now is)
  addEventListener('pointerdown', e => {
    if (!onlyAlt(e) || e.button !== 0 || clipping) return
    e.preventDefault() // no new selection, no link press
    e.stopImmediatePropagation()
    press(e, true, document.documentElement) // (dragged, it draws a box)
  }, true)
  addEventListener('click', e => {
    if (!onlyAlt(e) || e.button !== 0 || clipping) return
    e.preventDefault() // ⌥-click on a link would download it
    e.stopImmediatePropagation()
    hold(e.clientX, e.clientY)
    cutHeld()
  }, true)
  addEventListener('keydown', e => held && e.key === 'Escape' && letGo(), true)
  addEventListener('keyup', e => e.key === 'Alt' && letGo(), true)
  addEventListener('blur', letGo)
  document.documentElement.addEventListener('pointerleave', letGo)

  function selectorFor(el) {
    const parts = []
    while (el && el.nodeType === 1 && el !== document.documentElement) {
      if (el.id && document.querySelectorAll('#' + CSS.escape(el.id)).length === 1) {
        parts.unshift('#' + CSS.escape(el.id))
        break
      }
      let i = 1
      for (let s = el.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === el.tagName) i++
      parts.unshift(`${el.tagName.toLowerCase()}:nth-of-type(${i})`)
      el = el.parentElement
    }
    return parts.join(' > ') || ':root' // (the page itself, holding pieces cut from all over it)
  }

  // A clip is the element itself: an image stays an image, an embedded
  // player stays playable, anything else is copied with its computed styles
  // and the page's fonts, so it looks as it did here.
  function finishClip() {
    const el = clipping.el
    if (!el) return
    stopClip('cut')
    cut(el)
  }
  function cut(el, held = false) {
    if (el.tagName === 'PICTURE' && el.querySelector('img')) el = el.querySelector('img')
    // clipOf, freeze and backdrop read everything about how it looks before
    // they first wait (for the network only), so all of it is read while
    // unpointed has the page as it looks with the pointer elsewhere.
    unpointed(() => clipOf(el, held)).then(clip => send('clip', clip))
  }
  // Several pieces (chosen by a box) cut as one: what holds them all, with
  // only them and what holds each of them, laid out as they were (see freeze).
  function cutTogether(pieces, held) {
    unpointed(() => clipOfPieces(pieces, held)).then(clip => send('clip', clip))
  }
  async function clipOfPieces(pieces, held) {
    let root = pieces[0].parentElement
    while (!pieces.every(p => root.contains(p))) root = root.parentElement
    const r = root.getBoundingClientRect()
    const rs = pieces.map(p => p.getBoundingClientRect())
    const top = Math.min(...rs.map(b => b.top))
    const h = Math.max(...rs.map(b => b.bottom)) - top
    return {
      url: here(),
      held,
      // from where its first piece was, across what holds them (it lifts out from there)
      rect: { x: r.left, y: top, w: r.width, h },
      w: Math.ceil(r.width),
      h: Math.ceil(h),
      selector: pieces.map(selectorFor).join(', '),
      text: pieces.map(p => p.innerText || p.alt || '').join(' ').trim().replace(/\s+/g, ' ').slice(0, 300),
      kind: 'html',
      ...(await freeze(root, pieces)),
    }
  }
  async function clipOf(el, held) {
    const r = el.getBoundingClientRect()
    const base = {
      url: here(),
      held,
      rect: { x: r.left, y: r.top, w: r.width, h: r.height },
      // rounded up: text that exactly fits would wrap in a box a fraction narrower
      w: Math.ceil(r.width),
      h: Math.ceil(r.height),
      selector: selectorFor(el),
      text: (el.innerText || el.alt || '').trim().replace(/\s+/g, ' ').slice(0, 300),
    }
    // a picture keeps how the page showed it: its fit and place in its box, how its pixels scale (pixel art), its filter
    const look = () => {
      const cs = getComputedStyle(el)
      return { fit: cs.objectFit, at: cs.objectPosition, rendering: cs.imageRendering, filter: cs.filter === 'none' ? undefined : cs.filter }
    }
    // (a picture isn't rounded up as text is: a pixel more stretches it)
    const pictureSize = { w: Math.round(r.width), h: Math.round(r.height) }
    if (el.tagName === 'IMG') {
      const seen = look()
      const bg = backdrop(el)
      return { ...base, ...pictureSize, kind: 'image', src: toReal(el.currentSrc || el.src), look: seen, bg: await bg }
    }
    if (el.tagName === 'CANVAS') {
      try {
        return { ...base, ...pictureSize, kind: 'image', src: el.toDataURL(), look: look() }
      } catch {}
    }
    if (el.tagName === 'IFRAME' && /^https?:/.test(el.src)) return { ...base, kind: 'embed', src: toReal(el.src) }
    return { ...base, kind: 'html', ...(await freeze(el)) }
  }

  // How the page looks with the pointer elsewhere. A ⌥-click cut is read
  // with the pointer on the piece, and what the page draws under a pointer (a
  // link's colour, a card lifting, a picture turning from grey to colour, on
  // the thing or on what holds it) would stay in the clip for good. So while
  // `read` runs, the page's :hover selectors match nothing: in each, :hover
  // is swapped for a state no element is in, as specific as :hover, so
  // `a:not(:hover)` still weighs what it did. (A stylesheet from another
  // server can't be read or changed, so its :hover rules still hold.) What the
  // swap sets moving (a hover fading out) is stopped where it ends, so it is
  // read at rest. Then the selectors are put back, all before the page is
  // drawn again, so nothing shows; what that sets moving goes on from where
  // the same thing was (a hover still fading in) or, if it had finished,
  // stops instead of playing again.
  const HOVER = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(?<!\\):hover(?![\w-])/gi
  const NOWHERE = ':not(*|*, :root)'
  // the style rules whose selectors name :hover: [rule, its selector, the selector without it]
  function hoverRules(rules, out) {
    for (const rule of rules) {
      if (rule instanceof CSSStyleRule) {
        const selector = rule.selectorText
        const off = selector.replace(HOVER, (m, quoted) => quoted || NOWHERE)
        if (off !== selector) out.push([rule, selector, off])
      }
      try {
        // @media, @supports, @layer, @container, nested rules; an @import's sheet
        const inner = rule instanceof CSSImportRule ? rule.styleSheet?.cssRules : rule.cssRules
        if (inner) hoverRules(inner, out)
      } catch {} // an @import from another server
    }
    return out
  }
  function unpointed(read) {
    // the pointer on nothing of the page (the ✂ tool's layer covers it): nothing to undo
    if (!document.querySelector(':hover:not(:root)')) return read()
    const rules = []
    for (const sheet of [...document.styleSheets, ...(document.adoptedStyleSheets || [])]) {
      try {
        if (!sheet.disabled) hoverRules(sheet.cssRules, rules)
      } catch {} // another server's
    }
    if (!rules.length) return read()
    const before = document.getAnimations().map(a => ({ a, start: a.startTime, at: a.currentTime }))
    const was = new Set(before.map(b => b.a))
    const started = () => document.getAnimations().filter(a => !was.has(a) && (a instanceof CSSTransition || a instanceof CSSAnimation))
    const same = (a, b) => a.constructor === b.constructor && a.effect?.target === b.effect?.target && a.effect?.pseudoElement === b.effect?.pseudoElement && a.transitionProperty === b.transitionProperty && a.animationName === b.animationName
    for (const [rule, , off] of rules) rule.selectorText = off
    for (const a of started()) a.cancel()
    try {
      return read()
    } finally {
      for (const [rule, selector] of rules) rule.selectorText = selector
      for (const a of started()) {
        const old = before.find(b => same(a, b.a))
        if (old?.start != null) a.startTime = old.start
        else if (old?.at != null) a.currentTime = old.at
        else a.cancel()
      }
    }
  }

  const REPLACED = /^(IMG|VIDEO|AUDIO|IFRAME|CANVAS|SVG|PICTURE|EMBED|OBJECT|INPUT|SELECT|TEXTAREA|BUTTON)$/i
  // Sizes are left out (except on media) so a clip reflows when it is
  // resized; heightOf and widthOf keep the ones the content doesn't give.
  const SKIP = /^(transition|animation|will-change|cursor|-webkit-locale|-webkit-tap-highlight-color|view-transition|inline-size|block-size|width|height|min-inline|max-inline|min-block|max-block|perspective-origin|transform-origin)/
  const ROOT_SKIP = /^(position|top|left|right|bottom|inset|float|margin|transform|translate|rotate|scale|z-index)/
  // Logical properties (margin-block-start…) repeat the physical ones (margin-top…).
  const LOGICAL = /(^|-)(block|inline)(-|$)/
  const LINE = /^(border-(top|right|bottom|left)|outline|column-rule|row-rule)-(style|color)$/
  // Not drawn, or would run or load something in the copy.
  const LEAVE_OUT = /^(SCRIPT|NOSCRIPT|TEMPLATE|LINK|STYLE|META|SOURCE|BASE)$/i
  // What starts loading or playing as soon as it is in a page.
  const LOADS = /^(IFRAME|FRAME|OBJECT|EMBED|VIDEO|AUDIO)$/i
  // Addresses made real, except a reference to something in the same
  // document (an SVG gradient or icon, #id), which stays one.
  const realUrls = css => css.replace(/url\("([^"]+)"\)/g, (m, u) => (u.startsWith('#') ? m : `url("${toReal(u)}")`))

  // The computed styles that make `have` look like `want`: every property
  // where they differ.
  function differences(want, have, { root = false, sized = false } = {}) {
    let style = ''
    for (const p of want) {
      if (p.startsWith('--') || LOGICAL.test(p)) continue
      if (SKIP.test(p) && !(sized && (p === 'width' || p === 'height'))) continue
      if (root && ROOT_SKIP.test(p)) continue
      const v = want.getPropertyValue(p)
      if (v === have.getPropertyValue(p)) continue
      // A line of width 0 isn't drawn, whatever its style or colour. Without
      // this, "border: 0 solid" (Tailwind sets it on everything) would copy
      // its style and then need its width too.
      const line = LINE.exec(p)?.[1]
      if (line && (want.getPropertyValue(`${line}-width`) === '0px' || /^(none|hidden)$/.test(want.getPropertyValue(`${line}-style`)))) continue
      style += `${p}:${v};`
    }
    return realUrls(style)
  }

  // A ::before / ::after decoration (an icon, a bullet, a quote mark) becomes a
  // real span in the copy, since the copy has no stylesheet to draw it.
  function copyPseudo(o, c, which, view) {
    const ps = getComputedStyle(o, `::${which}`)
    const content = ps.content
    if (!content || content === 'none' || content === 'normal' || ps.display === 'none') return
    const span = c.ownerDocument.createElement('span')
    // its strings, and attributes it shows with attr()
    let text = ''
    for (const [, string, attr] of content.matchAll(/"((?:[^"\\]|\\.)*)"|attr\(\s*([\w-]+)\s*\)/g)) {
      text += string !== undefined ? string.replace(/\\([0-9a-f]{1,6})\s?/gi, (m, h) => String.fromCodePoint(parseInt(h, 16))).replace(/\\(.)/g, '$1') : o.getAttribute(attr) || ''
    }
    span.textContent = text
    if (which === 'before') c.prepend(span)
    else c.append(span)
    span.setAttribute('style', differences(ps, view.getComputedStyle(span)))
  }

  // A copy of the element that looks as it does here: its computed styles,
  // written only where the copy would otherwise come out different. What the
  // copy would come out as is asked of the browser itself, with the copy in a
  // blank page like a clip's own (standards mode, no stylesheets): it knows
  // what it gives each tag in each place (a heading is bold, a link is blue, a
  // list inside a list has circles) and what passes from parent to child, so
  // nothing here has to guess it. Elements are written parent first, so each
  // child is compared with what it will inherit.
  // Several pieces (`pieces`, chosen by a box) are copied as the root that
  // holds them all, with only them and what holds each of them: that keeps
  // its look and the places it gives them (columns stay columns), and the
  // rest goes, except, in a row or a grid, what lies between two of them,
  // what sits beside one of them in a row (a picture beside the words
  // chosen, a cell), which stays as an empty room as wide as it was, so they
  // stay in their columns. Down the page, what is left out takes no room:
  // what holds them doesn't keep a height (nor a grid's rows) its other
  // content gave it, and what holds only pieces placed by position
  // (absolutely) holds just them, moved up together to its top. But where
  // they were nudged from their place in the flow (relatively, by an
  // offset), what was left out keeps all its room there: they were placed
  // against it.
  async function freeze(root, pieces = null) {
    const copy = root.cloneNode(true)
    // its language, which says how words break and hyphenate, which quote
    // marks and which fonts it takes; a page usually says it once, on <html>
    const lang = root.closest('[lang]')?.getAttribute('lang')
    if (lang && !copy.hasAttribute('lang')) copy.setAttribute('lang', lang)
    const originals = [root, ...root.querySelectorAll('*')]
    const copies = [copy, ...copy.querySelectorAll('*')]

    const inPiece = new Set(pieces?.flatMap(p => [p, ...p.querySelectorAll('*')]))
    const holding = new Set() // what holds a piece, up to the root
    for (const p of pieces || []) {
      for (let e = p.parentElement; e && !holding.has(e); e = e.parentElement) {
        holding.add(e)
        if (e === root) break
      }
    }
    const kept = e => holding.has(e) || inPiece.has(e)
    const sideBySide = s => /^(table-row|grid|inline-grid|flex|inline-flex)$/.test(s.display) && !s.flexDirection.startsWith('column')
    const rooms = new Map() // left out but keeping their room -> 'across' (beside a kept one in a row: its width) or 'all'
    const placed = new Map() // what holds only pieces placed by position -> how far they move up, and its height then
    const nudged = s => s.position === 'relative' && ['top', 'left', 'right', 'bottom'].some(side => !/^(auto|0px)$/.test(s[side]))
    for (const h of holding) {
      const kids = [...h.children]
      const hs = getComputedStyle(h)
      if (kids.some(k => kept(k) && nudged(getComputedStyle(k)))) {
        for (const k of kids) if (!kept(k)) rooms.set(k, 'all')
      } else if (sideBySide(hs)) {
        const rows = kids.filter(kept).map(k => k.getBoundingClientRect())
        for (const k of kids) {
          const r = k.getBoundingClientRect()
          if (!kept(k) && rows.some(t => r.top < t.bottom && r.bottom > t.top)) rooms.set(k, 'across')
        }
      }
      const theirs = kids.filter(kept)
      if (theirs.every(k => getComputedStyle(k).position === 'absolute')) {
        const top = h.getBoundingClientRect().top + h.clientTop
        const rs = theirs.map(k => k.getBoundingClientRect())
        const up = Math.min(...rs.map(r => r.top)) - top
        placed.set(h, { up, height: Math.max(...rs.map(r => r.bottom)) - top - up })
      }
    }

    // as wide as the clip will be, so the copy is laid out there as in its
    // clip (made after the copy, which is of the whole page when pieces span it)
    const blank = document.createElement('iframe')
    blank.style.cssText = `position:fixed;left:0;top:0;width:${Math.ceil(root.getBoundingClientRect().width)}px;height:0;border:0;visibility:hidden`
    document.documentElement.append(blank)
    const clean = blank.contentDocument
    clean.open()
    clean.write('<!doctype html><style>html,body{margin:0;padding:0}</style>')
    clean.close()
    const view = clean.defaultView

    // whether the nearest thing shown before (or after) a kept one was left out
    const apart = (o, way) => {
      for (let n = o[way]; n; n = n[way]) {
        if (kept(n) || rooms.has(n)) return false
        if (getComputedStyle(n).display !== 'none' && !/^(absolute|fixed)$/.test(getComputedStyle(n).position)) return true
      }
      return false
    }
    const done = [] // [original, its copy, the original's computed style, placed against something outside, its part: 'holder', 'room' or none]
    const paused = [] // [element, attribute, value]: what would load while the copy is checked
    originals.forEach((o, i) => {
      let c = copies[i]
      if (c !== copy && !copy.contains(c)) return // inside something left out
      if (LEAVE_OUT.test(o.tagName)) return c.remove()
      // pieces chosen by a box: what holds them, and the rooms beside them in a row, stay; the rest goes
      const part = pieces && !inPiece.has(o) ? (rooms.has(o) ? 'room' : holding.has(o) ? 'holder' : 'out') : null
      if (part === 'out') return c.remove()
      if (part === 'room') c.replaceChildren()
      // what holds pieces holds them alone: words of its own that aren't in one go
      if (part === 'holder') for (const t of [...c.childNodes]) if (t.nodeType === Node.TEXT_NODE && t.data.trim()) t.remove()
      const cs = getComputedStyle(o)
      if (cs.display === 'none') return c.remove()
      // a box of its own scrolled within the page: its clip shows it scrolled as here (see CLIP_SCRIPT in app.js)
      if ((o.scrollTop || o.scrollLeft) && o !== document.scrollingElement) c.setAttribute('data-cb-scroll', `${o.scrollLeft} ${o.scrollTop}`)
      // no handlers, and no value that would run as script (xlink:href, an SVG animation's to=…)
      for (const a of [...c.attributes]) {
        if (/^on/i.test(a.name) || ['class', 'style', 'srcset', 'sizes', 'loading', 'srcdoc'].includes(a.name) || /^\s*(javascript|vbscript|data:text\/html)/i.test(a.value)) c.removeAttribute(a.name)
      }
      for (const name of ['src', 'href', 'poster']) {
        if (!c.hasAttribute(name) || c.getAttribute(name).startsWith('#')) continue
        const v = name === 'src' && o.currentSrc ? o.currentSrc : typeof o[name] === 'string' ? o[name] : c.getAttribute(name)
        c.setAttribute(name, toReal(v))
      }
      if (o.tagName === 'CANVAS') {
        try {
          const img = clean.createElement('img')
          img.src = o.toDataURL()
          c.replaceWith(img)
          c = img
        } catch {}
      }
      if (LOADS.test(c.tagName)) {
        for (const name of ['src', 'data']) {
          if (!c.hasAttribute(name)) continue
          paused.push([c, name, c.getAttribute(name)])
          c.removeAttribute(name)
        }
      }
      // placed against a box outside the cut (or the window): placed against the cut element instead
      const loose = o !== root && /^(absolute|fixed)$/.test(cs.position) && !(cs.position === 'absolute' && o.offsetParent && root.contains(o.offsetParent))
      done.push([o, c, cs, loose, part])
    })
    const at = root.getBoundingClientRect()
    const holds = done.some(k => k[3])
    clean.body.append(copy)
    for (const [o, c, cs, loose, part] of done) {
      const have = view.getComputedStyle(c)
      // The text colour and size first: what follows them (the colour of
      // borders, underlines and the caret; margins in em) then comes out
      // right by itself and needn't be written.
      let first = ''
      for (const p of ['color', 'font-size']) if (cs.getPropertyValue(p) !== have.getPropertyValue(p)) first += `${p}:${cs.getPropertyValue(p)};`
      c.setAttribute('style', first)
      const sized = part === 'room' || REPLACED.test(o.tagName) || loose
      let style = first + differences(cs, have, { root: o === root, sized })
      if (!sized) style += (part === 'holder' ? '' : heightOf(o, cs)) + (o === root ? '' : widthOf(o, cs))
      if (part === 'room') style += rooms.get(o) === 'all' ? 'visibility:hidden;' : 'visibility:hidden;height:0;min-height:0;padding-block:0;border-block-width:0;margin-block:0;'
      // a grid holding pieces: the rows the page gave it, not the ones it made for all it held
      if (part === 'holder' && /grid/.test(cs.display) && o.computedStyleMap) style += `grid-template-rows:${o.computedStyleMap().get('grid-template-rows')};`
      if (placed.has(o)) style += `height:${placed.get(o).height}px;min-height:0;`
      // one above (or below) another: a margin that kept it apart from what was left out goes with it
      if (pieces && o !== root && kept(o) && !sideBySide(getComputedStyle(o.parentElement))) {
        if (apart(o, 'previousElementSibling')) style += 'margin-top:0;'
        if (apart(o, 'nextElementSibling')) style += 'margin-bottom:0;'
      }
      if (placed.has(o.parentElement) && cs.position === 'absolute' && /px$/.test(cs.top)) style += `top:${parseFloat(cs.top) - placed.get(o.parentElement).up}px;bottom:auto;`
      if (loose) {
        const r = o.getBoundingClientRect()
        // (against the cut element's own box: in a grid, its cell would be what it is placed against)
        style += `position:absolute;left:${r.left - at.left - root.clientLeft - parseFloat(cs.marginLeft)}px;top:${r.top - at.top - root.clientTop - parseFloat(cs.marginTop)}px;right:auto;bottom:auto;grid-area:auto;`
      }
      // Chrome reports a box whose lines are clamped (display: -webkit-box)
      // as flow-root, where the clamp doesn't apply
      if (cs.webkitLineClamp !== 'none' && /flow-root/.test(cs.display)) style += `display:${/inline/.test(cs.display) ? '-webkit-inline-box' : '-webkit-box'};`
      // a margin given as auto (which centres it) reads as 0 in a flex or grid container: it stays auto
      const given = o !== root && o.computedStyleMap?.()
      if (given) for (const side of ['top', 'right', 'bottom', 'left']) if (String(given.get(`margin-${side}`)) === 'auto') style += `margin-${side}:auto;`
      if (o === root) style += rootStyle(root, cs, holds)
      c.setAttribute('style', style)
      if (!REPLACED.test(o.tagName)) for (const which of ['before', 'after']) copyPseudo(o, c, which, view)
    }
    // A child's top margin that passes through the element's top edge (no
    // border or padding there to stop it) lies outside the element in the
    // page, above it. Alone in its clip it would push the element down from
    // the top; a negative margin of the same size cancels it.
    const pushed = copy.getBoundingClientRect().top
    if (pushed > 0) copy.style.marginTop = `${-pushed}px`
    copy.remove()
    blank.remove()
    for (const [c, name, value] of paused) c.setAttribute(name, value)

    // the fonts it draws with: each family, in the weights and styles used with it
    const used = new Map() // family -> Set of "weight style"
    for (const [o, , cs] of done) {
      for (const style of [cs, getComputedStyle(o, '::before'), getComputedStyle(o, '::after')]) {
        for (const f of style.fontFamily.split(',')) {
          if (!used.has(family(f))) used.set(family(f), new Set())
          used.get(family(f)).add(`${style.fontWeight} ${style.fontStyle.split(' ')[0]}`)
        }
      }
    }
    const [bg, fonts] = await Promise.all([backdrop(root), fontsFor(used, copy.textContent)])
    // As XML, not HTML: a page built by script can hold what the HTML parser
    // would rebuild differently (a div inside a p closes the p), and XML
    // comes back exactly as it was.
    xmlSafe(copy)
    return { html: new XMLSerializer().serializeToString(copy), fonts: fonts.join('\n'), bg }
  }

  // XML takes less than HTML: no attribute names that script frameworks
  // invent (@click, :class, x-on:click), no xmlns attributes the HTML parser
  // kept as plain ones, no control characters, no comment holding "--". None
  // of them draws anything, so a copy leaves them out and stays well-formed.
  const XML_NAME = /^(xml:)?[\p{L}_][\p{L}\p{N}_.-]*$/u
  const NOT_XML = /[\0-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g
  function xmlSafe(root) {
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT | NodeFilter.SHOW_COMMENT | NodeFilter.SHOW_PROCESSING_INSTRUCTION)
    const gone = []
    for (let n = walk.currentNode; n; n = walk.nextNode()) {
      if (n.nodeType === Node.TEXT_NODE) {
        const text = n.data.replace(NOT_XML, '')
        if (text !== n.data) n.data = text
      } else if (n.nodeType !== Node.ELEMENT_NODE) gone.push(n)
      else {
        for (const a of [...n.attributes]) {
          if (!a.namespaceURI && (!XML_NAME.test(a.name) || a.name === 'xmlns')) n.removeAttribute(a.name)
          else {
            const value = a.value.replace(NOT_XML, '')
            if (value !== a.value) a.value = value
          }
        }
      }
    }
    for (const n of gone) n.remove()
  }

  // Sizes are left out of a copy so it reflows when its clip is resized, but
  // an element's height stays when it isn't just the height of what it
  // holds: taller (a height set, stretched in a row, a box for a background
  // picture) it stays at least that tall; shorter, cutting off what
  // overflows, it stays that tall. Measured in the page, where it is laid
  // out with its own fonts.
  function heightOf(o, cs) {
    if (!/px$/.test(cs.height) || /^(table|contents)/.test(cs.display)) return ''
    const box = o.getBoundingClientRect()
    const range = document.createRange()
    range.selectNodeContents(o)
    const content = range.getBoundingClientRect()
    const px = p => parseFloat(cs.getPropertyValue(p)) || 0
    const top = content.width || content.height ? content.bottom : box.top + px('border-top-width') + px('padding-top')
    const held = top + px('padding-bottom') + px('border-bottom-width')
    if (box.bottom - held > 1) return `min-height:${cs.height};`
    if (held - box.bottom > 1 && cs.overflowY !== 'visible') return `height:${cs.height};`
    return ''
  }

  // Its width, when it doesn't simply fill what holds it: a box sized to its
  // content or by a row or table around it (a float, an inline block, a
  // table, a cell, an item in a flex row or grid) keeps the width it had;
  // a block narrower than its container (a width or max-width set) keeps
  // that as the most it may be, so it still narrows with its clip.
  function widthOf(o, cs) {
    if (!/px$/.test(cs.width) || /^(inline$|contents|table-(row|column|header|footer))/.test(cs.display)) return ''
    const parent = o.parentElement && getComputedStyle(o.parentElement)
    if (cs.float !== 'none' || /^inline-|^table|^-webkit-inline/.test(cs.display) || /flex|grid/.test(parent?.display)) return `width:${cs.width};`
    const px = (s, p) => parseFloat(s.getPropertyValue(p)) || 0
    const room = o.parentElement.clientWidth - px(parent, 'padding-left') - px(parent, 'padding-right')
    const takes = o.getBoundingClientRect().width + px(cs, 'margin-left') + px(cs, 'margin-right')
    return room - takes > 1 ? `max-width:${cs.width};` : ''
  }

  // The cut element alone in its clip, as it was in the page: on its own,
  // not in a line of text (inline-flex is flex, inline is block); without
  // its margins; still holding
  // what is positioned inside it, and what was positioned against something
  // around it (`holds`); and turned, scaled and zoomed as it was with
  // everything around it, though not moved to where it was.
  function rootStyle(root, cs, holds) {
    let style = ''
    if (/^inline/.test(cs.display)) style += `display:${cs.display.replace(/^inline-?/, '') || 'block'};`
    // a table (or a part of one) alone is only as wide as its content
    if (/table/.test(cs.display) && /px$/.test(cs.width)) style += `width:${cs.width};`
    style += 'margin:0;'
    // the page itself (holding pieces from all over it) holds its body's
    // margins, as a page's root does, rather than letting them pass through
    if (root === document.documentElement && cs.display === 'block') style += 'display:flow-root;'
    if (cs.position !== 'static' || holds) style += 'position:relative;'
    // the page's colours for its controls and scrollbars (dark, say), when a
    // <meta name="color-scheme"> asks for them rather than a style
    const scheme = document.querySelector('meta[name="color-scheme" i]')?.content
    if (cs.colorScheme === 'normal' && scheme) style += `color-scheme:${scheme.replace(/[;{}<>]/g, '')};`
    let turn = new DOMMatrix()
    let zoom = 1
    for (let e = root; e; e = e.parentElement) {
      const s = getComputedStyle(e)
      // translate, rotate, scale, then transform; only what turns and scales
      const own = new DOMMatrix()
      const angle = /^(-?[\d.]+)deg$/.exec(s.rotate)
      if (angle) own.rotateSelf(+angle[1])
      const scale = /^(-?[\d.]+)(?: (-?[\d.]+))?$/.exec(s.scale)
      if (scale) own.scaleSelf(+scale[1], +(scale[2] ?? scale[1]))
      if (s.transform !== 'none') own.multiplySelf(new DOMMatrix(s.transform))
      turn = own.multiply(turn)
      if (e !== root) zoom *= +s.zoom || 1
    }
    if (zoom !== 1) style += `zoom:${zoom};`
    const { a, b, c, d } = turn
    if (a !== 1 || b !== 0 || c !== 0 || d !== 1) {
      // its own width (the clip is as wide as the turned box), turned about
      // its corner and moved so the turned box starts at the clip's corner
      const pad = side => parseFloat(cs.getPropertyValue(`padding-${side}`)) + parseFloat(cs.getPropertyValue(`border-${side}-width`))
      const outer = cs.boxSizing === 'border-box' ? 0 : 1
      const w = parseFloat(cs.width) + outer * (pad('left') + pad('right'))
      const h = parseFloat(cs.height) + outer * (pad('top') + pad('bottom'))
      const xs = [0, a * w, c * h, a * w + c * h]
      const ys = [0, b * w, d * h, b * w + d * h]
      style += `width:${cs.width};transform-origin:0 0;transform:matrix(${a},${b},${c},${d},${-Math.min(...xs)},${-Math.min(...ys)});`
    }
    return style
  }

  // The page's @font-face rules for the families a clip uses, from all its
  // stylesheets (and the ones they import, and inside @media, @supports and
  // @layer blocks), with their files at their own addresses (the add-on lets
  // the clip load them: see RULES in app.js). A stylesheet from another
  // server can't be read here; it is fetched (the add-on lets it be read),
  // once per page, all at once, with the browser's own fetch (the page's
  // scripts may have replaced theirs).
  const family = f => f.trim().replace(/^(['"])(.*)\1$/, '$2').toLowerCase()
  // How long a cut waits for something from the network (a stylesheet from
  // another server, a picture's size): about the second a person waits
  // without losing their thought. Past it, the cut goes without it.
  const PATIENCE = 1000
  const inTime = (promise, otherwise) => Promise.race([promise, new Promise(done => setTimeout(() => done(otherwise), PATIENCE))])
  const fetchedSheets = new Map() // address -> its rules, parsed
  const originalFetch = window.fetch
  function sheetFrom(href) {
    if (!fetchedSheets.has(href)) {
      fetchedSheets.set(href, originalFetch.call(window, href).then(r => (r.ok ? r.text() : ''), () => '').then(css => {
        const sheet = new CSSStyleSheet()
        try {
          sheet.replaceSync(css) // leaves out @import rules: they are followed here
        } catch {}
        const imports = [...css.matchAll(/@import\s+(?:url\(\s*)?['"]?([^'")\s;]+)/g)].map(m => new URL(m[1], href).href)
        return { rules: sheet.cssRules, imports }
      }))
    }
    return fetchedSheets.get(href)
  }
  // every @font-face rule of a stylesheet, in order, with the address its urls are relative to
  async function facesIn(sheet, href, seen) {
    const key = href || sheet
    if (seen.has(key)) return []
    seen.add(key)
    let rules = null
    try {
      rules = sheet?.cssRules
    } catch {}
    if (rules) return facesOfRules(rules, sheet.href || href || document.baseURI, seen)
    if (!href || !/^https?:/.test(href)) return []
    const got = await inTime(sheetFrom(href), { rules: [], imports: [] })
    const parts = await Promise.all([facesOfRules(got.rules, href, seen), ...got.imports.map(u => facesIn(null, u, seen))])
    return parts.flat()
  }
  async function facesOfRules(rules, base, seen) {
    const parts = await Promise.all([...rules].map(rule => {
      if (rule instanceof CSSFontFaceRule) return [{ rule, base }]
      if (rule instanceof CSSImportRule) return facesIn(rule.styleSheet, new URL(rule.href, base).href, seen)
      return rule.cssRules ? facesOfRules(rule.cssRules, base, seen) : []
    }))
    return parts.flat()
  }
  const pageFaces = (seen = new Set()) => Promise.all([...document.styleSheets].map(sheet => facesIn(sheet, sheet.href, seen))).then(parts => parts.flat())
  async function fontsFor(used, text) {
    // only faces that can draw some of the clip's characters (a font service
    // splits a font into many faces, one per alphabet); digits and bullets
    // too, for list numbers and markers
    const codes = [...new Set(text + '0123456789.•◦▪')].map(ch => ch.codePointAt(0))
    const drawsAny = range => !range || range.split(',').some(part => {
      const [lo, hi] = part.trim().replace(/^U\+/i, '').split('-')
      const from = parseInt(lo.replace(/\?/g, '0'), 16)
      const to = parseInt((hi ?? lo).replace(/\?/g, 'F'), 16)
      return codes.some(c => c >= from && c <= to)
    })
    // A face for a weight and style the clip uses. When a family has none
    // that fits exactly, all its faces stay, so the browser picks the nearest
    // one as it did in the page.
    const weights = w => (w || 'normal').replace(/\bnormal\b/g, '400').replace(/\bbold\b/g, '700').split(/\s+/).map(Number)
    const fits = (rule, want) => {
      const [lo, hi = lo] = weights(rule.style.getPropertyValue('font-weight'))
      const style = (rule.style.getPropertyValue('font-style') || 'normal').split(' ')[0]
      return [...want].some(ws => {
        const [w, st] = ws.split(' ')
        return +w >= lo && +w <= hi && st === style
      })
    }
    const faces = (await pageFaces()).filter(({ rule }) => used.has(family(rule.style.getPropertyValue('font-family'))) && drawsAny(rule.style.getPropertyValue('unicode-range')))
    const exact = new Set(faces.filter(({ rule }) => fits(rule, used.get(family(rule.style.getPropertyValue('font-family'))))).map(({ rule }) => family(rule.style.getPropertyValue('font-family'))))
    return faces
      .filter(({ rule }) => !exact.has(family(rule.style.getPropertyValue('font-family'))) || fits(rule, used.get(family(rule.style.getPropertyValue('font-family')))))
      .map(({ rule, base }) => rule.cssText.replace(/url\((['"]?)([^'")]+)\1\)/g, (m, q, u) => `url("${new URL(u, base).href}")`))
  }

  // What an element sat on, as one CSS `background` for its clip: the
  // backgrounds of what is drawn beneath it, nearest on top, down to the first
  // opaque colour that covers it, or else the page's own canvas colour. Each
  // layer keeps the place and size it had in the page, given in pixels from
  // the element's top-left corner (where the element sits in its clip), so a
  // texture or a gradient across the page lines up as it did instead of being
  // fitted to the clip.
  async function backdrop(el) {
    const at = el.getBoundingClientRect()
    const html = document.documentElement
    const blankBg = s => s.backgroundImage === 'none' && alphaOf(s.backgroundColor) === 0
    // What is drawn beneath it, nearest first: what holds it (its ancestors),
    // and what lies under it without holding it (a coloured box placed
    // behind the page, a picture under a caption), in the order the page
    // paints them where its middle is.
    const around = []
    for (let e = el.parentElement; e; e = e.parentElement) around.push(e)
    const stack = document.elementsFromPoint(at.left + at.width / 2, at.top + at.height / 2)
    const beneath = []
    let next = 0
    for (const e of stack.includes(el) ? stack.slice(stack.indexOf(el) + 1) : []) {
      const k = around.indexOf(e)
      if (k >= 0) while (next <= k) beneath.push(around[next++])
      else if (!el.contains(e)) beneath.push(e)
    }
    beneath.push(...around.slice(next))
    // the page itself (holding pieces cut from all over it): it sits on its canvas,
    // which is the body's background when it has none of its own
    if (el === html && document.body && blankBg(getComputedStyle(html))) beneath.push(document.body)
    // how see-through something beneath is that doesn't hold it: its own
    // opacity and that of what holds it, up to what holds the element too
    const fadeOf = e => {
      let fade = 1
      for (let x = e; x && !x.contains(el); x = x.parentElement) fade *= +getComputedStyle(x).opacity
      return fade
    }
    // everything read first, while the page is as it was; then the pictures' sizes, all at once
    const found = [] // nearest first: { image, x, y, size, repeat, area, natural } or { color, paint }
    let base = null
    for (const e of beneath) {
      const s = getComputedStyle(e)
      const holds = around.includes(e)
      const fade = holds ? 1 : fadeOf(e)
      // the root's background (or the body's, when the root has none) is the
      // page's: it covers everything, placed from the root's box
      const whole = e === html || (e === document.body && blankBg(getComputedStyle(html)))
      const boxes = boxesOf(whole ? html : e, s)
      // a picture beneath it, drawn into its box (a background can't fade one)
      if (!holds && e.tagName === 'IMG' && fade === 1 && e.currentSrc) {
        const b = boxes['content-box']
        found.push({ image: `url("${e.currentSrc}")`, x: '0px', y: '0px', size: `${b.w}px ${b.h}px`, repeat: 'no-repeat', area: b })
      }
      const list = p => split(s.getPropertyValue(p))
      const [images, xs, ys, sizes, repeats, attachments, origins, clips] = ['background-image', 'background-position-x', 'background-position-y', 'background-size', 'background-repeat', 'background-attachment', 'background-origin', 'background-clip'].map(list)
      const nth = (values, i) => values[i % values.length]
      if (fade === 1) {
        images.forEach((image, i) => {
          if (image === 'none' || nth(clips, i) === 'text') return
          const url = /^url\("(.*)"\)$/.exec(image)?.[1]
          const area = nth(attachments, i) === 'fixed' ? { x: 0, y: 0, w: innerWidth, h: innerHeight } : boxes[nth(origins, i)] || boxes['padding-box']
          found.push({ image, x: nth(xs, i), y: nth(ys, i), size: nth(sizes, i), repeat: nth(repeats, i), area, natural: url ? naturalSize(url) : null })
        })
      }
      const alpha = alphaOf(s.backgroundColor) * fade
      if (!alpha) continue
      const color = fade === 1 ? s.backgroundColor : `color-mix(in srgb, ${s.backgroundColor} ${fade * 100}%, transparent)`
      const paint = whole ? null : boxes[clips[clips.length - 1]] || boxes['border-box']
      const covers = !paint || (paint.x <= at.left && paint.y <= at.top && paint.x + paint.w >= at.right && paint.y + paint.h >= at.bottom)
      if (alpha === 1 && covers) {
        base = color
        break
      }
      found.push({ color, paint })
    }
    if (!base) {
      // nothing opaque behind it: the page's canvas, white unless the page asks for dark
      const probe = document.createElement('div')
      probe.style.cssText = 'display:none;background-color:Canvas'
      html.append(probe)
      base = getComputedStyle(probe).backgroundColor
      probe.remove()
    }
    const naturals = await Promise.all(found.map(f => f.natural))
    const layers = found.map((f, i) => {
      if (f.color) return `linear-gradient(${f.color}, ${f.color})` + (f.paint ? ` ${f.paint.x - at.left}px ${f.paint.y - at.top}px / ${f.paint.w}px ${f.paint.h}px no-repeat` : '')
      const { area } = f
      const size = tileSize(f.size, area, naturals[i])
      const [rx, ry] = repeatsOf(f.repeat)
      // `round` fits a whole number of tiles in the area
      if (rx === 'round') size.w = area.w / Math.max(1, Math.round(area.w / size.w))
      if (ry === 'round') size.h = area.h / Math.max(1, Math.round(area.h / size.h))
      const x = area.x + along(f.x, area.w - size.w) - at.left
      const y = area.y + along(f.y, area.h - size.h) - at.top
      const tiled = r => (r === 'no-repeat' ? 'no-repeat' : 'repeat')
      return `${f.image} ${x}px ${y}px / ${size.w}px ${size.h}px ${tiled(rx)} ${tiled(ry)}`
    })
    return finish(layers, base)
  }
  // The canvas keeps a backdrop as one CSS value without ; < > { } (it takes
  // those out), so a data: picture is given in the form that needs none of them.
  const finish = (layers, color) => realUrls([...layers, color].join(', ')).replace(/url\("(data:[^"]*)"\)/g, (m, u) => `url("${plainData(u)}")`)
  function plainData(u) {
    const m = /^data:([^;,]*)((?:;[^;,]*)*),(.*)$/s.exec(u)
    if (!m || !/[;<>{}]/.test(u)) return u
    const bytes = /;base64/i.test(m[2]) ? Uint8Array.from(atob(m[3]), ch => ch.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(m[3]))
    return `data:${m[1]},${[...bytes].map(b => (/[A-Za-z0-9_.~-]/.test(String.fromCharCode(b)) ? String.fromCharCode(b) : `%${b.toString(16).padStart(2, '0')}`)).join('')}`
  }
  // a comma-separated list, leaving commas inside brackets (gradients) alone
  function split(value) {
    const out = []
    let depth = 0
    let from = 0
    for (let i = 0; i < value.length; i++) {
      if (value[i] === '(') depth++
      else if (value[i] === ')') depth--
      else if (value[i] === ',' && !depth) {
        out.push(value.slice(from, i).trim())
        from = i + 1
      }
    }
    out.push(value.slice(from).trim())
    return out
  }
  const alphaOf = color => {
    if (color === 'transparent') return 0
    const legacy = /^rgba?\((.*)\)$/.exec(color)
    if (legacy) return +(legacy[1].split(',')[3] ?? 1)
    const slash = /\/\s*([\d.]+)(%?)\s*\)$/.exec(color)
    return !slash ? 1 : slash[2] ? slash[1] / 100 : +slash[1]
  }
  // an element's border, padding and content boxes, where it is now
  function boxesOf(e, s) {
    const r = e.getBoundingClientRect()
    const inset = (b, side) => ['top', 'right', 'bottom', 'left'].map(k => parseFloat(s.getPropertyValue(side.replace('*', k))) || 0)
    const shrink = (b, [t, ri, bo, l]) => ({ x: b.x + l, y: b.y + t, w: b.w - l - ri, h: b.h - t - bo })
    const border = { x: r.left, y: r.top, w: r.width, h: r.height }
    const padding = shrink(border, inset(border, 'border-*-width'))
    return { 'border-box': border, 'padding-box': padding, 'content-box': shrink(padding, inset(padding, 'padding-*')) }
  }
  // a length or percentage (or a calc() of them) in px; % of `of`
  const lengthOf = (v, of) => {
    let total = 0
    for (const [, op, n, unit] of v.matchAll(/([+-])?\s*(-?[\d.]+(?:e-?\d+)?)(%|px)/g)) total += (op === '-' ? -1 : 1) * (unit === '%' ? (n * of) / 100 : +n)
    return total
  }
  // a background-position-x or -y in px; `room` is the area less the tile
  function along(v, room) {
    const m = /^(left|right|top|bottom|center)(?:\s+(.+))?$/.exec(v)
    if (!m) return lengthOf(v, room)
    const offset = m[2] ? lengthOf(m[2], room) : 0
    return m[1] === 'center' ? room / 2 : /right|bottom/.test(m[1]) ? room - offset : offset
  }
  function tileSize(size, area, natural) {
    if (size === 'cover' || size === 'contain') {
      if (!natural) return { w: area.w, h: area.h }
      const k = (size === 'cover' ? Math.max : Math.min)(area.w / natural.w, area.h / natural.h)
      return { w: natural.w * k, h: natural.h * k }
    }
    const [sw, sh = 'auto'] = size.split(/\s+(?![^(]*\))/)
    let w = sw === 'auto' ? null : lengthOf(sw, area.w)
    let h = sh === 'auto' ? null : lengthOf(sh, area.h)
    if (w === null && h === null) return natural ? { ...natural } : { w: area.w, h: area.h }
    if (w === null) w = natural ? (h * natural.w) / natural.h : area.w
    if (h === null) h = natural ? (w * natural.h) / natural.w : area.h
    return { w, h }
  }
  const repeatsOf = r => ({ 'repeat-x': ['repeat', 'no-repeat'], 'repeat-y': ['no-repeat', 'repeat'] })[r] || (r.includes(' ') ? r.split(' ') : [r, r])
  // A background picture's own size, which `auto`, `cover` and `contain`
  // depend on. The page has drawn it, so it is in the browser's cache and
  // comes at once, unless the request is stuck.
  const naturalSizes = new Map()
  function naturalSize(url) {
    if (!naturalSizes.has(url)) {
      naturalSizes.set(url, new Promise(done => {
        const img = new Image()
        img.onload = () => done(img.naturalWidth && img.naturalHeight ? { w: img.naturalWidth, h: img.naturalHeight } : null)
        img.onerror = () => done(null)
        img.src = url
      }))
    }
    return inTime(naturalSizes.get(url), null)
  }

  // ------------------------------------------------------ dragging things out

  addEventListener('dragstart', event => {
    const t = event.target
    const el = t.nodeType === 1 ? t : t.parentElement
    const a = el?.closest?.('a[href]')
    const img = el?.tagName === 'IMG' ? el : null
    send('drag', {
      url: a ? toReal(a.href) : null,
      img: img ? toReal(img.currentSrc || img.src) : null,
      text: !a && !img ? String(getSelection() || '').trim().slice(0, 4000) : '',
      label: a ? (a.textContent || '').trim().slice(0, 120) : '',
    })
  }, true)
  addEventListener('dragend', () => send('dragend'), true)
  addEventListener('dragenter', () => send('drag'), true)
  // Dropping a link onto a page would load it there, in the page's place.
  addEventListener('drop', event => {
    if (!event.target.closest?.('input, textarea, [contenteditable=""], [contenteditable="true"]')) event.preventDefault()
  }, true)

  // ------------------------------------------------------------ from the canvas

  // The page as it is now, to stand in for it while it sleeps: its own markup
  // and stylesheets with every script taken out, what was typed kept, its
  // own frames copied the same way, other sites' frames as empty boxes,
  // players stopped, drawings as pictures of themselves, and where it was
  // scrolled to. It is shown where nothing can run.
  function snapshot() {
    // Frames from other sites can't be copied. A page that is mostly those
    // would sleep as a page of empty boxes: it stays awake instead.
    const view = innerWidth * innerHeight
    const foreign = [...document.querySelectorAll('iframe, frame, object, embed')].reduce((area, f) => {
      if (f.contentDocument && f.tagName !== 'OBJECT' && f.tagName !== 'EMBED') return area
      const r = f.getBoundingClientRect()
      return area + Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0))
    }, 0)
    if (foreign > view / 2) return { busy: true }
    const { doc, doctype } = copyDocument(document)
    // As HTML, with the page's own doctype, when the HTML parser builds the
    // same page from it: it then reads exactly as the page did. A page built
    // by script can hold what the parser would build differently (a div
    // inside a p closes the p); that one goes as XML, which comes back exactly.
    const html = doctype + doc.outerHTML
    const names = root => [root, ...root.querySelectorAll('*')].map(e => e.localName).join(' ')
    const as = { sx: scrollX, sy: scrollY, text: textOf() }
    if (names(new DOMParser().parseFromString(html, 'text/html').documentElement) === names(doc)) return { html, ...as }
    // The XML goes only if it reads back (else the HTML after all). It is
    // read back here, not in the canvas: Chrome keeps a parsed document that
    // holds a <video> for as long as the window that parsed it, and this
    // page's window goes when it sleeps; the canvas's stays.
    const xml = new XMLSerializer().serializeToString(doc)
    if (new DOMParser().parseFromString(xml, 'application/xhtml+xml').querySelector('parsererror')) return { html, ...as }
    return { xml, ...as }
  }
  // A document's copy (its root element, not in any document) and doctype.
  function copyDocument(d) {
    const live = [d.documentElement, ...d.documentElement.querySelectorAll('*')]
    const doc = d.documentElement.cloneNode(true)
    const copy = [doc, ...doc.querySelectorAll('*')]
    const styleOf = el => d.defaultView.getComputedStyle(el)
    // Animations go on from where they are instead of starting over: a copy
    // shows the page as it is, not how it arrived. Each one's delay is moved
    // back by how far it has run (those a script made don't exist in a copy).
    const ran = new Map() // element -> { animation name: ms run }
    for (const an of d.getAnimations()) {
      const el = an.effect?.target
      if (!an.animationName || !el || an.effect.pseudoElement || an.currentTime == null) continue
      if (!ran.has(el)) ran.set(el, {})
      ran.get(el)[an.animationName] = an.currentTime
    }
    live.forEach((o, i) => {
      const c = copy[i]
      if (c !== doc && !doc.contains(c)) return // inside something left out
      if (/^(SCRIPT|NOSCRIPT|TEMPLATE)$/.test(o.tagName)) return c.remove()
      for (const a of [...c.attributes]) if (/^on/i.test(a.name)) c.removeAttribute(a.name)
      if (ran.has(o)) {
        const cs = styleOf(o)
        const delays = split(cs.animationDelay)
        c.style.animationDelay = split(cs.animationName).map((name, k) => `${parseFloat(delays[k % delays.length]) * 1000 - (ran.get(o)[name] ?? 0)}ms`).join(', ')
      }
      // A stylesheet as the page wrote it, while that is still what the
      // browser holds: Chrome writes some rules back wrong (a shorthand
      // holding var() comes out empty). One from an address loads from where
      // the page's did; one a script built or changed is written out from
      // what the browser holds.
      if (o.sheet && (o.tagName === 'STYLE' || /stylesheet/i.test(o.rel || ''))) {
        if (o.sheet.disabled) return c.remove()
        if (o.tagName === 'LINK' && o.sheet.href) return c.setAttribute('href', o.sheet.href)
        if (o.tagName === 'STYLE' && asWritten(o)) return
        const style = d.createElement('style')
        if (o.media) style.media = o.media
        style.textContent = liveRules(o.sheet, d)
        return c.replaceWith(style)
      }
      // a frame of the page's own, copied the same way and shown in its place
      if (o.tagName === 'IFRAME' && o.contentDocument?.documentElement) {
        const inner = copyDocument(o.contentDocument)
        c.removeAttribute('src')
        return c.setAttribute('srcdoc', inner.doctype + inner.doc.outerHTML)
      }
      // The rest keep their tags, so the page's styles for them still hold;
      // only what would load or play is stopped. A drawing shows a picture
      // of itself; a player shows its poster; another site's frame is an
      // empty box, faintly shaded.
      if (o.tagName === 'CANVAS') {
        try {
          c.style.background = `url("${o.toDataURL()}") 0 0 / 100% 100% no-repeat`
        } catch {} // drawn from another site's pictures: it can't be read
        return
      }
      if (/^(VIDEO|AUDIO)$/.test(o.tagName)) {
        c.removeAttribute('autoplay')
        return c.setAttribute('preload', 'none')
      }
      if (o.tagName === 'IFRAME') {
        c.removeAttribute('src')
        c.setAttribute('srcdoc', '')
        return (c.style.background = '#0001')
      }
      if (/^(OBJECT|EMBED)$/.test(o.tagName)) {
        const r = o.getBoundingClientRect()
        const box = d.createElement('div')
        const display = styleOf(o).display
        box.setAttribute('style', `${o.getAttribute('style') || ''};display:${display === 'inline' ? 'inline-block' : display};width:${r.width}px;height:${r.height}px;background:#0001`)
        if (o.className && typeof o.className === 'string') box.className = o.className
        return c.replaceWith(box)
      }
      if (o.tagName === 'INPUT' && !/^(password|file)$/i.test(o.type)) {
        c.setAttribute('value', o.value)
        o.checked ? c.setAttribute('checked', '') : c.removeAttribute('checked')
      }
      if (o.tagName === 'TEXTAREA') c.textContent = o.value
      if (o.tagName === 'SELECT') [...c.options].forEach((opt, j) => (j === o.selectedIndex ? opt.setAttribute('selected', '') : opt.removeAttribute('selected')))
    })
    for (const sheet of d.adoptedStyleSheets || []) {
      const style = d.createElement('style')
      try {
        style.textContent = liveRules(sheet, d)
        doc.querySelector('head')?.append(style)
      } catch {}
    }
    // Nothing in a copy changes (no scripts, no pointer), so a transition in
    // it could only animate the copy settling as it loads.
    const still = d.createElement('style')
    still.textContent = '*,*::before,*::after{transition:none!important}'
    doc.querySelector('head')?.append(still)
    // The copy is shown from elsewhere: its addresses are read against the page's.
    const base = d.createElement('base')
    base.setAttribute('href', d.baseURI)
    doc.querySelector('head')?.prepend(base)
    xmlSafe(doc)
    const dt = d.doctype
    const doctype = dt ? `<!DOCTYPE ${dt.name}${dt.publicId ? ` PUBLIC "${dt.publicId}"` : dt.systemId ? ' SYSTEM' : ''}${dt.systemId ? ` "${dt.systemId}"` : ''}>` : ''
    return { doc, doctype }
  }
  // whether a <style>'s own text still makes the rules the browser holds
  function asWritten(style) {
    const parsed = new CSSStyleSheet()
    try {
      parsed.replaceSync(style.textContent) // leaves out @import rules: counted apart
    } catch {
      return false
    }
    return parsed.cssRules.length + (style.textContent.match(/@import\b/g) || []).length === style.sheet.cssRules.length
  }
  // Waits for the page to stop changing (a moment with no changes to it), so
  // a copy isn't caught mid-animation. A page that keeps changing is alive:
  // it says so, and stays awake.
  function whenStill(then) {
    let quiet = setTimeout(done, 800)
    const giveUp = setTimeout(() => done(false), 4000)
    const watch = new MutationObserver(() => {
      clearTimeout(quiet)
      quiet = setTimeout(done, 800)
    })
    watch.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true })
    function done(ok = true) {
      watch.disconnect()
      clearTimeout(quiet)
      clearTimeout(giveUp)
      then(ok)
    }
  }
  // A stylesheet as the browser holds it now (scripts may have changed it,
  // switched it off, or built it), its addresses made absolute.
  function liveRules(sheet, d = document) {
    const base = sheet.href || d.baseURI
    return [...sheet.cssRules].map(r => r.cssText.replace(/url\((['"]?)([^'")]+)\1\)/g, (m, q, u) => (/^(data|blob):/.test(u) ? m : `url("${new URL(u, base).href}")`))).join('\n')
  }
  // the canvas never puts a page to sleep while it is playing
  for (const [type, playing] of [['play', true], ['pause', false], ['ended', false]]) {
    addEventListener(type, () => send('media', { playing: [...document.querySelectorAll('video, audio')].some(m => !m.paused) || playing }), true)
  }

  // ------------------------------------------------ frames inside the page
  // What a frame of this page tells the canvas passes up through each frame
  // it is in, which moves its places (a link's, a cut piece's, the pointer's)
  // from the frame's view into its own. A frame's address, scroll and
  // loading are its own, not the page's, so they stay. The canvas asks back
  // about links and pieces by numbers (req) and selectors that mean
  // something only in the frame they came from, so those are left out.
  const FROM_FRAMES = new Set(['hello', 'touch', 'took-focus', 'open', 'zoom', 'key', 'clip', 'holding', 'copied', 'drag', 'dragend', 'media', 'show', 'cutting'])
  function fromFrame(v, dx, dy) {
    if (Array.isArray(v)) return v.map(x => fromFrame(x, dx, dy))
    if (!v || typeof v !== 'object') return v
    const o = {}
    for (const [k, x] of Object.entries(v)) if (k !== 'req' && k !== 'selector') o[k] = fromFrame(x, dx, dy)
    if (typeof o.x === 'number' && typeof o.y === 'number') Object.assign(o, { x: o.x + dx, y: o.y + dy })
    return o
  }
  addEventListener('message', event => {
    const d = event.data
    if (d?.cb !== 1 || !FROM_FRAMES.has(d.type) || !URL.parse(event.origin)) return
    const f = [...document.querySelectorAll('frame, iframe')].find(f => f.contentWindow === event.source)
    if (!f) return
    const { cb, type, ...data } = d
    if (type === 'show' && !inner) return showIn(data.path, data.url)
    if (type === 'hello') return tellKeys(event.source) // the canvas's commands, as this page was told them
    const r = f.getBoundingClientRect()
    const s = getComputedStyle(f)
    send(type, fromFrame(data, r.left + f.clientLeft + parseFloat(s.paddingLeft), r.top + f.clientTop + parseFloat(s.paddingTop)))
  })

  addEventListener('message', event => {
    if (event.origin !== APP || event.source !== parent) return
    const d = event.data
    if (!d || d.cb !== 1) return
    if (d.type === 'track') track(d)
    else if (d.type === 'untrack') {
      const els = tracked.get(d.child) || []
      tracked.delete(d.child)
      for (const el of els) if (![...tracked.values()].some(t => t.includes(el))) el.removeAttribute('data-cb-trail')
    } else if (d.type === 'flash') {
      flash(d.child, d.on)
    } else if (d.type === 'reveal') tracked.get(d.child)?.[0].scrollIntoView({ behavior: 'smooth', block: 'center' })
    else if (d.type === 'clip-start') startClip(d.quiet)
    else if (d.type === 'clip-stop') stopClip()
    else if (d.type === 'snapshot') whenStill(ok => send('snapshot', ok ? snapshot() : { busy: true }))
    else if (d.type === 'let-go') letGo()
    else if (d.type === 'scroll-to') {
      scrollTo(d.x, d.y)
      addEventListener('load', () => scrollTo(d.x, d.y), { once: true })
    } else if (d.type === 'find') {
      // again once its pictures have their sizes (or its scripts have written
      // it), unless a press in it has taken the mark away
      const found = find(d.pattern)
      if (document.readyState !== 'complete') addEventListener('load', () => (!found || marked.has('cb-found')) && find(d.pattern), { once: true })
    }
  })
})()
