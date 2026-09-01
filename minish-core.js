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
  function spendingCategories(entries,categories,month) {
    const groups=new Map()
    let total=0,count=0
    for(const entry of entries) {
      if(entry.deleted||entry.type!=='expense'||!entry.date.startsWith(`${month}-`))continue
      const group=groups.get(entry.categoryId)||{id:entry.categoryId,amount:0,count:0}
      group.amount+=entry.amount;group.count++;total+=entry.amount;count++
      if(!Number.isSafeInteger(total))throw new Error('합계가 지원 범위를 초과했습니다.')
      groups.set(entry.categoryId,group)
    }
    const names=new Map(categories.map(c=>[c.id,c.name]))
    const rows=[...groups.values()].map(row=>({...row,name:names.get(row.id)||'카테고리 없음',pct:row.amount/total*100}))
      .sort((a,b)=>b.amount-a.amount||a.name.localeCompare(b.name)||a.id.localeCompare(b.id))
    return {month,total,count,rows}
  }
  const clone=value=>value==null?value:JSON.parse(JSON.stringify(value))
  const encodePath=value=>String(value).replace(/~/g,'~0').replace(/\//g,'~1')
  const decodePath=value=>value.replace(/~1/g,'/').replace(/~0/g,'~')
  function trackerContent(value) {
    if(!value||typeof value!=='object')return null
    const {_sync,...content}=value
    return content
  }
  function toTrackerSyncShape(value) {
    const content=clone(trackerContent(value)||{})
    for(const [source,itemsKey,orderKey] of [['routines','__routineItems','__routineOrder'],['mealPresets','__mealPresetItems','__mealPresetOrder']])if(Array.isArray(content[source])) {
      content[itemsKey]=Object.fromEntries(content[source].filter(item=>item&&typeof item.id==='string').map(item=>[item.id,item]))
      content[orderKey]=content[source].filter(item=>item&&typeof item.id==='string').map(item=>item.id)
      delete content[source]
    }
    return content
  }
  function fromTrackerSyncShape(shape) {
    const content=clone(shape||{})
    for(const [target,itemsKey,orderKey] of [['routines','__routineItems','__routineOrder'],['mealPresets','__mealPresetItems','__mealPresetOrder']]) {
      const items=content[itemsKey],order=content[orderKey]
      delete content[itemsKey];delete content[orderKey]
      if(items&&typeof items==='object'&&!Array.isArray(items)) {
        const ids=[...(Array.isArray(order)?order:[]),...Object.keys(items).sort()].filter((id,index,list)=>items[id]&&list.indexOf(id)===index)
        content[target]=ids.map(id=>items[id])
      } else if(!Array.isArray(content[target]))content[target]=[]
    }
    for(const key of ['records','okr','weeklyTargets','weeklyReviews','dailyQuotes'])if(!content[key]||typeof content[key]!=='object'||Array.isArray(content[key]))content[key]={}
    if(!content.meals||typeof content.meals!=='object'||Array.isArray(content.meals))content.meals={}
    if(!Array.isArray(content.quoteHistory))content.quoteHistory=[]
    return content
  }
  function trackerLeaves(value) {
    const leaves=new Map()
    const walk=(item,segments)=>{
      if(item===null||typeof item!=='object'||Array.isArray(item)) {leaves.set('/'+segments.map(encodePath).join('/'),clone(item));return}
      const keys=Object.keys(item).sort()
      if(!keys.length){leaves.set('/'+segments.map(encodePath).join('/'),{});return}
      for(const key of keys)walk(item[key],[...segments,key])
    }
    walk(toTrackerSyncShape(value),[])
    return leaves
  }
  function validTrackerVersion(value) {
    return Boolean(value&&Number.isSafeInteger(value.at)&&value.at>=0&&typeof value.device==='string'&&value.device.length<=100)
  }
  function latestTrackerTime(...values) {
    return values.reduce((latest,value)=>Math.max(latest,...Object.values(value?._sync?.fieldVersions||{}).filter(validTrackerVersion).map(v=>v.at)),0)
  }
  function ensureTrackerVersions(value) {
    const next=clone(value||{}),versions={}
    for(const [path,version] of Object.entries(next._sync?.fieldVersions||{}))if(validTrackerVersion(version))versions[path]=version
    const legacyAt=Math.max(0,Date.parse(next._sync?.modifiedAt||'')||0),legacyDevice=String(next._sync?.deviceId||'legacy').slice(0,100)
    for(const path of trackerLeaves(next).keys())if(!versions[path])versions[path]={at:legacyAt,device:legacyDevice}
    next._sync={...(next._sync||{}),mergeSchema:1,fieldVersions:versions}
    return next
  }
  function changedTrackerPaths(before,after) {
    const a=trackerLeaves(before),b=trackerLeaves(after),paths=new Set([...a.keys(),...b.keys()])
    return [...paths].filter(path=>!a.has(path)||!b.has(path)||stableStringify(a.get(path))!==stableStringify(b.get(path))).sort()
  }
  function markTrackerChanges(nextValue,previousValue,device,now=Date.now()) {
    const next=ensureTrackerVersions(nextValue),paths=changedTrackerPaths(previousValue||{},next)
    if(!paths.length)return next
    const at=Math.max(Number(now)||0,latestTrackerTime(next,previousValue)+1),id=String(device||'local').slice(0,100)
    const versions={...next._sync.fieldVersions},dirty=new Set(next._sync.dirtyPaths||[])
    for(const path of paths){versions[path]={at,device:id};dirty.add(path)}
    next._sync={...next._sync,mergeSchema:1,fieldVersions:versions,dirtyPaths:[...dirty].sort(),deviceId:id,modifiedAt:new Date(at).toISOString(),dirty:true}
    return next
  }
  function rebaseTrackerChanges(localValue,remoteValue) {
    const local=ensureTrackerVersions(localValue),dirty=[...new Set(local._sync.dirtyPaths||[])].sort()
    if(!dirty.length)return local
    const at=latestTrackerTime(local,ensureTrackerVersions(remoteValue))+1,device=String(local._sync.deviceId||'local').slice(0,100)
    for(const path of dirty)local._sync.fieldVersions[path]={at,device}
    local._sync.modifiedAt=new Date(at).toISOString()
    return local
  }
  function mergeTrackerData(localValue,remoteValue) {
    const local=ensureTrackerVersions(localValue),remote=ensureTrackerVersions(remoteValue)
    const a=trackerLeaves(local),b=trackerLeaves(remote),av=local._sync.fieldVersions,bv=remote._sync.fieldVersions
    const paths=[...new Set([...a.keys(),...b.keys(),...Object.keys(av),...Object.keys(bv)])].sort()
    const chosen=new Map(),versions={}
    const compare=(left,right)=>left.at-right.at||left.device.localeCompare(right.device)
    for(const path of paths) {
      const left=validTrackerVersion(av[path])?av[path]:{at:0,device:''},right=validTrackerVersion(bv[path])?bv[path]:{at:0,device:''}
      const takeLocal=compare(left,right)>0
      const winner=takeLocal?left:right,source=takeLocal?a:b
      versions[path]=winner
      if(source.has(path))chosen.set(path,clone(source.get(path)))
    }
    const shape={}
    for(const [path,value] of [...chosen].sort(([a],[b])=>a.split('/').length-b.split('/').length)) {
      const parts=path.slice(1).split('/').filter(Boolean).map(decodePath)
      let target=shape
      for(let i=0;i<parts.length-1;i++){
        if(!target[parts[i]]||typeof target[parts[i]]!=='object'||Array.isArray(target[parts[i]]))Object.defineProperty(target,parts[i],{value:{},writable:true,enumerable:true,configurable:true})
        target=target[parts[i]]
      }
      if(parts.length)Object.defineProperty(target,parts.at(-1),{value,writable:true,enumerable:true,configurable:true})
    }
    const merged=fromTrackerSyncShape(shape),at=Math.max(latestTrackerTime(local,remote),0)
    merged._sync={...remote._sync,...local._sync,mergeSchema:1,fieldVersions:versions,modifiedAt:at?new Date(at).toISOString():new Date(0).toISOString()}
    return merged
  }
  function mealStats(meals,dateKeys) {
    const allowed=new Set(dateKeys||[]),ratings={healthy:0,normal:0,fast:0},places={home:0,out:0,delivery:0}
    let recorded=0,rated=0,placed=0
    for(const [date,day] of Object.entries(meals||{})) {
      if(!allowed.has(date)||!day||typeof day!=='object')continue
      for(const type of ['breakfast','lunch','dinner']) {
        const entry=day[type]
        if(!entry||typeof entry!=='object')continue
        const hasRating=Object.hasOwn(ratings,entry.rating),hasPlace=Object.hasOwn(places,entry.place),hasDish=typeof entry.dish==='string'&&entry.dish.trim()
        if(!hasRating&&!hasPlace&&!hasDish)continue
        recorded++
        if(hasRating){ratings[entry.rating]++;rated++}
        if(hasPlace){places[entry.place]++;placed++}
      }
    }
    return {recorded,rated,placed,ratings,places}
  }
  return {stableStringify,AREAS,dateKey,validDate,weekKey,periodKey,migrateGoals,goalStats,validEvent,sortEvents,replay,totals,spendingWeeks,spendingCategories,
    trackerContent,trackerLeaves,ensureTrackerVersions,changedTrackerPaths,markTrackerChanges,rebaseTrackerChanges,mergeTrackerData,mealStats}
})
