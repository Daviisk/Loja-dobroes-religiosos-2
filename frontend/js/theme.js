(()=>{
 'use strict';
 const KEY='signum.theme';
 const root=document.documentElement;
 function ensureCss(){
  if(document.querySelector('link[href$="mobile.css"],link[href$="signum-v2.css"]'))return;
  const link=document.createElement('link');link.rel='stylesheet';link.href='/css/signum-v2.css';document.head.append(link);
 }
 const safeGet=()=>{try{return localStorage.getItem(KEY);}catch{return null;}};
 const safeSet=value=>{try{localStorage.setItem(KEY,value);}catch{}};
 const current=()=>root.dataset.theme==='dark'?'dark':'light';
 function apply(theme,persist=false){
  const next=theme==='dark'?'dark':'light';
  root.dataset.theme=next;
  root.style.colorScheme=next;
  if(persist)safeSet(next);
  const meta=document.querySelector('meta[name="theme-color"]');
  if(meta)meta.content=next==='dark'?'#050505':'#f3eee4';
  const button=document.querySelector('.theme-toggle');
  if(button){
   const isDark=next==='dark';
   button.setAttribute('aria-pressed',String(isDark));
   button.setAttribute('aria-label',isDark?'Ativar modo claro':'Ativar modo escuro');
   const label=button.querySelector('.theme-toggle-label');
   if(label)label.textContent=isDark?'Ativar modo claro':'Ativar modo escuro';
  }
 }
 function brand(){
  const header=document.querySelector('.devotional-brand');
  if(header)header.setAttribute('aria-label','Signum Sanctum — início');
  document.querySelectorAll('.footer-brand').forEach(el=>{el.textContent='Signum Sanctum';});
  document.querySelectorAll('.kicker').forEach(el=>{if(el.textContent.includes('Dobrões de Fé'))el.textContent=el.textContent.replaceAll('Dobrões de Fé','Signum Sanctum');});
  if(document.title.includes('Dobrões de Fé'))document.title=document.title.replaceAll('Dobrões de Fé','Signum Sanctum');
  const description=document.querySelector('meta[name="description"]');
  if(description)description.content='Signum Sanctum — medalhas religiosas para guardar, presentear e acompanhar sua devoção.';
 }
 function toggle(){
  if(document.querySelector('.theme-toggle'))return;
  const button=document.createElement('button');
  button.type='button';
  button.className='theme-toggle';
  button.innerHTML='<svg class="theme-moon" aria-hidden="true" viewBox="0 0 24 24"><path d="M20.5 14.7A8.3 8.3 0 0 1 9.3 3.5 8.5 8.5 0 1 0 20.5 14.7Z"></path></svg><svg class="theme-sun" aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"></path></svg><span class="theme-toggle-label"></span>';
  button.addEventListener('click',()=>apply(current()==='dark'?'light':'dark',true));
  document.body.append(button);
 }
 function init(){ensureCss();brand();toggle();apply(safeGet()==='dark'?'dark':'light',false);}
 ensureCss();
 apply(safeGet()==='dark'?'dark':'light',false);
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
