/** 将笔记导出为 Markdown，返回下载提示或已保存的文件路径。 */
export const exportNoteFile = (text: string): Promise<string> => {
  // 以当前日期命名的导出文件名。
  const fileName = 'notes_export_' + new Date().toISOString().slice(0, 10) + '.md'
  // #ifdef WEB
  // resolve 返回下载提示，reject 传递浏览器导出失败信息。
  return new Promise((resolve, reject) => {
    try {
      // 带有 Markdown 类型和字符编码的文件内容。
      const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
      // 供下载使用、稍后释放的临时对象地址。
      const url = URL.createObjectURL(blob)
      // 用于触发浏览器下载的链接元素。
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
  // resolve 返回保存路径，reject 传递目录访问或文件写入错误。
  return new Promise((resolve, reject) => {
    // 应用可写的用户文件目录。
    const directory = uni.env.USER_DATA_PATH
    if (!directory) {
      reject(new Error('无法获取应用用户文件目录，笔记未保存'))
      return
    }
    // 笔记导出文件的完整保存路径。
    const path = directory + '/' + fileName
    try {
      uni.getFileSystemManager().writeFile({
        filePath: path,
        data: text,
        encoding: 'utf-8',
        success: () => resolve(path),
        // error 为文件系统写入失败时的错误详情。
        fail: (error: any) => reject(new Error('写入笔记文件失败，未生成文件：' + (error?.errMsg || '文件系统写入错误')))
      })
    } catch (error: any) {
      // error 为文件系统初始化或同步调用时抛出的异常。
      reject(new Error('无法访问应用用户文件目录，笔记未保存：' + (error?.message || '文件系统初始化失败')))
    }
  })
  // #endif
}
