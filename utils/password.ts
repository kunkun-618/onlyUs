export function changeAccountPassword(url: string, apiKey: string, email: string, oldPassword: string, newPassword: string, expectedUserId: string, currentScope: () => string): Promise<void> {
  const scope = currentScope()
  if (!email || !expectedUserId) return Promise.reject(new Error('当前登录身份无效，请重新登录'))
  function authRequest(path: string, method: string, data: any, token: string): Promise<any> {
    return new Promise((resolve, reject) => {
      uni.request({
        url: url + path,
        method: method as any,
        timeout: 15000,
        data,
        header: { apikey: apiKey, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        success: (response: any) => {
          if (response.statusCode >= 200 && response.statusCode < 300) resolve(response.data)
          else reject(new Error(response.data?.msg || response.data?.message || response.data?.error_description || response.data?.error || '请求失败 ' + response.statusCode))
        },
        fail: () => reject(new Error('网络连接失败，请检查网络和项目地址'))
      })
    })
  }
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
