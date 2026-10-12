/**
 * 저장소 두 곳.
 *
 * - local (영구): scenarios 시나리오 목록, activeId 지금 쓰는 시나리오
 * - session (브라우저를 닫으면 사라짐): currentId 현재 단계 id, offScript 현재 탭이 시나리오 밖인가
 *
 * 키마다 따로 쓰므로 읽고-고치고-쓰기 경합이 없다.
 * 시나리오 목록은 편집 화면만 통째로 쓴다.
 */
import { api } from './api.js'
import { fromMarkdown } from './markdown.js'
import { newId } from './scenario.js'

export async function getLibrary() {
  const { scenarios = [], activeId = null } = await api.storage.local.get(['scenarios', 'activeId'])
  return { scenarios, activeId }
}

export function activeScenario({ scenarios, activeId }) {
  return scenarios.find((scenario) => scenario.id === activeId) ?? scenarios[0] ?? null
}

export const saveLibrary = (patch) => api.storage.local.set(patch)

/** 시나리오들을 목록 끝에 붙이고 첫 번째를 활성으로 둔다. 겹치는 id 는 새로 매긴다. */
export async function addScenarios(scenarios) {
  const library = await getLibrary()
  const taken = new Set(library.scenarios.map((scenario) => scenario.id))
  const added = scenarios.map((scenario) => {
    const id = taken.has(scenario.id) ? newId('s') : scenario.id
    taken.add(id)
    return { ...scenario, id }
  })
  await saveLibrary({
    scenarios: [...library.scenarios, ...added],
    ...(added[0] ? { activeId: added[0].id } : {}),
  })
  return added
}

/** 확장에 들어 있는 예시 시나리오(seed.md). */
export async function fetchSeed() {
  const res = await fetch(api.runtime.getURL('seed.md'), { cache: 'no-store' })
  if (!res.ok) throw new Error(`seed.md 를 읽지 못했습니다 (HTTP ${res.status})`)
  return fromMarkdown(await res.text()).scenarios
}

export const getProgress = () => api.storage.session.get(['currentId', 'offScript'])

export const setProgress = (patch) => api.storage.session.set(patch)

export function onStoreChange(callback) {
  api.storage.onChanged.addListener((changes, area) => callback(area, changes))
}
