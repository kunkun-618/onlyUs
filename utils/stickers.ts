export interface Sticker {
  key: string
  label: string
  src: string
  content: string
}

export const stickers: readonly Sticker[] = Object.freeze([
  { key: 'hug', label: '抱抱你', src: '/static/stickers/hug.svg', content: '[sticker:hug]' },
  { key: 'miss', label: '想你了', src: '/static/stickers/miss.svg', content: '[sticker:miss]' },
  { key: 'love', label: '爱你呀', src: '/static/stickers/love.svg', content: '[sticker:love]' },
  { key: 'night', label: '晚安啦', src: '/static/stickers/night.svg', content: '[sticker:night]' }
])

export function resolveSticker(content: unknown): Sticker | null {
  return typeof content === 'string' ? stickers.find(sticker => sticker.content === content) || null : null
}
