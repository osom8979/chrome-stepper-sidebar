/**
 * 작은 DOM 도우미. 빌드 단계 없이 압축해제 확장으로 바로 올리려고 프레임워크 대신 둔다.
 */

/**
 * h('button', { class: 'primary', onclick }, '저장')
 *
 * 자식을 먼저 붙이고 속성을 나중에 넣는다. select 의 value 는 option 이 있어야 먹기 때문이다.
 * on 으로 시작하는 함수 속성은 이벤트로, 그 밖에 요소 프로퍼티면 프로퍼티로, 아니면 속성으로 넣는다.
 */
export function h(tag, props, ...children) {
  const node = document.createElement(tag)
  node.append(...children.flat(Infinity).filter((child) => child != null && child !== false))
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null) continue
    if (key === 'class') node.className = value
    else if (key === 'dataset') Object.assign(node.dataset, value)
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value)
    else if (key in node) node[key] = value
    else node.setAttribute(key, value)
  }
  return node
}

/**
 * 두 번 눌러야 실행되는 버튼. 첫 클릭은 문구만 바꾸고 3초 뒤 되돌린다.
 * needsConfirm() 이 false 면 확인 없이 바로 실행한다.
 */
export function confirmTwice(button, armedLabel, action, needsConfirm = () => true) {
  const idle = button.textContent
  let timer = null
  const reset = () => {
    clearTimeout(timer)
    delete button.dataset.armed
    button.textContent = idle
  }
  button.addEventListener('click', (event) => {
    if (button.dataset.armed || !needsConfirm()) {
      reset()
      action(event)
      return
    }
    button.dataset.armed = 'true'
    button.textContent = armedLabel
    timer = setTimeout(reset, 3000)
  })
  return button
}
