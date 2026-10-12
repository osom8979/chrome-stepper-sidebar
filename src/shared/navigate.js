/**
 * 탭을 url 로 옮긴다.
 *
 * - spa: 같은 사이트면 페이지 안에서 history.pushState + popstate 를 일으켜
 *   React Router 가 새로고침 없이 이동하게 한다. 실패하면 reload 로 대신한다.
 * - reload: 탭 주소를 바꿔 새로 불러온다.
 * - newtab: 현재 탭 바로 오른쪽에 새 탭을 연다.
 */
import { api } from './api.js'

export async function navigate(tab, url, mode) {
  if (mode === 'newtab') {
    await api.tabs.create({ url, windowId: tab.windowId, index: tab.index + 1 })
    return
  }
  const target = new URL(url)
  if (mode === 'spa' && originOf(tab.url) === target.origin && target.origin !== 'null') {
    try {
      await api.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: pushRoute,
        args: [target.pathname + target.search + target.hash],
      })
      return
    } catch (e) {
      console.warn('SPA 이동에 실패해 새로 불러오기로 대신합니다', e)
    }
  }
  await api.tabs.update(tab.id, { url })
}

/**
 * 페이지(MAIN world) 안에서 실행된다. 직렬화되어 넘어가므로 바깥 변수를 쓰면 안 된다.
 *
 * 상태 객체 { usr, key, idx } 는 React Router 의 createBrowserHistory 가 쓰는 모양을
 * 흉내 낸 것이다. idx 를 이어 붙여야 라우터의 히스토리 인덱스가 어긋나지 않는다.
 */
function pushRoute(path) {
  const idx = (window.history.state?.idx ?? 0) + 1
  const state = { usr: null, key: Math.random().toString(36).slice(2, 10), idx }
  window.history.pushState(state, '', path)
  window.dispatchEvent(new PopStateEvent('popstate', { state }))
}

function originOf(href) {
  try {
    return new URL(href).origin
  } catch {
    return null
  }
}
