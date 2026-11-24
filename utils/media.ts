export type MediaMetadata = {
  media_type: 'image' | 'video'
  mime_type: string
  size_bytes: number
  file_name: string
}

export const MAX_MEDIA_BYTES = 50 * 1024 * 1024
const imageTypes: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' }

export function isVideo(media: any): boolean { return media?.media_type === 'video' }
export function validateMedia(metadata: MediaMetadata) {
  if (!Number.isSafeInteger(metadata.size_bytes) || metadata.size_bytes <= 0) throw new Error('无法确认文件大小，或文件为空')
  if (metadata.size_bytes > MAX_MEDIA_BYTES) throw new Error('单个文件不能超过 50 MiB')
  if (metadata.media_type === 'video') {
    if (metadata.mime_type !== 'video/mp4') throw new Error('视频仅支持 MP4 格式')
  } else if (metadata.media_type !== 'image' || !Object.values(imageTypes).includes(metadata.mime_type)) {
    throw new Error('图片仅支持 JPEG、PNG、WebP、GIF 格式')
  }
}

export function mediaExtension(mime: string): string {
  return mime === 'video/mp4' ? 'mp4' : Object.keys(imageTypes).find(key => imageTypes[key] === mime) || 'jpg'
}

export async function inspectMedia(filePath: string, kind: 'image' | 'video', name: string = ''): Promise<MediaMetadata> {
  let size = 0
  let mime = ''
  // #ifdef WEB
  const response = await fetch(filePath)
  if (!response.ok) throw new Error('无法读取所选文件')
  const blob = await response.blob()
  size = blob.size
  mime = blob.type.toLowerCase().split(';')[0]
  // #endif
  // #ifndef WEB
  size = await new Promise<number>((resolve, reject) => uni.getFileSystemManager().getFileInfo({
    filePath, success: (r: any) => resolve(r.size), fail: () => reject(new Error('无法读取文件大小'))
  }))
  // #endif
  if (kind === 'image') {
    const info: any = await new Promise((resolve, reject) => uni.getImageInfo({ src: filePath, success: resolve, fail: () => reject(new Error('无法识别图片')) }))
    if (info.type) mime = imageTypes[String(info.type).toLowerCase()] || ''
  } else {
    const info: any = await new Promise((resolve, reject) => uni.getVideoInfo({ src: filePath, success: resolve, fail: () => reject(new Error('无法识别视频')) }))
    const type = String(info.type || '').toLowerCase()
    mime = type === 'mp4' || type === 'video/mp4' ? 'video/mp4' : ''
  }
  const metadata: MediaMetadata = { media_type: kind, mime_type: mime, size_bytes: size, file_name: name || (kind === 'video' ? '我们的视频_' : '我们的照片_') + Date.now() + '.' + mediaExtension(mime) }
  validateMedia(metadata)
  return metadata
}

function cancelled(error: any): boolean { return error?.errCode === 1101001 || /cancel/i.test(error?.errMsg || '') }

export function chooseImages(): Promise<any[]> {
  return new Promise((resolve, reject) => uni.chooseImage({
    count: 9, sizeType: ['compressed'],
    success: (r: any) => resolve(r.tempFilePaths.slice(0, 9).map((path: string, i: number) => ({ path, name: r.tempFiles?.[i]?.name || '' }))),
    fail: (e: any) => cancelled(e) ? resolve([]) : reject(new Error('无法选择照片，请检查相册权限'))
  }))
}

export function chooseOneVideo(): Promise<any[]> {
  return new Promise((resolve, reject) => uni.chooseVideo({
    sourceType: ['album', 'camera'], compressed: false,
    success: (r: any) => resolve([{ path: r.tempFilePath, name: '' }]),
    fail: (e: any) => cancelled(e) ? resolve([]) : reject(new Error('无法选择视频，请检查相册和相机权限'))
  }))
}

// #ifdef WEB
async function demoFileStore(mode: 'readonly' | 'readwrite', id: string, blob?: Blob): Promise<any> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('pair-demo-media', 1)
    open.onupgradeneeded = () => { open.result.createObjectStore('files') }
    open.onerror = () => reject(new Error('无法打开本地媒体存储'))
    open.onsuccess = () => {
      const db = open.result
      const tx = db.transaction('files', mode)
      const store = tx.objectStore('files')
      const operation = mode === 'readonly' ? store.get(id) : blob ? store.put(blob, id) : store.delete(id)
      tx.oncomplete = () => { db.close(); resolve(operation.result) }
      tx.onabort = () => { db.close(); reject(new Error('本地媒体存储失败，请检查剩余空间')) }
      tx.onerror = () => {}
    }
  })
}
// #endif

export async function persistDemoMedia(filePath: string, id: string, metadata: MediaMetadata): Promise<string> {
  // #ifdef WEB
  const response = await fetch(filePath)
  if (!response.ok) throw new Error('无法读取演示文件')
  await demoFileStore('readwrite', id, await response.blob())
  return filePath
  // #endif
  // #ifndef WEB
  return new Promise((resolve, reject) => uni.getFileSystemManager().saveFile({
    tempFilePath: filePath, filePath: uni.env.USER_DATA_PATH + '/pair-media-' + id + '.' + mediaExtension(metadata.mime_type),
    success: (r: any) => resolve(r.savedFilePath), fail: () => reject(new Error('演示文件保存失败，请检查剩余空间'))
  }))
  // #endif
}

export async function restoreDemoMedia(media: any): Promise<string> {
  // #ifdef WEB
  if (media.demo_media) {
    const blob = await demoFileStore('readonly', media.id)
    if (!blob) throw new Error('本地演示文件不存在，请重新添加')
    return URL.createObjectURL(blob)
  }
  // #endif
  if (!media.local) throw new Error('本地演示文件不存在')
  return media.local
}

export async function removeDemoMedia(media: any): Promise<void> {
  // #ifdef WEB
  if (media.demo_media) await demoFileStore('readwrite', media.id)
  // #endif
  // #ifndef WEB
  if (media.local) await new Promise<void>((resolve, reject) => uni.getFileSystemManager().unlink({ filePath: media.local, success: () => resolve(), fail: () => reject(new Error('本地文件清理失败')) }))
  // #endif
}

export function saveMediaToAlbum(filePath: string, video: boolean): Promise<void> {
  // #ifdef WEB
  const link = document.createElement('a')
  link.href = filePath; link.download = 'pair_' + Date.now() + (video ? '.mp4' : '.jpg'); link.click()
  return Promise.resolve()
  // #endif
  // #ifndef WEB
  return new Promise((resolve, reject) => {
    const options = { filePath, success: () => resolve(), fail: () => reject(new Error('保存失败，请检查相册权限和剩余空间')) }
    if (video) uni.saveVideoToPhotosAlbum(options)
    else uni.saveImageToPhotosAlbum(options)
  })
  // #endif
}
