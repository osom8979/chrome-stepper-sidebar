/**
 * 저장소 두 곳.
 *
 * - local (영구): scenarios 시나리오 목록, activeId 지금 쓰는 시나리오, 단계별 스냅샷
 * - session (브라우저를 닫으면 사라짐): currentId 현재 단계 id, offScript 현재 탭이 시나리오 밖인가,
 *   loading 지금 불러오는 단계, 단계별 마지막 로딩 시간
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

export const getProgress = () => api.storage.session.get(['currentId', 'offScript', 'loading'])

export const setProgress = (patch) => api.storage.session.set(patch)

// ---- 스냅샷 (local) 과 로딩 기록 (session) -------------------------------------
//
// 키에 시나리오 id 를 함께 쓴다. 시나리오를 복제해도 단계 id 는 그대로라서다.
// 원본 이미지는 크므로 패널은 썸네일이 든 정보만 읽는다.
// src/content/snapshot.js 는 모듈이 아니라서 이 키 모양을 따로 적어 두었다. 바꾸면 같이 바꾼다.
//
//   snapInfo:<시나리오>:<단계>   { thumb, href, at, manual, width, height, dpr }
//   snapImage:<시나리오>:<단계>  JPEG data URL
//   snapPending                  { scenarioId, stepId, href, at } 새 문서로 이동하기 직전에 남기는 힌트
//   load:<시나리오>:<단계>       { ms, timedOut, at } (session) 마지막 로딩
//   loading                      { scenarioId, stepId, startedAt, overlay } (session) 지금 불러오는 단계

const snapInfoKey = (scenarioId, stepId) => `snapInfo:${scenarioId}:${stepId}`
const snapImageKey = (scenarioId, stepId) => `snapImage:${scenarioId}:${stepId}`
export const loadKey = (scenarioId, stepId) => `load:${scenarioId}:${stepId}`

/** 패널이 다시 그릴 필요가 없는 키. 원본 이미지가 바뀔 때마다 그리면 무겁고, 정보 키가 늘 같이 바뀐다. */
export const isQuietKey = (key) => key.startsWith('snapImage:') || key === 'snapPending'

export async function getSnapshotInfo(scenarioId, stepId) {
  const key = snapInfoKey(scenarioId, stepId)
  return (await api.storage.local.get(key))[key] ?? null
}

export const saveSnapshot = (scenarioId, stepId, image, info) =>
  api.storage.local.set({ [snapImageKey(scenarioId, stepId)]: image, [snapInfoKey(scenarioId, stepId)]: info })

export const removeSnapshots = (scenarioId, stepIds) =>
  api.storage.local.remove(stepIds.flatMap((id) => [snapInfoKey(scenarioId, id), snapImageKey(scenarioId, id)]))

/** 단계별 스냅샷 정보와 마지막 로딩. { snapshots: { [단계 id]: info }, loads: { [단계 id]: load } } */
export async function getStepRecords(scenarioId, stepIds) {
  const [snapshots, loads] = await Promise.all([
    pick(api.storage.local, stepIds, (id) => snapInfoKey(scenarioId, id)),
    pick(api.storage.session, stepIds, (id) => loadKey(scenarioId, id)),
  ])
  return { snapshots, loads }
}

async function pick(area, ids, keyOf) {
  if (!ids.length) return {}
  const stored = await area.get(ids.map(keyOf))
  return Object.fromEntries(ids.filter((id) => stored[keyOf(id)]).map((id) => [id, stored[keyOf(id)]]))
}

export function onStoreChange(callback) {
  api.storage.onChanged.addListener((changes, area) => callback(area, changes))
}
