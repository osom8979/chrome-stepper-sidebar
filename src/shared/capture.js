/**
 * 탭 화면 캡처. 원본(JPEG data URL)과 패널 목록에 쓰는 작은 썸네일을 만든다.
 *
 * captureVisibleTab 은 <all_urls> 호스트 권한이 있어야 한다 (http/https 와일드카드로는 안 된다).
 */
import { api } from './api.js'

const QUALITY = 85
const THUMB_WIDTH = 120

export async function captureTab(windowId) {
  const image = await api.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: QUALITY })
  return { image, thumb: await thumbnail(image) }
}

/** 스냅샷을 찍은 화면 크기와 같은가. 다르면 덮어도 어긋나 보인다. src/content/snapshot.js 에도 같은 규칙이 있다. */
export const sameViewport = (a, b) =>
  Math.abs(a.width - b.width) <= 1 && Math.abs(a.height - b.height) <= 1 && a.dpr === b.dpr

async function thumbnail(dataUrl) {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob())
  const width = Math.min(THUMB_WIDTH, bitmap.width)
  const height = Math.max(1, Math.round((bitmap.height * width) / bitmap.width))
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d')
  context.imageSmoothingQuality = 'high'
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 })
  return `data:image/jpeg;base64,${toBase64(new Uint8Array(await blob.arrayBuffer()))}`
}

function toBase64(bytes) {
  let binary = ''
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  return btoa(binary)
}
