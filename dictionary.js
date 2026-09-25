(() => {
  const $=id=>document.getElementById(id),C=window.MinishDictionarySearch
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
  let loading=null,results=[],limit=20,timer=null
  function load(){
    if(window.MinishDictionaryData)return Promise.resolve()
    if(loading)return loading
    $('dictionaryStatus').textContent='내장 사전을 준비하고 있어요…'
    loading=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='dictionary/data.js?v=15';script.onload=()=>{if(window.MinishDictionaryData)resolve();else {script.remove();loading=null;reject(new Error('사전 데이터 확인 실패'))}};script.onerror=()=>{script.remove();loading=null;reject(new Error('사전을 불러오지 못했어요. 연결을 확인하고 다시 입력해 주세요.'))};document.head.appendChild(script)})
    return loading
  }
  function render(){
    const q=$('dictionaryQuery').value.trim(),exact=results.find(r=>r.kind==='exact')
    $('dictionaryStatus').textContent=!q?'영어를 입력하면 한국어 뜻이 바로 나옵니다.':results.length?`${exact?`일치하는 표현의 뜻 ${exact.entry[1].length}개`:'정확히 일치하는 표현 없음'} / 관련 표현 ${results.length-(exact?1:0)}개`:'수록된 표현이 없어요. 철자나 더 짧은 영어 표현을 확인해 주세요.'
    $('dictionaryResults').innerHTML=results.slice(0,limit).map(({entry:[word,meanings],kind},i)=>`<article class="dictionary-result"><div class="dictionary-result-head"><div><span class="dictionary-match">${kind==='exact'?'일치하는 표현':kind==='prefix'?'이 글자로 시작하는 표현':'입력한 글자가 포함된 표현'}</span><h2>${esc(word)}</h2></div><button class="today-btn" data-dictionary-copy="${i}" aria-label="${esc(word)} 뜻 모두 복사">모두 복사</button></div><ol>${meanings.map((meaning,j)=>`<li><span>${esc(meaning)}</span><button class="dictionary-copy" data-dictionary-copy="${i}" data-meaning="${j}" aria-label="${esc(word+' '+meaning)} 복사">복사</button></li>`).join('')}</ol></article>`).join('')
    $('dictionaryMore').hidden=results.length<=limit
  }
  async function update(){const query=$('dictionaryQuery').value;try{await load();if(query!==$('dictionaryQuery').value)return;results=C.search(window.MinishDictionaryData.entries,query);limit=20;render()}catch(error){$('dictionaryStatus').textContent=error.message}}
  $('dictionaryQuery').addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(update,80)})
  $('dictionaryQuery').addEventListener('compositionend',update)
  $('dictionaryClear').addEventListener('click',()=>{$('dictionaryQuery').value='';results=[];render();$('dictionaryQuery').focus()})
  $('dictionaryMore').addEventListener('click',()=>{limit+=20;render()})
  $('dictionaryResults').addEventListener('click',async event=>{
    const button=event.target.closest('[data-dictionary-copy]');if(!button)return
    const result=results[Number(button.dataset.dictionaryCopy)];if(!result)return
    const [word,meanings]=result.entry,selected=button.hasAttribute('data-meaning')?[meanings[Number(button.dataset.meaning)]]:meanings,text=C.copyLine(word,selected)
    try {await navigator.clipboard.writeText(text);$('dictionaryCopyStatus').textContent='복사했어요. 원하는 곳에 붙여넣으세요.'}
    catch {
      const fallback=$('dictionaryCopyFallback');fallback.hidden=false;fallback.value=text;fallback.focus();fallback.select()
      let copied=false;try{copied=document.execCommand('copy')}catch{}
      if(copied){fallback.hidden=true;$('dictionaryCopyStatus').textContent='복사했어요.'}else $('dictionaryCopyStatus').textContent='아래 선택된 문장을 직접 복사해 주세요.'
    }
  })
  window.MinishDictionary={open:update}
})()
