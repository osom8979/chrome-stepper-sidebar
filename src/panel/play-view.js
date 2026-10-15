/**
 * 진행 화면. 저장소를 그리기만 하고, 동작은 background 로 메시지를 보낸다.
 *
 * 단계 오른쪽에 로딩 상태(불러오는 중이면 경과 시간, 끝났으면 마지막 로딩 시간)와 스냅샷 썸네일을 둔다.
 * 지금 단계의 스냅샷 칸은 버튼이라, 누르면 지금 화면을 그 단계의 스냅샷으로 찍는다.
 */
import { h } from './dom.js'
import { compile } from '../shared/scenario.js'
import { activeScenario, getLibrary, getProgress, getStepRecords } from '../shared/store.js'

// 패널에 포커스가 있으면 프레젠터 리모컨(PageUp/PageDown)과 화살표로도 넘긴다.
// 수식키가 붙은 입력은 전역 단축키(manifest commands)에 맡긴다.
const KEY_DELTA = { PageDown: 1, ArrowDown: 1, ArrowRight: 1, PageUp: -1, ArrowUp: -1, ArrowLeft: -1 }

// 페이지가 준비를 알리지 못하면(content script 가 없는 페이지 등) 이 시간이 지나 불러오는 중 표시를 거둔다.
// content script 의 LIMIT(10초)보다 넉넉하게 둔다.
const LOADING_STALE = 20000

export function createPlayView(root, { send, notify, setCounter, onEdit, onNewScenario }) {
  const offScript = h('p', { class: 'banner', hidden: true }, '시나리오에 없는 화면입니다. 단계를 누르면 돌아갑니다.')
  const empty = h('div', { class: 'empty', hidden: true })
  const list = h('ol', {
    class: 'steps',
    onclick: async (event) => {
      const capture = event.target.closest('[data-capture]')
      if (capture) {
        if (await send({ type: 'capture', stepId: capture.dataset.capture })) notify('스냅샷을 찍었습니다')
        return
      }
      // 줄 어디를 눌러도 그 단계로 간다 (오른쪽 상태 칸 포함).
      const button = event.target.closest('.step')?.querySelector('[data-id]')
      if (button && !button.disabled) send({ type: 'goto', stepId: button.dataset.id })
    },
  })
  const note = h('section', { class: 'note', hidden: true })
  const prev = h('button', { type: 'button', onclick: () => send({ type: 'move', delta: -1 }) }, '이전')
  const next = h('button', { type: 'button', class: 'primary', onclick: () => send({ type: 'move', delta: 1 }) }, '다음')
  let shownId = null
  let ticker = null

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
    const [progress, records] = await Promise.all([
      getProgress(),
      getStepRecords(scenario?.id, steps.map((s) => s.id)),
    ])
    const current = steps.findIndex((step) => step.id === progress.currentId)
    const step = steps[current]
    const loading = activeLoading(progress.loading, scenario)

    setCounter(steps.length ? `${current === -1 ? '-' : current + 1} / ${steps.length}` : '')
    renderEmpty(scenario, steps)
    offScript.hidden = !(steps.length && progress.offScript)
    root.classList.toggle('off-script', Boolean(progress.offScript))

    list.replaceChildren(
      ...steps.flatMap((s) =>
        stepItems(s, {
          current,
          snapshot: records.snapshots[s.id],
          load: records.loads[s.id],
          loading: loading?.stepId === s.id ? loading : null,
          // 탭이 그 단계 화면일 때만 찍을 수 있다.
          capturable: s.index === current && !progress.offScript,
        }),
      ),
    )
    note.hidden = !step?.note.trim()
    note.textContent = step?.note ?? ''
    prev.disabled = current <= 0
    next.disabled = !steps.length || current >= steps.length - 1

    // 로딩·스냅샷이 바뀔 때마다 다시 그리므로, 단계가 바뀐 때만 따라 내린다. 사용자가 올려 둔 목록을 끌어내리지 않는다.
    if (step?.id !== shownId) {
      shownId = step?.id
      list.querySelector('[data-state="current"]')?.scrollIntoView({ block: 'nearest' })
    }
    clearInterval(ticker)
    ticker = loading ? setInterval(tick, 100) : null
  }

  /** 불러오는 중 표시의 경과 시간만 갱신한다. 너무 오래되면 다시 그려서 거둔다. */
  function tick() {
    for (const badge of list.querySelectorAll('[data-since]')) {
      const elapsed = Date.now() - Number(badge.dataset.since)
      if (elapsed > LOADING_STALE) {
        render()
        return
      }
      badge.textContent = seconds(elapsed)
    }
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

  return {
    render,
    destroy() {
      clearInterval(ticker)
      document.removeEventListener('keydown', onKey)
    },
  }
}

function activeLoading(loading, scenario) {
  if (!loading || loading.scenarioId !== scenario?.id) return null
  return Date.now() - loading.startedAt < LOADING_STALE ? loading : null
}

function stepItems(step, { current, snapshot, load, loading, capturable }) {
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
  const aside = h('div', { class: 'step__aside' }, loadBadge(load, loading), snapBadge(step, snapshot, capturable))
  const item = h('li', { class: 'step', dataset: { state } }, button, aside)
  return step.section === null ? [item] : [h('li', { class: 'section' }, step.section), item]
}

function loadBadge(load, loading) {
  if (loading) {
    return h(
      'span',
      {
        class: `load load--active${loading.overlay ? ' load--overlay' : ''}`,
        title: loading.overlay ? '스냅샷을 보여 주며 불러오는 중' : '불러오는 중',
        dataset: { since: loading.startedAt },
      },
      seconds(Date.now() - loading.startedAt),
    )
  }
  if (!load) return h('span', { class: 'load' })
  if (load.timedOut) {
    const limit = Math.round(load.ms / 1000)
    return h(
      'span',
      { class: 'load load--timeout', title: `${limit}초 안에 준비되지 않았습니다. 자동 스냅샷은 건너뛰었습니다.` },
      `${limit}s+`,
    )
  }
  return h('span', { class: 'load', title: `마지막 로딩 ${(load.ms / 1000).toFixed(2)}초 · ${time(load.at)}` }, seconds(load.ms))
}

function snapBadge(step, snapshot, capturable) {
  const lines = [
    snapshot
      ? `스냅샷 ${date(snapshot.at)} · ${snapshot.width}×${snapshot.height} · ${snapshot.manual ? '수동' : '자동'}`
      : '스냅샷 없음',
  ]
  if (capturable) lines.push(snapshot ? '누르면 지금 화면으로 다시 찍습니다' : '누르면 지금 화면을 찍습니다')
  const props = {
    class: ['snap', snapshot && 'has-image', snapshot?.manual && 'is-manual'].filter(Boolean).join(' '),
    title: lines.join('\n'),
  }
  const content = snapshot ? h('img', { src: snapshot.thumb, alt: '' }) : capturable ? '찍기' : null
  return capturable
    ? h('button', { ...props, type: 'button', dataset: { capture: step.id } }, content)
    : h('span', props, content)
}

const seconds = (ms) => `${(ms / 1000).toFixed(1)}s`
const time = (at) => new Date(at).toLocaleTimeString('ko-KR')
const date = (at) =>
  new Date(at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
