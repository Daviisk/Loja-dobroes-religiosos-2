(()=>{
 'use strict';
 const motion=window.matchMedia('(prefers-reduced-motion: reduce)');
 if(motion.matches || !('IntersectionObserver' in window) || !Element.prototype.animate) return;
 const active=new Set();
 const observer=new IntersectionObserver(entries=>{
  for(const entry of entries){
   if(!entry.isIntersecting) continue;
   const element=entry.target;
   observer.unobserve(element);
   if(motion.matches || element.contains(document.activeElement)) continue;
   const animation=element.animate([
    {opacity:0,transform:'translateY(16px)'},
    {opacity:1,transform:'translateY(0)'}
   ],{duration:460,easing:'cubic-bezier(.22,1,.36,1)'});
   active.add(animation);
   animation.onfinish=animation.oncancel=()=>active.delete(animation);
  }
 },{threshold:0.08});
 document.querySelectorAll('.hero-copy,.category,.section-head,.story-grid,.journal-grid,.contact,.piece').forEach(element=>observer.observe(element));
 motion.addEventListener('change',event=>{
  if(!event.matches) return;
  observer.disconnect();
  for(const animation of active) animation.cancel();
  active.clear();
 });
 document.addEventListener('focusin',()=>{
  for(const animation of active) animation.cancel();
  active.clear();
 });
})();
