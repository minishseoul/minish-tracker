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
      return `<button class="sober-day sober-${status}${date===today?' today':''}" data-sober-date="${date}" ${date>today?'disabled':''} aria-label="${date} ${labels[status]||'미기록'}" title="${date} / ${labels[status]||'미기록'}"><span>${Number(date.slice(8))}</span><small>${status===1?'✓':status===2?'−':''}</small></button>`
    }).join('')}</div></article>`).join('')
  }
  function renderWorkout() {
    if(!$('workoutDate').value)$('workoutDate').value=todayDK()
    renderWorkoutWeek()
    const rows=Object.entries(data.workouts?.[$('workoutDate').value]||{}).filter(([,row])=>!row.deleted).sort(([a,x],[b,y])=>(x.createdAt||0)-(y.createdAt||0)||a.localeCompare(b))
    const names=[...new Set(Object.entries(data.workouts||{}).filter(([date])=>date<=$('workoutDate').value).sort(([a],[b])=>b.localeCompare(a)).flatMap(([,items])=>Object.values(items).filter(r=>!r.deleted&&r.note?.trim()).map(r=>r.note.trim())))].slice(0,6)
    $('workoutQuickStart').innerHTML=names.length?`<span>다시 하기</span>${names.map(name=>`<button type="button" class="today-btn" data-workout-repeat="${esc(name)}">${esc(name)}</button>`).join('')}`:''
    $('workoutAdd').textContent=rows.length?'+ 운동 추가':'운동 시작'
    $('workoutRows').innerHTML=rows.length?rows.map(([id,row])=>{
      const sets=MinishCore.workoutSets(row),completed=sets.filter(([,s])=>s.done&&s.reps>0).length
return `<article class="workout-card workout-row" data-workout-id="${esc(id)}"><div class="workout-card-head"><input data-workout-field="note" aria-label="운동 이름" maxlength="240" placeholder="운동 이름 / 예: 스쿼트" value="${esc(row.note||'')}"><select data-workout-field="place" aria-label="운동 장소">${[['home','홈트'],['gym','헬스장'],['outdoor','야외'],['other','기타']].map(([key,label])=>`<option value="${key}" ${row.place===key?'selected':''}>${label}</option>`).join('')}</select></div>${row.schema===2?`<p class="workout-previous">${previousText(row)}</p><div class="workout-set-labels"><span>세트</span><span>kg / 맨몸은 0</span><span>횟수</span><span>완료</span><span></span></div>${sets.map(([sid,set],i)=>`<div class="workout-set ${set.done?'is-done':''}" data-set-id="${esc(sid)}"><span>${i+1}</span><input type="number" inputmode="decimal" min="0" max="2000" step="any" data-set-field="weight" aria-label="${i+1}세트 무게 kg" placeholder="0" value="${set.weight??''}"><input type="number" inputmode="numeric" min="1" max="9999" step="1" data-set-field="reps" aria-label="${i+1}세트 횟수" placeholder="횟수" value="${set.reps??''}"><button class="set-check" data-set-done aria-label="${i+1}세트 완료" aria-pressed="${!!set.done}">${set.done?'✓':'○'}</button><button class="set-remove" data-set-remove aria-label="${i+1}세트 삭제">×</button></div>`).join('')}<div class="workout-card-foot"><button class="today-btn" data-set-add>+ 세트</button><span>${completed}/${sets.length}세트 완료</span><button class="workout-delete" data-workout-delete="${esc(id)}">운동 삭제</button></div>`:`<p class="feature-help">이전 메모 기록 / 그대로 보관 중</p><label class="workout-legacy-count">기록한 횟수 <input data-workout-field="count" aria-label="횟수" type="number" inputmode="numeric" min="0" max="999999" step="1" value="${row.count==null?'':Number(row.count)}"></label><button class="workout-delete" data-workout-delete="${esc(id)}">기록 삭제</button>`}</article>`
    }).join(''):'<div class="workout-empty"><strong>오늘도, 한 세트부터.</strong><p>운동을 시작하면 지난 기록이 다음 세트의 출발점이 됩니다.</p></div>'
    renderWorkoutRecap()
  }
  function previousText(row) {
    const previous=MinishCore.workoutHistory(data.workouts,row.note,$('workoutDate').value)[0]
    if(!previous)return '첫 기록이에요. 오늘의 한 세트가 기준이 됩니다.'
    return esc(`지난번 ${previous.date.slice(5).replace('-','/')} / ${previous.sets.length?previous.sets.map(s=>`${s.weight||0}kg × ${s.reps}`).join(' / '):`${previous.row.count||'-'}회 / 이전 메모`}`)
  }
  function newSet(order,source={}) {return {order,weight:source.weight??0,reps:source.reps??null,done:false,deleted:false}}
  function addWorkout(name='') {
    const date=$('workoutDate').value||todayDK();if(!MinishCore.validDate(date))return
    const previous=MinishCore.workoutHistory(data.workouts,name,date)[0]
    const templates=previous?.sets.length?previous.sets:[{}],sets={}
    templates.forEach((set,i)=>{sets[crypto.randomUUID()]=newSet(i,set)})
    data.workouts??={};data.workouts[date]??={};const id=crypto.randomUUID()
    data.workouts[date][id]={schema:2,place:previous?.row.place||'home',note:name,sets,createdAt:Date.now(),deleted:false}
    save();renderWorkout()
    const card=document.querySelector(`[data-workout-id="${id}"]`);card?.scrollIntoView({block:'nearest',behavior:'smooth'});card?.querySelector(name?'[data-set-field="reps"]':'[data-workout-field="note"]')?.focus()
  }
  function renderWorkoutRecap() {
    const date=$('workoutDate').value,rows=Object.values(data.workouts?.[date]||{}).filter(MinishCore.completedWorkout)
    const sets=rows.flatMap(r=>MinishCore.workoutSets(r).map(([,s])=>s).filter(s=>s.done&&s.reps>0))
    const reps=sets.reduce((n,s)=>n+Number(s.reps),0)
    $('workoutRecap').innerHTML=sets.length?`<strong>오늘 ${sets.length}세트 / ${reps}회 해냈어요</strong><p>완료한 운동 ${rows.length}개. 끝낸 세트는 이미 저장됐어요.</p>`:''
    const names=[...new Set(Object.entries(data.workouts||{}).filter(([d])=>d<=date).sort(([a],[b])=>b.localeCompare(a)).flatMap(([,rs])=>Object.values(rs).filter(MinishCore.completedWorkout).map(r=>r.note.trim())))].slice(0,8)
    // Compare actual completed sets, never planned or copied sets. Same name only.
    $('workoutHistory').innerHTML=names.length?names.map(name=>{
      const next=new Date(`${date}T12:00:00`);next.setDate(next.getDate()+1)
      const history=MinishCore.workoutHistory(data.workouts,name,toDK(next)).filter(h=>h.sets.length)
      if(!history.length)return ''
      const best=h=>h.sets.reduce((a,s)=>Number(s.weight||0)>Number(a.weight||0)||Number(s.weight||0)===Number(a.weight||0)&&s.reps>a.reps?s:a,{weight:0,reps:0})
      const latest=best(history[0]),previous=history[1]?best(history[1]):null
      let change='첫 세트 기록'
      if(previous){const kg=Number(latest.weight||0)-Number(previous.weight||0),reps=latest.reps-previous.reps;change=kg?`지난번 최고 무게보다 ${kg>0?'+':''}${kg}kg`:reps?`같은 무게에서 ${reps>0?'+':''}${reps}회`:'지난번과 같은 최고 세트'}
      return `<div class="workout-history-item"><strong>${esc(name)}</strong><span>${latest.weight||0}kg × ${latest.reps}회</span><small>${esc(change)} / ${history[0].date.slice(5)}</small><details><summary>최근 기록</summary>${history.slice(0,5).map(h=>`<p>${h.date} / ${h.sets.map(s=>`${s.weight||0}kg × ${s.reps}`).join(' / ')}</p>`).join('')}</details></div>`
    }).join(''):'<p class="feature-help">세트를 완료하면 여기에 변화가 쌓여요.</p>'
  }
  function render(view) {if(view==='sober')renderSober();if(view==='workout')renderWorkout()}
  $('soberCalendar').addEventListener('click',event=>{
    const button=event.target.closest('[data-sober-date]');if(!button||button.disabled)return
    const date=button.dataset.soberDate;if(date<start||date>end||date>todayDK())return
    data.soberDays??={};data.soberDays[date]=((data.soberDays[date]||0)+1)%3
    // Update in place so two fast taps hit the same button, including on touch screens.
    const status=data.soberDays[date];button.className=`sober-day sober-${status}${date===todayDK()?' today':''}`
    button.setAttribute('aria-label',`${date} ${labels[status]}`);button.title=`${date} / ${labels[status]}`;button.querySelector('small').textContent=status===1?'✓':status===2?'−':''
    save();renderSoberSummary()
  })
  $('soberToday').addEventListener('click',()=>{$('soberCalendar').querySelector(`[data-sober-date="${todayDK()}"]`)?.scrollIntoView({block:'center',behavior:'smooth'})})
  $('workoutAdd').addEventListener('click',()=>addWorkout())
  $('workoutQuickStart').addEventListener('click',event=>{const button=event.target.closest('[data-workout-repeat]');if(button)addWorkout(button.dataset.workoutRepeat)})
  $('workoutRows').addEventListener('input',event=>{
    const input=event.target,field=input.dataset.setField;if(!field)return
    const row=input.closest('[data-workout-id]'),setRow=input.closest('[data-set-id]'),set=data.workouts?.[$('workoutDate').value]?.[row.dataset.workoutId]?.sets?.[setRow.dataset.setId]
    if(!set||set.deleted)return
    const n=Number(input.value),valid=!input.validity.badInput&&(input.value===''||Number.isFinite(n)&&n>=0&&n<=(field==='weight'?2000:9999)&&(field==='weight'||Number.isInteger(n)))
    input.setCustomValidity(valid?'':'올바른 숫자를 입력해 주세요.');if(!valid){$('workoutStatus').textContent='숫자를 확인해 주세요. 이전 값은 보존됩니다.';return}
    set[field]=input.value===''?null:n;if(field==='reps'&&!n)set.done=false
    setRow.classList.toggle('is-done',!!set.done);setRow.querySelector('[data-set-done]').setAttribute('aria-pressed',String(!!set.done));setRow.querySelector('[data-set-done]').textContent=set.done?'✓':'○'
    save();renderWorkoutWeek();renderWorkoutRecap()
  })
  $('workoutRows').addEventListener('input',event=>{
    const input=event.target,field=input.dataset.workoutField,row=input.closest('[data-workout-id]');if(!field||!row)return
    let value=input.value
    if(field==='count'){
      if(input.validity.badInput||value!==''&&(!/^\d+$/.test(value)||Number(value)>999999)){input.setCustomValidity('0~999999 사이의 정수를 입력하세요.');$('workoutStatus').textContent='횟수를 확인해 주세요. 다른 입력은 보존됩니다.';return}
      input.setCustomValidity('');value=value===''?null:Number(value)
    }
    const entry=data.workouts?.[$('workoutDate').value]?.[row.dataset.workoutId];if(!entry||entry.deleted)return
    entry[field]=value;renderWorkoutWeek();renderWorkoutRecap();const hint=row.querySelector('.workout-previous');if(hint)hint.innerHTML=previousText(entry);$('workoutStatus').textContent='자동 저장 중…';save().then(()=>{$('workoutStatus').textContent='저장 상태는 상단 동기화 표시에서 확인할 수 있어요.'})
  })
  $('workoutRows').addEventListener('click',event=>{
    const card=event.target.closest('[data-workout-id]'),row=card&&data.workouts?.[$('workoutDate').value]?.[card.dataset.workoutId]
    if(row&&!row.deleted){
      const setRow=event.target.closest('[data-set-id]'),set=setRow&&row.sets?.[setRow.dataset.setId]
      if(event.target.closest('[data-set-add]')){const sets=MinishCore.workoutSets(row);row.sets[crypto.randomUUID()]=newSet(Math.max(-1,...sets.map(([,s])=>s.order||0))+1,sets.at(-1)?.[1]);save();renderWorkout();return}
      if(set&&event.target.closest('[data-set-done]')){
        if(!set.done&&(!row.note.trim()||!set.reps||card.querySelector(':invalid'))){$('workoutStatus').textContent='운동 이름과 세트 횟수를 입력해 주세요.';(!row.note.trim()?card.querySelector('[data-workout-field="note"]'):setRow.querySelector('[data-set-field="reps"]')).focus();return}
        set.done=!set.done;save();renderWorkout();return
      }
      if(set&&event.target.closest('[data-set-remove]')){if(set.done&&!confirm('완료한 세트를 삭제할까요?'))return;set.deleted=true;save();renderWorkout();return}
    }
    const button=event.target.closest('[data-workout-delete]');if(!button)return
    const entry=data.workouts?.[$('workoutDate').value]?.[button.dataset.workoutDelete];if(!entry)return
    if(!confirm('이 운동과 세트 기록을 삭제할까요?'))return
    entry.deleted=true;save();renderWorkout()
  })
  $('workoutDate').addEventListener('change',()=>{if(!MinishCore.validDate($('workoutDate').value))$('workoutDate').value=todayDK();renderWorkout()})
  for(const [id,offset] of [['workoutPrev',-1],['workoutNext',1]])$(id).addEventListener('click',()=>{const date=new Date(`${$('workoutDate').value||todayDK()}T12:00:00`);date.setDate(date.getDate()+offset);$('workoutDate').value=toDK(date);renderWorkout()})
  $('workoutToday').addEventListener('click',()=>{$('workoutDate').value=todayDK();renderWorkout()})
  function renderWorkoutWeek() {
    const week=MinishCore.spendingWeeks([],$('workoutDate').value,1)[0]
    const days=Array.from({length:7},(_,i)=>{const d=new Date(`${week.from}T12:00:00`);d.setDate(d.getDate()+i);const date=toDK(d);return {date,done:Object.values(data.workouts?.[date]||{}).some(MinishCore.completedWorkout)}})
    const done=days.filter(day=>day.done).length,target=Number(data.workoutWeeklyTargets?.[week.key])||0,pct=target?Math.min(100,Math.round(done/target*100)):0
    $('workoutWeekRange').textContent=`${week.from} ~ ${week.to} / 월–일`
    $('workoutTarget').value=String(target)
    $('workoutProgress').textContent=target?`${done} / ${target}회 / ${pct}%`:`${done}회 기록 / 목표 미설정`
    $('workoutProgressNote').textContent=target?(done>=target?'이번 주 목표 달성!':`목표까지 ${target-done}회 남았어요`):'이번 주에 운동할 횟수를 선택해 주세요'
    $('workoutProgressBar').style.width=`${pct}%`
    $('workoutDays').innerHTML=days.map((day,i)=>`<span class="${day.done?'done':''}" title="${day.date}">${['월','화','수','목','금','토','일'][i]}<b>${day.done?'✓':'-'}</b></span>`).join('')
  }
  $('workoutTarget').addEventListener('change',event=>{
    const target=Number(event.target.value);if(!Number.isInteger(target)||target<0||target>7)return
    const week=MinishCore.spendingWeeks([],$('workoutDate').value,1)[0]
    data.workoutWeeklyTargets??={};data.workoutWeeklyTargets[week.key]=target;save();renderWorkoutWeek()
  })
  window.MinishHealth={render,soberStats}
})()
