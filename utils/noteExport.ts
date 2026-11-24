export function exportNoteFile(text: string): Promise<string> {
  const fileName = 'notes_export_' + new Date().toISOString().slice(0, 10) + '.md'
  // #ifdef WEB
  return new Promise((resolve, reject) => {
    try {
      const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = fileName
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      resolve('已触发浏览器下载：' + fileName)
    } catch (e) {
      reject(new Error('浏览器无法创建笔记下载文件'))
    }
  })
  // #endif
  // #ifndef WEB
  return new Promise((resolve, reject) => {
    const directory = uni.env.USER_DATA_PATH
    if (!directory) {
      reject(new Error('无法获取应用用户文件目录，笔记未保存'))
      return
    }
    const path = directory + '/' + fileName
    try {
      uni.getFileSystemManager().writeFile({
        filePath: path,
        data: text,
        encoding: 'utf-8',
        success: () => resolve(path),
        fail: (error: any) => reject(new Error('写入笔记文件失败，未生成文件：' + (error?.errMsg || '文件系统写入错误')))
      })
    } catch (error: any) {
      reject(new Error('无法访问应用用户文件目录，笔记未保存：' + (error?.message || '文件系统初始化失败')))
    }
  })
  // #endif
}
