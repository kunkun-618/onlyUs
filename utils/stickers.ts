/** 内置贴纸的展示信息与消息编码。 */
export interface Sticker {
  /** 贴纸唯一标识。 */
  key: string
  /** 选择面板中显示的中文名称。 */
  label: string
  /** 本地贴纸图片路径。 */
  src: string
  /** 聊天消息中用于识别贴纸的完整编码。 */
  content: string
}

/** 供选择面板与消息解析共用的只读内置贴纸列表。 */
export const stickers: readonly Sticker[] = Object.freeze([
  { key: 'hug', label: '抱抱你', src: '/static/stickers/hug.svg', content: '[sticker:hug]' },
  { key: 'miss', label: '想你了', src: '/static/stickers/miss.svg', content: '[sticker:miss]' },
  { key: 'love', label: '爱你呀', src: '/static/stickers/love.svg', content: '[sticker:love]' },
  { key: 'night', label: '晚安啦', src: '/static/stickers/night.svg', content: '[sticker:night]' }
])

/** 按完整消息编码查找贴纸，未匹配时返回空值。 */
export const resolveSticker = (content: unknown): Sticker | null => {
  // sticker 为当前待匹配的内置贴纸。
  return typeof content === 'string' ? stickers.find(sticker => sticker.content === content) || null : null
}
