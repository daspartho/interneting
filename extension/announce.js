// On a canvas page (canvases.js), before its own scripts: tells the canvas
// the add-on is here, and passes on what the canvas asks of it.
//
// The canvas sees data-canvas-bridge="<version>" on its <html>, and a
// `canvas-bridge` event on its document when the add-on arrives (or is
// updated) while it is open. It asks with
//   postMessage({ canvasBridge: 'ask', id, ask: { type, ... } }, its origin)
// and is answered (see background.js for what it may ask)
//   { canvasBridge: 'answer', id, value } or { canvasBridge: 'answer', id, error }
;(() => {
  const me = {}
  globalThis.canvasBridge = me // the newest of these answers (an add-on updated leaves the old one behind, cut off)
  document.documentElement.setAttribute('data-canvas-bridge', chrome.runtime.getManifest().version)
  addEventListener('message', async e => {
    const d = e.data
    if (e.source !== window || d?.canvasBridge !== 'ask' || globalThis.canvasBridge !== me || !chrome.runtime?.id) return
    let answer
    try {
      answer = await chrome.runtime.sendMessage(d.ask)
    } catch (err) {
      answer = { error: String(err?.message || err) }
    }
    postMessage({ canvasBridge: 'answer', id: d.id, ...answer }, location.origin)
  })
  document.dispatchEvent(new CustomEvent('canvas-bridge'))
})()
