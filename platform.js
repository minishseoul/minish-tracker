(() => {
  'use strict'

  const DATA_KEY = 'minish-tracker:data:v1'
  const CONFIG_KEY = 'minish-tracker:supabase:v1'
  const SESSION_KEY = 'minish-tracker:session:v1'
  const DEVICE_KEY = 'minish-tracker:device-id:v1'
  const BACKUP_KEY = 'minish-tracker:before-sync:v1'
  const TABLE = 'tracker_state'
  const SyncCore = window.MinishCore
  const electronApi = window.api?.loadData ? window.api : null
  let syncTimer = null
  let syncRunning = false
  let installPrompt = null
  let pendingPasswordSetup = false
  let persistedContent = null
  let persistedData = null
  let localGeneration = 0
  let lastMergeBackup = null
  let authMessage = ''

  function contentOf(value) {
    return value ? SyncCore.stableStringify(SyncCore.trackerContent(value)) : ''
  }

  function validData(value) {
    return Boolean(value && Array.isArray(value.routines) && value.records && value.okr)
  }

  function safeParse(value, fallback = null) {
    try { return JSON.parse(value) } catch { return fallback }
  }

  function deviceId() {
    let value = localStorage.getItem(DEVICE_KEY)
    if (!value) {
      value = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
      localStorage.setItem(DEVICE_KEY, value)
    }
    return value
  }

  const browserApi = {
    async loadData() {
      return safeParse(localStorage.getItem(DATA_KEY))
    },
    async saveData(nextData) {
      try {
        localStorage.setItem(DATA_KEY, JSON.stringify(nextData))
        return { ok: true }
      } catch (error) {
        return { ok: false, error: error.message }
      }
    },
    saveDataSync(nextData) {
      try {
        localStorage.setItem(DATA_KEY, JSON.stringify(nextData))
        return { ok: true }
      } catch (error) {
        return { ok: false, error: error.message }
      }
    },
    openImage() {
      return new Promise(resolve => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = 'image/*'
        input.onchange = () => {
          const file = input.files?.[0]
          if (!file) return resolve(null)
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result)
          reader.onerror = () => resolve(null)
          reader.readAsDataURL(file)
        }
        input.click()
      })
    }
  }

  const localApi = electronApi || browserApi

  function getConfig() {
    const bundled = window.MINISH_SUPABASE || {}
    const saved = safeParse(localStorage.getItem(CONFIG_KEY), {}) || {}
    const privateMode = Boolean(bundled.privateMode)
    return {
      url: String((privateMode ? bundled.url : saved.url || bundled.url) || '').replace(/\/$/, ''),
      anonKey: String((privateMode ? bundled.anonKey : saved.anonKey || bundled.anonKey) || ''),
      privateMode,
      allowedUserId: String(bundled.allowedUserId || '')
    }
  }

  function isConfigReady(config = getConfig()) {
    try {
      const url = new URL(config.url)
      return url.protocol === 'https:' && url.hostname.endsWith('.supabase.co') && config.anonKey.length >= 20
    } catch {
      return false
    }
  }

  function getSession() {
    const session = safeParse(localStorage.getItem(SESSION_KEY))
    const allowedUserId = getConfig().allowedUserId
    if (allowedUserId && session?.user?.id !== allowedUserId) return null
    return session
  }

  function setSession(session) {
    if (session?.access_token && session?.refresh_token) {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    } else {
      localStorage.removeItem(SESSION_KEY)
    }
    pendingPasswordSetup = Boolean(session?.needsPasswordSetup)
    dispatchStatus()
    updatePrivateGate()
  }

  async function consumeAuthRedirect() {
    if (electronApi || !location.hash) return
    const params = new URLSearchParams(location.hash.slice(1))
    const accessToken = params.get('access_token')
    const refreshToken = params.get('refresh_token')
    if (!accessToken || !refreshToken) {
      if (params.has('error')) {
        authMessage = '로그인 링크가 만료되었거나 이미 사용됐습니다. 새 링크를 받아 주세요.'
        history.replaceState({}, document.title, location.pathname + location.search)
      }
      return
    }
    history.replaceState({}, document.title, location.pathname + location.search)
    try {
      const user = await request(`${getConfig().url}/auth/v1/user`, { headers: authHeaders(accessToken) })
      if (getConfig().allowedUserId && user.id !== getConfig().allowedUserId) {
        throw new Error('승인되지 않은 계정입니다.')
      }
      const expiresIn = Number(params.get('expires_in') || 3600)
      setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: expiresIn,
        expires_at: Math.floor(Date.now() / 1000) + expiresIn,
        token_type: params.get('token_type') || 'bearer',
        needsPasswordSetup: ['invite', 'recovery'].includes(params.get('type')),
        user
      })
    } catch {
      authMessage = '로그인 링크를 확인할 수 없습니다. 새 링크를 받아 주세요.'
      setSession(null)
    }
  }

  function emitStatus(status, message) {
    window.dispatchEvent(new CustomEvent('minish-sync-status', {
      detail: { status, message, configured: isConfigReady(), session: getSession() }
    }))
  }

  function dispatchStatus() {
    const session = getSession()
    if (!isConfigReady()) emitStatus('local', 'Supabase 프로젝트 연결 정보가 필요합니다.')
    else if (!session) emitStatus('ready', '프로젝트 연결됨 · 로그인하면 기기 간 동기화됩니다.')
    else if (!navigator.onLine) emitStatus('offline', '오프라인 저장 중 · 연결되면 자동 동기화됩니다.')
    else emitStatus('connected', `${session.user?.email || '계정'} · 자동 동기화 켜짐`)
  }

  function authHeaders(accessToken) {
    const config = getConfig()
    return {
      apikey: config.anonKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  }

  async function request(url, options = {}) {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(20000) })
    const text = await response.text()
    const body = text ? safeParse(text, { message: text }) : null
    if (!response.ok) {
      const error = new Error(body?.msg || body?.message || body?.error_description || `요청 실패 (${response.status})`)
      error.status = response.status
      throw error
    }
    return body
  }

  async function refreshSessionIfNeeded() {
    let session = getSession()
    if (!session) return null
    const expiresAt = Number(session.expires_at || 0) * 1000
    if (expiresAt && expiresAt - Date.now() > 90000) return session

    const config = getConfig()
    try {
      const refreshed = await request(`${config.url}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { apikey: config.anonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: session.refresh_token })
      })
      refreshed.needsPasswordSetup = session.needsPasswordSetup
      setSession(refreshed)
      return refreshed
    } catch (error) {
      if (error.status === 400 || error.status === 401) setSession(null)
      throw error
    }
  }

  async function signIn(email, password) {
    if (!isConfigReady()) throw new Error('먼저 Supabase 프로젝트 연결 정보를 저장해 주세요.')
    const config = getConfig()
    emitStatus('syncing', '로그인 중…')
    const session = await request(`${config.url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: config.anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    })
    if (config.allowedUserId && session.user?.id !== config.allowedUserId) {
      throw new Error('이 계정은 MINISH TRACKER 접근 권한이 없습니다.')
    }
    setSession(session)
    await syncNow().catch(() => {})
    return session
  }

  async function sendMagicLink(email) {
    if (!isConfigReady()) throw new Error('Supabase 연결 정보가 없습니다.')
    if (!email) throw new Error('이메일을 입력해 주세요.')
    const config = getConfig()
    const redirectTo = `${location.origin}${location.pathname}`
    await request(`${config.url}/auth/v1/otp?redirect_to=${encodeURIComponent(redirectTo)}`, {
      method: 'POST',
      headers: { apikey: config.anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, create_user: false })
    })
  }

  async function updatePassword(password) {
    const session = await refreshSessionIfNeeded()
    if (!session) throw new Error('로그인 링크가 만료되었습니다. 새 링크를 받아 주세요.')
    await request(`${getConfig().url}/auth/v1/user`, {
      method: 'PUT',
      headers: authHeaders(session.access_token),
      body: JSON.stringify({ password })
    })
    setSession({ ...session, needsPasswordSetup: false })
    await syncNow().catch(() => {})
  }

  async function signUp(email, password) {
    if (!isConfigReady()) throw new Error('먼저 Supabase 프로젝트 연결 정보를 저장해 주세요.')
    const config = getConfig()
    if (config.privateMode) throw new Error('초대된 계정만 사용할 수 있습니다.')
    emitStatus('syncing', '계정 생성 중…')
    const result = await request(`${config.url}/auth/v1/signup`, {
      method: 'POST',
      headers: { apikey: config.anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    })
    if (result?.access_token) {
      setSession(result)
      await syncNow()
    } else {
      emitStatus('ready', '확인 메일을 보냈습니다. 인증 후 로그인해 주세요.')
    }
    return result
  }

  function logout() {
    pendingPasswordSetup = false
    setSession(null)
    dispatchStatus()
  }

  function hasMeaningfulData(localData) {
    return Boolean(
      localData && (
        localData.routines?.length ||
        Object.keys(localData.records || {}).length ||
        Object.keys(localData.okr || {}).length ||
        Object.keys(localData.weeklyReviews || {}).length ||
        Object.keys(localData.weeklyTargets || {}).length ||
        Object.keys(localData.dailyQuotes || {}).length ||
        localData.quoteHistory?.length || localData.photo
      )
    )
  }

  async function saveLocalRaw(nextData) {
    const result = await localApi.saveData(nextData)
    if (!result?.ok) throw new Error('기기 저장 공간을 확인해 주세요. 기존 기록은 유지했습니다.')
    persistedContent = contentOf(nextData)
    persistedData = JSON.parse(JSON.stringify(nextData))
    return result
  }

  function preserveMergeBackup(local, cloud) {
    if (!hasMeaningfulData(local) || !hasMeaningfulData(cloud) || contentOf(local) === contentOf(cloud)) return
    lastMergeBackup = { savedAt: new Date().toISOString(), local, cloud }
    try { localStorage.setItem(BACKUP_KEY, JSON.stringify(lastMergeBackup)) } catch {}
  }

  async function pullCloud(session) {
    const config = getConfig()
    const query = new URLSearchParams({
      select: 'payload,revision,updated_at',
      user_id: `eq.${session.user.id}`,
      limit: '1'
    })
    const rows = await request(`${config.url}/rest/v1/${TABLE}?${query}`, {
      headers: authHeaders(session.access_token)
    })
    return Array.isArray(rows) ? rows[0] || null : null
  }

  async function pushCloud(session, localData, remoteRevision = 0) {
    const config = getConfig()
    localData = SyncCore.ensureTrackerVersions(localData)
    const nextRevision = Number(remoteRevision || 0) + 1
    const body = {
      user_id: session.user.id,
      payload: localData,
      revision: nextRevision,
      client_modified_at: localData._sync.modifiedAt
    }
    const query = remoteRevision ? `?user_id=eq.${session.user.id}&revision=eq.${remoteRevision}` : '?on_conflict=user_id'
    const rows = await request(`${config.url}/rest/v1/${TABLE}${query}`, {
      method: remoteRevision ? 'PATCH' : 'POST',
      headers: {
        ...authHeaders(session.access_token),
        Prefer: remoteRevision ? 'return=representation' : 'resolution=ignore-duplicates,return=representation'
      },
      body: JSON.stringify(body)
    })
    return Array.isArray(rows) ? rows[0] || null : null
  }

  async function syncNow() {
    if (syncRunning || pendingPasswordSetup || !navigator.onLine || !isConfigReady() || !getSession()) return null
    syncRunning = true
    emitStatus('syncing', '동기화 중…')
    try {
      const session = await refreshSessionIfNeeded()
      if (!session) return null
      window.dispatchEvent(new CustomEvent('minish-before-sync'))
      const generation = localGeneration
      const localData = await localApi.loadData()
      const markSynced = async (value, revision, replace = false) => {
        window.dispatchEvent(new CustomEvent('minish-before-sync'))
        if (generation !== localGeneration) { queueSync(); return }
        const next = JSON.parse(JSON.stringify(value))
        next._sync = { ...next._sync, baseRevision: revision, dirty: false, dirtyPaths: [] }
        await saveLocalRaw(next)
        if (generation !== localGeneration) { queueSync(); return }
        window.dispatchEvent(new CustomEvent(replace ? 'minish-data-replaced' : 'minish-sync-meta', { detail: next }))
        document.getElementById('syncConflict').hidden = true
      }
      for (let attempt = 0; attempt < 5; attempt++) {
        const remote = await pullCloud(session)
        if (generation !== localGeneration || getSession()?.access_token !== session.access_token) {
          queueSync(); return null
        }
        if (!remote) {
          if (!hasMeaningfulData(localData)) {
            emitStatus('connected', '클라우드 자동 저장 준비됨'); return localData
          }
          const candidate = SyncCore.ensureTrackerVersions(localData)
          const pushed = await pushCloud(session, candidate)
          if (!pushed) continue
          await markSynced(candidate, pushed.revision)
          emitStatus('connected', '클라우드 자동 저장 완료')
          return candidate
        }
        const remoteData = remote.payload
        if (!validData(remoteData)) throw new Error('클라우드 기록 형식이 올바르지 않아 기존 기록을 유지했습니다.')
        if (!validData(localData)) {
          await markSynced(remoteData, remote.revision, true)
          emitStatus('connected', '클라우드 최신 기록 적용 완료')
          return remoteData
        }
        preserveMergeBackup(localData, remoteData)
        const rebased = SyncCore.rebaseTrackerChanges(localData, remoteData)
        const merged = SyncCore.mergeTrackerData(rebased, remoteData)
        const remoteIsCurrent = contentOf(merged) === contentOf(remoteData) && remoteData._sync?.mergeSchema === 1
        if (remoteIsCurrent) {
          await markSynced(merged, remote.revision, contentOf(localData) !== contentOf(merged))
          emitStatus('connected', `클라우드 최신 기록 적용 · ${new Date().toLocaleTimeString('ko-KR', { hour:'2-digit', minute:'2-digit' })}`)
          return merged
        }
        const pushed = await pushCloud(session, merged, remote.revision)
        if (!pushed) continue
        await markSynced(merged, pushed.revision, contentOf(localData) !== contentOf(merged))
        emitStatus('connected', `클라우드 자동 저장 완료 · ${new Date().toLocaleTimeString('ko-KR', { hour:'2-digit', minute:'2-digit' })}`)
        return merged
      }
      throw new Error('동시에 변경된 내용을 자동 병합하는 중입니다. 잠시 후 다시 시도합니다.')
    } catch (error) {
      console.error('Supabase sync failed:', error)
      emitStatus('error', `동기화 실패 · ${error.message}`)
      throw error
    } finally {
      syncRunning = false
    }
  }

  function queueSync() {
    clearTimeout(syncTimer)
    syncTimer = setTimeout(() => syncNow().catch(() => {}), 100)
  }

  const storage = {
    async loadData() {
      const value = await localApi.loadData()
      persistedContent = contentOf(value)
      persistedData = value ? JSON.parse(JSON.stringify(value)) : null
      return value
    },
    async saveData(nextData) {
      if (contentOf(nextData) === persistedContent) return { ok: true }
      localGeneration++
      const marked = SyncCore.markTrackerChanges(nextData, persistedData || {}, deviceId())
      nextData._sync = marked._sync
      const result = await localApi.saveData(marked)
      if (result?.ok) { persistedContent = contentOf(marked); persistedData = JSON.parse(JSON.stringify(marked)); queueSync() }
      return result
    },
    saveDataSync(nextData) {
      if (contentOf(nextData) === persistedContent) return { ok: true }
      localGeneration++
      const marked = SyncCore.markTrackerChanges(nextData, persistedData || {}, deviceId())
      nextData._sync = marked._sync
      const result = localApi.saveDataSync(marked)
      if (result?.ok) { persistedContent = contentOf(marked); persistedData = JSON.parse(JSON.stringify(marked)); queueSync() }
      return result
    },
    openImage: () => localApi.openImage()
  }

  function setConfig(url, anonKey) {
    const config = { url: String(url || '').trim().replace(/\/$/, ''), anonKey: String(anonKey || '').trim() }
    if (!isConfigReady(config)) throw new Error('올바른 Supabase Project URL과 publishable/anon key를 입력해 주세요.')
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config))
    setSession(null)
    dispatchStatus()
  }

  function updatePrivateGate(message = '') {
    const gate = document.getElementById('privateGate')
    if (!gate) return
    const config = getConfig()
    const locked = !electronApi && config.privateMode && (!getSession() || pendingPasswordSetup)
    gate.hidden = !locked
    document.body.classList.toggle('web-locked', locked)
    const setup = document.getElementById('privatePasswordSetup')
    const standard = [
      document.getElementById('privateEmail')?.closest('label'),
      document.getElementById('privatePassword')?.closest('label'),
      document.getElementById('privateLogin'),
      document.getElementById('privateMagicLink')
    ]
    if (setup) setup.hidden = !pendingPasswordSetup
    standard.forEach(element => {
      if (element) element.hidden = pendingPasswordSetup
    })
    if (pendingPasswordSetup && !message) {
      document.getElementById('privateGateMessage').textContent = '초대 승인이 완료되었습니다. 사용할 비밀번호를 만들어 주세요.'
    }
    if (message) document.getElementById('privateGateMessage').textContent = message
  }

  function updateSyncUi(detail = {}) {
    const button = document.getElementById('syncButton')
    if (!button) return
    const session = getSession()
    const label = document.getElementById('syncButtonLabel')
    const message = document.getElementById('syncMessage')
    button.dataset.status = detail.status || (session ? 'connected' : 'local')
    label.textContent = ({ syncing: '클라우드 저장 중', error: '연결 확인', offline: '오프라인 저장' })[detail.status] || (session ? '클라우드 저장됨' : '로컬 저장')
    if (message && detail.message) message.textContent = detail.message
    document.getElementById('syncAuthFields').hidden = Boolean(session)
    document.getElementById('syncConnected').hidden = !session
    document.getElementById('syncUserEmail').textContent = session?.user?.email || ''
  }

  async function wireSyncUi() {
    const overlay = document.getElementById('syncOverlay')
    const config = getConfig()
    document.getElementById('syncProjectUrl').value = config.url
    document.getElementById('syncAnonKey').value = config.anonKey
    if (config.privateMode && isConfigReady(config)) {
      document.getElementById('syncProjectFields').hidden = true
      document.getElementById('syncSignup').hidden = true
    }

    document.getElementById('syncButton').addEventListener('click', () => overlay.classList.add('visible'))
    document.getElementById('syncClose').addEventListener('click', () => overlay.classList.remove('visible'))
    overlay.addEventListener('click', event => {
      if (event.target === overlay) overlay.classList.remove('visible')
    })
    document.getElementById('syncSaveProject').addEventListener('click', () => {
      try {
        setConfig(
          document.getElementById('syncProjectUrl').value,
          document.getElementById('syncAnonKey').value
        )
        emitStatus('ready', '프로젝트 연결 정보를 저장했습니다. 이제 로그인해 주세요.')
      } catch (error) {
        emitStatus('error', error.message)
      }
    })
    document.getElementById('syncLogin').addEventListener('click', async () => {
      try {
        await signIn(
          document.getElementById('syncEmail').value.trim(),
          document.getElementById('syncPassword').value
        )
        document.getElementById('syncPassword').value = ''
      } catch (error) {
        emitStatus('error', `로그인 실패 · ${error.message}`)
      }
    })
    document.getElementById('syncSignup').addEventListener('click', async () => {
      try {
        await signUp(
          document.getElementById('syncEmail').value.trim(),
          document.getElementById('syncPassword').value
        )
        document.getElementById('syncPassword').value = ''
      } catch (error) {
        emitStatus('error', `계정 생성 실패 · ${error.message}`)
      }
    })
    document.getElementById('syncLogout').addEventListener('click', logout)
    document.getElementById('syncNow').addEventListener('click', () => syncNow().catch(() => {}))
    document.getElementById('syncSetPassword').hidden = Boolean(electronApi)
    document.getElementById('syncSetPassword').addEventListener('click', () => {
      const session = getSession()
      if (!session) return
      overlay.classList.remove('visible')
      setSession({ ...session, needsPasswordSetup: true })
    })
    document.getElementById('syncBackup').addEventListener('click', () => {
      const backup = lastMergeBackup || safeParse(localStorage.getItem(BACKUP_KEY))
      if (!backup) { emitStatus('ready', '아직 자동 병합 백업이 없습니다.'); return }
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `minish-sync-backup-${new Date().toISOString().slice(0, 10)}.json`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    })
    document.getElementById('installButton').addEventListener('click', async () => {
      if (!installPrompt) return
      await installPrompt.prompt()
      installPrompt = null
      document.getElementById('installButton').hidden = true
    })
    document.getElementById('privateLogin').addEventListener('click', async () => {
      const button = document.getElementById('privateLogin')
      const message = document.getElementById('privateGateMessage')
      button.disabled = true
      message.textContent = '계정을 확인하고 있습니다…'
      try {
        await signIn(
          document.getElementById('privateEmail').value.trim(),
          document.getElementById('privatePassword').value
        )
        document.getElementById('privatePassword').value = ''
      } catch (error) {
        setSession(null)
        updatePrivateGate(`접속 실패 · ${error.message}`)
      } finally {
        button.disabled = false
      }
    })
    document.getElementById('privateMagicLink').addEventListener('click', async () => {
      const button = document.getElementById('privateMagicLink')
      const message = document.getElementById('privateGateMessage')
      button.disabled = true
      message.textContent = '로그인 링크를 보내고 있습니다…'
      try {
        await sendMagicLink(document.getElementById('privateEmail').value.trim())
        message.textContent = '로그인 링크를 보냈습니다. 메일에서 링크를 열어 주세요.'
      } catch (error) {
        message.textContent = `전송 실패 · ${error.message}`
      } finally {
        button.disabled = false
      }
    })
    document.getElementById('privateSavePassword').addEventListener('click', async () => {
      const button = document.getElementById('privateSavePassword')
      const message = document.getElementById('privateGateMessage')
      const password = document.getElementById('privateNewPassword').value
      const confirmation = document.getElementById('privateNewPasswordConfirm').value
      if (password.length < 8) {
        message.textContent = '비밀번호는 8자 이상으로 입력해 주세요.'
        return
      }
      if (password !== confirmation) {
        message.textContent = '두 비밀번호가 서로 다릅니다.'
        return
      }
      button.disabled = true
      message.textContent = '비밀번호를 안전하게 저장하고 있습니다…'
      try {
        await updatePassword(password)
        document.getElementById('privateNewPassword').value = ''
        document.getElementById('privateNewPasswordConfirm').value = ''
      } catch (error) {
        message.textContent = `저장 실패 · ${error.message}`
      } finally {
        button.disabled = false
      }
    })

    window.addEventListener('minish-sync-status', event => updateSyncUi(event.detail))
    window.addEventListener('online', () => {
      dispatchStatus()
      syncNow().catch(() => {})
    })
    window.addEventListener('offline', dispatchStatus)
    window.addEventListener('focus', () => syncNow().catch(() => {}))
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') syncNow().catch(() => {})
    })
    window.addEventListener('beforeinstallprompt', event => {
      event.preventDefault()
      installPrompt = event
      document.getElementById('installButton').hidden = false
    })

    await authReady
    pendingPasswordSetup = Boolean(getSession()?.needsPasswordSetup)
    updatePrivateGate(authMessage)
    dispatchStatus()
    setTimeout(() => syncNow().catch(() => {}), 1000)
    setInterval(() => {
      if (document.visibilityState !== 'hidden') syncNow().catch(() => {})
    }, 5000)
  }

  window.minishStorage = storage
  window.minishSync = { getConfig, getSession, setConfig, signIn, signUp, sendMagicLink, logout, syncNow,
    readySession: () => pendingPasswordSetup ? Promise.resolve(null) : refreshSessionIfNeeded() }

  const authReady = consumeAuthRedirect()

  if ('serviceWorker' in navigator && ['http:', 'https:'].includes(location.protocol)) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(error => {
      console.error('Service worker registration failed:', error)
    }))
  }
  document.addEventListener('DOMContentLoaded', wireSyncUi)
})()
