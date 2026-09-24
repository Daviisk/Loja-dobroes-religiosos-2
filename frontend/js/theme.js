(()=> {
  'use strict';
  const root=document.documentElement;
  const key='signum.theme';
  let theme='light';
  try { if(localStorage.getItem(key)==='dark') theme='dark'; } catch {}
  function apply(value){
    theme=value;
    root.dataset.theme=value;
    const button=document.getElementById('theme-toggle');
    if(button){
      button.setAttribute('aria-pressed',String(value==='dark'));
      button.setAttribute('aria-label',value==='dark'?'Ativar modo claro':'Ativar modo escuro');
      button.textContent=value==='dark'?'☀ Modo claro':'☾ Modo escuro';
    }
    const meta=document.querySelector('meta[name="theme-color"]');
    if(meta) meta.content=value==='dark'?'#10100e':'#f4efe4';
  }
  apply(theme);
  document.addEventListener('DOMContentLoaded',()=>{
    apply(theme);
    document.getElementById('theme-toggle')?.addEventListener('click',()=>{
      apply(theme==='dark'?'light':'dark');
      try {localStorage.setItem(key,theme);} catch {}
    });
  },{once:true});
  window.addEventListener('storage',event=>{
    if(event.key===key) apply(event.newValue==='dark'?'dark':'light');
  });
})();
