(() => {
  'use strict'
  const C=window.MinishCore, $=id=>document.getElementById(id)
  const money=n=>`${n.toLocaleString('ko-KR')}원`
  const symbols={income:'+',expense:'−',investment:'*'}
  const names={income:'수입',expense:'지출',investment:'저축·투자'}
  const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))
  const DRAFT='minish-finance:draft:v1'
  let events=[],state={entries:[],categories:[]},dbPromise=null,syncRunning=false,syncTimer=null,ready=false
  let editId=null,editEventId=null,newEntryId=null,selectedType=null,deleteId=null,showTrash=false,showAll=false,pendingEvent=null
  let currentStatus='가계부 저장소 확인 중…'
  function status(message,error=false){currentStatus=message;$('financeStatus').textContent=message;$('financeStatus').classList.toggle('error',error)}

  function database() {
    if(dbPromise)return dbPromise
    dbPromise=new Promise((resolve,reject)=>{
      const request=indexedDB.open('minish-finance-journal',1)
      request.onupgradeneeded=()=>{request.result.createObjectStore('events',{keyPath:'id'});request.result.createObjectStore('backup',{keyPath:'id'})}
      request.onsuccess=()=>resolve(request.result)
      request.onerror=()=>reject(new Error('가계부 저장소를 열 수 없습니다. 브라우저 저장 권한을 확인해 주세요.'))
      request.onblocked=()=>reject(new Error('다른 탭을 닫고 다시 시도해 주세요.'))
    })
    return dbPromise
  }
  async function readLocal() {
    if(window.api?.financeLoad){const r=await window.api.financeLoad();if(!r.ok)throw new Error(r.error);return r.events}
    const db=await database()
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(['events','backup'],'readonly'),a=tx.objectStore('events').getAll(),b=tx.objectStore('backup').getAll()
      tx.oncomplete=()=>{
        try {
          const union=new Map()
          for(const event of [...a.result,...b.result]){
            if(!C.validEvent(event))throw new Error('가계부 저장 기록에 오류가 있습니다. 복구 전 기록을 보존합니다.')
            if(union.has(event.id)&&C.stableStringify(union.get(event.id))!==C.stableStringify(event))throw new Error('가계부 원본과 백업이 다릅니다.')
            union.set(event.id,event)
          }
          resolve([...union.values()])
        }catch(error){reject(error)}
      }
      tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('가계부 읽기가 중단되었습니다.'))
    })
  }
  async function appendLocal(batch) {
    if(batch.some(e=>!C.validEvent(e)))throw new Error('금액·날짜·기록 내용을 확인해 주세요.')
    if(window.api?.financeAppend){const r=await window.api.financeAppend(batch);if(!r.ok)throw new Error(r.error);return}
    const db=await database()
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(['events','backup'],'readwrite',{durability:'strict'})
      let failure=null
      for(const name of ['events','backup'])for(const event of batch){
        const store=tx.objectStore(name),get=store.get(event.id)
        get.onsuccess=()=>{
          if(get.result&&C.stableStringify(get.result)!==C.stableStringify(event)){
            failure=new Error('같은 기록 ID의 내용이 다릅니다. 덮어쓰지 않았습니다.');tx.abort()
          }else store.put(event)
        }
      }
      tx.oncomplete=resolve;tx.onerror=()=>reject(failure||tx.error);tx.onabort=()=>reject(failure||tx.error||new Error('저장이 중단되었습니다. 다시 시도해 주세요.'))
    })
  }
  async function reload() {events=await readLocal();state=C.replay(events);render()}
  function makeEvent(entity,entityId,action,value={}) {
    return {id:crypto.randomUUID(),entity,entityId,action,value,clock:events.reduce((latest,e)=>Math.max(latest,e.clock+1),Date.now()),deviceId:localStorage.getItem('minish-tracker:device-id:v1')||'local'}
  }
  async function commit(event) {
    if(!ready)throw new Error('가계부 저장소를 먼저 확인해 주세요.')
    await appendLocal([event])
    await reload()
    status('이 기기에 저장됨 · 클라우드 동기화 대기')
    queueSync()
  }
  function queueSync(){clearTimeout(syncTimer);syncTimer=setTimeout(()=>sync().catch(()=>{}),800)}
  async function sync() {
    if(syncRunning||!ready)return
    if(!navigator.onLine){status('오프라인 · 이 기기에 저장됨. 연결되면 자동 동기화합니다.');return}
    if(!window.minishSync.getSession()){status('이 기기에 저장됨 · 같은 계정으로 로그인하면 가계부도 동기화합니다.');return}
    syncRunning=true
    try{
      const session=await window.minishSync.readySession()
      if(!session)return
      const config=window.minishSync.getConfig()
      const headers={apikey:config.anonKey,Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'}
      async function request(url,init={}){
        const response=await fetch(url,{...init,headers:{...headers,...init.headers},signal:AbortSignal.timeout(20000)})
        if(!response.ok)throw new Error(`가계부 연결 확인 필요 (${response.status}) · 기기 기록은 유지됩니다.`)
        return response.status===204?null:response.json()
      }
      status('가계부 동기화 중…')
      const remote=new Map()
      let cursor=''
      for(;;){
        const query=new URLSearchParams({select:'id,event',user_id:`eq.${session.user.id}`,order:'id.asc',limit:'500'})
        if(cursor)query.set('id',`gt.${cursor}`)
        const rows=await request(`${config.url}/rest/v1/finance_events?${query}`)
        if(!Array.isArray(rows))throw new Error('가계부 서버 응답을 확인할 수 없습니다.')
        for(const row of rows){if(!C.validEvent(row.event)||row.id!==row.event.id)throw new Error('클라우드 기록 형식 오류. 기기 기록은 유지됩니다.');remote.set(row.id,row.event)}
        if(rows.length<500)break
        cursor=rows.at(-1).id
      }
      const local=await readLocal(),localMap=new Map(local.map(e=>[e.id,e]))
      for(const [id,event] of remote)if(localMap.has(id)&&C.stableStringify(localMap.get(id))!==C.stableStringify(event))throw new Error('기록 ID 충돌을 발견했습니다. 양쪽 원본을 유지했습니다.')
      const missingLocal=[...remote.values()].filter(e=>!localMap.has(e.id))
      for(let i=0;i<missingLocal.length;i+=200)await appendLocal(missingLocal.slice(i,i+200))
      const missingCloud=local.filter(e=>!remote.has(e.id))
      for(let i=0;i<missingCloud.length;i+=200){
        if(window.minishSync.getSession()?.user?.id!==session.user.id)throw new Error('로그인이 변경되어 동기화를 중단했습니다.')
        await request(`${config.url}/rest/v1/finance_events?on_conflict=user_id,id`,{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=representation'},body:JSON.stringify(missingCloud.slice(i,i+200).map(event=>({id:event.id,user_id:session.user.id,event})))})
      }
      await reload()
      const pending=events.filter(e=>!remote.has(e.id)&&!missingCloud.some(x=>x.id===e.id)).length
      if(pending){status('새 기록 저장됨 · 동기화 대기');queueSync()}
      else status(`가계부 동기화 완료 · ${new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})}`)
    }catch(error){status(error.message||'동기화 실패 · 기기 기록은 유지됩니다.',true);throw error}
    finally{syncRunning=false}
  }
  function render() {
    const month=$('financeMonth').value
    const entries=state.entries.filter(e=>showAll||e.date.startsWith(month))
    const sums=C.totals(entries)
    $('financeSummary').innerHTML=['income','expense','investment','net'].map(type=>`<article class="finance-total ${type}"><span>${names[type]||'기록 합계'}</span><strong>${type==='net'?(sums.net<0?'−':'+'):symbols[type]} ${money(Math.abs(sums[type]))}</strong></article>`).join('')
    const anchor=showAll?C.dateKey(new Date()):C.dateKey(new Date(Number(month.slice(0,4)),Number(month.slice(5)),0))
    const weeks=C.spendingWeeks(state.entries,anchor),max=Math.max(1,...weeks.map(w=>w.amount))
    $('financeChart').innerHTML=weeks.map(w=>`<div class="spending-week"><span>${money(w.amount)}</span><div class="spending-track"><div class="spending-fill" style="height:${w.amount/max*100}%"></div></div><strong>${w.from.slice(5).replace('-','/')}</strong><small>${w.key.split('-')[1]}</small></div>`).join('')
    $('financeChart').setAttribute('aria-label','주차별 지출: '+weeks.map(w=>`${w.from}부터 ${w.to}: ${money(w.amount)}`).join(', '))
    const rows=showTrash?state.entries.filter(e=>e.deleted):entries.filter(e=>!e.deleted)
    $('financeListTitle').textContent=showTrash?'휴지통 · 전체 기간':showAll?'전체 내역':`${month} 내역`
    $('financeTrash').textContent=showTrash?'기록으로 돌아가기':'휴지통'
    $('financeAll').classList.toggle('active',showAll)
    $('financeList').innerHTML=rows.length?rows.map(entry=>{
      const category=state.categories.find(c=>c.id===entry.categoryId)?.name||'카테고리 없음'
      const controls=showTrash?`<button data-restore="${entry.id}">복원</button>`:`<button data-edit="${entry.id}">수정</button><button data-delete="${entry.id}">삭제</button>`
      return `<div class="finance-row"><span class="finance-symbol ${entry.type}">${symbols[entry.type]}</span><div class="finance-description"><strong>${escape(entry.note)}</strong><small>${escape(entry.date)} · ${escape(category)}</small></div><strong class="finance-value ${entry.type}">${symbols[entry.type]} ${money(entry.amount)}</strong><div class="finance-row-actions">${controls}</div></div>`
    }).join(''):`<div class="review-empty">${showTrash?'휴지통이 비어 있어요.':'아직 기록이 없어요. 만들기를 눌러 첫 내역을 남겨보세요.'}</div>`
  }
  function renderCategories(selected='') {
    $('financeCategory').innerHTML='<option value="">카테고리 선택</option>'+state.categories.map(c=>`<option value="${c.id}">${escape(c.name)}</option>`).join('')
    $('financeCategory').value=selected
    $('financeCategoryList').innerHTML=state.categories.map(c=>`<div class="finance-inline-category"><input class="modal-input" maxlength="40" data-category-name="${c.id}" aria-label="${escape(c.name)} 이름" value="${escape(c.name)}"><button class="today-btn" data-category-rename="${c.id}">이름 저장</button></div>`).join('')
  }
  function valueOf(entry){return {type:entry.type,date:entry.date,categoryId:entry.categoryId,note:entry.note,amount:entry.amount}}
  function openForm(entry=null) {
    editId=entry?.id||null;editEventId=entry?.eventId||null;pendingEvent=null;selectedType=entry?.type||null
    let draft={};try{draft=JSON.parse(localStorage.getItem(DRAFT)||'{}')}catch{}
    newEntryId=/^[a-f0-9-]{36}$/i.test(draft.id||'')?draft.id:crypto.randomUUID()
    const value=entry||draft
    $('financeFormTitle').textContent=entry?'기록 수정':'기록 만들기'
    $('financeDate').value=value.date||C.dateKey(new Date());$('financeNote').value=value.note||'';$('financeAmount').value=value.amount?Number(value.amount).toLocaleString('ko-KR'):''
    $('financeNewCategory').value='';$('financeFormMessage').textContent=entry?'수정 전 기록도 이력에 보관합니다.':'먼저 + 수입, − 지출, * 저축·투자를 선택하세요.'
    renderCategories(value.categoryId||'');$('financeForm').hidden=!selectedType
    document.querySelectorAll('[data-type]').forEach(b=>b.classList.toggle('active',b.dataset.type===selectedType))
    $('financeOverlay').classList.add('visible')
  }
  async function addCategory(name) {
    name=name.trim()
    if(!name)throw new Error('카테고리 이름을 입력해 주세요.')
    if(name.length>40)throw new Error('카테고리는 40자 이내로 입력해 주세요.')
    const existing=state.categories.find(c=>c.name.toLocaleLowerCase()===name.toLocaleLowerCase())
    if(existing)return existing.id
    const id=crypto.randomUUID();await commit(makeEvent('category',id,'put',{name}));return id
  }
  function saveDraft() {
    if(editId)return
    try {localStorage.setItem(DRAFT,JSON.stringify({id:newEntryId,type:selectedType,date:$('financeDate').value,categoryId:$('financeCategory').value,note:$('financeNote').value,amount:$('financeAmount').value.replace(/,/g,'')}))}catch{}
  }
  function download(value,name) {
    const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'})),link=document.createElement('a')
    link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
  }
  async function init() {
    $('financeMonth').value=C.dateKey(new Date()).slice(0,7)
    try{await reload();ready=true;status('이 기기에 저장됨 · 가계부 연결 확인 중…');queueSync()}
    catch(error){status(error.message,true);$('financeCreate').disabled=true}
    $('financeCreate').addEventListener('click',()=>openForm())
    $('financeClose').addEventListener('click',()=>{$('financeOverlay').classList.remove('visible');saveDraft()})
    $('financeTypes').addEventListener('click',event=>{
      const button=event.target.closest('[data-type]');if(!button)return
      selectedType=button.dataset.type;pendingEvent=null;$('financeForm').hidden=false
      document.querySelectorAll('[data-type]').forEach(b=>b.classList.toggle('active',b===button));saveDraft()
    })
    $('financeForm').addEventListener('input',()=>{pendingEvent=null;saveDraft()})
    $('financeAddCategory').addEventListener('click',async()=>{
      const button=$('financeAddCategory');button.disabled=true
      try{const id=await addCategory($('financeNewCategory').value);renderCategories(id);$('financeNewCategory').value='';$('financeFormMessage').textContent='카테고리 저장됨';saveDraft()}
      catch(error){$('financeFormMessage').textContent=error.message}finally{button.disabled=false}
    })
    $('financeForm').addEventListener('submit',async event=>{
      event.preventDefault();const button=$('financeSave');if(button.disabled)return
      const raw=$('financeAmount').value.replace(/,/g,'').trim()
      const value={type:selectedType,date:$('financeDate').value,categoryId:$('financeCategory').value,note:$('financeNote').value.trim(),amount:Number(raw)}
      if(!/^\d+$/.test(raw)||!state.categories.some(c=>c.id===value.categoryId)){$('financeFormMessage').textContent='카테고리를 선택하고 원 단위의 양수 금액을 입력해 주세요.';return}
      if(editId&&state.entries.find(e=>e.id===editId)?.eventId!==editEventId){$('financeFormMessage').textContent='다른 기기에서 수정되었습니다. 창을 닫고 최신 기록을 다시 열어 주세요.';return}
      pendingEvent=pendingEvent||makeEvent('entry',editId||newEntryId,'put',value)
      if(!C.validEvent(pendingEvent)){$('financeFormMessage').textContent='날짜·내용·금액(1원 이상)을 확인해 주세요.';pendingEvent=null;return}
      button.disabled=true;$('financeFormMessage').textContent='기기에 안전하게 저장 중…'
      try{await commit(pendingEvent);if(!editId)localStorage.removeItem(DRAFT);pendingEvent=null;$('financeOverlay').classList.remove('visible');navigator.storage?.persist?.().catch(()=>{})}
      catch(error){$('financeFormMessage').textContent=`저장되지 않았습니다 · ${error.message}. 입력 내용은 유지됩니다.`}finally{button.disabled=false}
    })
    $('financeMonth').addEventListener('change',()=>{if(!/^\d{4}-\d{2}$/.test($('financeMonth').value))return;showAll=false;render()})
    function moveMonth(offset){const [y,m]=$('financeMonth').value.split('-').map(Number);$('financeMonth').value=C.dateKey(new Date(y,m-1+offset,1)).slice(0,7);showAll=false;render()}
    $('financePrevMonth').addEventListener('click',()=>moveMonth(-1));$('financeNextMonth').addEventListener('click',()=>moveMonth(1))
    $('financeCurrentMonth').addEventListener('click',()=>{$('financeMonth').value=C.dateKey(new Date()).slice(0,7);showAll=false;render()})
    $('financeAll').addEventListener('click',()=>{showAll=true;render()})
    $('financeTrash').addEventListener('click',()=>{showTrash=!showTrash;render()})
    $('financeList').addEventListener('click',async event=>{
      const button=event.target.closest('button');if(!button)return
      const id=button.dataset.edit||button.dataset.delete||button.dataset.restore,entry=state.entries.find(e=>e.id===id);if(!entry)return
      if(button.dataset.edit)openForm(entry)
      else if(button.dataset.delete){deleteId=id;$('financeDeleteMessage').textContent='';$('financeDeleteOverlay').classList.add('visible')}
      else {button.disabled=true;try{await commit(makeEvent('entry',id,'put',valueOf(entry)))}catch(error){status(error.message,true);button.disabled=false}}
    })
    $('financeDeleteCancel').addEventListener('click',()=>$('financeDeleteOverlay').classList.remove('visible'))
    $('financeDeleteConfirm').addEventListener('click',async()=>{
      const button=$('financeDeleteConfirm');button.disabled=true
      try{await commit(makeEvent('entry',deleteId,'delete'));$('financeDeleteOverlay').classList.remove('visible')}
      catch(error){$('financeDeleteMessage').textContent=error.message}finally{button.disabled=false}
    })
    $('financeCategories').addEventListener('click',()=>{renderCategories();$('financeCategoryOverlay').classList.add('visible')})
    $('financeCategoryClose').addEventListener('click',()=>$('financeCategoryOverlay').classList.remove('visible'))
    $('financeCategoryCreate').addEventListener('click',async()=>{
      const button=$('financeCategoryCreate');button.disabled=true
      try{await addCategory($('financeCategoryName').value);$('financeCategoryName').value='';renderCategories();$('financeCategoryMessage').textContent='카테고리 저장됨'}catch(error){$('financeCategoryMessage').textContent=error.message}finally{button.disabled=false}
    })
    $('financeCategoryList').addEventListener('click',async event=>{
      const id=event.target.dataset.categoryRename;if(!id)return
      const name=document.querySelector(`[data-category-name="${id}"]`).value.trim()
      if(!name||state.categories.some(c=>c.id!==id&&c.name.toLocaleLowerCase()===name.toLocaleLowerCase())){$('financeCategoryMessage').textContent='이름이 비어 있거나 이미 사용 중입니다.';return}
      event.target.disabled=true
      try{await commit(makeEvent('category',id,'put',{name}));renderCategories();$('financeCategoryMessage').textContent='이름 저장됨'}catch(error){$('financeCategoryMessage').textContent=error.message;event.target.disabled=false}
    })
    $('financeSync').addEventListener('click',()=>sync().catch(()=>{}))
    $('financeExport').addEventListener('click',async()=>{try{download({format:'minish-finance-v1',exportedAt:new Date().toISOString(),events:await readLocal()},`MINISH-finance-${C.dateKey(new Date())}.json`)}catch(error){status(error.message,true)}})
    $('financeImport').addEventListener('click',()=>$('financeImportFile').click())
    $('financeImportFile').addEventListener('change',async event=>{
      try {
        const file=event.target.files[0];if(!file)return
        if(file.size>20000000)throw new Error('20MB 이하의 가계부 백업 파일을 선택해 주세요.')
        const backup=JSON.parse(await file.text())
        if(backup.format!=='minish-finance-v1'||!Array.isArray(backup.events)||backup.events.some(e=>!C.validEvent(e)))throw new Error('올바른 MINISH 가계부 백업이 아닙니다.')
        const current=new Map((await readLocal()).map(e=>[e.id,e]))
        for(const e of backup.events)if(current.has(e.id)&&C.stableStringify(current.get(e.id))!==C.stableStringify(e))throw new Error('동일 ID의 다른 기록이 있어 가져오기를 중단했습니다.')
        for(let i=0;i<backup.events.length;i+=200)await appendLocal(backup.events.slice(i,i+200))
        await reload();status('백업 기록을 합쳤습니다. 기존 기록은 삭제하지 않았습니다.');queueSync()
      }catch(error){status(error.message,true)}finally{event.target.value=''}
    })
    window.addEventListener('online',queueSync);window.addEventListener('focus',()=>{reload().then(queueSync).catch(e=>status(e.message,true))})
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')queueSync()})
    window.addEventListener('minish-sync-status',event=>{if(['connected','ready'].includes(event.detail.status))queueSync()})
    setInterval(queueSync,30000)
  }
  // The append-only financial journal is deliberately independent of tracker snapshots.
  document.addEventListener('DOMContentLoaded',init)
})()
