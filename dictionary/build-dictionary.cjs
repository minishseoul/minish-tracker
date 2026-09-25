// Kengdic data transformation. SPDX-License-Identifier: MPL-2.0
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto')
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'dictionary/kengdic.tsv'),'utf8')
const groups=new Map()
const clean=s=>s.normalize('NFKC').replace(/[—·・]/g,',').replace(/\s+/g,' ').trim()
function add(term,meaning){term=clean(term).toLowerCase().replace(/^to /,'');meaning=clean(meaning);if(!term||!meaning||!/[a-z]/.test(term)||!/[가-힣]/.test(meaning)||term.length>120)return;const set=groups.get(term)||new Set();set.add(meaning);groups.set(term,set)}
for(const line of source.split(/\r?\n/).slice(1)){
  const [,ko,,gloss]=line.split('\t');if(!ko||!gloss)continue
  // Split alternatives only outside parentheses, retaining qualified expressions.
  let depth=0,part='';const alternatives=[]
  for(const c of gloss){if(c==='(')depth++;if(c===')')depth=Math.max(0,depth-1);if((c===','||c===';')&&!depth){alternatives.push(part);part=''}else part+=c}alternatives.push(part)
  for(const term of alternatives)add(term,ko)
}
// Small, documented editorial supplement for the user's sample expressions.
const supplement=JSON.parse(fs.readFileSync(path.join(root,'dictionary/supplement.json'),'utf8'))
groups.get('public defender')?.delete('공선 변호인')
for(const [word,meanings] of Object.entries(supplement))for(const meaning of meanings)add(word,meaning)
const entries=[...groups].sort(([a],[b])=>a.localeCompare(b,'en')).map(([word,meanings])=>[word,[...meanings]])
const metadata={source:'Kengdic / Joe Speigle and contributors',license:'MPL-2.0',sourceSha256:crypto.createHash('sha256').update(source).digest('hex'),entries:entries.length,meanings:entries.reduce((n,[,m])=>n+m.length,0)}
fs.writeFileSync(path.join(root,'dictionary/data.js'),'// Kengdic-derived data. SPDX-License-Identifier: MPL-2.0\nwindow.MinishDictionaryData='+JSON.stringify({metadata,entries})+';\n')
if(__filename!==path.join(root,'dictionary/build-dictionary.cjs'))fs.copyFileSync(__filename,path.join(root,'dictionary/build-dictionary.cjs'))
console.log(JSON.stringify(metadata))
