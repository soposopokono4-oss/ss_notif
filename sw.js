const CACHE='smartstudy-v18-web-push';
const ASSETS=['./','./index.html','./style.css','./app.js','./supabase-config.js','./manifest.json','./icons/icon.svg','./icons/icon-192.png','./icons/icon-512.png','./icons/install.svg','./assets/developer-1.svg','./assets/developer-2.svg','./assets/fajar.jpeg','./assets/natanael.jpeg'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key))))));
self.addEventListener('fetch',event=>{
  const request=event.request;
  const url=new URL(request.url);
  // Jangan cache endpoint PHP/API atau permintaan lintas origin: respons akun bersifat privat.
  if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname.includes('/api/'))return;
  event.respondWith(caches.match(request).then(cached=>cached||fetch(request).then(response=>{
    if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(request,copy));}
    return response;
  }).catch(()=>caches.match('./index.html'))));
});

self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{for(const client of list){if('focus'in client)return client.focus()}if(clients.openWindow)return clients.openWindow('./')}))});


// Pesan push dapat diterima saat halaman aplikasi tidak sedang dibuka.
self.addEventListener('push',event=>{
  let payload={title:'Pengingat SmartStudy',body:'Ada pengingat belajar untukmu.',url:'./'};
  try{if(event.data)payload={...payload,...event.data.json()};}catch(_){if(event.data)payload.body=event.data.text();}
  const options={
    body:payload.body||'Ada pengingat belajar untukmu.',
    icon:'./icons/icon-192.png',badge:'./icons/icon-192.png',
    tag:payload.tag||'smartstudy-reminder',renotify:false,
    data:{url:payload.url||'./'},
    requireInteraction:false
  };
  event.waitUntil((async()=>{
    await self.registration.showNotification(payload.title||'Pengingat SmartStudy',options);
    const windows=await clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of windows)client.postMessage({type:'SMARTSTUDY_PUSH_RECEIVED'});
  })());
});
