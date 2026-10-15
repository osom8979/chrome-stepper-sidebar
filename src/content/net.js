/**
 * 시연 페이지의 MAIN world 에 들어가는 content script. snapshot.js 의 준비 판정을 돕는다.
 *
 * isolated world 의 content script 는 페이지의 fetch 와 history 를 볼 수 없어서,
 * 여기서 감싸 두고 window 이벤트로 알린다.
 *
 *   chrome-stepper-sidebar:net    detail = 진행 중인 fetch/XHR 수
 *   chrome-stepper-sidebar:route  pushState / replaceState / popstate 로 주소가 바뀌었을 수 있음
 *   chrome-stepper-sidebar:ping   (받는 쪽) 지금 요청 수를 다시 알려 달라
 *
 * 페이지 스크립트보다 먼저 감싸도록 document_start 에 등록한다. 다시 넣어도 한 번만 감싼다.
 */
;(() => {
  const FLAG = Symbol.for('chrome-stepper-sidebar.net')
  if (window[FLAG]) return
  window[FLAG] = true

  const emit = (name, detail) => window.dispatchEvent(new CustomEvent(`chrome-stepper-sidebar:${name}`, { detail }))
  let pending = 0
  const opened = () => emit('net', ++pending)
  const closed = () => emit('net', (pending = Math.max(0, pending - 1)))

  // fetch 는 헤더가 오면 끝난 것으로 본다. 본문을 읽고 그리는 동안은 DOM 변경이 이어 받는다.
  const { fetch } = window
  if (typeof fetch === 'function') {
    window.fetch = function (...args) {
      opened()
      let result
      try {
        result = fetch.apply(this, args)
      } catch (e) {
        closed()
        throw e
      }
      result.then(closed, closed)
      return result
    }
  }

  const { send } = XMLHttpRequest.prototype
  XMLHttpRequest.prototype.send = function (...args) {
    opened()
    this.addEventListener('loadend', closed, { once: true })
    try {
      return send.apply(this, args)
    } catch (e) {
      this.removeEventListener('loadend', closed)
      closed()
      throw e
    }
  }

  for (const name of ['pushState', 'replaceState']) {
    const original = history[name]
    history[name] = function (...args) {
      const result = original.apply(this, args)
      emit('route')
      return result
    }
  }
  window.addEventListener('popstate', () => emit('route'))
  window.addEventListener('chrome-stepper-sidebar:ping', () => emit('net', pending))
})()
