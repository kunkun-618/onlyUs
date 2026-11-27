/** 用于媒体校验、上传和保存的元数据。 */
export type MediaMetadata = {
  /** 区分图片和视频的业务类型。 */
  media_type: 'image' | 'video'
  /** 检测得到的文件内容类型。 */
  mime_type: string
  /** 文件大小，单位为字节。 */
  size_bytes: number
  /** 原始名称或自动生成的文件名。 */
  file_name: string
}

/** 单个媒体文件允许的最大字节数，即五十 MiB。 */
export const MAX_MEDIA_BYTES = 50 * 1024 * 1024
/** 支持的图片扩展名与内容类型映射。 */
const imageTypes: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' }

/** 判断媒体记录是否为视频。 */
export const isVideo = (media: any): boolean => { return media?.media_type === 'video' }
/** 校验媒体大小和格式，不符合要求时抛出错误。 */
export const validateMedia = (metadata: MediaMetadata) => {
  if (!Number.isSafeInteger(metadata.size_bytes) || metadata.size_bytes <= 0) throw new Error('无法确认文件大小，或文件为空')
  if (metadata.size_bytes > MAX_MEDIA_BYTES) throw new Error('单个文件不能超过 50 MiB')
  if (metadata.media_type === 'video') {
    if (metadata.mime_type !== 'video/mp4') throw new Error('视频仅支持 MP4 格式')
  } else if (metadata.media_type !== 'image' || !Object.values(imageTypes).includes(metadata.mime_type)) {
    throw new Error('图片仅支持 JPEG、PNG、WebP、GIF 格式')
  }
}

/** 将内容类型转换为文件扩展名，未知类型默认使用 jpg。 */
export const mediaExtension = (mime: string): string => {
  // key 为遍历到的图片扩展名，用于查找对应内容类型。
  return mime === 'video/mp4' ? 'mp4' : Object.keys(imageTypes).find(key => imageTypes[key] === mime) || 'jpg'
}

/** 读取所选文件的大小和格式，生成并校验媒体元数据。 */
export const inspectMedia = async (filePath: string, kind: 'image' | 'video', name: string = ''): Promise<MediaMetadata> => {
  // 从浏览器或文件系统读取的文件字节数。
  let size = 0
  // 从文件内容或媒体信息识别出的内容类型。
  let mime = ''
  // #ifdef WEB
  // 浏览器读取本地媒体地址的响应。
  const response = await fetch(filePath)
  if (!response.ok) throw new Error('无法读取所选文件')
  // 用于提取文件大小与内容类型的二进制对象。
  const blob = await response.blob()
  size = blob.size
  mime = blob.type.toLowerCase().split(';')[0]
  // #endif
  // #ifndef WEB
  // resolve 返回字节数，reject 传递读取错误；r 为文件信息结果。
  size = await new Promise<number>((resolve, reject) => uni.getFileSystemManager().getFileInfo({
    filePath, success: (r: any) => resolve(r.size), fail: () => reject(new Error('无法读取文件大小'))
  }))
  // #endif
  if (kind === 'image') {
    // 图片识别结果；resolve 接收结果，reject 传递识别失败信息。
    const info: any = await new Promise((resolve, reject) => uni.getImageInfo({ src: filePath, success: resolve, fail: () => reject(new Error('无法识别图片')) }))
    if (info.type) mime = imageTypes[String(info.type).toLowerCase()] || ''
  } else {
    // 视频识别结果；resolve 接收结果，reject 传递识别失败信息。
    const info: any = await new Promise((resolve, reject) => uni.getVideoInfo({ src: filePath, success: resolve, fail: () => reject(new Error('无法识别视频')) }))
    // 统一为小写的视频格式标识。
    const type = String(info.type || '').toLowerCase()
    mime = type === 'mp4' || type === 'video/mp4' ? 'video/mp4' : ''
  }
  // 汇总类型、大小和文件名后待校验的媒体信息。
  const metadata: MediaMetadata = { media_type: kind, mime_type: mime, size_bytes: size, file_name: name || (kind === 'video' ? '我们的视频_' : '我们的照片_') + Date.now() + '.' + mediaExtension(mime) }
  validateMedia(metadata)
  return metadata
}

/** 判断媒体选择失败是否由用户主动取消引起。 */
const cancelled = (error: any): boolean => { return error?.errCode === 1101001 || /cancel/i.test(error?.errMsg || '') }

/** 选择最多九张压缩图片，取消时返回空列表。 */
export const chooseImages = (): Promise<any[]> => {
  // resolve 返回所选文件列表，reject 传递错误；r 为选择结果，path、i 为路径及其索引，e 为失败详情。
  return new Promise((resolve, reject) => uni.chooseImage({
    count: 9,
	// sizeType: ['compressed'],
    success: (r: any) => resolve(r.tempFilePaths.slice(0, 9).map((path: string, i: number) => ({ path, name: r.tempFiles?.[i]?.name || '' }))),
    fail: (e: any) => cancelled(e) ? resolve([]) : reject(new Error('无法选择照片，请检查相册权限'))
  }))
}

/** 从相册或相机选择一个视频，取消时返回空列表。 */
export const chooseOneVideo = (): Promise<any[]> => {
  // resolve 返回所选视频列表，reject 传递错误；r 为选择结果，e 为失败详情。
  return new Promise((resolve, reject) => uni.chooseVideo({
    sourceType: ['album', 'camera'], compressed: false,
    success: (r: any) => resolve([{ path: r.tempFilePath, name: '' }]),
    fail: (e: any) => cancelled(e) ? resolve([]) : reject(new Error('无法选择视频，请检查相册和相机权限'))
  }))
}

/** 将演示媒体持久化到浏览器数据库或应用文件目录。 */
export const persistDemoMedia = async (filePath: string, id: string, metadata: MediaMetadata): Promise<string> => {
  // #ifndef WEB
  // resolve 返回保存后的路径，reject 传递保存错误；r 为文件保存结果。
  return new Promise((resolve, reject) => uni.getFileSystemManager().saveFile({
    tempFilePath: filePath, filePath: uni.env.USER_DATA_PATH + '/pair-media-' + id + '.' + mediaExtension(metadata.mime_type),
    success: (r: any) => resolve(r.savedFilePath), fail: () => reject(new Error('演示文件保存失败，请检查剩余空间'))
  }))
  // #endif
}

/** 从演示媒体记录恢复可访问的本地文件地址。 */
export const restoreDemoMedia = async (media: any): Promise<string> => {
  // #ifdef WEB
  if (media.demo_media) {
    // 从浏览器数据库读取的媒体二进制内容。
    const blob = await demoFileStore('readonly', media.id)
    if (!blob) throw new Error('本地演示文件不存在，请重新添加')
    return URL.createObjectURL(blob)
  }
  // #endif
  if (!media.local) throw new Error('本地演示文件不存在')
  return media.local
}

/** 删除演示记录对应的本地媒体文件。 */
export const removeDemoMedia = async (media: any): Promise<void> => {
  // #ifdef WEB
  if (media.demo_media) await demoFileStore('readwrite', media.id)
  // #endif
  // #ifndef WEB
  // resolve 表示删除完成，reject 传递文件清理错误。
  if (media.local) await new Promise<void>((resolve, reject) => uni.getFileSystemManager().unlink({ filePath: media.local, success: () => resolve(), fail: () => reject(new Error('本地文件清理失败')) }))
  // #endif
}

/** 在浏览器触发下载，或将图片、视频保存到设备相册。 */
export const saveMediaToAlbum = (filePath: string, video: boolean): Promise<void> => {
  // #ifdef WEB
  // 用于触发媒体下载的临时链接元素。
  const link = document.createElement('a')
  link.href = filePath; link.download = 'pair_' + Date.now() + (video ? '.mp4' : '.jpg'); link.click()
  return Promise.resolve()
  // #endif
  // #ifndef WEB
  // resolve 表示相册保存完成，reject 传递保存失败信息。
  return new Promise((resolve, reject) => {
    // 图片与视频保存接口共用的路径及结果回调配置。
    const options = { filePath, success: () => resolve(), fail: () => reject(new Error('保存失败，请检查相册权限和剩余空间')) }
    if (video) uni.saveVideoToPhotosAlbum(options)
    else uni.saveImageToPhotosAlbum(options)
  })
  // #endif
}
