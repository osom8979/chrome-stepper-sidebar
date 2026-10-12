/**
 * 브라우저 확장 API 진입점.
 *
 * Firefox 는 browser.* 가 Promise 를 돌려주고 chrome.* 는 콜백 방식이다.
 * Chrome 은 chrome.* 가 Promise 를 돌려준다. 둘 다 Promise 로 쓰려고 여기서 고른다.
 */
export const api = globalThis.browser ?? globalThis.chrome
