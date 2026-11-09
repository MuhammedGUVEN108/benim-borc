/* Yalnız uygulama dosyaları önbelleğe alınır; finansal kayıtlar localStorage'dan çıkmaz.
   Sürüm değiştiğinde bu adı artırmak, eski arayüz önbelleğinin temizlenmesini sağlar. */
'use strict';
const PREFIX='benim-borc-shell-',CACHE=PREFIX+'2026-11-09-v2';
const ROOT=new URL('./',self.location.href),INDEX=new URL('index.html',ROOT).href;
const FILES=['./','index.html','manifest.webmanifest','icon-180.png','icon-192.png','icon-512.png'].map(p=>new URL(p,ROOT).href);
self.addEventListener('install',event=>event.waitUntil((async()=>{
 const cache=await caches.open(CACHE);await cache.addAll(FILES);await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 for(const key of await caches.keys())if(key.startsWith(PREFIX)&&key!==CACHE)await caches.delete(key);
 await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==ROOT.origin)return;
 const isHome=url.pathname===ROOT.pathname||url.pathname===new URL(INDEX).pathname;
 if(request.mode==='navigate'&&isHome){
  // İnternet varsa güncel HTML; bağlantı kesildiyse kurulmuş kopya açılır.
  event.respondWith((async()=>{
   const cache=await caches.open(CACHE);
   try{const response=await fetch(request);if(response.ok){await cache.put(INDEX,response.clone());return response}const saved=await cache.match(INDEX);return saved||response}
   catch(error){const saved=await cache.match(INDEX);if(saved)return saved;throw error}
  })());return;
 }
 if(FILES.includes(url.href))event.respondWith((async()=>{
  const cache=await caches.open(CACHE),saved=await cache.match(request);if(saved)return saved;
  const response=await fetch(request);if(response.ok)await cache.put(request,response.clone());return response;
 })());
});
