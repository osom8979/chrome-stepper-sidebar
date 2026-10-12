/**
 * 편집 화면. 활성 시나리오의 사본(draft)을 고치고, 저장할 때만 저장소에 쓴다.
 *
 * 입력 한 글자마다 전체를 다시 그리면 포커스가 날아가므로,
 * 값 입력은 draft 만 고치고 refresh() 로 요약·오류 표시만 갱신한다.
 * 순서·추가·삭제·펼침처럼 구조가 바뀔 때만 render() 로 다시 그린다.
 *
 * 폼과 Markdown 두 탭이 같은 draft 를 고친다. Markdown 탭은 파일 형식(markdown.js)과 같다.
 */
import { confirmTwice, h } from './dom.js'
import { fromMarkdown, toMarkdown } from '../shared/markdown.js'
import {
  MATCH,
  NAVIGATION,
  carryIds,
  httpOrigin,
  newId,
  newSection,
  newStep,
  normalizeScenario,
  resolveUrl,
  toStoredUrl,
  validate,
} from '../shared/scenario.js'

const NAVIGATION_OPTIONS = Object.entries(NAVIGATION)
const STEP_NAVIGATION_OPTIONS = [['inherit', '시나리오 기본값'], ...NAVIGATION_OPTIONS]
const MATCH_OPTIONS = Object.entries(MATCH)
const PATTERN_HINT = { prefix: '비우면 URL 의 경로를 씁니다', regex: '^/datasets/ds-[^/]+$' }

export function createEditView(root, { scenario, send, currentTab, onSave, onCancel }) {
  const original = JSON.stringify(scenario)
  let draft = structuredClone(scenario)
  let expandedId = null
  let textMode = false
  let textInitial = ''
  let dragId = null
  const rows = new Map() // item.id → { item, row, title, sub }
  const refs = {}

  const isDirty = () =>
    JSON.stringify(draft) !== original || (textMode && refs.text.value !== textInitial)

  function render() {
    rows.clear()
    const body = textMode ? textEditor() : [settings(), itemList(), addBar()]
    root.replaceChildren(h('div', { class: 'edit-scroll' }, modeSwitch(), body), footer())
    refresh()
  }

  // ---- 시나리오 설정 -------------------------------------------------------

  function settings() {
    refs.baseUrl = h('input', {
      value: draft.baseUrl,
      placeholder: 'https://app.example.com',
      oninput: (event) => {
        draft.baseUrl = event.target.value
        refresh()
      },
    })
    return h(
      'section',
      { class: 'card' },
      field(
        '시나리오 제목',
        h('input', {
          value: draft.title,
          oninput: (event) => {
            draft.title = event.target.value
            refresh()
          },
        }),
      ),
      field('기본 URL', h('div', { class: 'inline' }, refs.baseUrl, button('현재 탭', useTabOrigin))),
      field(
        '기본 이동 방식',
        select(NAVIGATION_OPTIONS, draft.navigation, (value) => {
          draft.navigation = value
          refresh()
        }),
      ),
    )
  }

  async function useTabOrigin() {
    const origin = httpOrigin((await currentTab())?.url)
    if (!origin) return
    draft.baseUrl = origin
    refs.baseUrl.value = origin
    refresh()
  }

  // ---- 폼 / Markdown 전환 ---------------------------------------------------

  function modeSwitch() {
    const tab = (label, text) =>
      h('button', { type: 'button', class: textMode === text ? 'is-active' : '', onclick: () => switchMode(text) }, label)
    return h('div', { class: 'segmented' }, tab('폼', false), tab('Markdown', true))
  }

  function switchMode(text) {
    if (text === textMode) return
    if (!text && !applyText()) return
    textMode = text
    render()
  }

  function textEditor() {
    textInitial = toMarkdown([draft], { header: false })
    refs.text = h('textarea', { class: 'markdown', spellcheck: false, value: textInitial, oninput: () => refresh() })
    refs.textError = h('div', { class: 'banner banner--error', hidden: true })
    return [h('p', { class: 'hint' }, '파일 형식과 같습니다. # 은 시나리오 하나만 둡니다.'), refs.text, refs.textError]
  }

  /** Markdown 탭의 글을 draft 에 반영한다. 경고가 하나라도 있으면 반영하지 않는다. */
  function applyText() {
    if (!textMode) return true
    const showError = (lines) => {
      refs.textError.replaceChildren(...lines.map((line) => h('div', null, line)))
      refs.textError.hidden = false
      return false
    }
    const { scenarios, warnings } = fromMarkdown(refs.text.value, draft.title)
    if (warnings.length) return showError(warnings)
    if (scenarios.length !== 1) return showError([`# 시나리오가 ${scenarios.length}개입니다. 하나만 두세요.`])
    const [parsed] = scenarios
    draft = { ...parsed, id: draft.id, items: carryIds(draft.items, parsed.items) }
    return true
  }

  // ---- 단계 목록 -----------------------------------------------------------

  function itemList() {
    if (!draft.items.length) return h('p', { class: 'hint' }, '아직 단계가 없습니다. 아래 버튼으로 추가하세요.')
    let number = 0
    return h(
      'ol',
      { class: 'items' },
      draft.items.map((item) => itemRow(item, item.type === 'step' ? ++number : null)),
    )
  }

  function itemRow(item, number) {
    const expanded = item.id === expandedId
    const title = h('span', { class: 'item__title' })
    const sub = h('span', { class: 'item__sub' })
    const handle = h(
      'span',
      {
        class: 'handle',
        draggable: true,
        title: '끌어서 순서 바꾸기',
        onclick: (event) => event.stopPropagation(),
        ondragstart: (event) => startDrag(event, item, row),
        ondragend: endDrag,
      },
      '⠿',
    )
    const summary = h(
      'div',
      { class: 'item__summary', onclick: () => toggle(item.id) },
      handle,
      h('span', { class: 'item__badge' }, number ?? '§'),
      h('span', { class: 'item__text' }, title, sub),
      h('span', { class: 'item__chevron' }, expanded ? '▾' : '▸'),
    )
    const row = h(
      'li',
      {
        class: `item item--${item.type}${expanded ? ' is-open' : ''}`,
        ondragover: (event) => dragOver(event, item, row),
        ondragleave: () => row.classList.remove('drop-before', 'drop-after'),
        ondrop: (event) => drop(event, item, row),
      },
      summary,
      expanded ? (item.type === 'step' ? stepForm(item) : sectionForm(item)) : null,
    )
    rows.set(item.id, { item, row, title, sub })
    return row
  }

  function toggle(id) {
    expandedId = expandedId === id ? null : id
    render()
  }

  function stepForm(step) {
    const titleInput = textInput(step, 'title', '단계 이름')
    const urlInput = textInput(step, 'url', '/path 또는 https://...')
    const pattern = h('input', {
      value: step.match.pattern,
      hidden: step.match.mode === 'exact',
      placeholder: PATTERN_HINT[step.match.mode] ?? '',
      oninput: (event) => {
        step.match.pattern = event.target.value
        refresh()
      },
    })
    const fromTab = async () => {
      const tab = await currentTab()
      if (!tab?.url) return
      step.url = toStoredUrl(tab.url, draft.baseUrl)
      urlInput.value = step.url
      if (!step.title) {
        step.title = tab.title ?? ''
        titleInput.value = step.title
      }
      refresh()
    }
    return h(
      'div',
      { class: 'form' },
      field('제목', titleInput),
      field('URL', h('div', { class: 'inline' }, urlInput, button('현재 URL', fromTab))),
      field(
        '현재 단계 판정',
        select(MATCH_OPTIONS, step.match.mode, (mode) => {
          step.match.mode = mode
          pattern.hidden = mode === 'exact'
          pattern.placeholder = PATTERN_HINT[mode] ?? ''
          refresh()
        }),
        pattern,
      ),
      field(
        '이동 방식',
        select(STEP_NAVIGATION_OPTIONS, step.navigation, (value) => {
          step.navigation = value
          refresh()
        }),
      ),
      field('발표 메모', h('textarea', { rows: 3, value: step.note, oninput: (event) => { step.note = event.target.value; refresh() } })),
      itemActions(step, button('열어 보기', () => preview(step))),
    )
  }

  function sectionForm(section) {
    return h('div', { class: 'form' }, field('구분 제목', textInput(section, 'title', '예: 데이터 준비')), itemActions(section))
  }

  function itemActions(item, ...extra) {
    return h(
      'div',
      { class: 'form__actions' },
      extra,
      button('↑', () => shift(item, -1), { title: '위로' }),
      button('↓', () => shift(item, 1), { title: '아래로' }),
      button('복제', () => insertAfter(item, { ...structuredClone(item), id: newId('i') })),
      button('삭제', () => remove(item), { class: 'danger' }),
    )
  }

  function textInput(item, key, placeholder) {
    return h('input', {
      value: item[key],
      placeholder,
      oninput: (event) => {
        item[key] = event.target.value
        refresh()
      },
    })
  }

  function preview(step) {
    const url = resolveUrl(step.url, draft.baseUrl)
    if (!url) return
    send({ type: 'open', url, navigation: step.navigation === 'inherit' ? draft.navigation : step.navigation })
  }

  // ---- 구조 바꾸기 ---------------------------------------------------------

  function addBar() {
    return h(
      'div',
      { class: 'add-bar' },
      button('+ 현재 페이지', addCurrentPage, { class: 'primary' }),
      button('+ 빈 단계', () => insert(newStep())),
      button('+ 구분', () => insert(newSection())),
    )
  }

  async function addCurrentPage() {
    const tab = await currentTab()
    if (!tab?.url) return
    // 첫 페이지를 담을 때 기본 URL 이 비어 있으면 그 사이트로 채운다.
    if (!draft.baseUrl.trim()) draft.baseUrl = httpOrigin(tab.url) ?? ''
    insert(newStep({ title: tab.title ?? '', url: toStoredUrl(tab.url, draft.baseUrl) }))
  }

  /** 펼친 항목 바로 뒤에, 없으면 끝에 넣고 펼친다. */
  function insert(item) {
    const at = draft.items.findIndex((candidate) => candidate.id === expandedId)
    draft.items.splice(at === -1 ? draft.items.length : at + 1, 0, item)
    expandedId = item.id
    render()
    rows.get(item.id)?.row.scrollIntoView({ block: 'nearest' })
  }

  function insertAfter(anchor, item) {
    draft.items.splice(draft.items.indexOf(anchor) + 1, 0, item)
    expandedId = item.id
    render()
  }

  function shift(item, delta) {
    const from = draft.items.indexOf(item)
    const to = from + delta
    if (to < 0 || to >= draft.items.length) return
    ;[draft.items[from], draft.items[to]] = [draft.items[to], draft.items[from]]
    render()
  }

  function remove(item) {
    draft.items = draft.items.filter((candidate) => candidate !== item)
    if (expandedId === item.id) expandedId = null
    render()
  }

  function startDrag(event, item, row) {
    dragId = item.id
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', item.id)
    event.dataTransfer.setDragImage(row, 20, 16)
    row.classList.add('is-dragging')
  }

  function endDrag() {
    dragId = null
    for (const { row } of rows.values()) row.classList.remove('is-dragging', 'drop-before', 'drop-after')
  }

  function dragOver(event, item, row) {
    if (!dragId || dragId === item.id) return
    event.preventDefault()
    const rect = row.getBoundingClientRect()
    const after = event.clientY > rect.top + rect.height / 2
    row.classList.toggle('drop-before', !after)
    row.classList.toggle('drop-after', after)
  }

  function drop(event, target, row) {
    event.preventDefault()
    const after = row.classList.contains('drop-after')
    const moving = draft.items.find((item) => item.id === dragId)
    endDrag()
    if (!moving || moving === target) return
    draft.items.splice(draft.items.indexOf(moving), 1)
    draft.items.splice(draft.items.indexOf(target) + (after ? 1 : 0), 0, moving)
    render()
  }

  // ---- 저장 ---------------------------------------------------------------

  function footer() {
    refs.problems = h('ul', { class: 'problems', hidden: true })
    refs.save = button('저장', save, { class: 'primary' })
    const cancel = confirmTwice(h('button', { type: 'button' }, '취소'), '변경 버리기?', onCancel, isDirty)
    return h('footer', { class: 'dock' }, refs.problems, h('div', { class: 'nav' }, cancel, refs.save))
  }

  function save() {
    if (!applyText()) return
    const problems = validate(draft)
    if (problems.length) {
      // 문제가 있는 단계를 짚어 보이도록 폼으로 돌아간다.
      textMode = false
      render()
      return
    }
    onSave(normalizeScenario(draft))
  }

  /** 행 요약, 오류 표시, 저장 버튼 상태만 갱신한다. */
  function refresh() {
    const problems = textMode ? [] : validate(draft)
    const failing = new Set(problems.map((problem) => problem.id))
    for (const { item, row, title, sub } of rows.values()) {
      title.textContent = item.title.trim() || (item.type === 'section' ? '(제목 없는 구분)' : '(제목 없음)')
      sub.textContent = item.type === 'step' ? item.url.trim() || 'URL 없음' : ''
      row.classList.toggle('has-error', failing.has(item.id))
    }
    refs.baseUrl?.classList.toggle('is-invalid', failing.has(null))
    refs.problems.replaceChildren(...problems.map((problem) => h('li', null, problem.message)))
    refs.problems.hidden = problems.length === 0
    refs.save.disabled = !isDirty() || problems.length > 0
  }

  return { render, destroy() {} }
}

function field(label, ...controls) {
  return h('label', { class: 'field' }, h('span', { class: 'field__label' }, label), controls)
}

function select(options, value, onChange) {
  return h(
    'select',
    { value, onchange: (event) => onChange(event.target.value) },
    options.map(([code, label]) => h('option', { value: code }, label)),
  )
}

function button(label, onclick, props = {}) {
  return h('button', { type: 'button', onclick, ...props }, label)
}
