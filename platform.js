(() => {
  'use strict'

  const DATA_KEY = 'minish-tracker:data:v1'
  const CONFIG_KEY = 'minish-tracker:supabase:v1'
  const SESSION_KEY = 'minish-tracker:session:v1'
  const DEVICE_KEY = 'minish-tracker:device-id:v1'
  const TABLE = 'tracker_state'
  const electronApi = window.api?.loadData ? window.api : null
  let syncTimer = null
  let syncRunning = false
  let installPrompt = null

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
    dispatchStatus()
    updatePrivateGate()
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
    const response = await fetch(url, options)
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
    await syncNow()
    return session
  }

  async function signUp(email, password) {
    if (!isConfigReady()) throw new Error('먼저 Supabase 프로젝트 연결 정보를 저장해 주세요.')
    const config = getConfig()
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
    setSession(null)
    dispatchStatus()
  }

  function localModifiedAt(localData) {
    return Date.parse(localData?._sync?.modifiedAt || '') || 0
  }

  function hasMeaningfulData(localData) {
    return Boolean(
      localData && (
        localData.routines?.length ||
        Object.keys(localData.records || {}).length ||
        Object.keys(localData.okr || {}).length ||
        Object.keys(localData.weeklyReviews || {}).length
      )
    )
  }

  async function saveLocalRaw(nextData) {
    return localApi.saveData(nextData)
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
    if (!localData._sync?.modifiedAt) {
      localData._sync = {
        ...(localData._sync || {}),
        deviceId: deviceId(),
        modifiedAt: new Date().toISOString()
      }
      await saveLocalRaw(localData)
    }
    const nextRevision = Number(remoteRevision || 0) + 1
    const body = {
      user_id: session.user.id,
      payload: localData,
      revision: nextRevision,
      client_modified_at: localData._sync.modifiedAt
    }
    const rows = await request(`${config.url}/rest/v1/${TABLE}?on_conflict=user_id`, {
      method: 'POST',
      headers: {
        ...authHeaders(session.access_token),
        Prefer: 'resolution=merge-duplicates,return=representation'
      },
      body: JSON.stringify(body)
    })
    return Array.isArray(rows) ? rows[0] : rows
  }

  async function syncNow() {
    if (syncRunning || !navigator.onLine || !isConfigReady() || !getSession()) return null
    syncRunning = true
    emitStatus('syncing', '동기화 중…')
    try {
      const session = await refreshSessionIfNeeded()
      if (!session) return null
      const localData = await localApi.loadData()
      const remote = await pullCloud(session)

      if (!remote) {
        if (localData) await pushCloud(session, localData)
        emitStatus('connected', '첫 동기화 완료')
        return localData
      }

      const remoteData = remote.payload
      const shouldPull = remoteData && (
        !hasMeaningfulData(localData) ||
        localModifiedAt(remoteData) > localModifiedAt(localData)
      )

      if (shouldPull) {
        await saveLocalRaw(remoteData)
        window.dispatchEvent(new CustomEvent('minish-data-replaced', { detail: remoteData }))
      } else if (localData && localModifiedAt(localData) >= localModifiedAt(remoteData)) {
        await pushCloud(session, localData, remote.revision)
      }

      emitStatus('connected', `동기화 완료 · ${new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`)
      return shouldPull ? remoteData : localData
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
    syncTimer = setTimeout(() => syncNow().catch(() => {}), 1200)
  }

  const storage = {
    async loadData() {
      return localApi.loadData()
    },
    async saveData(nextData) {
      nextData._sync = {
        ...(nextData._sync || {}),
        deviceId: deviceId(),
        modifiedAt: new Date().toISOString()
      }
      const result = await localApi.saveData(nextData)
      if (result?.ok) queueSync()
      return result
    },
    saveDataSync(nextData) {
      nextData._sync = {
        ...(nextData._sync || {}),
        deviceId: deviceId(),
        modifiedAt: new Date().toISOString()
      }
      return localApi.saveDataSync(nextData)
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
    const locked = !electronApi && config.privateMode && !getSession()
    gate.hidden = !locked
    document.body.classList.toggle('web-locked', locked)
    if (message) document.getElementById('privateGateMessage').textContent = message
  }

  function updateSyncUi(detail = {}) {
    const button = document.getElementById('syncButton')
    if (!button) return
    const session = getSession()
    const label = document.getElementById('syncButtonLabel')
    const message = document.getElementById('syncMessage')
    button.dataset.status = detail.status || (session ? 'connected' : 'local')
    label.textContent = detail.status === 'syncing' ? '동기화 중' : session ? '동기화됨' : '로컬 저장'
    if (message && detail.message) message.textContent = detail.message
    document.getElementById('syncAuthFields').hidden = Boolean(session)
    document.getElementById('syncConnected').hidden = !session
    document.getElementById('syncUserEmail').textContent = session?.user?.email || ''
  }

  function wireSyncUi() {
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

    window.addEventListener('minish-sync-status', event => updateSyncUi(event.detail))
    window.addEventListener('online', () => {
      dispatchStatus()
      syncNow().catch(() => {})
    })
    window.addEventListener('offline', dispatchStatus)
    window.addEventListener('focus', () => syncNow().catch(() => {}))
    window.addEventListener('beforeinstallprompt', event => {
      event.preventDefault()
      installPrompt = event
      document.getElementById('installButton').hidden = false
    })

    updatePrivateGate()
    dispatchStatus()
    setTimeout(() => syncNow().catch(() => {}), 1000)
    setInterval(() => syncNow().catch(() => {}), 60000)
  }

  window.minishStorage = storage
  window.minishSync = { getConfig, getSession, setConfig, signIn, signUp, logout, syncNow }

  if ('serviceWorker' in navigator && ['http:', 'https:'].includes(location.protocol)) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(error => {
      console.error('Service worker registration failed:', error)
    }))
  }
  document.addEventListener('DOMContentLoaded', wireSyncUi)
})()
