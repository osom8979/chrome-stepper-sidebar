/**
 * 컨트롤러. 단계 이동, 전역 단축키, 탭 URL 추적, 스냅샷을 모두 여기서 한다.
 * 패널은 저장소(store.js)를 그리고 메시지를 보낼 뿐이다.
 *
 * 서비스 워커(Chrome)와 이벤트 페이지(Firefox)는 수시로 내려가므로 모듈 변수에 아무것도 담아 두지 않는다.
 */
import { api } from './shared/api.js'
import { captureTab, sameViewport } from './shared/capture.js'
import { compile, isStepUrl, matchStep, sitePatterns } from './shared/scenario.js'
import { navigate } from './shared/navigate.js'
import {
  activeScenario,
  addScenarios,
  fetchSeed,
  getLibrary,
  getProgress,
  getSnapshotInfo,
  loadKey,
  saveSnapshot,
  setProgress,
} from './shared/store.js'

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
  await syncAgents()
  await syncTab(await targetTab())
})

// 등록한 content script 가 브라우저를 다시 켠 뒤에도 남는지는 브라우저마다 달라서 켤 때마다 맞춘다.
api.runtime.onStartup.addListener(() => syncAgents())

async function compiledActive() {
  const scenario = activeScenario(await getLibrary())
  return scenario ? compile(scenario) : null
}

/**
 * 패널이 보낸 메시지는 그 패널의 창, 단축키는 마지막으로 포커스된 창의 활성 탭.
 * 패널이 알아낸 창 id 로 못 찾으면(창이 닫혔거나 브라우저가 패널 자체를 창으로 본 경우)
 * 마지막으로 포커스된 창으로 대신한다.
 */
async function targetTab(windowId) {
  const [tab] = windowId ? await api.tabs.query({ active: true, windowId }) : []
  const [focused] = tab ? [tab] : await api.tabs.query({ active: true, lastFocusedWindow: true })
  return focused ?? null
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
  if (changes.scenarios) syncAgents()
  if (changes.activeId || changes.scenarios) await syncTab(await targetTab())
})

// ---- 단계 이동 -----------------------------------------------------------

async function goto(stepId, windowId) {
  const scenario = activeScenario(await getLibrary())
  const step = scenario && compile(scenario).steps.find((candidate) => candidate.id === stepId)
  const tab = await targetTab(windowId)
  if (!step) throw new Error(`단계를 찾지 못했습니다: ${stepId}`)
  if (!step.url) throw new Error(`URL 이 올바르지 않습니다: ${step.title}`)
  if (!tab?.id) throw new Error('이동시킬 탭을 찾지 못했습니다')
  // 이동 전에 기록해 두면 같은 URL 을 쓰는 단계끼리도 구분된다 (matchStep 의 preferId).
  // loading 은 페이지의 content script 가 시작을 알리면 그 시각으로 바뀐다.
  await setProgress({
    currentId: step.id,
    offScript: false,
    loading: { scenarioId: scenario.id, stepId: step.id, startedAt: Date.now(), overlay: false },
  })
  await navigate(tab, step.url, step.navigation, (kind) => prepareSnapshot(kind, tab, scenario.id, step))
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
    if (!tab?.id) throw new Error('이동시킬 탭을 찾지 못했습니다')
    await navigate(tab, msg.url, msg.navigation)
  },
  sync: async (msg) => syncTab(await targetTab(msg.windowId)),
  capture: (msg) => captureManually(msg.stepId, msg.windowId),
  // 시연 페이지의 content script 가 보낸다.
  page: (msg, sender) => onPage(msg, sender),
}

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = HANDLERS[msg?.type]
  if (!handler) return false
  handler(msg, sender).then(
    () => sendResponse({ ok: true }),
    (e) => sendResponse({ ok: false, error: String(e) }),
  )
  return true
})

api.commands.onCommand.addListener((command) => {
  if (command === 'next-step') move(1)
  if (command === 'prev-step') move(-1)
})

// ---- 시연 페이지의 content script -----------------------------------------

const AGENTS = [
  { id: 'stepper-net', js: ['src/content/net.js'], world: 'MAIN' },
  { id: 'stepper-snapshot', js: ['src/content/snapshot.js'] },
]

/**
 * 시나리오에 나오는 사이트에만 content script 를 document_start 로 건다.
 * 모든 사이트에 걸지 않는 이유: net.js 가 페이지의 fetch 와 history 를 감싼다.
 * 호출이 겹치면 같은 id 를 두 번 등록하다 실패하므로 차례로 돌린다. 이 체인은 상태가 아니라 순서만 잡는다.
 */
let agentSync = Promise.resolve()
function syncAgents() {
  agentSync = agentSync.then(registerAgents).catch((e) => console.error('content script 를 등록하지 못했습니다', e))
  return agentSync
}

async function registerAgents() {
  const registered = await api.scripting.getRegisteredContentScripts({ ids: AGENTS.map((agent) => agent.id) })
  if (registered.length) await api.scripting.unregisterContentScripts({ ids: registered.map((script) => script.id) })
  const matches = sitePatterns((await getLibrary()).scenarios)
  if (!matches.length) return
  await api.scripting.registerContentScripts(AGENTS.map((agent) => ({ ...agent, matches, runAt: 'document_start' })))
}

/** 등록하기 전에 열린 페이지에도 넣는다. 이미 들어 있으면 스크립트가 그냥 끝난다. */
async function injectAgents(tabId) {
  for (const agent of AGENTS) {
    await api.scripting.executeScript({ target: { tabId }, files: agent.js, world: agent.world ?? 'ISOLATED' })
  }
}

// ---- 스냅샷과 로딩 기록 ----------------------------------------------------

/**
 * 단계로 이동하기 직전에 부른다. spa 는 문서가 그대로라 지금 페이지에 바로 덮개를 씌우고 준비를 지켜보게 한다.
 * 새 문서는 아직 없으니, 그 문서의 content script 가 document_start 에 읽어 갈 힌트를 남긴다.
 * 실패해도 이동은 막지 않는다.
 */
async function prepareSnapshot(kind, tab, scenarioId, step) {
  try {
    if (kind === 'spa') {
      await injectAgents(tab.id)
      await api.scripting.executeScript({
        target: { tabId: tab.id },
        func: (message) => globalThis.__chromeStepperSnapshot?.expect(message),
        args: [{ scenarioId, stepId: step.id, href: step.url }],
      })
    } else if (await getSnapshotInfo(scenarioId, step.id)) {
      await api.storage.local.set({ snapPending: { scenarioId, stepId: step.id, href: step.url, at: Date.now() } })
    }
  } catch (e) {
    console.warn('스냅샷을 준비하지 못했습니다', e)
  }
}

/** content script 가 로딩 시작(start)과 준비(ready)를 알린다. 활성 탭의 것만 받는다. */
async function onPage(msg, sender) {
  if (!sender.tab?.active || sender.frameId !== 0) return
  const scenario = activeScenario(await getLibrary())
  if (!scenario) return
  const compiled = compile(scenario)
  const { currentId, loading } = await getProgress()
  const step = compiled.steps.find((candidate) => candidate.id === matchStep(compiled, msg.href, currentId))

  if (msg.phase === 'start') {
    const next = step ? { scenarioId: scenario.id, stepId: step.id, startedAt: msg.startedAt, overlay: msg.overlay } : null
    await setProgress({ loading: next })
    return
  }

  const patch = loading?.startedAt === msg.startedAt ? { loading: null } : {}
  if (step) patch[loadKey(scenario.id, step.id)] = { ms: msg.ms, timedOut: msg.timedOut, at: Date.now() }
  if (Object.keys(patch).length) await setProgress(patch)

  // 자동 스냅샷은 단계 URL 그 화면이 손대지 않은 채로 준비됐을 때만 찍는다.
  if (!step || msg.timedOut || !msg.pristine) return
  if (!isStepUrl(step.url, msg.startHref) && !isStepUrl(step.url, msg.href)) return
  // 수동 스냅샷은 크기가 맞는 한 덮어쓰지 않는다. 크기가 다르면 어차피 쓸 수 없으니 새로 찍는다.
  const info = await getSnapshotInfo(scenario.id, step.id)
  if (info?.manual && sameViewport(info, msg.viewport)) return
  try {
    await captureStep(sender.tab.id, msg.href, scenario.id, step.id, msg.viewport, false)
  } catch (e) {
    console.warn('자동 스냅샷을 찍지 못했습니다', e)
  }
}

/** 패널의 단계 옆 스냅샷 버튼. 지금 탭이 그 단계 화면일 때만 찍는다. */
async function captureManually(stepId, windowId) {
  const scenario = activeScenario(await getLibrary())
  const compiled = scenario ? compile(scenario) : null
  const step = compiled?.steps.find((candidate) => candidate.id === stepId)
  const tab = await targetTab(windowId)
  if (!step) throw new Error(`단계를 찾지 못했습니다: ${stepId}`)
  if (!tab?.id) throw new Error('찍을 탭을 찾지 못했습니다')
  if (matchStep(compiled, tab.url, step.id) !== step.id) {
    throw new Error('지금 탭이 이 단계 화면이 아닙니다. 단계로 이동한 뒤 찍으세요.')
  }
  // 덮개가 떠 있으면 덮개를 찍게 되므로 먼저 걷고, 걷힌 화면이 그려진 다음에 찍는다.
  const [{ result: viewport }] = await api.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      globalThis.__chromeStepperSnapshot?.reveal()
      return new Promise((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => resolve({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio })),
        ),
      )
    },
  })
  if (!(await captureStep(tab.id, tab.url, scenario.id, step.id, viewport, true))) {
    throw new Error('찍는 사이에 탭이 바뀌었습니다')
  }
}

/** 지금 보이는 탭 화면을 단계의 스냅샷으로 저장한다. 그사이 탭이 바뀌었으면 찍지 않고 false. */
async function captureStep(tabId, href, scenarioId, stepId, viewport, manual) {
  const tab = await api.tabs.get(tabId)
  if (!tab.active || tab.url !== href) return false
  const { image, thumb } = await captureTab(tab.windowId)
  await saveSnapshot(scenarioId, stepId, image, { thumb, href, at: Date.now(), manual, ...viewport })
  return true
}
