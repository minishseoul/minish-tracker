;(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else root.MinishCore = factory()
})(typeof window === 'object' ? window : this, function () {
  'use strict'
  const AREAS = ['Work', 'Health', 'Music']
  const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
  const stableStringify = value => JSON.stringify(value,(key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(k=>[k,item[k]])):item)
  const dateKey = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false
    const date = new Date(`${value}T12:00:00`)
    return Number.isFinite(date.getTime()) && dateKey(date) === value
  }
  function weekKey(date) {
    const d = new Date(Date.UTC(date.getFullYear(),date.getMonth(),date.getDate()))
    d.setUTCDate(d.getUTCDate()+4-(d.getUTCDay()||7))
    const year=d.getUTCFullYear()
    return `${year}-W${String(Math.ceil((((d-new Date(Date.UTC(year,0,1)))/86400000)+1)/7)).padStart(2,'0')}`
  }
  function periodKey(period,date) {
    const y=date.getFullYear(),m=date.getMonth()+1
    return period==='year'?`${y}`:period==='quarter'?`${y}-Q${Math.ceil(m/3)}`:period==='month'?`${y}-${String(m).padStart(2,'0')}`:weekKey(date)
  }
  function migrateGoals(data) {
    let changed=false
    for (const item of Object.values(data.okr || {})) {
      if (item && typeof item==='object' && Object.hasOwn(item,'goal')) {delete item.goal;changed=true}
    }
    if(data.goalSchemaVersion!==2){data.goalSchemaVersion=2;changed=true}
    return changed
  }
  function goalStats(okr,year,scope) {
    const re={year:/^\d{4}$/,quarter:/^\d{4}-Q[1-4]$/,month:/^\d{4}-\d{2}$/,week:/^\d{4}-W\d{2}$/}[scope]
    const entries=Object.entries(okr||{}).filter(([key])=>re.test(key)&&key.slice(0,4)===String(year)).sort(([a],[b])=>a.localeCompare(b))
    const areas=AREAS.map(area=>{
      const goals=entries.flatMap(([key,value])=>{
        const goal=value?.areas?.[area]
        return goal?.text?.trim()?[{key,area,text:goal.text,done:goal.done===true}]:[]
      })
      return {area,total:goals.length,done:goals.filter(x=>x.done).length,goals}
    })
    const total=areas.reduce((n,a)=>n+a.total,0),done=areas.reduce((n,a)=>n+a.done,0)
    return {total,done,pct:total?Math.round(done/total*100):0,areas,entries}
  }
  function validEvent(event) {
    if(!event||!UUID.test(event.id)||!UUID.test(event.entityId)||!['category','entry'].includes(event.entity)) return false
    if(!['put','delete'].includes(event.action)||!Number.isSafeInteger(event.clock)||event.clock<0) return false
    if(typeof event.deviceId!=='string'||event.deviceId.length>100) return false
    if(event.action==='delete') return event.entity==='entry'
    const v=event.value
    if(!v||typeof v!=='object')return false
    if(event.entity==='category')return typeof v.name==='string'&&v.name.trim().length>0&&v.name.length<=40
    return ['income','expense','investment'].includes(v.type)&&validDate(v.date)&&UUID.test(v.categoryId)&&
      typeof v.note==='string'&&v.note.trim().length>0&&v.note.length<=160&&Number.isSafeInteger(v.amount)&&v.amount>0&&v.amount<=1000000000000
  }
  function sortEvents(events) {return [...events].sort((a,b)=>a.clock-b.clock||a.id.localeCompare(b.id))}
  function replay(events) {
    const categories=new Map(),entries=new Map(),seen=new Set()
    for(const event of sortEvents(events)) {
      if(!validEvent(event))throw new Error('가계부 변경 기록의 형식이 올바르지 않습니다.')
      if(seen.has(event.id))continue
      seen.add(event.id)
      const map=event.entity==='category'?categories:entries
      const previous=map.get(event.entityId)
      map.set(event.entityId,{...previous,...(event.action==='put'?event.value:{}),id:event.entityId,deleted:event.action==='delete',eventId:event.id,clock:event.clock})
    }
    return {categories:[...categories.values()].sort((a,b)=>a.name.localeCompare(b.name)),entries:[...entries.values()].filter(e=>e.amount).sort((a,b)=>b.date.localeCompare(a.date)||b.clock-a.clock)}
  }
  function totals(entries) {
    const out={income:0,expense:0,investment:0,net:0}
    for(const entry of entries.filter(e=>!e.deleted)) {
      out[entry.type]+=entry.amount
      if(!Number.isSafeInteger(out[entry.type]))throw new Error('합계가 지원 범위를 초과했습니다.')
    }
    out.net=out.income-out.expense-out.investment
    return out
  }
  function spendingWeeks(entries,anchor,count=8) {
    const end=new Date(`${anchor}T12:00:00`)
    end.setDate(end.getDate()-((end.getDay()+6)%7))
    return Array.from({length:count},(_,i)=>{
      const start=new Date(end);start.setDate(start.getDate()-7*(count-1-i))
      const finish=new Date(start);finish.setDate(finish.getDate()+6)
      const from=dateKey(start),to=dateKey(finish)
      return {from,to,key:weekKey(start),amount:entries.filter(e=>!e.deleted&&e.type==='expense'&&e.date>=from&&e.date<=to).reduce((n,e)=>n+e.amount,0)}
    })
  }
  return {stableStringify,AREAS,dateKey,validDate,weekKey,periodKey,migrateGoals,goalStats,validEvent,sortEvents,replay,totals,spendingWeeks}
})
