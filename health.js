// New records use independent date/row keys in the existing field-merge journal.
(() => {
  const $=id=>document.getElementById(id)
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))
  const start='2026-09-23',end='2027-09-22'
  const dates=Array.from({length:365},(_,i)=>{const d=new Date(`${start}T12:00:00`);d.setDate(d.getDate()+i);return toDK(d)})
  const labels={0:'미기록',1:'금주',2:'음주'}
  function soberStats(today=todayDK()) {
    const eligible=dates.filter(date=>date<=today),entries=data.soberDays||{}
    const sober=eligible.filter(date=>entries[date]===1).length,drank=eligible.filter(date=>entries[date]===2).length
    let streak=0,index=eligible.length-1
    if(eligible[index]===today&&!entries[today])index--
    for(;index>=0&&entries[eligible[index]]===1;index--)streak++
    return {sober,drank,streak,missing:eligible.length-sober-drank,pct:Math.round(sober/365*1000)/10}
  }
  function renderSoberSummary() {
    const stats=soberStats()
    $('soberSummary').innerHTML=[['금주 달성',`${stats.sober} / 365일`,`${stats.pct}% 채웠어요`],['연속 금주',`${stats.streak}일`,'오늘 미기록이면 어제까지'],['음주 기록',`${stats.drank}일`,'기록한 날만 집계'],['미기록',`${stats.missing}일`,'시작일부터 오늘까지']].map(([label,value,note])=>`<article class="dashboard-metric"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`).join('')
  }
  function renderSober() {
    const today=todayDK();renderSoberSummary()
    const months=[...new Set(dates.map(date=>date.slice(0,7)))]
    $('soberCalendar').innerHTML=months.map(month=>`<article class="review-panel sober-month"><h2>${month.slice(0,4)}년 ${Number(month.slice(5))}월</h2><div class="sober-grapes">${dates.filter(date=>date.startsWith(month)).map(date=>{
      const status=data.soberDays?.[date]||0
      return `<button class="sober-day sober-${status}${date===today?' today':''}" data-sober-date="${date}" ${date>today?'disabled':''} aria-label="${date} ${labels[status]||'미기록'}" title="${date} · ${labels[status]||'미기록'}"><span>${Number(date.slice(8))}</span><small>${status===1?'✓':status===2?'−':''}</small></button>`
    }).join('')}</div></article>`).join('')
  }
  function renderWorkout() {
    if(!$('workoutDate').value)$('workoutDate').value=todayDK()
    const rows=Object.entries(data.workouts?.[$('workoutDate').value]||{}).filter(([,row])=>!row.deleted).sort(([a,x],[b,y])=>(x.createdAt||0)-(y.createdAt||0)||a.localeCompare(b))
    $('workoutRows').innerHTML=rows.length?rows.map(([id,row])=>`<div class="workout-row" data-workout-id="${esc(id)}"><select data-workout-field="place" aria-label="운동 장소">${[['home','홈트'],['gym','헬스장'],['outdoor','야외'],['other','기타']].map(([key,label])=>`<option value="${key}" ${row.place===key?'selected':''}>${label}</option>`).join('')}</select><input data-workout-field="note" aria-label="운동 내용" maxlength="240" placeholder="어떤 운동을 했나요?" value="${esc(row.note||'')}"><input data-workout-field="count" aria-label="횟수" type="number" inputmode="numeric" min="0" max="999999" step="1" placeholder="횟수" value="${row.count==null?'':Number(row.count)}"><button class="today-btn" data-workout-delete="${esc(id)}" aria-label="운동 줄 삭제">삭제</button></div>`).join(''):'<p class="review-empty">이 날의 운동 기록이 없어요. 한 줄을 추가해 보세요.</p>'
  }
  function render(view) {if(view==='sober')renderSober();if(view==='workout')renderWorkout()}
  $('soberCalendar').addEventListener('click',event=>{
    const button=event.target.closest('[data-sober-date]');if(!button||button.disabled)return
    const date=button.dataset.soberDate;if(date<start||date>end||date>todayDK())return
    data.soberDays??={};data.soberDays[date]=((data.soberDays[date]||0)+1)%3
    // Update in place so two fast taps hit the same button, including on touch screens.
    const status=data.soberDays[date];button.className=`sober-day sober-${status}${date===todayDK()?' today':''}`
    button.setAttribute('aria-label',`${date} ${labels[status]}`);button.title=`${date} · ${labels[status]}`;button.querySelector('small').textContent=status===1?'✓':status===2?'−':''
    save();renderSoberSummary()
  })
  $('soberToday').addEventListener('click',()=>{$('soberCalendar').querySelector(`[data-sober-date="${todayDK()}"]`)?.scrollIntoView({block:'center',behavior:'smooth'})})
  $('workoutAdd').addEventListener('click',()=>{
    const date=$('workoutDate').value||todayDK();if(!MinishCore.validDate(date))return
    data.workouts??={};data.workouts[date]??={};const id=crypto.randomUUID()
    data.workouts[date][id]={place:'home',note:'',count:null,createdAt:Date.now(),deleted:false}
    save();renderWorkout();document.querySelector(`[data-workout-id="${id}"] [data-workout-field="note"]`)?.focus()
  })
  $('workoutRows').addEventListener('input',event=>{
    const input=event.target,field=input.dataset.workoutField,row=input.closest('[data-workout-id]');if(!field||!row)return
    let value=input.value
    if(field==='count'){
      if(input.validity.badInput||value!==''&&(!/^\d+$/.test(value)||Number(value)>999999)){input.setCustomValidity('0~999999 사이의 정수를 입력하세요.');$('workoutStatus').textContent='횟수를 확인해 주세요. 다른 입력은 보존됩니다.';return}
      input.setCustomValidity('');value=value===''?null:Number(value)
    }
    const entry=data.workouts?.[$('workoutDate').value]?.[row.dataset.workoutId];if(!entry||entry.deleted)return
    entry[field]=value;$('workoutStatus').textContent='자동 저장 중…';save().then(()=>{$('workoutStatus').textContent='저장 상태는 상단 동기화 표시에서 확인할 수 있어요.'})
  })
  $('workoutRows').addEventListener('click',event=>{
    const button=event.target.closest('[data-workout-delete]');if(!button)return
    const entry=data.workouts?.[$('workoutDate').value]?.[button.dataset.workoutDelete];if(!entry)return
    if(!confirm('이 운동 줄을 삭제할까요?'))return
    entry.deleted=true;save();renderWorkout()
  })
  $('workoutDate').addEventListener('change',()=>{if(!MinishCore.validDate($('workoutDate').value))$('workoutDate').value=todayDK();renderWorkout()})
  for(const [id,offset] of [['workoutPrev',-1],['workoutNext',1]])$(id).addEventListener('click',()=>{const date=new Date(`${$('workoutDate').value||todayDK()}T12:00:00`);date.setDate(date.getDate()+offset);$('workoutDate').value=toDK(date);renderWorkout()})
  $('workoutToday').addEventListener('click',()=>{$('workoutDate').value=todayDK();renderWorkout()})
  window.MinishHealth={render,soberStats}
})()
