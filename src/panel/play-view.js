/**
 * 진행 화면. 저장소를 그리기만 하고, 동작은 background 로 메시지를 보낸다.
 */
import { h } from './dom.js'
import { compile } from '../shared/scenario.js'
import { activeScenario, getLibrary, getProgress } from '../shared/store.js'

// 패널에 포커스가 있으면 프레젠터 리모컨(PageUp/PageDown)과 화살표로도 넘긴다.
// 수식키가 붙은 입력은 전역 단축키(manifest commands)에 맡긴다.
const KEY_DELTA = { PageDown: 1, ArrowDown: 1, ArrowRight: 1, PageUp: -1, ArrowUp: -1, ArrowLeft: -1 }

export function createPlayView(root, { send, setCounter, onEdit, onNewScenario }) {
  const offScript = h('p', { class: 'banner', hidden: true }, '시나리오에 없는 화면입니다. 단계를 누르면 돌아갑니다.')
  const empty = h('div', { class: 'empty', hidden: true })
  const list = h('ol', {
    class: 'steps',
    onclick: (event) => {
      const button = event.target.closest('[data-id]')
      if (button && !button.disabled) send({ type: 'goto', stepId: button.dataset.id })
    },
  })
  const note = h('section', { class: 'note', hidden: true })
  const prev = h('button', { type: 'button', onclick: () => send({ type: 'move', delta: -1 }) }, '이전')
  const next = h('button', { type: 'button', class: 'primary', onclick: () => send({ type: 'move', delta: 1 }) }, '다음')

  root.replaceChildren(offScript, empty, list, h('footer', { class: 'dock' }, note, h('div', { class: 'nav' }, prev, next)))

  const onKey = (event) => {
    const delta = KEY_DELTA[event.key]
    if (!delta || event.altKey || event.ctrlKey || event.metaKey) return
    if (event.target.closest?.('input, select, textarea, details')) return
    event.preventDefault()
    send({ type: 'move', delta })
  }
  document.addEventListener('keydown', onKey)

  async function render() {
    const scenario = activeScenario(await getLibrary())
    const steps = scenario ? compile(scenario).steps : []
    const progress = await getProgress()
    const current = steps.findIndex((step) => step.id === progress.currentId)
    const step = steps[current]

    setCounter(steps.length ? `${current === -1 ? '-' : current + 1} / ${steps.length}` : '')
    renderEmpty(scenario, steps)
    offScript.hidden = !(steps.length && progress.offScript)
    root.classList.toggle('off-script', Boolean(progress.offScript))

    list.replaceChildren(...steps.flatMap((s) => stepItems(s, current)))
    note.hidden = !step?.note.trim()
    note.textContent = step?.note ?? ''
    prev.disabled = current <= 0
    next.disabled = !steps.length || current >= steps.length - 1

    list.querySelector('[data-state="current"]')?.scrollIntoView({ block: 'nearest' })
  }

  function renderEmpty(scenario, steps) {
    empty.hidden = steps.length > 0
    if (!scenario) {
      empty.replaceChildren(
        h('p', null, '시나리오가 없습니다.'),
        h('button', { type: 'button', class: 'primary', onclick: onNewScenario }, '새 시나리오 만들기'),
      )
    } else if (!steps.length) {
      empty.replaceChildren(
        h('p', null, '단계가 없습니다.'),
        h('button', { type: 'button', class: 'primary', onclick: onEdit }, '편집해서 추가하기'),
      )
    }
  }

  return { render, destroy: () => document.removeEventListener('keydown', onKey) }
}

function stepItems(step, current) {
  const state = step.index < current ? 'done' : step.index === current ? 'current' : 'todo'
  const button = h(
    'button',
    {
      class: 'step__btn',
      type: 'button',
      title: step.url ?? 'URL 이 올바르지 않아 이동할 수 없습니다',
      disabled: !step.url,
      dataset: { id: step.id },
    },
    h('span', { class: 'step__dot' }, state === 'done' ? '✓' : String(step.index + 1)),
    h('span', { class: 'step__title' }, step.title),
    h('span', { class: 'step__path' }, step.display || 'URL 오류'),
  )
  const item = h('li', { class: 'step', dataset: { state } }, button)
  return step.section === null ? [item] : [h('li', { class: 'section' }, step.section), item]
}
