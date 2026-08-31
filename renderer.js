// ─── Constants ──────────────────────────────────────────────────

const STATUS = {
  0: { label: '기록 없음', cls: 's0' },
  1: { label: '달성',      cls: 's1' },
  2: { label: '양호',      cls: 's2' },
  3: { label: '아쉬움',    cls: 's3' },
  4: { label: '미달성',    cls: 's4' }
}

const DAY_KO  = ['일', '월', '화', '수', '목', '금', '토']
const MONTH_KO = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월']

// ─── App State ──────────────────────────────────────────────────

let data = {
  routines: [],
  records: {},
  okr: {},
  weeklyTargets: {},
  weeklyReviews: {},
  dailyQuotes: {},
  quoteHistory: [],
  photo: null
}

let weekOffset        = 0
let activePeriod      = 'week'
let activeView        = 'tracker'
let saveTimer         = null
let saveRetryTimer    = null
let ctxTarget         = null
let drag              = null
let pendingDeleteIdx  = null
const goalOffsets = { year: 0, quarter: 0, month: 0 }
let goalDashboardScope = 'week'

// ─── Date Helpers ────────────────────────────────────────────────

function toDK(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function todayDK() { return toDK(new Date()) }

function getWeekDates(offset) {
  const today = new Date()
  const dow   = today.getDay()
  const toMon = dow === 0 ? -6 : 1 - dow
  const mon   = new Date(today)
  mon.setDate(today.getDate() + toMon + offset * 7)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mon)
    d.setDate(mon.getDate() + i)
    return d
  })
}

function getISOWeekInfo(date) {
  const d   = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const jan1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return {
    year: d.getUTCFullYear(),
    week: Math.ceil((((d - jan1) / 86400000) + 1) / 7)
  }
}

function getPeriodDate(period) {
  if (period === 'week') return getWeekDates(weekOffset)[0]
  const date = new Date()
  date.setDate(1)
  if (period === 'year') date.setFullYear(date.getFullYear()+goalOffsets.year)
  else date.setMonth(date.getMonth()+goalOffsets[period]*(period==='quarter'?3:1))
  return date
}

function getWeekKey(date) {
  const { year, week } = getISOWeekInfo(date)
  return `${year}-W${String(week).padStart(2, '0')}`
}

function getViewedWeekKey() {
  return getWeekKey(getWeekDates(weekOffset)[0])
}

function formatWeekRange(dates) {
  const fmt = d => `${d.getMonth()+1}월 ${d.getDate()}일`
  if (dates[0].getMonth() === dates[6].getMonth()) {
    return `${dates[0].getMonth()+1}월 ${dates[0].getDate()}일 — ${dates[6].getDate()}일`
  }
  return `${fmt(dates[0])} — ${fmt(dates[6])}`
}

function getOKRKey(period) {
  const date = getPeriodDate(period)
  const y = date.getFullYear()
  const m = date.getMonth() + 1
  switch (period) {
    case 'year':    return `${y}`
    case 'quarter': return `${y}-Q${Math.ceil(m / 3)}`
    case 'month':   return `${y}-${String(m).padStart(2, '0')}`
    case 'week':    return getWeekKey(date)
  }
}

function getOKRLabel(period) {
  const date = getPeriodDate(period)
  const y = date.getFullYear()
  const m = date.getMonth() + 1
  switch (period) {
    case 'year':    return `${y}년`
    case 'quarter': return `${y} Q${Math.ceil(m / 3)}`
    case 'month':   return `${y} ${MONTH_KO[m - 1]}`
    case 'week': {
      const info = getISOWeekInfo(date)
      return `${info.year}년 ${info.week}주차`
    }
  }
}

// ─── Day Helpers ──────────────────────────────────────────────

const DAY_LABELS = ['일','월','화','수','목','금','토']

function isTargetDay(routine, dow) {
  return !routine.days || routine.days.includes(dow)
}

function isValidDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false
  const date = new Date(`${value}T00:00:00`)
  return !Number.isNaN(date.getTime()) && toDK(date) === value
}

function isRoutineActiveOnDate(routine, date) {
  return !isValidDateKey(routine.endDate) || toDK(date) <= routine.endDate
}

function getRoutineEligibleDates(routine, dates = getWeekDates(weekOffset)) {
  return dates.filter(date =>
    isRoutineActiveOnDate(routine, date) && isTargetDay(routine, date.getDay())
  )
}

function isRoutineVisibleInWeek(routine, dates = getWeekDates(weekOffset)) {
  return dates.some(date => isRoutineActiveOnDate(routine, date))
}

function formatEndDate(value) {
  if (!isValidDateKey(value)) return null
  const [, month, day] = value.split('-').map(Number)
  return `${month}/${day}까지`
}

function formatDaysList(days) {
  if (!days || days.length === 7) return null
  return [...days].sort((a, b) => a - b).map(d => DAY_LABELS[d]).join(' · ')
}

function getWeeklyTarget(routine, weekKey = getViewedWeekKey()) {
  const value = data.weeklyTargets?.[weekKey]?.[routine.id]
  return Number.isInteger(value) && value >= 1 && value <= 7 ? value : null
}

function getRoutineWeekDone(routine, dates = getWeekDates(weekOffset)) {
  return dates.reduce((count, date) => {
    if (!isRoutineActiveOnDate(routine, date)) return count
    if (!isTargetDay(routine, date.getDay())) return count
    const status = (data.records[toDK(date)] || {})[routine.id] || 0
    return count + (status === 1 || status === 2 ? 1 : 0)
  }, 0)
}

function getRoutineMetaLabel(routine, dates) {
  const parts = []
  const target = getWeeklyTarget(routine)
  const days = formatDaysList(routine.days)
  const endDate = formatEndDate(routine.endDate)

  if (target) {
    const effectiveTarget = Math.min(target, getRoutineEligibleDates(routine, dates).length)
    const done = Math.min(getRoutineWeekDone(routine, dates), effectiveTarget)
    if (effectiveTarget > 0) parts.push(`주 ${effectiveTarget}회 · ${done}/${effectiveTarget}`)
  }
  if (days) parts.push(days)
  if (endDate) parts.push(endDate)
  return parts.join('  ·  ')
}

// ─── Weekly Stats ─────────────────────────────────────────────

function calcWeeklyStats() {
  const dates = getWeekDates(weekOffset)
  const today = todayDK()
  const past  = dates.filter(d => toDK(d) <= today)

  let total = 0, done = 0

  data.routines.filter(r => isRoutineVisibleInWeek(r, dates)).forEach(r => {
    const weeklyTarget = getWeeklyTarget(r)
    if (weeklyTarget) {
      const effectiveTarget = Math.min(weeklyTarget, getRoutineEligibleDates(r, dates).length)
      total += effectiveTarget
      done += Math.min(getRoutineWeekDone(r, dates), effectiveTarget)
      return
    }

    past.forEach(date => {
      if (!isRoutineActiveOnDate(r, date)) return
      if (!isTargetDay(r, date.getDay())) return
      total++
      const s = (data.records[toDK(date)] || {})[r.id] || 0
      if (s === 1 || s === 2) done++
    })
  })

  const pct = total > 0 ? Math.round(done / total * 100) : 0
  return { total, done, pct }
}

function renderStats() {
  const { total, done, pct } = calcWeeklyStats()
  const fill    = document.getElementById('statsBarFill')
  const pctEl   = document.getElementById('statsPercent')
  const detail  = document.getElementById('statsDetail')

  if (fill)   fill.style.width = `${pct}%`
  if (pctEl)  pctEl.textContent = `${pct}%`
  if (detail) {
    if (data.routines.length === 0) {
      detail.textContent = '루틴을 추가해 시작하세요'
    } else {
      detail.textContent = `${done} / ${total} 완료`
    }
  }
}

// ─── Weekly Review ──────────────────────────────────────────────

function getRoutineReviewData(routine, dates) {
  const eligibleDates = getRoutineEligibleDates(routine, dates)
  const configuredTarget = getWeeklyTarget(routine)
  const target = configuredTarget ? Math.min(configuredTarget, eligibleDates.length) : eligibleDates.length
  const statuses = { 1: 0, 2: 0, 3: 0, 4: 0 }

  eligibleDates.forEach(date => {
    const status = (data.records[toDK(date)] || {})[routine.id] || 0
    if (status >= 1 && status <= 4) statuses[status]++
  })

  const completedRaw = statuses[1] + statuses[2]
  const done = Math.min(completedRaw, target)
  const pct = target > 0 ? Math.min(100, Math.round(done / target * 100)) : 0
  return { routine, target, done, pct, statuses }
}

function renderReview() {
  renderGoalDashboard()
  const dates = getWeekDates(weekOffset)
  const weekInfo = getISOWeekInfo(dates[0])
  const routineStats = data.routines
    .filter(routine => isRoutineVisibleInWeek(routine, dates))
    .map(routine => getRoutineReviewData(routine, dates))
  const total = routineStats.reduce((sum, item) => sum + item.target, 0)
  const done = routineStats.reduce((sum, item) => sum + item.done, 0)
  const pct = total > 0 ? Math.round(done / total * 100) : 0

  document.getElementById('reviewWeekTitle').textContent = `${weekInfo.year}년 ${weekInfo.week}주차`
  document.getElementById('reviewWeekRange').textContent = formatWeekRange(dates)
  document.getElementById('reviewPercent').textContent = `${pct}%`
  document.getElementById('reviewProgressFill').style.width = `${pct}%`
  document.getElementById('reviewDone').textContent = `${done} / ${total}`

  const ranked = routineStats
    .filter(item => item.done > 0)
    .sort((a, b) => b.pct - a.pct || b.done - a.done)
  const best = ranked[0]
  document.getElementById('reviewBest').textContent = best ? best.routine.name : '—'
  document.getElementById('reviewBestDetail').textContent = best
    ? `${best.done}/${best.target} 완료 · ${best.pct}%`
    : '기록을 시작해 보세요'

  const routineList = document.getElementById('routineReviewList')
  if (routineStats.length === 0) {
    routineList.innerHTML = '<div class="review-empty">체커보드에 루틴을 추가하면 주간 성과가 표시됩니다.</div>'
  } else {
    routineList.innerHTML = routineStats.map(item => `
      <div class="routine-review-item">
        <div class="routine-review-head">
          <span class="routine-review-name">${esc(item.routine.name)}</span>
          <span class="routine-review-score">${item.done}/${item.target} · ${item.pct}%</span>
        </div>
        <div class="routine-review-bar"><span style="width:${item.pct}%"></span></div>
      </div>`).join('')
  }

  const statusTotals = { 1: 0, 2: 0, 3: 0, 4: 0 }
  routineStats.forEach(item => {
    Object.keys(statusTotals).forEach(status => {
      statusTotals[status] += item.statuses[status]
    })
  })
  const recorded = Object.values(statusTotals).reduce((sum, count) => sum + count, 0)
  const statusList = document.getElementById('statusReviewList')
  statusList.innerHTML = [1, 2, 3, 4].map(status => {
    const share = recorded > 0 ? Math.round(statusTotals[status] / recorded * 100) : 0
    return `
      <div class="status-review-item">
        <span class="status-review-dot ${STATUS[status].cls}"></span>
        <span class="status-review-label">${STATUS[status].label}</span>
        <span class="status-review-count">${statusTotals[status]}</span>
        <div class="status-review-bar"><span class="${STATUS[status].cls}" style="width:${share}%"></span></div>
      </div>`
  }).join('')

  const comment = data.weeklyReviews[getViewedWeekKey()] || ''
  document.getElementById('weeklyReviewComment').value = comment
  document.getElementById('reviewSaveState').textContent = comment ? '저장됨' : '자동 저장'
}

function persistWeeklyReview() {
  const key = getViewedWeekKey()
  const value = document.getElementById('weeklyReviewComment').value.trim()
  if (value) data.weeklyReviews[key] = value
  else delete data.weeklyReviews[key]
  document.getElementById('reviewSaveState').textContent = '저장 중…'
  debounceSave()
}

// ─── Daily Sentence ────────────────────────────────────────────

const MEDITATIONS = 'Marcus Aurelius · Meditations'
const LETTERS = 'Seneca · Moral Letters'
const DISCOURSES = 'Epictetus · Discourses'
const TUSCULAN = 'Cicero · Tusculan Disputations'
const quote = (english, korean, inspiredBy) => ({ english, korean, inspiredBy })

const FALLBACK_QUOTES = [
  quote('Master the next choice; leave tomorrow unopened.', '다음 선택을 다스리고 내일은 아직 열지 마라.', DISCOURSES),
  quote('A calm beginning gives the whole day better shape.', '차분한 시작은 하루 전체에 더 나은 모양을 준다.', MEDITATIONS),
  quote('Do the worthy thing before the easy thing.', '쉬운 일보다 가치 있는 일을 먼저 하라.', LETTERS),
  quote('Let effort speak where excuses once stood.', '변명이 서 있던 자리에 노력이 말하게 하라.', MEDITATIONS),
  quote('Your peace begins where comparison finally ends.', '비교가 끝나는 곳에서 평온이 시작된다.', DISCOURSES),
  quote('Use the obstacle; do not merely endure it.', '장애물을 견디는 데서 그치지 말고 활용하라.', MEDITATIONS),
  quote('Today needs your attention, not your anxiety.', '오늘에 필요한 것은 불안이 아니라 집중이다.', LETTERS),
  quote('A smaller promise kept outweighs a grand intention.', '지킨 작은 약속은 거대한 의도보다 무겁다.', TUSCULAN),
  quote('Begin gently, then continue with unshaken purpose.', '부드럽게 시작하고 흔들림 없는 뜻으로 이어가라.', MEDITATIONS),
  quote('What you repeat quietly becomes your character.', '조용히 반복한 것이 결국 너의 품성이 된다.', LETTERS),
  quote('Guard your judgment; events cannot enter without it.', '판단을 지켜라. 사건은 허락 없이 들어오지 못한다.', DISCOURSES),
  quote('The present hour is enough for honest work.', '정직한 일을 하기엔 지금 이 시간이면 충분하다.', MEDITATIONS),
  quote('Meet delay with method, not with complaint.', '지연을 불평이 아니라 방식으로 맞이하라.', LETTERS),
  quote('Freedom grows each time impulse loses command.', '충동이 명령권을 잃을 때마다 자유가 자란다.', DISCOURSES),
  quote('Choose clarity even when comfort asks otherwise.', '편안함이 말려도 명료함을 선택하라.', TUSCULAN),
  quote('A disciplined morning makes fortune less powerful.', '절제된 아침은 운명의 힘을 줄인다.', MEDITATIONS),
  quote('Spend energy only where action remains possible.', '행동할 수 있는 곳에만 힘을 써라.', DISCOURSES),
  quote('Let principle decide before mood begins negotiating.', '기분이 흥정하기 전에 원칙이 결정하게 하라.', LETTERS),
  quote('The mind steadies when the task becomes specific.', '할 일이 구체적일수록 마음은 안정된다.', MEDITATIONS),
  quote('Courage is often one quiet step repeated.', '용기는 대개 조용한 한 걸음의 반복이다.', TUSCULAN),
  quote('Refuse the first complaint; keep your freedom.', '첫 불평을 거절하고 자유를 지켜라.', DISCOURSES),
  quote('Make this hour answerable to your values.', '이 한 시간이 너의 가치에 답하게 하라.', MEDITATIONS),
  quote('Nothing is wasted when character is strengthened.', '품성이 단단해진다면 어떤 일도 낭비가 아니다.', LETTERS),
  quote('Act well before asking whether it feels good.', '기분을 묻기 전에 먼저 바르게 행동하라.', TUSCULAN),
  quote('The day becomes lighter when desire becomes simpler.', '욕망이 단순해질수록 하루는 가벼워진다.', LETTERS),
  quote('Keep the standard; release the applause.', '기준은 지키고 박수는 놓아주어라.', MEDITATIONS),
  quote('Your response is the part fortune cannot own.', '너의 대응은 운명이 소유할 수 없는 몫이다.', DISCOURSES),
  quote('Practice calm before the world requests it.', '세상이 요구하기 전에 평온을 연습하라.', TUSCULAN),
  quote('One completed duty quiets many imagined fears.', '완수한 의무 하나가 수많은 상상의 두려움을 잠재운다.', LETTERS),
  quote('Do not decorate the plan; begin the work.', '계획을 꾸미지 말고 일을 시작하라.', MEDITATIONS),
  quote('A clear no protects a meaningful yes.', '분명한 거절은 의미 있는 승낙을 지킨다.', DISCOURSES),
  quote('Let today be measured by conduct, not outcome.', '오늘을 결과가 아니라 태도로 평가하라.', TUSCULAN),
  quote('Patience is strength that has learned its pace.', '인내는 자신의 속도를 배운 힘이다.', LETTERS),
  quote('Return to the task whenever the mind wanders.', '마음이 흩어질 때마다 할 일로 돌아와라.', MEDITATIONS),
  quote('The useful question is always: what now?', '늘 쓸모 있는 질문은 하나다. 지금 무엇을 할까?', DISCOURSES),
  quote('Carry less opinion and more honest observation.', '의견은 덜고 정직한 관찰은 더하라.', TUSCULAN),
  quote('Consistency turns ordinary days into a worthy life.', '꾸준함은 평범한 날들을 가치 있는 삶으로 바꾼다.', LETTERS),
  quote('Meet praise and blame with the same posture.', '칭찬과 비난을 같은 자세로 맞이하라.', MEDITATIONS),
  quote('The boundary you keep teaches others your value.', '지켜낸 경계가 타인에게 너의 가치를 가르친다.', DISCOURSES),
  quote('A hurried mind mistakes motion for progress.', '서두르는 마음은 움직임을 진전으로 착각한다.', TUSCULAN),
  quote('Finish one thing before admiring the next.', '다음을 바라보기 전에 하나를 끝내라.', LETTERS),
  quote('What is difficult can still be simple.', '어려운 일도 단순하게 해낼 수 있다.', MEDITATIONS),
  quote('Do not borrow trouble from an unopened hour.', '아직 오지 않은 시간에서 걱정을 빌리지 마라.', DISCOURSES),
  quote('Your habits vote daily for the person you become.', '습관은 매일 네가 될 사람에게 표를 던진다.', TUSCULAN),
  quote('A useful life is built in unremarkable moments.', '쓸모 있는 삶은 평범한 순간에 지어진다.', LETTERS),
  quote('Keep moving, but never abandon your measure.', '계속 나아가되 너의 기준은 버리지 마라.', MEDITATIONS),
  quote('Peace follows the acceptance of what is finished.', '이미 끝난 일을 받아들일 때 평온이 따른다.', DISCOURSES),
  quote('Train the pause between feeling and action.', '감정과 행동 사이의 멈춤을 훈련하라.', TUSCULAN),
  quote('Enough is a decision, not a quantity.', '충분함은 양이 아니라 하나의 결정이다.', LETTERS),
  quote('Make room for silence before making judgment.', '판단하기 전에 침묵할 자리를 만들어라.', MEDITATIONS),
  quote('A firm direction matters more than fast movement.', '빠른 움직임보다 확고한 방향이 중요하다.', DISCOURSES),
  quote('Let your routine carry you past hesitation.', '루틴이 망설임 너머로 너를 데려가게 하라.', TUSCULAN),
  quote('The honest effort is already a form of success.', '정직한 노력은 이미 성공의 한 형태다.', LETTERS),
  quote('Do less, but let it be fully yours.', '덜 하되 온전히 너의 것으로 하라.', MEDITATIONS),
  quote('You need no permission to begin again.', '다시 시작하는 데 누구의 허락도 필요 없다.', DISCOURSES),
  quote('Order outside begins with order in attention.', '바깥의 질서는 집중의 질서에서 시작된다.', TUSCULAN),
  quote('Protect the morning from unnecessary noise.', '불필요한 소음으로부터 아침을 지켜라.', LETTERS),
  quote('Let difficulty reveal your method, not your mood.', '어려움이 기분 대신 너의 방식을 드러내게 하라.', MEDITATIONS),
  quote('The next right action is a complete horizon.', '다음의 바른 행동 하나면 시야는 충분하다.', DISCOURSES),
  quote('A good day can begin without good feelings.', '좋은 기분 없이도 좋은 하루는 시작될 수 있다.', TUSCULAN),
  quote('Respect time by giving it a single purpose.', '시간에 하나의 목적을 주어 존중하라.', LETTERS),
  quote('Calm is not passive; it is directed strength.', '평온은 수동이 아니라 방향 잡힌 힘이다.', MEDITATIONS),
  quote('Release the verdict; continue the practice.', '평가는 놓고 연습은 계속하라.', DISCOURSES),
  quote('End the day with fewer unfinished promises.', '끝내지 못한 약속을 줄이며 하루를 마쳐라.', TUSCULAN)
]

let quoteGenerating = false

function renderQuoteDate() {
  const label = new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long'
  }).format(new Date())
  document.getElementById('quoteDate').textContent = label
}

function renderDailyQuote(quote) {
  const content = document.getElementById('quoteContent')
  if (!quote?.english || !quote?.korean) {
    content.innerHTML = '<p class="quote-placeholder">버튼을 눌러 오늘 아침의 문장을 만나보세요.</p>'
    document.getElementById('quoteOrigin').textContent = 'GREEK · ROMAN STOICISM'
    return
  }

  content.innerHTML = `
    <p class="quote-english">${esc(quote.english)}</p>
    <span class="quote-divider"></span>
    <p class="quote-korean">${esc(quote.korean)}</p>`
  document.getElementById('quoteOrigin').textContent =
    `MINISH ARCHIVE · INSPIRED BY · ${quote.inspiredBy || 'CLASSICAL MEDITATION'}`
  requestAnimationFrame(fitQuoteLines)
}

function fitSingleLine(element, maxSize, minSize) {
  if (!element) return
  let size = maxSize
  element.style.fontSize = `${size}px`
  while (element.scrollWidth > element.clientWidth && size > minSize) {
    size -= 0.5
    element.style.fontSize = `${size}px`
  }
}

function fitQuoteLines() {
  fitSingleLine(document.querySelector('.quote-english'), 19, 10)
  fitSingleLine(document.querySelector('.quote-korean'), 15, 9)
}

function renderDailyQuoteView() {
  renderQuoteDate()
  renderDailyQuote(data.dailyQuotes[todayDK()])
}

function selectFallbackQuote() {
  const recentLimit = Math.min(FALLBACK_QUOTES.length - 1, 60)
  const recent = new Set((data.quoteHistory || []).slice(-recentLimit).map(item => item.english))
  const available = FALLBACK_QUOTES.filter(item => !recent.has(item.english))
  const pool = available.length ? available : FALLBACK_QUOTES
  const index = Math.floor(Math.random() * pool.length)
  return { ...pool[index], generatedBy: 'archive' }
}

function rememberQuote(quote) {
  data.dailyQuotes[todayDK()] = quote
  data.quoteHistory.push({ ...quote, date: todayDK() })
  data.quoteHistory = data.quoteHistory.slice(-120)
  renderDailyQuote(quote)
  save()
}

function generateQuote() {
  if (quoteGenerating) return
  quoteGenerating = true

  const button = document.getElementById('quoteGenerateBtn')
  const card = document.getElementById('quoteCard')
  const state = document.getElementById('quoteState')
  button.disabled = true
  card.classList.add('is-switching')

  setTimeout(() => {
    rememberQuote(selectFallbackQuote())
    state.textContent = `오프라인 문장 ${FALLBACK_QUOTES.length}개 · 최근 문장은 반복하지 않아요`
    card.classList.remove('is-switching')
    button.disabled = false
    document.getElementById('quoteGenerateLabel').textContent = '다른 문장 보기'
    quoteGenerating = false
  }, 180)
}

// ─── Ambient Color ────────────────────────────────────────────

function applyAmbientColor(imgEl) {
  try {
    const canvas = document.createElement('canvas')
    canvas.width  = 8
    canvas.height = 8
    const ctx = canvas.getContext('2d')
    ctx.drawImage(imgEl, 0, 0, 8, 8)
    const d = ctx.getImageData(0, 0, 8, 8).data
    let r = 0, g = 0, b = 0
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i+1]; b += d[i+2] }
    const n = d.length / 4
    const mix = 0.12
    r = Math.round(246 * (1 - mix) + (r / n) * mix)
    g = Math.round(249 * (1 - mix) + (g / n) * mix)
    b = Math.round(255 * (1 - mix) + (b / n) * mix)
    const color = `rgb(${r},${g},${b})`
    document.querySelector('.sidebar').style.setProperty('--ambient', color)
    document.querySelector('.photo-gradient').style.background =
      `linear-gradient(to bottom, transparent, ${color})`
  } catch {}
}

// ─── Photo ─────────────────────────────────────────────────────

function renderPhoto() {
  const img = document.getElementById('photoImg')
  const ph  = document.getElementById('photoPlaceholder')
  if (data.photo) {
    img.src = data.photo
    img.style.display = 'block'
    ph.style.display  = 'none'
    img.onload = () => applyAmbientColor(img)
    if (img.complete && img.naturalWidth) applyAmbientColor(img)
  } else {
    img.style.display = 'none'
    ph.style.display  = 'flex'
    document.querySelector('.sidebar').style.removeProperty('--ambient')
    document.querySelector('.photo-gradient').style.removeProperty('background')
  }
}

async function resizeImage(base64, maxDim = 1200) {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      const scale  = Math.min(1, maxDim / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width  = Math.round(img.width  * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.src = base64
  })
}

async function onPhotoClick() {
  const raw = await window.minishStorage.openImage()
  if (!raw) return
  data.photo = await resizeImage(raw)
  renderPhoto()
  save()
}

// ─── OKR ────────────────────────────────────────────────────────

function renderOKR() {
  document.getElementById('okrPeriodLabel').textContent = getOKRLabel(activePeriod)
  const okr = data.okr[getOKRKey(activePeriod)] || {}
  document.getElementById('goalAreaFields').innerHTML = MinishCore.AREAS.map(area => {
    const goal = okr.areas?.[area] || {}
    return `<div class="goal-area-field${goal.done && goal.text?.trim()?' completed':''}"><div class="goal-area-heading"><label for="goal${area}">${area}</label><label class="goal-complete"><input type="checkbox" data-goal-check="${area}" aria-label="${area} 목표 달성" ${goal.done && goal.text?.trim()?'checked':''} ${goal.text?.trim()?'':'disabled'}><span>달성</span></label></div><textarea id="goal${area}" class="okr-textarea" data-goal-area="${area}" maxlength="300" rows="2" placeholder="${area}에서 이루고 싶은 목표">${esc(goal.text||'')}</textarea></div>`
  }).join('')
  document.getElementById('okrKeyword').value = okr.keyword || ''
}

function persistOKR() {
  const key = getOKRKey(activePeriod)
  if (!data.okr[key]) data.okr[key] = {}
  if (!data.okr[key].areas) data.okr[key].areas = {}
  MinishCore.AREAS.forEach(area => {
    const input = document.querySelector(`[data-goal-area="${area}"]`)
    const check = document.querySelector(`[data-goal-check="${area}"]`)
    const text = input.value
    const done = Boolean(text.trim() && check.checked)
    data.okr[key].areas[area] = { text, done }
    check.disabled = !text.trim()
    check.checked = done
    input.closest('.goal-area-field').classList.toggle('completed',done)
  })
  data.okr[key].keyword = document.getElementById('okrKeyword').value
  debounceSave()
  renderGoalDashboard()
}

function renderGoalDashboard() {
  const yearInput=document.getElementById('goalDashboardYear')
  if(!yearInput.value)yearInput.value=new Date().getFullYear()
  const year=Number(yearInput.value)
  if(year<2000||year>2199)return
  const labels={year:'연간',quarter:'분기',month:'월',week:'주차'}
  document.getElementById('goalSummary').innerHTML=Object.entries(labels).map(([scope,label])=>{
    const stats=MinishCore.goalStats(data.okr,year,scope)
    return `<button class="goal-scope-card${scope===goalDashboardScope?' active':''}" data-goal-scope="${scope}"><span>${label} 목표</span><strong>${stats.total?stats.pct+'%':'—'}</strong><small>${stats.done} / ${stats.total} 달성</small></button>`
  }).join('')
  const stats=MinishCore.goalStats(data.okr,year,goalDashboardScope)
  document.getElementById('goalAreaSummary').innerHTML=stats.areas.map(a=>`<div><div><strong>${a.area}</strong><span>${a.done}/${a.total}</span></div><div class="routine-review-bar"><span style="width:${a.total?a.done/a.total*100:0}%"></span></div></div>`).join('')
  const goals=stats.areas.flatMap(a=>a.goals).sort((a,b)=>b.key.localeCompare(a.key)||MinishCore.AREAS.indexOf(a.area)-MinishCore.AREAS.indexOf(b.area))
  document.getElementById('goalHistory').innerHTML=goals.length?goals.map(g=>`<div class="goal-history-row"><span class="goal-history-check${g.done?' done':''}">${g.done?'✓':'○'}</span><span class="goal-history-period">${esc(g.key)}</span><span class="goal-history-area">${g.area}</span><span>${esc(g.text)}</span></div>`).join(''):'<p class="review-empty">이 기간의 목표를 작성하면 달성 현황이 표시됩니다.</p>'
}

// ─── Grid ────────────────────────────────────────────────────────

function renderGrid() {
  const dates = getWeekDates(weekOffset)
  const today = todayDK()
  const visibleRoutines = data.routines
    .map((routine, idx) => ({ routine, idx }))
    .filter(({ routine }) => isRoutineVisibleInWeek(routine, dates))

  document.getElementById('weekLabel').textContent = formatWeekRange(dates)

  // Date headers
  const headerRow = document.getElementById('dateHeaderRow')
  while (headerRow.children.length > 1) headerRow.removeChild(headerRow.lastChild)

  dates.forEach(date => {
    const dk = toDK(date)
    const th = document.createElement('th')
    th.className = `date-th${dk === today ? ' is-today' : ''}`
    th.innerHTML =
      `<span class="date-num">${date.getMonth()+1}/${date.getDate()}</span>` +
      `<span class="date-day">${DAY_KO[date.getDay()]}</span>`
    headerRow.appendChild(th)
  })

  // Routine rows
  const tbody = document.getElementById('routineBody')
  tbody.innerHTML = ''

  const empty = document.getElementById('emptyState')
  const emptyTitle = empty.querySelector('.empty-title')
  const emptySub = empty.querySelector('.empty-sub')
  if (visibleRoutines.length === 0) {
    empty.classList.add('visible')
    if (data.routines.length === 0) {
      emptyTitle.textContent = '아직 루틴이 없어요'
      emptySub.innerHTML = '위의 <strong>루틴 추가</strong>로 첫 번째 루틴을 만들어 보세요'
    } else {
      emptyTitle.textContent = '이 주에 유지 중인 루틴이 없어요'
      emptySub.textContent = '이전 주로 이동하면 종료된 루틴과 기록을 확인할 수 있어요'
    }
  } else {
    empty.classList.remove('visible')
    visibleRoutines.forEach(({ routine, idx }) => {
      tbody.appendChild(buildRow(routine, idx, dates))
    })
  }

  renderStats()
  renderReview()
}

function buildRow(routine, idx, dates) {
  const tr = document.createElement('tr')
  tr.dataset.idx = idx

  // Name cell
  const nameTd       = document.createElement('td')
  const weeklyTarget = getWeeklyTarget(routine)
  const weekDone     = getRoutineWeekDone(routine, dates)
  const effectiveTarget = weeklyTarget
    ? Math.min(weeklyTarget, getRoutineEligibleDates(routine, dates).length)
    : null
  const goalReached  = effectiveTarget && weekDone >= effectiveTarget
  const hasCustom    = weeklyTarget || (routine.days && routine.days.length < 7) || routine.endDate
  nameTd.className = `name-cell${hasCustom ? ' has-custom' : ''}`

  const metaLabel = getRoutineMetaLabel(routine, dates)
  nameTd.innerHTML = `
    <div class="name-inner">
      <button class="drag-handle" data-idx="${idx}" title="드래그하여 순서 변경">
        <svg width="12" height="10" viewBox="0 0 12 10" fill="currentColor">
          <rect y="0" width="12" height="1.5" rx="0.75"/>
          <rect y="4.25" width="12" height="1.5" rx="0.75"/>
          <rect y="8.5" width="12" height="1.5" rx="0.75"/>
        </svg>
      </button>
      <div class="name-main">
        <span class="name-text" data-idx="${idx}">${esc(routine.name)}</span>
        ${metaLabel ? `<span class="name-days${goalReached ? ' goal-complete' : ''}">${metaLabel}</span>` : ''}
      </div>
      <button class="days-btn" data-idx="${idx}" title="주간 목표·요일·유지 기간 설정">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/>
          <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
      </button>
      <button class="del-btn" data-idx="${idx}" title="삭제">×</button>
    </div>`
  tr.appendChild(nameTd)

  // Status cells
  dates.forEach(date => {
    const dk       = toDK(date)
    const dow      = date.getDay()
    const isActive = isRoutineActiveOnDate(routine, date)
    const isTarget = isTargetDay(routine, dow)
    const status   = (data.records[dk] || {})[routine.id] || 0
    const goalLocked = isActive && isTarget && status === 0 && goalReached
    const td       = document.createElement('td')
    td.className   = 'status-td'

    const btn = document.createElement('button')
    if (!isActive && status === 0) {
      btn.className = 'status-btn expired'
      btn.title     = `${formatEndDate(routine.endDate)} · 기간 종료`
    } else if (!isActive && status > 0) {
      btn.className = `status-btn ${STATUS[status].cls} expired-recorded`
      btn.title     = `기간 종료 후 기록 · ${STATUS[status].label}`
    } else if (goalLocked) {
      btn.className = 'status-btn goal-locked'
      btn.title     = `주 ${effectiveTarget}회 목표 달성`
    } else if (!isTarget && status === 0) {
      btn.className = 'status-btn rest'
      btn.title     = '휴식일'
    } else if (!isTarget && status > 0) {
      btn.className = `status-btn ${STATUS[status].cls} rest-recorded`
      btn.title     = `휴식일 · ${STATUS[status].label}`
    } else {
      btn.className = `status-btn ${STATUS[status].cls}`
      btn.title     = STATUS[status].label
    }
    btn.dataset.date = dk
    btn.dataset.rid  = routine.id
    btn.dataset.stat = status
    td.appendChild(btn)
    tr.appendChild(td)
  })

  return tr
}

// ─── Drag-to-reorder ────────────────────────────────────────────

function startDrag(e, idx) {
  if (e.button !== 0) return
  e.preventDefault()

  const tbody   = document.getElementById('routineBody')
  const rows    = [...tbody.querySelectorAll('tr')]
  const srcRow  = tbody.querySelector(`tr[data-idx="${idx}"]`)
  if (!srcRow) return
  const srcRect = srcRow.getBoundingClientRect()
  const wrapper = document.querySelector('.grid-wrapper')
  const wRect   = wrapper.getBoundingClientRect()

  const ghost = document.createElement('div')
  ghost.className   = 'drag-ghost'
  ghost.textContent = data.routines[idx].name
  ghost.style.left  = `${srcRect.left + 32}px`
  ghost.style.top   = `${e.clientY - 18}px`
  document.body.appendChild(ghost)

  const indicator = document.createElement('div')
  indicator.className    = 'drag-indicator'
  indicator.style.left   = `${wRect.left}px`
  indicator.style.width  = `${wRect.width}px`
  document.body.appendChild(indicator)

  srcRow.classList.add('is-dragging')
  document.body.style.cursor = 'grabbing'

  const visibleIndices = rows.map(row => parseInt(row.dataset.idx))
  drag = {
    srcIdx: idx,
    srcVisibleIdx: visibleIndices.indexOf(idx),
    insertBefore: visibleIndices.indexOf(idx),
    visibleIndices,
    ghost,
    indicator
  }

  document.addEventListener('mousemove', onDragMove)
  document.addEventListener('mouseup', onDragEnd, { once: true })
}

function onDragMove(e) {
  if (!drag) return

  drag.ghost.style.top = `${e.clientY - 18}px`

  const tbody = document.getElementById('routineBody')
  const rows  = [...tbody.querySelectorAll('tr')]

  let insertBefore = rows.length
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i].getBoundingClientRect()
    if (e.clientY < r.top + r.height / 2) { insertBefore = i; break }
  }

  drag.insertBefore = insertBefore

  let indicatorY
  if (rows.length === 0) { drag.indicator.style.display = 'none'; return }
  if (insertBefore < rows.length) {
    indicatorY = rows[insertBefore].getBoundingClientRect().top
  } else {
    indicatorY = rows[rows.length - 1].getBoundingClientRect().bottom
  }

  drag.indicator.style.top     = `${indicatorY - 1}px`
  drag.indicator.style.display = 'block'
}

function onDragEnd() {
  if (!drag) return

  const { srcIdx, srcVisibleIdx, insertBefore, visibleIndices, ghost, indicator } = drag
  drag = null

  ghost.remove()
  indicator.remove()
  document.body.style.cursor = ''
  document.removeEventListener('mousemove', onDragMove)

  const tbody = document.getElementById('routineBody')
  tbody.querySelectorAll('tr.is-dragging').forEach(r => r.classList.remove('is-dragging'))

  if (insertBefore === srcVisibleIdx || insertBefore === srcVisibleIdx + 1) return

  const routines = [...data.routines]
  const [moved]  = routines.splice(srcIdx, 1)
  const targetIdx = insertBefore < visibleIndices.length
    ? visibleIndices[insertBefore]
    : visibleIndices[visibleIndices.length - 1] + 1
  const insertAt = targetIdx > srcIdx ? targetIdx - 1 : targetIdx
  routines.splice(insertAt, 0, moved)
  data.routines = routines
  renderGrid()
  save()
}

// ─── Status ──────────────────────────────────────────────────────

function setStatus(dk, rid, newStatus) {
  if (!data.records[dk]) data.records[dk] = {}
  if (newStatus === 0) {
    delete data.records[dk][rid]
  } else {
    data.records[dk][rid] = newStatus
  }
  renderGrid()
  save()
}

function cycleStatus(dk, rid) {
  const current = (data.records[dk] || {})[rid] || 0
  setStatus(dk, rid, (current + 1) % 5)
}

// ─── Routine Management ──────────────────────────────────────────

function addRoutine(name) {
  data.routines.push({ id: `r${Date.now()}`, name, endDate: null })
  renderGrid()
  save()
}

function deleteRoutine(idx) {
  const [removed] = data.routines.splice(idx, 1)
  if (removed) {
    Object.values(data.weeklyTargets).forEach(targets => {
      if (targets && typeof targets === 'object') delete targets[removed.id]
    })
  }
  renderGrid()
  save()
}

function openConfirmDelete(idx) {
  pendingDeleteIdx = idx
  document.getElementById('confirmDesc').textContent =
    `"${data.routines[idx].name}" 루틴을 삭제하시겠습니까?`
  document.getElementById('confirmOverlay').classList.add('visible')
}

function closeConfirmDelete() {
  document.getElementById('confirmOverlay').classList.remove('visible')
  pendingDeleteIdx = null
}

function renameRoutine(idx, name) {
  if (data.routines[idx]) data.routines[idx].name = name
  save()
}

function startRename(span, idx) {
  const original = data.routines[idx].name
  const input    = document.createElement('input')
  input.type      = 'text'
  input.value     = original
  input.className = 'rename-input'
  span.replaceWith(input)
  input.select()

  function done() {
    const name    = input.value.trim() || original
    const newSpan = document.createElement('span')
    newSpan.className   = 'name-text'
    newSpan.dataset.idx = idx
    newSpan.textContent = name
    input.replaceWith(newSpan)
    if (name !== original) renameRoutine(idx, name)
  }

  input.addEventListener('blur', done)
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  input.blur()
    if (e.key === 'Escape') { input.value = original; input.blur() }
  })
}

// ─── Day Picker ──────────────────────────────────────────────────

let dppIdx = null  // currently editing routine index
let dppWeekKey = null
let dppDurationMode = 'ongoing'

function refreshTargetButtons(routine) {
  const eligibleDates = getRoutineEligibleDates(routine, getWeekDates(weekOffset))
  const currentTarget = getWeeklyTarget(routine, dppWeekKey)

  document.querySelectorAll('.dpp-target-btn').forEach(btn => {
    const value = parseInt(btn.dataset.target)
    btn.disabled = value > eligibleDates.length
    btn.classList.toggle('active', value === (currentTarget || 0))
  })
}

function refreshDurationControls(routine) {
  document.querySelectorAll('.dpp-duration-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === dppDurationMode)
  })

  const wrap = document.getElementById('dppEndDateWrap')
  const input = document.getElementById('dppEndDate')
  wrap.hidden = dppDurationMode !== 'until'
  input.value = isValidDateKey(routine.endDate) ? routine.endDate : ''
}

function openDayPicker(idx, anchorEl) {
  dppIdx = idx
  dppWeekKey = getViewedWeekKey()
  const routine    = data.routines[idx]
  const activeDays = routine.days || [0, 1, 2, 3, 4, 5, 6]
  dppDurationMode = isValidDateKey(routine.endDate) ? 'until' : 'ongoing'

  const container = document.getElementById('dppDays')
  container.innerHTML = ''

  DAY_LABELS.forEach((label, i) => {
    const btn = document.createElement('button')
    btn.className    = `dpp-day-btn${activeDays.includes(i) ? ' active' : ''}`
    btn.textContent  = label
    btn.dataset.day  = i
    container.appendChild(btn)
  })

  refreshTargetButtons(routine)
  refreshDurationControls(routine)

  const popup = document.getElementById('dayPickerPopup')
  const rect  = anchorEl.getBoundingClientRect()
  popup.style.left = `${rect.left}px`
  popup.style.top  = `${rect.bottom + 7}px`
  popup.classList.add('visible')

  requestAnimationFrame(() => {
    const pr = popup.getBoundingClientRect()
    if (pr.right  > window.innerWidth  - 8) popup.style.left = `${window.innerWidth  - pr.width  - 8}px`
    if (pr.bottom > window.innerHeight - 8) popup.style.top  = `${rect.top - pr.height - 7}px`
  })
}

function closeDayPicker() {
  document.getElementById('dayPickerPopup').classList.remove('visible')
  dppIdx = null
  dppWeekKey = null
  dppDurationMode = 'ongoing'
}

function applyWeeklyTarget(target) {
  if (dppIdx === null || !dppWeekKey) return
  if (!data.weeklyTargets[dppWeekKey]) data.weeklyTargets[dppWeekKey] = {}

  const routine = data.routines[dppIdx]
  const maxTarget = getRoutineEligibleDates(routine, getWeekDates(weekOffset)).length
  if (target >= 1) {
    data.weeklyTargets[dppWeekKey][routine.id] = Math.min(target, maxTarget)
  } else {
    delete data.weeklyTargets[dppWeekKey][routine.id]
    if (Object.keys(data.weeklyTargets[dppWeekKey]).length === 0) {
      delete data.weeklyTargets[dppWeekKey]
    }
  }

  renderGrid()
  refreshTargetButtons(routine)
  save()
}

function applyDays(days) {
  if (dppIdx === null) return
  const routine = data.routines[dppIdx]
  routine.days = (days.length === 7) ? null : days

  const target = getWeeklyTarget(routine, dppWeekKey)
  const eligibleCount = getRoutineEligibleDates(routine, getWeekDates(weekOffset)).length
  if (target && target > eligibleCount) {
    if (eligibleCount > 0) {
      data.weeklyTargets[dppWeekKey][routine.id] = eligibleCount
    } else {
      delete data.weeklyTargets[dppWeekKey][routine.id]
      if (Object.keys(data.weeklyTargets[dppWeekKey]).length === 0) {
        delete data.weeklyTargets[dppWeekKey]
      }
    }
  }

  renderGrid()
  refreshTargetButtons(routine)
  save()
}

function applyEndDate(value) {
  if (dppIdx === null) return
  const routine = data.routines[dppIdx]
  routine.endDate = isValidDateKey(value) ? value : null
  dppDurationMode = routine.endDate ? 'until' : 'ongoing'

  const eligibleCount = getRoutineEligibleDates(routine, getWeekDates(weekOffset)).length
  const target = getWeeklyTarget(routine, dppWeekKey)
  if (target && target > eligibleCount) {
    if (eligibleCount > 0) {
      data.weeklyTargets[dppWeekKey][routine.id] = eligibleCount
    } else {
      delete data.weeklyTargets[dppWeekKey][routine.id]
      if (Object.keys(data.weeklyTargets[dppWeekKey]).length === 0) {
        delete data.weeklyTargets[dppWeekKey]
      }
    }
  }

  renderGrid()
  if (!isRoutineVisibleInWeek(routine, getWeekDates(weekOffset))) {
    closeDayPicker()
  } else {
    refreshTargetButtons(routine)
    refreshDurationControls(routine)
  }
  save()
}

function wirePopup() {
  const popup = document.getElementById('dayPickerPopup')

  document.getElementById('dppTargets').addEventListener('click', e => {
    const btn = e.target.closest('.dpp-target-btn')
    if (!btn || btn.disabled || dppIdx === null) return
    applyWeeklyTarget(parseInt(btn.dataset.target))
  })

  document.getElementById('dppDurationOptions').addEventListener('click', e => {
    const btn = e.target.closest('.dpp-duration-btn')
    if (!btn || dppIdx === null) return

    if (btn.dataset.mode === 'ongoing') {
      applyEndDate(null)
      return
    }

    dppDurationMode = 'until'
    const routine = data.routines[dppIdx]
    refreshDurationControls(routine)
    requestAnimationFrame(() => {
      const input = document.getElementById('dppEndDate')
      input.focus()
      if (typeof input.showPicker === 'function') input.showPicker()
    })
  })

  document.getElementById('dppEndDate').addEventListener('change', e => {
    if (dppIdx === null || !isValidDateKey(e.target.value)) return
    applyEndDate(e.target.value)
  })

  // Day toggle
  document.getElementById('dppDays').addEventListener('click', e => {
    const btn = e.target.closest('.dpp-day-btn')
    if (!btn || dppIdx === null) return

    const wasActive = btn.classList.contains('active')
    const all = [...document.querySelectorAll('.dpp-day-btn')]
    const activeAfter = all.filter(b => b !== btn && b.classList.contains('active'))
    if (wasActive && activeAfter.length === 0) return  // prevent 0 days

    btn.classList.toggle('active')
    const activeDays = [...document.querySelectorAll('.dpp-day-btn.active')]
      .map(b => parseInt(b.dataset.day))
    applyDays(activeDays)
  })

  // Presets
  document.getElementById('dppAll').addEventListener('click', () => {
    if (dppIdx === null) return
    document.querySelectorAll('.dpp-day-btn').forEach(b => b.classList.add('active'))
    applyDays([0, 1, 2, 3, 4, 5, 6])
  })

  document.getElementById('dppWeekday').addEventListener('click', () => {
    if (dppIdx === null) return
    document.querySelectorAll('.dpp-day-btn').forEach(b => {
      b.classList.toggle('active', [1,2,3,4,5].includes(parseInt(b.dataset.day)))
    })
    applyDays([1, 2, 3, 4, 5])
  })

  document.getElementById('dppWeekend').addEventListener('click', () => {
    if (dppIdx === null) return
    document.querySelectorAll('.dpp-day-btn').forEach(b => {
      b.classList.toggle('active', [0, 6].includes(parseInt(b.dataset.day)))
    })
    applyDays([0, 6])
  })

  // Close on outside click
  document.addEventListener('click', e => {
    if (popup.classList.contains('visible') &&
        !popup.contains(e.target) &&
        !e.target.closest('.days-btn')) {
      closeDayPicker()
    }
  })

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeDayPicker()
  })
}

// ─── Context Menu ────────────────────────────────────────────────

const ctxMenu = document.getElementById('contextMenu')

function showCtxMenu(x, y, dk, rid) {
  ctxTarget = { dk, rid }
  ctxMenu.style.left = `${x}px`
  ctxMenu.style.top  = `${y}px`
  ctxMenu.classList.add('visible')

  requestAnimationFrame(() => {
    const rect = ctxMenu.getBoundingClientRect()
    if (rect.right  > window.innerWidth)  ctxMenu.style.left = `${x - rect.width}px`
    if (rect.bottom > window.innerHeight) ctxMenu.style.top  = `${y - rect.height}px`
  })
}

function hideCtxMenu() {
  ctxMenu.classList.remove('visible')
  ctxTarget = null
}

// ─── Modal ───────────────────────────────────────────────────────

const overlay   = document.getElementById('modalOverlay')
const nameInput = document.getElementById('newRoutineName')

function openModal() {
  overlay.classList.add('visible')
  nameInput.value = ''
  requestAnimationFrame(() => nameInput.focus())
}

function closeModal() {
  overlay.classList.remove('visible')
}

function confirmAdd() {
  const name = nameInput.value.trim()
  if (name) { addRoutine(name); closeModal() }
}

// ─── Persistence ─────────────────────────────────────────────────

function debounceSave() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(save, 600)
}

async function save() {
  clearTimeout(saveTimer)
  clearTimeout(saveRetryTimer)
  const result = await window.minishStorage.saveData(data)
  if (!result?.ok) {
    console.error('자동 저장 실패:', result?.error || '알 수 없는 오류')
    saveRetryTimer = setTimeout(save, 2000)
  } else {
    const reviewState = document.getElementById('reviewSaveState')
    if (reviewState) reviewState.textContent = '저장됨'
  }
}

// ─── Event Wiring ────────────────────────────────────────────────

function wire() {
  document.getElementById('photoFrame').addEventListener('click', onPhotoClick)

  document.querySelectorAll('.view-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      activeView = btn.dataset.view
      document.querySelectorAll('.view-tab').forEach(tab => {
        tab.classList.toggle('active', tab === btn)
      })
      document.querySelectorAll('.main-view').forEach(view => {
        view.classList.toggle('active', view.id === `${activeView}View`)
      })
      if (activeView === 'review') renderReview()
      if (activeView === 'quote') renderDailyQuoteView()
    })
  })

  document.querySelectorAll('.okr-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      persistOKR()
      document.querySelectorAll('.okr-tab').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      activePeriod = btn.dataset.period
      renderOKR()
    })
  })

  document.getElementById('goalAreaFields').addEventListener('input',persistOKR)
  document.getElementById('okrKeyword').addEventListener('input', persistOKR)
  document.getElementById('goalDashboardYear').addEventListener('change',renderGoalDashboard)
  document.getElementById('goalSummary').addEventListener('click',event=>{
    const button=event.target.closest('[data-goal-scope]')
    if(button){goalDashboardScope=button.dataset.goalScope;renderGoalDashboard()}
  })
  function moveGoalPeriod(amount) {
    persistOKR()
    if(activePeriod==='week')moveWeek(weekOffset+amount)
    else {goalOffsets[activePeriod]+=amount;renderOKR()}
  }
  document.getElementById('goalPrev').addEventListener('click',()=>moveGoalPeriod(-1))
  document.getElementById('goalNext').addEventListener('click',()=>moveGoalPeriod(1))
  document.getElementById('goalToday').addEventListener('click',()=>{
    persistOKR()
    if(activePeriod==='week')moveWeek(0)
    else{goalOffsets[activePeriod]=0;renderOKR()}
  })

  function moveWeek(offset) {
    if(activePeriod==='week')persistOKR()
    closeDayPicker()
    weekOffset = offset
    renderGrid()
    if (activePeriod === 'week') renderOKR()
  }

  document.getElementById('prevWeek').addEventListener('click', () => moveWeek(weekOffset - 1))
  document.getElementById('nextWeek').addEventListener('click', () => moveWeek(weekOffset + 1))
  document.getElementById('todayBtn').addEventListener('click', () => moveWeek(0))
  document.getElementById('prevWeekReview').addEventListener('click', () => moveWeek(weekOffset - 1))
  document.getElementById('nextWeekReview').addEventListener('click', () => moveWeek(weekOffset + 1))
  document.getElementById('todayReviewBtn').addEventListener('click', () => moveWeek(0))
  document.getElementById('weeklyReviewComment').addEventListener('input', persistWeeklyReview)
  document.getElementById('quoteGenerateBtn').addEventListener('click', generateQuote)

  const tbody = document.getElementById('routineBody')

  tbody.addEventListener('mousedown', e => {
    const handle = e.target.closest('.drag-handle')
    if (handle) startDrag(e, parseInt(handle.dataset.idx))
  })

  tbody.addEventListener('click', e => {
    // Days config button
    const daysBtnEl = e.target.closest('.days-btn')
    if (daysBtnEl) {
      e.stopPropagation()
      const idx = parseInt(daysBtnEl.dataset.idx)
      if (dppIdx === idx) { closeDayPicker(); return }
      openDayPicker(idx, daysBtnEl)
      return
    }

    // Status cycle — skip non-target (rest) days
    const btn = e.target.closest('.status-btn')
    if (btn &&
        !btn.classList.contains('rest') &&
        !btn.classList.contains('rest-recorded') &&
        !btn.classList.contains('expired') &&
        !btn.classList.contains('expired-recorded') &&
        !btn.classList.contains('goal-locked')) {
      cycleStatus(btn.dataset.date, btn.dataset.rid)
      return
    }

    // Delete
    const del = e.target.closest('.del-btn')
    if (del) { openConfirmDelete(parseInt(del.dataset.idx)); return }
  })

  tbody.addEventListener('dblclick', e => {
    const span = e.target.closest('.name-text')
    if (span) startRename(span, parseInt(span.dataset.idx))
  })

  tbody.addEventListener('contextmenu', e => {
    const btn = e.target.closest('.status-btn')
    if (!btn ||
        btn.classList.contains('rest') ||
        btn.classList.contains('rest-recorded') ||
        btn.classList.contains('expired') ||
        btn.classList.contains('expired-recorded') ||
        btn.classList.contains('goal-locked')) return
    e.preventDefault()
    showCtxMenu(e.clientX, e.clientY, btn.dataset.date, btn.dataset.rid)
  })

  ctxMenu.addEventListener('click', e => {
    const item = e.target.closest('.ctx-item')
    if (!item || !ctxTarget) return
    setStatus(ctxTarget.dk, ctxTarget.rid, parseInt(item.dataset.status))
    hideCtxMenu()
  })

  document.addEventListener('click', e => {
    if (!ctxMenu.contains(e.target)) hideCtxMenu()
  })

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { hideCtxMenu(); closeModal(); closeConfirmDelete() }
  })

  document.getElementById('addRoutineBtn').addEventListener('click', openModal)
  document.getElementById('modalCancel').addEventListener('click', closeModal)
  document.getElementById('modalConfirm').addEventListener('click', confirmAdd)
  nameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter')  confirmAdd()
    if (e.key === 'Escape') closeModal()
  })
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal() })

  const confirmOverlay = document.getElementById('confirmOverlay')
  document.getElementById('confirmCancel').addEventListener('click', closeConfirmDelete)
  document.getElementById('confirmOk').addEventListener('click', () => {
    const idx = pendingDeleteIdx
    closeConfirmDelete()
    if (idx !== null) deleteRoutine(idx)
  })
  confirmOverlay.addEventListener('click', e => { if (e.target === confirmOverlay) closeConfirmDelete() })

  wirePopup()

  window.addEventListener('beforeunload', () => {
    clearTimeout(saveTimer)
    clearTimeout(saveRetryTimer)
    window.minishStorage.saveDataSync(data)
  })

  const flushPendingEdits = () => {
    if (!saveTimer && !saveRetryTimer) return
    clearTimeout(saveTimer)
    clearTimeout(saveRetryTimer)
    saveTimer = null
    saveRetryTimer = null
    const result = window.minishStorage.saveDataSync(data)
    if (!result?.ok) saveRetryTimer = setTimeout(save, 2000)
  }
  window.addEventListener('minish-before-sync', flushPendingEdits)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPendingEdits()
  })
  window.addEventListener('pagehide', flushPendingEdits)
  window.addEventListener('minish-sync-meta', event => { data._sync = event.detail._sync })

  window.addEventListener('minish-data-replaced', event => {
    if (!event.detail || typeof event.detail !== 'object') return
    data = { ...data, ...event.detail }
    normalizeDataShape()
    renderPhoto()
    renderOKR()
    renderGrid()
    renderDailyQuoteView()
    if (activeView === 'review') renderReview()
  })
}

// ─── Bootstrap ───────────────────────────────────────────────────

function esc(str) {
  const d = document.createElement('div')
  d.textContent = str
  return d.innerHTML
}

function normalizeDataShape() {
  if (!Array.isArray(data.routines)) data.routines = []
  if (!data.records || typeof data.records !== 'object') data.records = {}
  if (!data.okr || typeof data.okr !== 'object') data.okr = {}
  if (!data.weeklyTargets || typeof data.weeklyTargets !== 'object') data.weeklyTargets = {}
  if (!data.weeklyReviews || typeof data.weeklyReviews !== 'object') data.weeklyReviews = {}
  if (!data.dailyQuotes || typeof data.dailyQuotes !== 'object') data.dailyQuotes = {}
  if (!Array.isArray(data.quoteHistory)) data.quoteHistory = []
  let removedAiQuotes = MinishCore.migrateGoals(data)
  Object.keys(data.dailyQuotes).forEach(key => {
    if (['openai', 'codex'].includes(data.dailyQuotes[key]?.generatedBy)) {
      delete data.dailyQuotes[key]
      removedAiQuotes = true
    }
  })
  const cleanHistory = data.quoteHistory.filter(item => !['openai', 'codex'].includes(item?.generatedBy))
  if (cleanHistory.length !== data.quoteHistory.length) removedAiQuotes = true
  data.quoteHistory = cleanHistory
  data.routines.forEach(routine => {
    if (!isValidDateKey(routine.endDate)) routine.endDate = null
  })
  return removedAiQuotes
}

async function init() {
  const saved = await window.minishStorage.loadData()
  if (saved) data = { ...data, ...saved }
  const removedAiQuotes = normalizeDataShape()
  renderPhoto()
  renderOKR()
  renderGrid()
  wire()
  renderDailyQuoteView()
  if (removedAiQuotes) save()
}

init()
