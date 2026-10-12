/**
 * 파일 주고받기. 확장은 자기 폴더에 쓸 수 없으므로 내려받기와 파일 선택으로만 오간다.
 */
import { h } from './dom.js'

export function download(filename, text, type = 'text/markdown') {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }))
  const link = h('a', { href: url, download: filename })
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 파일 하나를 골라 { name, text } 로 돌려준다. 취소하면 null. */
export function pickTextFile(accept) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept })
    input.addEventListener('change', async () => {
      const file = input.files?.[0]
      resolve(file ? { name: file.name, text: await file.text() } : null)
    })
    input.addEventListener('cancel', () => resolve(null))
    input.click()
  })
}

/** 파일 이름으로 쓸 수 없는 문자만 바꾼다. 한글은 그대로 둔다. */
export const fileSlug = (title) => title.trim().replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '') || 'scenario'

export const baseName = (filename) => filename.replace(/\.[^.]+$/, '')
