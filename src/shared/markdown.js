/**
 * 시나리오 ⇄ Markdown. 파일 가져오기·내보내기, 예시(seed.md), 편집 화면의 Markdown 탭이 이 형식을 쓴다.
 *
 *   # 시나리오 제목
 *
 *   - 기본 URL: http://localhost:5173
 *   - 이동 방식: spa
 *
 *   ## 구분 제목
 *
 *   ### 단계 제목
 *
 *   - URL: /datasets/ds-xxxx
 *   - 판정: regex `^/datasets/ds-[^/]+$`
 *   - 이동: reload
 *
 *   발표 메모. 다음 제목 전까지 전부 메모다.
 *
 * 규칙
 * - # 가 여럿이면 시나리오도 여럿이다. # 없이 ## 나 ### 부터 시작하면 시나리오 하나로 본다.
 * - 제목 바로 아래 "- 키: 값" 목록이 속성이다. 빈 줄이나 다른 줄이 나오면 속성이 끝난다.
 * - ### 아래 속성 뒤의 본문은 메모다. # 와 ## 아래 본문은 버린다.
 * - 판정과 이동이 기본값(exact, inherit)이면 내보낼 때 쓰지 않는다.
 * - 메모 줄이 # 로 시작하면 \# 로 적는다.
 */
import { MATCH, NAVIGATION, normalizeScenario } from './scenario.js'

const KEY_ALIASES = {
  baseUrl: ['기본 url', 'base url', 'baseurl', 'base'],
  navigation: ['이동 방식', '이동', 'navigation'],
  url: ['url', '주소', '경로', 'path'],
  match: ['판정', 'match'],
}

const KEYS_BY_SCOPE = {
  scenario: ['baseUrl', 'navigation'],
  step: ['url', 'match', 'navigation'],
}

// 코드 값, 화면 표시 이름, 손으로 쓰기 쉬운 짧은 이름을 모두 받는다.
const NAVIGATION_ALIASES = aliasTable({
  spa: ['새로고침 없이', NAVIGATION.spa],
  reload: ['새로고침', NAVIGATION.reload],
  newtab: ['새 탭', NAVIGATION.newtab],
  inherit: ['기본값', '시나리오 기본값'],
})
const MATCH_ALIASES = aliasTable({
  exact: ['일치', MATCH.exact],
  prefix: ['접두사', MATCH.prefix],
  regex: [MATCH.regex],
})

// 긴 이름부터 비교해야 "경로 접두사 /x" 가 다른 별칭에 먼저 걸리지 않는다.
function aliasTable(names) {
  return Object.entries(names)
    .flatMap(([code, aliases]) => [code, ...aliases].map((alias) => [alias.toLowerCase(), code]))
    .sort((a, b) => b[0].length - a[0].length)
}

// ---- 읽기 -----------------------------------------------------------------

/**
 * Markdown 을 정규화된 시나리오 목록으로 읽는다.
 * 알 수 없는 값은 기본값으로 두고 warnings 에 "N행: ..." 으로 남긴다.
 */
export function fromMarkdown(source, fallbackTitle = '가져온 시나리오') {
  const raws = []
  const warnings = []
  let scenario = null
  let step = null
  let target = null // 속성을 받을 객체 (시나리오나 단계)
  let scope = null
  let inProps = false
  let sawProp = false

  const ensureScenario = () => {
    if (!scenario) {
      scenario = { title: fallbackTitle, items: [] }
      raws.push(scenario)
    }
    return scenario
  }
  const finishStep = () => {
    if (step) step.note = trimBlankLines(step.noteLines).join('\n')
    step = null
  }

  source
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .forEach((line, index) => {
      const lineNo = index + 1
      const heading = /^(#{1,3})(?:[ \t]+(.*?))?[ \t]*$/.exec(line)
      if (heading) {
        finishStep()
        const level = heading[1].length
        const title = heading[2] ?? ''
        if (level === 1) {
          scenario = { title, items: [] }
          raws.push(scenario)
          ;[target, scope] = [scenario, 'scenario']
        } else if (level === 2) {
          ensureScenario().items.push({ type: 'section', title })
          ;[target, scope] = [null, null]
        } else {
          step = { type: 'step', title, noteLines: [] }
          ensureScenario().items.push(step)
          ;[target, scope] = [step, 'step']
        }
        inProps = target !== null
        sawProp = false
        return
      }

      if (inProps) {
        const prop = /^\s*[-*+]\s+(.+?)\s*[:：]\s*(.*)$/.exec(line)
        const key = prop && keyOf(prop[1], scope)
        if (key) {
          const warning = setProp(target, key, prop[2])
          if (warning) warnings.push(`${lineNo}행: ${warning}`)
          sawProp = true
          return
        }
        if (!line.trim() && !sawProp) return // 제목과 속성 사이의 빈 줄
        inProps = false
      }

      if (step) step.noteLines.push(line.replace(/^\\(\\*#)/, '$1'))
    })
  finishStep()

  return { scenarios: raws.map(normalizeScenario), warnings }
}

function keyOf(raw, scope) {
  const name = raw.replace(/\*\*/g, '').trim().toLowerCase().replace(/\s+/g, ' ')
  return KEYS_BY_SCOPE[scope]?.find((key) => KEY_ALIASES[key].includes(name)) ?? null
}

/** 속성 하나를 적용한다. 값을 알 수 없으면 경고 문구를 돌려준다. */
function setProp(target, key, rawValue) {
  const value = rawValue.trim()
  if (key === 'url' || key === 'baseUrl') {
    target[key] = unwrapUrl(value)
    return null
  }
  if (key === 'navigation') {
    const code = NAVIGATION_ALIASES.find(([alias]) => alias === value.toLowerCase())?.[1]
    if (!code) return `이동 값 '${value}' 을 알 수 없어 기본값을 씁니다 (${Object.keys(NAVIGATION).join(', ')})`
    target.navigation = code
    return null
  }
  if (key === 'match') {
    const lower = value.toLowerCase()
    const hit = MATCH_ALIASES.find(([alias]) => lower === alias || lower.startsWith(`${alias} `))
    if (!hit) return `판정 값 '${value}' 을 알 수 없어 exact 를 씁니다 (${Object.keys(MATCH).join(', ')})`
    target.match = { mode: hit[1], pattern: unwrapCode(value.slice(hit[0].length).trim()) }
    return null
  }
  return null
}

function unwrapUrl(value) {
  const link = /^\[[^\]]*\]\((.*)\)$/.exec(value)
  if (link) return link[1].trim()
  const angle = /^<(.*)>$/.exec(value)
  if (angle) return angle[1].trim()
  return unwrapCode(value)
}

function unwrapCode(value) {
  const code = /^(`+)(.*)\1$/s.exec(value)
  if (!code) return value
  const inner = code[2]
  return inner.length > 2 && inner.startsWith(' ') && inner.endsWith(' ') ? inner.slice(1, -1) : inner
}

function trimBlankLines(lines) {
  let start = 0
  let end = lines.length
  while (start < end && !lines[start].trim()) start++
  while (end > start && !lines[end - 1].trim()) end--
  return lines.slice(start, end)
}

// ---- 쓰기 -----------------------------------------------------------------

export function toMarkdown(scenarios, { header = true } = {}) {
  const out = header ? ['<!-- Chrome Stepper Sidebar 시나리오. 형식은 README.md 참고 -->', ''] : []
  for (const scenario of scenarios) {
    out.push(`# ${scenario.title}`, '')
    if (scenario.baseUrl) out.push(`- 기본 URL: ${scenario.baseUrl}`)
    out.push(`- 이동 방식: ${scenario.navigation}`, '')
    for (const item of scenario.items) {
      if (item.type === 'section') {
        out.push(`## ${item.title}`.trimEnd(), '')
        continue
      }
      out.push(`### ${item.title}`.trimEnd(), '', `- URL: ${item.url}`.trimEnd())
      if (item.match.mode !== 'exact') out.push(`- 판정: ${formatMatch(item.match)}`)
      if (item.navigation !== 'inherit') out.push(`- 이동: ${item.navigation}`)
      out.push('')
      const note = trimBlankLines(item.note.split('\n'))
      if (note.length) out.push(...note.map((line) => line.replace(/^(\\*#)/, '\\$1')), '')
    }
  }
  return `${out.join('\n').trimEnd()}\n`
}

function formatMatch({ mode, pattern }) {
  return pattern ? `${mode} ${codeSpan(pattern)}` : mode
}

// 패턴 안의 백틱보다 긴 울타리를 쓴다. 정규식의 [ ] * _ 가 Markdown 으로 읽히지 않게 늘 감싼다.
function codeSpan(text) {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length))
  const fence = '`'.repeat(longest + 1)
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : ''
  return `${fence}${pad}${text}${pad}${fence}`
}
