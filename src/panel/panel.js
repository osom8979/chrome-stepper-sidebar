/**
 * 패널 진입점. 머리(시나리오 선택·관리 메뉴)를 맡고, 본문은 진행 화면과 편집 화면을 바꿔 끼운다.
 */
import { confirmTwice, h } from './dom.js'
import { baseName, download, fileSlug, pickTextFile } from './io.js'
import { createEditView } from './edit-view.js'
import { createPlayView } from './play-view.js'
import { api } from '../shared/api.js'
import { fromMarkdown, toMarkdown } from '../shared/markdown.js'
import { cloneScenario, httpOrigin, newScenario } from '../shared/scenario.js'
import { activeScenario, addScenarios, fetchSeed, getLibrary, onStoreChange, saveLibrary } from '../shared/store.js'

const els = {
  scenario: document.getElementById('scenario'),
  counter: document.getElementById('counter'),
  edit: document.getElementById('edit'),
  menu: document.getElementById('menu'),
  notice: document.getElementById('notice'),
  view: document.getElementById('view'),
}

const windowId = (await api.windows.getCurrent()).id
/** background 에 보내고, 실패하면 배너로 알린다. 조용히 삼키면 왜 안 움직이는지 알 수 없다. */
async function send(message) {
  let response
  try {
    response = await api.runtime.sendMessage({ ...message, windowId })
  } catch (e) {
    notify(['background 에 연결하지 못했습니다. 확장 관리 화면에서 이 확장을 새로고침하세요.', String(e)], 'error')
    return
  }
  if (response && !response.ok) notify([`${message.type} 실패`, response.error], 'error')
}
const currentTab = async () => (await api.tabs.query({ active: true, windowId }))[0] ?? null

let mode = 'play'
let view = null

async function show(next) {
  view?.destroy()
  mode = next
  document.body.dataset.mode = mode
  const scenario = activeScenario(await getLibrary())
  if (mode === 'edit' && scenario) {
    view = createEditView(els.view, { scenario, send, currentTab, onSave: save, onCancel: () => show('play') })
  } else {
    mode = document.body.dataset.mode = 'play'
    view = createPlayView(els.view, {
      send,
      setCounter: (text) => (els.counter.textContent = text),
      onEdit: () => show('edit'),
      onNewScenario: () => run('new'),
    })
  }
  await refreshHeader()
  await view.render()
}

async function save(scenario) {
  const { scenarios } = await getLibrary()
  const exists = scenarios.some((candidate) => candidate.id === scenario.id)
  await saveLibrary({
    scenarios: exists ? scenarios.map((candidate) => (candidate.id === scenario.id ? scenario : candidate)) : [...scenarios, scenario],
  })
  notify('저장했습니다')
  await show('play')
}

async function refreshHeader() {
  const library = await getLibrary()
  const active = activeScenario(library)
  els.scenario.replaceChildren(
    ...(library.scenarios.length
      ? library.scenarios.map((scenario) => h('option', { value: scenario.id }, scenario.title || '(제목 없음)'))
      : [h('option', { value: '' }, '시나리오 없음')]),
  )
  els.scenario.value = active?.id ?? ''
  els.scenario.disabled = mode === 'edit' || !active
  els.edit.disabled = !active
  for (const button of els.menu.querySelectorAll('[data-needs-active]')) button.disabled = !active
}

function notify(message, kind = 'info') {
  els.notice.className = `banner banner--${kind}`
  els.notice.replaceChildren(...[].concat(message).map((line) => h('div', null, line)))
  els.notice.hidden = false
  clearTimeout(notify.timer)
  // 오류와 경고는 사용자가 읽을 때까지 둔다 (누르면 닫힘).
  if (kind === 'info') notify.timer = setTimeout(() => (els.notice.hidden = true), 2500)
}

// ---- 관리 메뉴 -----------------------------------------------------------

const ACTIONS = {
  async new() {
    const baseUrl = httpOrigin((await currentTab())?.url) ?? ''
    await addScenarios([newScenario({ baseUrl })])
    await show('edit')
  },
  async duplicate() {
    const scenario = activeScenario(await getLibrary())
    if (scenario) await addScenarios([cloneScenario(scenario)])
  },
  async import() {
    const file = await pickTextFile('.md,.markdown,.txt,text/markdown,text/plain')
    if (!file) return
    const { scenarios, warnings } = fromMarkdown(file.text, baseName(file.name))
    if (!scenarios.length) throw new Error('시나리오를 찾지 못했습니다. # 제목이나 ### 단계가 있어야 합니다.')
    await addScenarios(scenarios)
    const summary = `${scenarios.length}개 시나리오를 가져왔습니다`
    if (warnings.length) notify([`${summary}. 다음 값은 기본값으로 바꿨습니다.`, ...warnings], 'warn')
    else notify(summary)
  },
  async export() {
    const scenario = activeScenario(await getLibrary())
    if (scenario) download(`${fileSlug(scenario.title)}.md`, toMarkdown([scenario]))
  },
  async exportAll() {
    const { scenarios } = await getLibrary()
    if (scenarios.length) download('chrome-stepper-sidebar.md', toMarkdown(scenarios))
  },
  async seed() {
    const added = await addScenarios(await fetchSeed())
    notify(`예시 ${added.length}개를 넣었습니다`)
  },
  async remove() {
    const library = await getLibrary()
    const target = activeScenario(library)
    if (!target) return
    const scenarios = library.scenarios.filter((scenario) => scenario.id !== target.id)
    await saveLibrary({ scenarios, activeId: scenarios[0]?.id ?? null })
    notify(`삭제했습니다: ${target.title}`)
  },
}

async function run(action) {
  els.menu.open = false
  try {
    await ACTIONS[action]()
  } catch (e) {
    notify(e.message ?? String(e), 'error')
  }
}

for (const button of els.menu.querySelectorAll('[data-action]')) {
  const action = () => run(button.dataset.action)
  if (button.dataset.action === 'remove') confirmTwice(button, '한 번 더 누르면 삭제', action)
  else button.addEventListener('click', action)
}

document.addEventListener('click', (event) => {
  if (els.menu.open && !els.menu.contains(event.target)) els.menu.open = false
})

// ---- 연결 ---------------------------------------------------------------

els.scenario.addEventListener('change', () => saveLibrary({ activeId: els.scenario.value }))
els.edit.addEventListener('click', () => show('edit'))
els.notice.addEventListener('click', () => (els.notice.hidden = true))

onStoreChange(async (area) => {
  if (area === 'local') await refreshHeader()
  // 편집 중에는 draft 를 지키려고 다시 그리지 않는다.
  if (mode === 'play') await view.render()
})

await show('play')
// 서비스 워커가 내려가 있던 사이의 변화를 메우도록 열 때마다 현재 탭과 맞춘다.
send({ type: 'sync' })
