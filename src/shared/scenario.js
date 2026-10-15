/**
 * 시나리오 문서 모델. chrome API 를 쓰지 않는 순수 함수만 둔다.
 *
 * 내부 저장 형식 (chrome.storage.local). 파일로는 Markdown 으로만 주고받는다 (markdown.js).
 *
 *   Scenario = { id, title, baseUrl, navigation, items: [Item] }
 *   Item     = { type: 'section', id, title }
 *            | { type: 'step', id, title, url, note, navigation, match: { mode, pattern } }
 *
 * - url 은 baseUrl 기준 경로("/datasets")나 전체 주소("https://...") 둘 다 된다.
 *   단계마다 다른 사이트를 섞어도 된다.
 * - 단계의 navigation 이 'inherit' 이면 시나리오의 navigation 을 따른다.
 */

export const NAVIGATION = {
  spa: '새로고침 없이 (SPA)',
  reload: '새로 불러오기',
  newtab: '새 탭에서 열기',
}

export const MATCH = {
  exact: '경로 일치',
  prefix: '경로 접두사',
  regex: '정규식',
}

// 여러 단계가 한 URL 에 걸리면 더 구체적인 판정이 이긴다.
const STRENGTH = { exact: 3, regex: 2, prefix: 1 }

export const newId = (prefix) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`

// ---- 정규화 (Markdown 읽기, 새로 만들기, 저장 직전) ----------------------------

export function normalizeScenario(raw) {
  const items = (raw.items ?? []).map(normalizeItem)
  return {
    id: text(raw.id) || newId('s'),
    title: text(raw.title) || '새 시나리오',
    baseUrl: text(raw.baseUrl),
    navigation: oneOf(raw.navigation, NAVIGATION, 'spa'),
    items: withUniqueIds(items),
  }
}

function normalizeItem(raw) {
  if (raw?.type === 'section') {
    return { type: 'section', id: text(raw.id) || newId('i'), title: text(raw.title) }
  }
  return {
    type: 'step',
    id: text(raw?.id) || newId('i'),
    title: text(raw?.title),
    url: text(raw?.url ?? raw?.path),
    note: typeof raw?.note === 'string' ? raw.note : '',
    navigation: raw?.navigation === 'inherit' ? 'inherit' : oneOf(raw?.navigation, NAVIGATION, 'inherit'),
    match: normalizeMatch(raw?.match),
  }
}

function normalizeMatch(raw) {
  if (raw && Object.hasOwn(MATCH, raw.mode)) return { mode: raw.mode, pattern: text(raw.pattern) }
  return { mode: 'exact', pattern: '' }
}

function withUniqueIds(items) {
  const seen = new Set()
  return items.map((item) => {
    const id = seen.has(item.id) ? newId('i') : item.id
    seen.add(id)
    return { ...item, id }
  })
}

const text = (value) => (typeof value === 'string' ? value.trim() : '')
const oneOf = (value, table, fallback) => (Object.hasOwn(table, value) ? value : fallback)

export const newScenario = (fields = {}) => normalizeScenario({ items: [], ...fields })
export const newStep = (fields = {}) => normalizeItem({ type: 'step', ...fields })
export const newSection = (fields = {}) => normalizeItem({ type: 'section', ...fields })

export function cloneScenario(scenario) {
  return { ...structuredClone(scenario), id: newId('s'), title: `${scenario.title} 사본` }
}

/**
 * 다시 읽어 들인 항목에 예전 id 를 되살린다. 종류·제목·URL 이 같은 항목끼리 앞에서부터 짝짓는다.
 * Markdown 에는 id 가 없으므로, 이렇게 해야 원문 편집 뒤에도 진행 위치가 유지된다.
 */
export function carryIds(previous, next) {
  const pool = [...previous]
  return next.map((item) => {
    const index = pool.findIndex(
      (old) => old.type === item.type && old.title === item.title && (item.type === 'section' || old.url === item.url),
    )
    if (index === -1) return item
    const [old] = pool.splice(index, 1)
    return { ...item, id: old.id }
  })
}

// ---- URL ------------------------------------------------------------------

// "localhost:5173" 같은 값을 스킴으로 오인하지 않도록 "스킴://" 꼴만 전체 주소로 본다.
const isAbsolute = (value) => /^[a-z][a-z\d+.-]*:\/\//i.test(value)

export function parseAbsolute(value) {
  const trimmed = (value ?? '').trim()
  if (!isAbsolute(trimmed)) return null
  try {
    return new URL(trimmed)
  } catch {
    return null
  }
}

/** 단계 url 을 전체 주소로 푼다. 풀 수 없으면 null. */
export function resolveUrl(raw, baseUrl = '') {
  const value = (raw ?? '').trim()
  if (!value) return null
  const base = isAbsolute(value) ? undefined : parseAbsolute(baseUrl)
  if (base === null) return null
  try {
    return new URL(value, base).href
  } catch {
    return null
  }
}

/** 탭 주소를 저장용으로 줄인다. baseUrl 과 같은 사이트면 경로만 남긴다. */
export function toStoredUrl(href, baseUrl) {
  const url = parseAbsolute(href)
  if (!url) return href ?? ''
  const base = parseAbsolute(baseUrl)
  return base && sameSite(base, url) ? url.pathname + url.search + url.hash : url.href
}

/** http(s) 주소의 origin. 그 밖의 주소(chrome:// 등)는 null. */
export function httpOrigin(href) {
  const url = parseAbsolute(href)
  return url && /^https?:$/.test(url.protocol) ? url.origin : null
}

// chrome:// 같은 주소는 origin 이 모두 "null" 이라 origin 으로 비교하면 서로 같다고 나온다.
const sameSite = (a, b) => a.protocol === b.protocol && a.host === b.host

const trimSlash = (path) => (path.length > 1 ? path.replace(/\/+$/, '') : path)

// ---- 실행용 컴파일과 현재 단계 판정 -------------------------------------------

/**
 * 진행 화면과 background 가 쓰는 형태로 푼다. 구분(section)은 바로 뒤 단계의 section 으로 붙는다.
 * URL 을 풀 수 없는 단계는 url 이 null 이고, 이동과 판정에서 빠진다.
 */
export function compile(scenario) {
  const base = parseAbsolute(scenario.baseUrl)
  const steps = []
  let section = null
  for (const item of scenario.items) {
    if (item.type === 'section') {
      section = item.title.trim()
      continue
    }
    const url = resolveUrl(item.url, scenario.baseUrl)
    steps.push({
      id: item.id,
      index: steps.length,
      title: item.title.trim() || item.url.trim() || '(제목 없음)',
      section,
      note: item.note,
      url,
      display: url ? displayUrl(new URL(url), base) : '',
      match: item.match,
      navigation: item.navigation === 'inherit' ? scenario.navigation : item.navigation,
    })
    section = null
  }
  return { id: scenario.id, title: scenario.title, steps }
}

function displayUrl(url, base) {
  const path = url.pathname + url.search + url.hash
  return base && sameSite(base, url) ? path : url.host + path
}

/**
 * href 에 해당하는 단계 id. 없으면 null.
 *
 * 가장 구체적인 판정(exact > regex > prefix)에 걸린 단계들 가운데
 * preferId 를 우선하고, 그다음은 preferId 뒤쪽의 첫 단계, 마지막으로 맨 앞 단계를 고른다.
 * 그래서 한 화면에 단계를 여럿 두어도 누른 단계가 유지된다.
 */
export function matchStep(compiled, href, preferId = null) {
  const url = parseAbsolute(href)
  if (!url) return null
  let best = 0
  let hits = []
  for (const step of compiled.steps) {
    const strength = stepMatches(step, url) ? STRENGTH[step.match.mode] : 0
    if (strength > best) {
      best = strength
      hits = [step]
    } else if (strength && strength === best) {
      hits.push(step)
    }
  }
  if (hits.length === 0) return null
  if (preferId != null) {
    if (hits.some((step) => step.id === preferId)) return preferId
    const from = compiled.steps.findIndex((step) => step.id === preferId)
    const ahead = hits.find((step) => step.index > from)
    if (ahead) return ahead.id
  }
  return hits[0].id
}

function stepMatches(step, url) {
  if (!step.url) return false
  const target = new URL(step.url)
  if (!sameSite(target, url)) return false
  const { mode, pattern } = step.match
  if (mode === 'regex') return cachedRegex(pattern)?.test(url.pathname + url.search + url.hash) ?? false
  if (mode === 'prefix') {
    const prefix = trimSlash(pattern.trim() || target.pathname)
    const path = trimSlash(url.pathname)
    return prefix === '/' || path === prefix || path.startsWith(`${prefix}/`)
  }
  return samePage(target, url)
}

// 단계에 쿼리나 해시가 없으면 그 부분은 보지 않는다 (목록 화면의 ?page= 등).
function samePage(target, url) {
  return (
    sameSite(target, url) &&
    trimSlash(target.pathname) === trimSlash(url.pathname) &&
    (!target.search || target.search === url.search) &&
    (!target.hash || target.hash === url.hash)
  )
}

/**
 * href 가 단계 URL 그 화면인가. 판정 방식과 상관없이 exact 규칙으로 본다.
 * 자동 스냅샷은 이 화면만 찍는다. 정규식 단계에 걸린 다른 id 의 화면을 찍으면 다음 이동 때 엉뚱한 화면이 덮인다.
 */
export function isStepUrl(stepUrl, href) {
  const target = parseAbsolute(stepUrl)
  const url = parseAbsolute(href)
  return Boolean(target && url && samePage(target, url))
}

/**
 * 시나리오들이 오가는 http(s) 사이트의 match pattern. content script 를 이 사이트에만 건다.
 * 포트는 넣지 않는다. Firefox 는 포트가 든 패턴을 받지 않고, 빼면 두 브라우저 모두 모든 포트에 걸린다.
 */
export function sitePatterns(scenarios) {
  const patterns = new Set()
  for (const scenario of scenarios) {
    for (const step of compile(scenario).steps) {
      const url = parseAbsolute(step.url)
      if (url && /^https?:$/.test(url.protocol)) patterns.add(`${url.protocol}//${url.hostname}/*`)
    }
  }
  return [...patterns]
}

/** 고친 뒤 없어졌거나 주소가 바뀐 단계 id. 그 단계의 스냅샷은 더는 맞지 않는다. */
export function staleStepIds(before, after) {
  const urls = new Map(compile(after).steps.map((step) => [step.id, step.url]))
  return compile(before)
    .steps.filter((step) => urls.get(step.id) !== step.url)
    .map((step) => step.id)
}

const regexCache = new Map()

function cachedRegex(pattern) {
  if (!regexCache.has(pattern)) {
    let regex = null
    try {
      regex = pattern ? new RegExp(pattern) : null
    } catch {
      // 검증(validate)에서 걸러진다. 여기서는 판정에서만 뺀다.
    }
    regexCache.set(pattern, regex)
  }
  return regexCache.get(pattern)
}

// ---- 검증 (편집 화면의 저장 조건) ---------------------------------------------

/** 저장을 막는 문제 목록. id 가 null 이면 시나리오 설정의 문제다. */
export function validate(scenario) {
  const problems = []
  const base = scenario.baseUrl.trim()
  if (base && !parseAbsolute(base)) {
    problems.push({ id: null, message: '기본 URL 은 https://... 처럼 전체 주소여야 합니다' })
  }
  for (const item of scenario.items) {
    if (item.type !== 'step') continue
    const name = item.title.trim() || '제목 없는 단계'
    const url = item.url.trim()
    if (!url) {
      problems.push({ id: item.id, message: `${name}: URL 이 비어 있습니다` })
    } else if (!resolveUrl(url, base)) {
      const reason = isAbsolute(url) ? 'URL 형식이 잘못되었습니다' : '경로만 쓰려면 기본 URL 이 필요합니다'
      problems.push({ id: item.id, message: `${name}: ${reason}` })
    }
    if (item.match.mode === 'regex') {
      const error = regexError(item.match.pattern)
      if (error) problems.push({ id: item.id, message: `${name}: ${error}` })
    }
  }
  return problems
}

function regexError(pattern) {
  if (!pattern.trim()) return '정규식이 비어 있습니다'
  try {
    new RegExp(pattern)
    return null
  } catch (e) {
    return `정규식 오류: ${e.message}`
  }
}
