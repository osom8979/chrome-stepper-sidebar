/**
 * 컨트롤러. 단계 이동, 전역 단축키, 탭 URL 추적을 모두 여기서 한다.
 * 패널은 저장소(store.js)를 그리고 메시지를 보낼 뿐이다.
 *
 * 서비스 워커(Chrome)와 이벤트 페이지(Firefox)는 수시로 내려가므로 모듈 변수에 아무것도 담아 두지 않는다.
 */
import { api } from './shared/api.js'
import { compile, matchStep } from './shared/scenario.js'
import { navigate } from './shared/navigate.js'
import { activeScenario, addScenarios, fetchSeed, getLibrary, getProgress, setProgress } from './shared/store.js'

// 툴바 버튼으로 패널을 연다. Chrome 은 sidePanel, Firefox 는 sidebarAction 이다.
if (api.sidePanel) {
  api.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error)
} else if (api.sidebarAction) {
  // toggle 은 사용자 동작 안에서만 허용되므로 버튼 클릭 핸들러에서 바로 부른다.
  api.action.onClicked.addListener(() => api.sidebarAction.toggle())
}

// 처음 설치했을 때만 예시 시나리오를 넣는다. 사용자가 전부 지운 뒤에는 다시 넣지 않는다.
api.runtime.onInstalled.addListener(async () => {
  const { scenarios } = await api.storage.local.get('scenarios')
  if (scenarios === undefined) {
    try {
      await addScenarios(await fetchSeed())
    } catch (e) {
      console.error('예시 시나리오를 넣지 못했습니다', e)
    }
  }
  await syncTab(await targetTab())
})

async function compiledActive() {
  const scenario = activeScenario(await getLibrary())
  return scenario ? compile(scenario) : null
}

/** 패널이 보낸 메시지는 그 패널의 창, 단축키는 마지막으로 포커스된 창의 활성 탭. */
async function targetTab(windowId) {
  const query = windowId ? { active: true, windowId } : { active: true, lastFocusedWindow: true }
  const [tab] = await api.tabs.query(query)
  return tab ?? null
}

// ---- 탭 URL → 현재 단계 -------------------------------------------------

async function syncUrl(url) {
  const compiled = await compiledActive()
  if (!compiled || !url) return
  const { currentId } = await getProgress()
  const known = compiled.steps.some((step) => step.id === currentId) ? currentId : null
  const matched = matchStep(compiled, url, known)
  await setProgress(matched ? { currentId: matched, offScript: false } : { currentId: known, offScript: true })
}

const syncTab = (tab) => syncUrl(tab?.url)

// pushState 같은 문서 안 이동도 onUpdated 에 url 로 들어온다.
api.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.url && tab.active) syncUrl(changeInfo.url)
})

api.tabs.onActivated.addListener(async ({ tabId }) => {
  syncTab(await api.tabs.get(tabId))
})

// 시나리오를 바꾸면 진행 위치를 지우고, 내용을 고치면 현재 탭과 다시 맞춘다.
api.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return
  if (changes.activeId) await setProgress({ currentId: null, offScript: false })
  if (changes.activeId || changes.scenarios) await syncTab(await targetTab())
})

// ---- 단계 이동 -----------------------------------------------------------

async function goto(stepId, windowId) {
  const compiled = await compiledActive()
  const step = compiled?.steps.find((candidate) => candidate.id === stepId)
  const tab = await targetTab(windowId)
  if (!step?.url || !tab?.id) return
  // 이동 전에 기록해 두면 같은 URL 을 쓰는 단계끼리도 구분된다 (matchStep 의 preferId).
  await setProgress({ currentId: step.id, offScript: false })
  await navigate(tab, step.url, step.navigation)
}

async function move(delta, windowId) {
  const steps = (await compiledActive())?.steps ?? []
  const { currentId } = await getProgress()
  const from = steps.findIndex((step) => step.id === currentId)
  const direction = from === -1 ? 1 : Math.sign(delta)
  let to = from === -1 ? 0 : from + delta
  // URL 이 잘못된 단계는 건너뛴다.
  while (steps[to] && !steps[to].url) to += direction
  if (steps[to] && to !== from) await goto(steps[to].id, windowId)
}

const HANDLERS = {
  goto: (msg) => goto(msg.stepId, msg.windowId),
  move: (msg) => move(msg.delta, msg.windowId),
  // 편집 중인 단계를 진행 위치와 상관없이 열어 본다.
  open: async (msg) => {
    const tab = await targetTab(msg.windowId)
    if (tab?.id) await navigate(tab, msg.url, msg.navigation)
  },
  sync: async (msg) => syncTab(await targetTab(msg.windowId)),
}

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = HANDLERS[msg?.type]
  if (!handler) return false
  handler(msg).then(
    () => sendResponse({ ok: true }),
    (e) => sendResponse({ ok: false, error: String(e) }),
  )
  return true
})

api.commands.onCommand.addListener((command) => {
  if (command === 'next-step') move(1)
  if (command === 'prev-step') move(-1)
})
