(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.MinishDictionarySearch=factory()})(typeof window==='object'?window:globalThis,()=>{
  const normalize=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[’‘]/g,"'").replace(/\s+/g,' ').trim()
  function search(entries,query){const q=normalize(query);if(!q)return [];const exact=[],prefix=[],related=[];for(const entry of entries){const key=normalize(entry[0]);if(key===q)exact.push({entry,kind:'exact'});else if(key.startsWith(q))prefix.push({entry,kind:'prefix'});else if(q.length>=2&&key.includes(q))related.push({entry,kind:'related'})}return [...exact,...prefix,...related]}
  function copyLine(word,meanings){return `${word} ${meanings.join(', ')}`}
  return {normalize,search,copyLine}
})
