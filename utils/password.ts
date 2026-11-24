/** 用旧密码验证指定账号后修改密码，通过 currentScope 检查连接范围是否变化。 */
export const changeAccountPassword = (url: string, apiKey: string, email: string, oldPassword: string, newPassword: string, expectedUserId: string, currentScope: () => string): Promise<void> => {
  // 操作开始时的项目与账号范围，用于阻止跨会话修改。
  const scope = currentScope()
  if (!email || !expectedUserId) return Promise.reject(new Error('当前登录身份无效，请重新登录'))
  /** 携带指定令牌发送认证请求并统一处理错误。 */
  const authRequest = (path: string, method: string, data: any, token: string): Promise<any> => {
    // resolve 返回认证数据，reject 传递请求错误。
    return new Promise((resolve, reject) => {
      uni.request({
        url: url + path,
        method: method as any,
        timeout: 15000,
        data,
        header: { apikey: apiKey, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        // response 为认证服务返回的状态码和响应内容。
        success: (response: any) => {
          if (response.statusCode >= 200 && response.statusCode < 300) resolve(response.data)
          else reject(new Error(response.data?.msg || response.data?.message || response.data?.error_description || response.data?.error || '请求失败 ' + response.statusCode))
        },
        fail: () => reject(new Error('网络连接失败，请检查网络和项目地址'))
      })
    })
  }
  // session 为旧密码验证取得的临时会话，修改结束后仅注销此会话。
  return authRequest('/auth/v1/token?grant_type=password', 'POST', { email, password: oldPassword }, apiKey).then(async session => {
    try {
      if (currentScope() !== scope || session?.user?.id !== expectedUserId) throw new Error('账号或项目连接已变更，密码未修改')
      await authRequest('/auth/v1/user', 'PUT', { password: newPassword }, session.access_token)
      if (currentScope() !== scope) throw new Error('项目连接已变更，请检查账号密码状态')
    } finally {
      try { await authRequest('/auth/v1/logout?scope=local', 'POST', {}, session.access_token) } catch (_) {}
    }
  })
}
