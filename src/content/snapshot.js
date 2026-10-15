/**
 * 시연 페이지에 들어가는 content script (isolated world).
 *
 * - 단계로 이동할 때 그 단계의 스냅샷(지난번 화면 캡처)을 화면 전체에 덮어 두고,
 *   페이지가 준비되면 한 번에 걷어 낸다. 덮개가 떠 있는 동안 누르거나 키를 치면 바로 걷는다.
 * - 로딩이 시작되고 준비된 것을 background 에 알린다. background 는 로딩 시간을 기록하고 스냅샷을 새로 찍는다.
 *
 * 준비 판정: 문서 load 가 끝났고, 진행 중인 fetch/XHR 이 없고(net.js 가 알려 줌), 글꼴과 화면 안 이미지를
 * 다 받았고, DOM 변경과 네트워크 활동이 QUIET 동안 없으면 준비된 것으로 본다. style 속성 변경은
 * JS 애니메이션이 끝없이 일으키므로 셈하지 않는다. LIMIT 안에 준비되지 않으면 포기한다.
 *
 * 덮개를 띄우는 길은 둘이다.
 * - 새 문서(reload, newtab): background 가 이동 직전에 남긴 snapPending 힌트를 document_start 에 읽는다.
 * - 같은 문서(spa): background 가 pushState 직전에 expect() 를 부른다. 덮개를 씌운 뒤에 돌아간다.
 *
 * background 가 시나리오에 나오는 사이트에만 document_start 로 등록한다. 등록 전에 열린 페이지에는
 * spa 이동 직전에 executeScript 로 넣으므로 두 번 들어올 수 있고, 그러면 먼저 들어온 쪽만 돈다.
 * 모듈이 아니라 import 를 못 쓴다. 저장소 키 모양은 src/shared/store.js 와 맞춘다.
 */
;(() => {
  const KEY = '__chromeStepperSnapshot'
  const EVENT = 'chrome-stepper-sidebar:'
  const QUIET = 600 // 이만큼 아무 변화가 없으면 준비된 것으로 본다 (ms)
  const LIMIT = 10000 // 이 안에 준비되지 않으면 포기하고 덮개를 걷는다 (ms)
  const HINT_TTL = 10000 // background 가 남긴 이동 힌트를 믿는 시간 (ms)
  // 페이지 CSS 가 덮개를 건드리지 못하게 인라인 !important 로 둔다.
  const HOST_STYLE = [
    'all: initial',
    'display: block',
    'position: fixed',
    'inset: 0',
    'width: 100vw',
    'height: 100vh',
    'z-index: 2147483647',
    'cursor: progress',
  ]
    .map((rule) => `${rule} !important`)
    .join('; ')

  const api = globalThis.browser ?? globalThis.chrome
  // 확장을 새로고침하면 먼저 들어와 있던 스크립트는 끊긴다. 그때만 새로 들어온 쪽이 이어 받는다.
  const previous = globalThis[KEY]
  if (previous?.alive()) return
  previous?.dispose()

  let pending = 0 // 진행 중인 fetch/XHR 수 (net.js)
  let session = null // 지켜보는 로딩 한 번
  let expected = null // expect() 로 예고받은 spa 이동 주소. 그 주소로 바뀌는 것은 새 로딩으로 치지 않는다.
  let lastHref = location.href
  const hosts = new WeakSet()
  const cleanups = []
  const mutations = new MutationObserver((records) => {
    if (records.some(isPageChange)) activity()
  })
  const resources = new PerformanceObserver(() => activity())

  function listen(target, type, handler, options) {
    target.addEventListener(type, handler, options)
    cleanups.push(() => target.removeEventListener(type, handler, options))
  }

  // ---- 로딩 한 번 지켜보기 ---------------------------------------------------
  // start 는 performance.now() 기준, startedAt 은 패널이 경과 시간을 세는 Date.now() 기준이다.

  function begin(kind, start, startedAt, startHref) {
    end()
    session = { kind, start, startedAt, startHref, lastActivity: start, interacted: false, host: null, hadOverlay: false, done: false }
    session.timer = setInterval(check, 100)
    mutations.observe(document, { subtree: true, childList: true, attributes: true, characterData: true })
    resources.observe({ type: 'resource' })
    return session
  }

  /** 알리지 않고 그만둔다. 다른 이동이 끼어든 경우다. */
  function end() {
    if (session && !session.done) stop(session)
  }

  function stop(s) {
    s.done = true
    clearInterval(s.timer)
    mutations.disconnect()
    resources.disconnect()
    reveal(s)
    expected = null
  }

  function activity() {
    if (session && !session.done) session.lastActivity = performance.now()
  }

  function check() {
    const s = session
    const now = performance.now()
    if (now - s.start >= LIMIT) return finish(s, true)
    if (s.kind === 'document' && document.readyState !== 'complete') return
    if (pending > 0 || document.fonts?.status === 'loading') return
    if (now - s.lastActivity < QUIET || !imagesLoaded()) return
    finish(s, false)
  }

  function finish(s, timedOut) {
    stop(s)
    const report = {
      phase: 'ready',
      startedAt: s.startedAt,
      startHref: s.startHref,
      href: location.href,
      ms: Math.round(timedOut ? LIMIT : s.lastActivity - s.start),
      timedOut,
      pristine: !s.interacted,
      overlay: s.hadOverlay,
      viewport: viewport(),
    }
    // 덮개를 걷은 화면이 그려진 뒤에 알린다. background 가 이어서 화면을 찍는다.
    afterPaint(() => post(report))
  }

  function announce(s) {
    post({ phase: 'start', startedAt: s.startedAt, href: s.startHref, overlay: s.hadOverlay })
  }

  // 덮개를 붙이고 떼는 것과 style 속성 변경은 페이지 변화로 치지 않는다.
  function isPageChange(record) {
    if (record.type === 'attributes') return record.attributeName !== 'style'
    if (record.type === 'childList') return [...record.addedNodes, ...record.removedNodes].some((node) => !hosts.has(node))
    return true
  }

  /** 화면 안에 보이는 이미지를 다 받았는가. 화면 밖의 loading=lazy 이미지는 기다리지 않는다. */
  function imagesLoaded() {
    for (const image of document.images) {
      if (image.complete) continue
      const rect = image.getBoundingClientRect()
      if (rect.width && rect.height && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth) {
        return false
      }
    }
    return true
  }

  function onRoute() {
    const href = location.href
    if (href === lastHref) return
    const from = new URL(lastHref)
    lastHref = href
    if (href === expected) {
      expected = null
      return activity()
    }
    // 불러오는 중에 바뀌면 앱의 리다이렉트로 보고 같은 로딩으로 이어 간다.
    if (session && !session.done) return activity()
    // 검색어나 해시만 바뀐 것은 화면 이동이 아니다.
    if (from.pathname === new URL(href).pathname) return
    announce(begin('route', performance.now(), Date.now(), href))
  }

  // ---- 덮개 ----------------------------------------------------------------

  /** 저장된 스냅샷으로 덮개를 만든다. 없거나 화면 크기가 다르면 null. */
  async function snapshotHost(scenarioId, stepId) {
    const infoKey = `snapInfo:${scenarioId}:${stepId}`
    const imageKey = `snapImage:${scenarioId}:${stepId}`
    const stored = await api.storage.local.get([infoKey, imageKey])
    const info = stored[infoKey]
    const image = stored[imageKey]
    if (!info || !image || !sameViewport(info, viewport())) return null
    // <img src="data:..."> 는 페이지 CSP(img-src)에 막힐 수 있어 canvas 에 그린다.
    const bitmap = await createImageBitmap(toBlob(image))
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    canvas.style.cssText = 'display: block; width: 100%; height: 100%'
    canvas.getContext('2d').drawImage(bitmap, 0, 0)
    bitmap.close()
    const host = document.createElement('div')
    host.style.cssText = HOST_STYLE
    host.attachShadow({ mode: 'closed' }).append(canvas)
    hosts.add(host)
    return host
  }

  /** 새 문서: background 가 이 사이트로 이동시키면서 남긴 힌트가 있으면 그 단계의 덮개를 만든다. */
  async function hintedHost() {
    const { snapPending: hint } = await api.storage.local.get('snapPending')
    if (!hint || Date.now() - hint.at > HINT_TTL || new URL(hint.href).origin !== location.origin) return null
    api.storage.local.remove('snapPending').catch(() => {})
    return snapshotHost(hint.scenarioId, hint.stepId)
  }

  function cover(s, host) {
    if (!host || !document.documentElement || s !== session || s.done || s.interacted) return
    document.documentElement.append(host)
    s.host = host
    s.hadOverlay = true
  }

  function reveal(s = session) {
    if (!s) return
    s.host?.remove()
    s.host = null
  }

  // 덮개를 진짜 화면으로 알고 누르는 일을 막는다. 손댄 화면은 자동 스냅샷으로 찍지 않는다.
  function interact() {
    if (!session || session.done) return
    session.interacted = true
    reveal()
  }

  /** background 가 spa 이동 직전에 부른다. 덮개를 먼저 씌운 뒤 돌아간다. */
  async function expect({ scenarioId, stepId, href }) {
    const start = performance.now()
    const startedAt = Date.now()
    end()
    const host = await snapshotHost(scenarioId, stepId).catch(() => null)
    const s = begin('route', start, startedAt, href)
    expected = href
    cover(s, host)
    announce(s)
    return { overlay: s.hadOverlay }
  }

  // ---- 도우미 --------------------------------------------------------------

  const viewport = () => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio })

  // src/shared/capture.js 의 sameViewport 와 같은 규칙.
  const sameViewport = (a, b) =>
    Math.abs(a.width - b.width) <= 1 && Math.abs(a.height - b.height) <= 1 && a.dpr === b.dpr

  function toBlob(dataUrl) {
    const [head, body] = dataUrl.split(',', 2)
    const bytes = Uint8Array.from(atob(body), (char) => char.charCodeAt(0))
    return new Blob([bytes], { type: head.slice(5, head.indexOf(';')) })
  }

  function afterPaint(callback) {
    let called = false
    const once = () => {
      if (!called) {
        called = true
        callback()
      }
    }
    requestAnimationFrame(() => requestAnimationFrame(once))
    // 탭이 가려져 있으면 requestAnimationFrame 이 돌지 않는다.
    setTimeout(once, 250)
  }

  function post(message) {
    try {
      api.runtime.sendMessage({ type: 'page', ...message }).catch(() => {})
    } catch {
      // 확장을 새로고침하면 이 스크립트는 끊긴다.
      dispose()
    }
  }

  function alive() {
    try {
      return Boolean(api.runtime?.id)
    } catch {
      return false
    }
  }

  function dispose() {
    end()
    for (const cleanup of cleanups.splice(0)) cleanup()
  }

  // ---- 시작 ----------------------------------------------------------------

  listen(window, `${EVENT}net`, (event) => {
    pending = Number(event.detail) || 0
    activity()
  })
  listen(window, `${EVENT}route`, onRoute)
  listen(window, 'load', activity)
  for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
    listen(window, type, interact, { capture: true, passive: true })
  }
  window.dispatchEvent(new CustomEvent(`${EVENT}ping`))

  globalThis[KEY] = { alive, dispose, expect, reveal: interact }

  // document_start 에 들어왔으면 이 문서의 로딩을 지켜본다. executeScript 로 나중에 들어왔으면 expect() 를 기다린다.
  if (document.readyState === 'loading') {
    const s = begin('document', 0, Math.round(performance.timeOrigin), location.href)
    hintedHost()
      .catch(() => null)
      .then((host) => {
        cover(s, host)
        announce(s)
      })
  }
})()
