const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const store={get(k){try{return JSON.parse(localStorage.getItem('smartstudy_'+k))||[]}catch{return[]}},set(k,v){localStorage.setItem('smartstudy_'+k,JSON.stringify(v))}};
let schedules=[],tasks=[],currentUser=null,authMode='login',supabaseClient=null;
const config=window.SMARTSTUDY_CONFIG||{};
const supabaseConfigured=!!(config.SUPABASE_URL&&config.SUPABASE_ANON_KEY&&window.supabase?.createClient);
if(supabaseConfigured){
  supabaseClient=window.supabase.createClient(config.SUPABASE_URL,config.SUPABASE_ANON_KEY);
}
function configError(){return 'Supabase belum dikonfigurasi. Isi SUPABASE_URL dan SUPABASE_ANON_KEY di supabase-config.js.'}
async function loadRemote(){
  if(!supabaseClient||!currentUser)return;
  const {data,error}=await supabaseClient.from('study_data').select('schedules,tasks').eq('user_id',currentUser.id).maybeSingle();
  if(error)throw error;
  schedules=Array.isArray(data?.schedules)?data.schedules:[];
  tasks=Array.isArray(data?.tasks)?data.tasks:[];
  store.set('schedules',schedules);store.set('tasks',tasks);renderAll();
}
async function syncRemote(){
  if(!supabaseClient||!currentUser)return;
  const payload={user_id:currentUser.id,schedules:[...schedules],tasks:[...tasks],updated_at:new Date().toISOString()};
  const {error}=await supabaseClient.from('study_data').upsert(payload,{onConflict:'user_id'});
  if(error)toast('Gagal menyimpan ke cloud: '+error.message);
}
function updateAccountUI(){
  $('#accountLabel').textContent=currentUser?(currentUser.user_metadata?.full_name||currentUser.email):'Belum login';
  $('#authOpenBtn').textContent=currentUser?'Akun Saya':'Login / Register';
  $('#authTitle').textContent=currentUser?'Akun SmartStudy':(authMode==='login'?'Selamat datang!':'Buat akun SmartStudy');
  $('#authSubtitle').textContent=currentUser?'Kamu sudah masuk. Progres belajar tersimpan di database online.':'Masuk untuk menyimpan jadwal dan tugas secara online.';
  $('#authNameWrap').hidden=authMode!=='register'||!!currentUser;
  $('#authTabs').hidden=!!currentUser;
  $('#authForm').hidden=!!currentUser;
  $('#logoutBtn').hidden=!currentUser;
  $('#authNote').hidden=!!currentUser;
  $('#authError').hidden=true;
  $('#authSubmit').textContent=authMode==='login'?'Masuk':'Buat akun';
  $$('.auth-tab').forEach(b=>b.classList.toggle('active',b.dataset.authMode===authMode));
  // Assistant lokal tidak memerlukan login atau layanan API.
}
function openAuth(mode='login'){
  if(!currentUser)authMode=mode;
  updateAccountUI();$('#authModal').hidden=false;
  if(!currentUser)$('#authEmail').focus();
}
function closeAuth(){ $('#authModal').hidden=true; }
$('#togglePassword').addEventListener('click',()=>{
  const input=$('#authPassword');
  const showing=input.type==='password';
  input.type=showing?'text':'password';
  $('#togglePassword').textContent=showing?'Sembunyikan':'Lihat';
  $('#togglePassword').setAttribute('aria-label',showing?'Sembunyikan password':'Tampilkan password');
  $('#togglePassword').setAttribute('aria-pressed',String(showing));
});
$('#authOpenBtn').addEventListener('click',()=>openAuth('login'));
$('#authClose').addEventListener('click',closeAuth);
$('#authModal').addEventListener('click',e=>{if(e.target.id==='authModal')closeAuth()});
$$('.auth-tab').forEach(b=>b.addEventListener('click',()=>{authMode=b.dataset.authMode;updateAccountUI();}));
$('#authForm').addEventListener('submit',async e=>{
  e.preventDefault();const submit=$('#authSubmit');submit.disabled=true;submit.textContent='Memproses...';$('#authError').hidden=true;
  if(!supabaseClient){$('#authError').textContent=configError();$('#authError').hidden=false;submit.disabled=false;submit.textContent=authMode==='login'?'Masuk':'Buat akun';return;}
  const email=$('#authEmail').value.trim(),password=$('#authPassword').value;
  try{
    let result;
    if(authMode==='register'){
      const name=$('#authName').value.trim();
      if(name.length<2)throw new Error('Nama minimal 2 karakter.');
      result=await supabaseClient.auth.signUp({email,password,options:{data:{full_name:name}}});
      if(result.error)throw result.error;
      if(!result.data.session){$('#authError').textContent='Pendaftaran berhasil. Buka email untuk konfirmasi akun, lalu login di sini.';$('#authError').hidden=false;return;}
    }else{
      result=await supabaseClient.auth.signInWithPassword({email,password});
      if(result.error)throw result.error;
    }
    currentUser=result.data.user;await loadRemote();updateAccountUI();closeAuth();toast(authMode==='register'?'Akun berhasil dibuat!':'Berhasil masuk!');
  }catch(err){$('#authError').textContent=err.message||'Tidak dapat memproses akun.';$('#authError').hidden=false;}
  finally{submit.disabled=false;submit.textContent=authMode==='login'?'Masuk':'Buat akun';}
});
$('#logoutBtn').addEventListener('click',async()=>{
  try{
    const {error}=await supabaseClient.auth.signOut();if(error)throw error;
    currentUser=null;schedules=[];tasks=[];store.set('schedules',[]);store.set('tasks',[]);renderAll();updateAccountUI();closeAuth();toast('Kamu sudah keluar.');
  }catch(e){$('#authError').textContent=e.message;$('#authError').hidden=false;}
});
async function initializeAccount(){
  if(!supabaseClient){updateAccountUI();return;}
  try{
    const {data,error}=await supabaseClient.auth.getSession();if(error)throw error;
    currentUser=data.session?.user||null;
    if(currentUser)await loadRemote();else{ schedules=[];tasks=[];store.set('schedules',[]);store.set('tasks',[]);renderAll(); }
  }catch(e){toast('Gagal memuat akun: '+e.message);}
  updateAccountUI();
  supabaseClient.auth.onAuthStateChange((_event,session)=>{
    const nextUser=session?.user||null;
    if(nextUser?.id!==currentUser?.id){currentUser=nextUser;if(currentUser)loadRemote().catch(err=>toast('Gagal memuat data: '+err.message));else{schedules=[];tasks=[];store.set('schedules',[]);store.set('tasks',[]);renderAll();}updateAccountUI();}
  });
}

const days=['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
// Tema terang/gelap tersimpan di perangkat pengguna.
const themeRoot=document.documentElement;
function applyTheme(theme){const dark=theme==='dark';themeRoot.dataset.theme=dark?'dark':'light';const icon=$('#themeIcon'),toggle=$('#themeToggle');if(icon)icon.textContent=dark?'☀️':'🌙';if(toggle){toggle.setAttribute('aria-label',dark?'Aktifkan tema terang':'Aktifkan tema gelap');toggle.title=dark?'Ganti ke tema terang':'Ganti ke tema gelap';}const meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.content=dark?'#171725':'#635bff';}
applyTheme(localStorage.getItem('smartstudy_theme')||'light');
$('#themeToggle').addEventListener('click',()=>{const next=themeRoot.dataset.theme==='dark'?'light':'dark';localStorage.setItem('smartstudy_theme',next);applyTheme(next);toast(next==='dark'?'Tema gelap diaktifkan.':'Tema terang diaktifkan.');});

function esc(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function toast(msg){let t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>t.classList.remove('show'),2300)}
function go(view){$$('.view').forEach(v=>v.classList.toggle('active',v.id===view));$$('.nav-link').forEach(b=>b.classList.toggle('active',b.dataset.view===view));$('#pageTitle').textContent=({dashboard:'Dashboard',schedule:'Jadwal Belajar',tasks:'Manajemen Tugas',recommendations:'Rekomendasi Belajar',assistant:'Assistant',install:'Install Aplikasi',developers:'Tim Pengembang'})[view];$('.sidebar').classList.remove('open');window.scrollTo({top:0,behavior:'smooth'});}
$$('.nav-link').forEach(b=>b.addEventListener('click',()=>go(b.dataset.view)));
$$('[data-go]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.go)));
$('#menuToggle').addEventListener('click',()=>$('.sidebar').classList.toggle('open'));
$('#todayLabel').textContent=new Intl.DateTimeFormat('id-ID',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date()).toUpperCase();
function renderSchedules(){
 $('#scheduleCount').textContent=schedules.length+' jadwal';
 $('#scheduleList').innerHTML=schedules.length?schedules.map(x=>`<div class="list-item"><div class="item-main"><b>${esc(x.subject)}</b><p>📅 ${esc(x.day)} · ⏰ ${esc(x.time)} · ${esc(x.duration)}${x.note?' · '+esc(x.note):''}</p></div><div class="item-actions"><button class="small-btn delete" data-del-s="${x.id}">Hapus</button></div></div>`).join(''):'<div class="empty-state">Belum ada jadwal belajar. Tambahkan jadwal pertamamu!</div>';
 $('#dashboardSchedules').innerHTML=schedules.length?schedules.slice(0,3).map(x=>`<div class="list-item"><div class="item-main"><b>${esc(x.subject)}</b><p>${esc(x.day)} · ${esc(x.time)} · ${esc(x.duration)}</p></div></div>`).join(''):'<div class="empty-state">Belum ada jadwal. Yuk, buat rencana belajarmu!</div>';
 $$('[data-del-s]').forEach(b=>b.onclick=()=>{schedules=schedules.filter(x=>x.id!==b.dataset.delS);store.set('schedules',schedules);syncRemote();renderAll();toast('Jadwal dihapus.')});
}
function renderTasks(){
 let filter=$('#taskFilter').value, shown=tasks.filter(t=>filter==='all'||(filter==='done'?t.done:!t.done));
 $('#taskList').innerHTML=shown.length?shown.map(t=>`<div class="list-item"><div class="item-main"><b>${esc(t.title)}</b><p>${esc(t.subject)} · Tenggat: ${esc(t.due)} · <span class="priority ${t.priority==='Tinggi'?'high':t.priority==='Rendah'?'low':''}">${esc(t.priority)}</span>${t.description?' · '+esc(t.description):''}</p></div><div class="item-actions"><button class="small-btn ${t.done?'':'done'}" data-toggle="${t.id}">${t.done?'↶ Batal':'✓ Selesai'}</button><button class="small-btn delete" data-del-t="${t.id}">Hapus</button></div></div>`).join(''):'<div class="empty-state">Tidak ada tugas pada kategori ini.</div>';
 $('#dashboardTasks').innerHTML=tasks.filter(t=>!t.done).sort((a,b)=>a.due.localeCompare(b.due)).slice(0,3).map(t=>`<div class="list-item"><div class="item-main"><b>${esc(t.title)}</b><p>${esc(t.subject)} · Tenggat ${esc(t.due)}</p></div><span class="priority ${t.priority==='Tinggi'?'high':''}">${esc(t.priority)}</span></div>`).join('')||'<div class="empty-state">Belum ada tugas aktif. Semua aman!</div>';
 $$('[data-toggle]').forEach(b=>b.onclick=()=>{tasks=tasks.map(t=>t.id===b.dataset.toggle?{...t,done:!t.done}:t);store.set('tasks',tasks);syncRemote();renderAll();toast('Status tugas diperbarui.')});
 $$('[data-del-t]').forEach(b=>b.onclick=()=>{tasks=tasks.filter(t=>t.id!==b.dataset.delT);store.set('tasks',tasks);syncRemote();renderAll();toast('Tugas dihapus.')});
 let done=tasks.filter(t=>t.done).length,pct=tasks.length?Math.round(done/tasks.length*100):0;
 $('#statSchedules').textContent=schedules.length;$('#statTasks').textContent=tasks.filter(t=>!t.done).length;$('#statDone').textContent=done;$('#statProgress').textContent=pct+'%';$('#ringValue').textContent=pct+'%';$('#progressRing').style.background=`conic-gradient(var(--purple) ${pct*3.6}deg,#eeedff 0deg)`;$('#progressCaption').textContent=tasks.length?`${done} dari ${tasks.length} tugas telah selesai.`:'Mulai kerjakan tugas pertamamu.';
}
function renderAll(){renderSchedules();renderTasks()}
$('#scheduleForm').addEventListener('submit',e=>{e.preventDefault();if(!currentUser){openAuth('login');toast('Login terlebih dahulu untuk menyimpan jadwal.');return;}let f=new FormData(e.target);schedules.push({id:crypto.randomUUID(),subject:f.get('subject'),day:f.get('day'),time:f.get('time'),duration:f.get('duration'),note:f.get('note'),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'Asia/Jakarta'});store.set('schedules',schedules);syncRemote();e.target.reset();renderAll();toast('Jadwal berhasil ditambahkan!')});
$('#taskForm').addEventListener('submit',e=>{e.preventDefault();if(!currentUser){openAuth('login');toast('Login terlebih dahulu untuk menyimpan tugas.');return;}let f=new FormData(e.target);tasks.push({id:crypto.randomUUID(),title:f.get('title'),subject:f.get('subject'),due:f.get('due'),priority:f.get('priority'),description:f.get('description'),done:false,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'Asia/Jakarta'});store.set('tasks',tasks);syncRemote();e.target.reset();renderAll();toast('Tugas berhasil dicatat!')});
$('#taskFilter').addEventListener('change',renderTasks);

// Push Notification: pengingat dijadwalkan oleh backend Supabase, bukan oleh timer halaman.
let reminderAudio=null;
function playReminderTone(){
  try{
    const Ctx=window.AudioContext||window.webkitAudioContext;if(!Ctx)return;
    reminderAudio=reminderAudio||new Ctx();if(reminderAudio.state==='suspended')reminderAudio.resume();
    const now=reminderAudio.currentTime;
    [[880,0],[1174.66,.19],[880,.42]].forEach(([freq,offset])=>{
      const osc=reminderAudio.createOscillator(),gain=reminderAudio.createGain();
      osc.type='sine';osc.frequency.value=freq;gain.gain.setValueAtTime(.0001,now+offset);
      gain.gain.exponentialRampToValueAtTime(.13,now+offset+.025);gain.gain.exponentialRampToValueAtTime(.0001,now+offset+.16);
      osc.connect(gain);gain.connect(reminderAudio.destination);osc.start(now+offset);osc.stop(now+offset+.18);
    });
  }catch(e){console.warn('Suara pengingat tidak dapat diputar:',e)}
}
function base64UrlToUint8Array(value){
  const padding='='.repeat((4-value.length%4)%4);
  const base64=(value+padding).replace(/-/g,'+').replace(/_/g,'/');
  const raw=atob(base64);return Uint8Array.from([...raw].map(ch=>ch.charCodeAt(0)));
}
function getDeviceLabel(){
  const ua=navigator.userAgent;
  if(/Android/i.test(ua))return 'Android';
  if(/Windows/i.test(ua))return 'Laptop/PC Windows';
  if(/Macintosh|Mac OS/i.test(ua))return 'Mac';
  if(/Linux/i.test(ua))return 'Linux';
  return 'Perangkat Web';
}
async function enablePushOnThisDevice(){
  const status=$('#notificationStatus'),button=$('#enableNotificationsBtn');
  if(!currentUser){openAuth('login');status.textContent='Silakan login terlebih dahulu untuk menghubungkan perangkat.';return;}
  if(!window.isSecureContext||!('serviceWorker'in navigator)||!('PushManager'in window)||!('Notification'in window)){
    status.textContent='Push Notification memerlukan HTTPS dan browser yang mendukung Service Worker.';return;
  }
  const publicKey=config.VAPID_PUBLIC_KEY;
  if(!publicKey||publicKey.includes('ISI_VAPID')){status.textContent='VAPID_PUBLIC_KEY belum diisi di supabase-config.js.';return;}
  button.disabled=true;button.textContent='Mengaktifkan...';
  try{
    const permission=await Notification.requestPermission();
    if(permission!=='granted')throw new Error('Izin notifikasi belum diberikan. Izinkan notifikasi melalui pengaturan situs browser.');
    const registration=await navigator.serviceWorker.ready;
    let subscription=await registration.pushManager.getSubscription();
    if(!subscription){subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:base64UrlToUint8Array(publicKey)});}
    const payload={user_id:currentUser.id,endpoint:subscription.endpoint,subscription:subscription.toJSON(),device_label:getDeviceLabel(),updated_at:new Date().toISOString()};
    const {error}=await supabaseClient.from('push_subscriptions').upsert(payload,{onConflict:'endpoint'});
    if(error)throw error;
    status.textContent=`Push Notification aktif di perangkat ini (${getDeviceLabel()}). Ulangi langkah ini di perangkat lain.`;
    button.textContent='✓ Push Aktif di Perangkat Ini';
    playReminderTone();
    toast('Perangkat berhasil didaftarkan untuk Push Notification.');
  }catch(error){
    console.error('Push subscription gagal:',error);
    status.textContent=error.message||'Push Notification gagal diaktifkan.';
    button.textContent='🔔 Coba Aktifkan Lagi';
  }finally{button.disabled=false;}
}
$('#enableNotificationsBtn').addEventListener('click',enablePushOnThisDevice);
function updateNotificationStatus(){
  const status=$('#notificationStatus');
  if(!('Notification'in window)){status.textContent='Browser ini tidak mendukung notifikasi.';return;}
  if(Notification.permission==='denied')status.textContent='Izin notifikasi diblokir. Aktifkan melalui pengaturan situs browser.';
  else if(Notification.permission==='granted')status.textContent='Izin notifikasi tersedia. Tekan tombol untuk mendaftarkan perangkat ini ke Push Notification.';
  else status.textContent='Login, lalu aktifkan notifikasi pada setiap perangkat.';
}
updateNotificationStatus();
if('serviceWorker'in navigator){navigator.serviceWorker.addEventListener('message',event=>{if(event.data?.type==='SMARTSTUDY_PUSH_RECEIVED')playReminderTone();});}
const tips={
 'Matematika':{mudah:['Pahami arti simbol pada rumus sebelum mulai menghitung.','Kerjakan 3 soal dasar, lalu cek langkah yang digunakan.','Buat kartu rumus berisi nama, fungsi, dan satu contoh.','Gambarkan soal cerita menjadi sketsa sederhana.','Coba jelaskan cara mendapatkan jawaban dengan suara sendiri.'],sedang:['Kelompokkan soal berdasarkan tipe dan strategi penyelesaiannya.','Selesaikan soal tanpa melihat contoh, lalu bandingkan prosesnya.','Catat kesalahan hitung yang sering muncul dan penyebabnya.','Latih soal kontekstual yang menggabungkan dua konsep.','Buat satu soal serupa dengan angka yang berbeda.'],sulit:['Pecah persoalan kompleks menjadi informasi diketahui, ditanya, dan langkah solusi.','Bandingkan dua metode penyelesaian dan tentukan yang paling efisien.','Cari asumsi yang digunakan dalam soal dan uji apakah masuk akal.','Buat variasi soal yang sedikit lebih menantang dari contoh.','Tulis pembuktian atau alasan untuk setiap langkah penting.']},
 'Bahasa Indonesia':{mudah:['Baca satu paragraf dan tandai gagasan utamanya.','Catat lima kosakata baru beserta maknanya.','Latih membedakan kalimat utama dan kalimat penjelas.','Baca teks dengan lantang untuk memahami alurnya.','Buat ringkasan tiga kalimat menggunakan bahasamu sendiri.'],sedang:['Identifikasi struktur teks dan fungsi tiap bagiannya.','Temukan fakta dan opini, lalu jelaskan perbedaannya.','Periksa penggunaan kata hubung dan kalimat efektif.','Bandingkan dua teks dengan tema yang sama.','Susun peta konsep dari ide utama dan argumen pendukung.'],sulit:['Evaluasi kekuatan argumen dengan memeriksa bukti yang digunakan.','Analisis sudut pandang penulis dan kemungkinan biasnya.','Tulis tanggapan kritis yang disertai alasan dan bukti teks.','Bandingkan gaya bahasa dan dampaknya terhadap pembaca.','Revisi tulisan dengan fokus pada koherensi dan ketepatan diksi.']},
 'Bahasa Inggris':{mudah:['Pelajari lima kosakata dalam kalimat, bukan sebagai daftar terpisah.','Baca dialog pendek dan tandai ungkapan penting.','Dengarkan audio singkat lalu tulis kata yang kamu kenali.','Buat tiga kalimat sederhana memakai kosakata baru.','Latih pengucapan dengan membaca kalimat secara perlahan.'],sedang:['Ubah kalimat positif menjadi negatif dan pertanyaan.','Baca satu paragraf lalu temukan main idea dan supporting details.','Buat dialog singkat menggunakan grammar yang sedang dipelajari.','Catat kesalahan grammar dan tulis versi perbaikannya.','Ceritakan kembali isi bacaan dalam 4–5 kalimat.'],sulit:['Tulis opini dengan alasan dan contoh yang relevan.','Bandingkan penggunaan dua tenses dalam konteks berbeda.','Baca artikel dan simpulkan maksud yang tidak dinyatakan langsung.','Latih parafrasa tanpa mengubah makna inti.','Periksa kohesi antarkalimat dan variasi kosakata tulisan.']},
 'Informatika':{mudah:['Kenali fungsi komponen atau istilah melalui kartu tanya-jawab.','Buat peta konsep yang menghubungkan istilah penting.','Praktikkan satu contoh kecil setelah membaca konsep.','Tuliskan urutan langkah kerja dengan bahasamu sendiri.','Cari contoh penggunaan konsep informatika di sekitar.'],sedang:['Buat proyek mini dan dokumentasikan setiap tahapnya.','Gambar diagram alur sebelum menulis kode atau konfigurasi.','Uji program dengan beberapa input yang berbeda.','Baca pesan error dan cari bagian kode yang berkaitan.','Jelaskan hubungan antara konsep, alat, dan hasil praktik.'],sulit:['Rancang solusi, uji beberapa skenario, lalu bandingkan hasilnya.','Evaluasi keamanan, efisiensi, dan kemudahan pemeliharaan solusi.','Lakukan debugging secara bertahap dengan mencatat hipotesis.','Buat dokumentasi teknis agar orang lain dapat mengulang prosesnya.','Kembangkan proyek mini dengan kebutuhan dan batasan yang jelas.']}
};
const extraTips={
 'Fisika':['Gambar diagram gaya atau situasi sebelum memasukkan angka.','Tuliskan satuan pada setiap besaran dan periksa konsistensinya.','Hubungkan rumus dengan contoh kejadian sehari-hari.','Ubah satu variabel pada soal dan amati pengaruhnya.','Jelaskan makna hasil hitungan, bukan hanya angkanya.'],
 'Kimia':['Buat tabel kecil untuk membandingkan sifat zat atau reaksi.','Seimbangkan persamaan reaksi langkah demi langkah.','Gunakan model partikel untuk membayangkan proses yang sulit dilihat.','Kelompokkan konsep berdasarkan pola dan pengecualiannya.','Latih membaca simbol, rumus, dan satuan dengan teliti.'],
 'Biologi':['Buat diagram proses dengan panah dan keterangan singkat.','Bandingkan fungsi organ atau organel dalam tabel.','Hubungkan konsep biologi dengan contoh di lingkungan sekitar.','Gunakan kartu istilah untuk nama dan fungsi struktur.','Ceritakan proses biologis secara berurutan tanpa melihat catatan.'],
 'Sejarah':['Susun peristiwa dalam garis waktu dan cari hubungan sebab-akibat.','Bedakan fakta, interpretasi, dan pendapat dalam sumber sejarah.','Bandingkan sudut pandang dari dua sumber yang berbeda.','Catat tokoh, tempat, waktu, dan dampak peristiwa.','Jelaskan mengapa suatu peristiwa penting bagi masa berikutnya.'],
 'Produktif Kejuruan':['Buat checklist prosedur sebelum praktik.','Latih membaca diagram atau dokumentasi teknis.','Catat gejala, dugaan penyebab, dan hasil saat troubleshooting.','Ulangi praktik dengan skenario berbeda dan bandingkan hasilnya.','Utamakan prosedur keselamatan dan kerapian dokumentasi.']
};
$('#recommendForm').addEventListener('submit',e=>{
 e.preventDefault();
 const s=$('#recSubject').value,l=$('#recLevel').value;
 const pool=[...(tips[s]?.[l]||({mudah:['Mulai dari konsep dasar dan buat catatan singkat.','Kerjakan contoh sederhana lalu jelaskan kembali.'],sedang:['Bagi materi menjadi subtopik dan latih tiap bagian.','Catat kesalahan lalu coba soal dengan variasi baru.'],sulit:['Mulai dari prasyarat, lalu hubungkan beberapa konsep.','Uji pemahaman dengan kasus baru dan evaluasi alasan.']}[l]||[])),...(extraTips[s]||[])];
 const chosen=shuffle(pool).slice(0,3);
 const methods=shuffle(['Gunakan metode belajar aktif: tutup catatan, lalu coba ingat kembali inti materi.','Buat mind map sederhana untuk melihat hubungan antarkonsep.','Belajar dalam sesi fokus 20–25 menit, lalu istirahat sejenak.','Ajarkan kembali materi seolah-olah kamu sedang menjelaskan kepada teman.','Akhiri sesi dengan menulis satu hal yang sudah dipahami dan satu hal yang perlu ditanyakan.','Campurkan latihan dari materi lama dan baru agar ingatan lebih kuat.']);
 const challenges=shuffle(['Tantangan 10 menit: tulis lima poin penting tanpa melihat buku.','Tantangan praktik: buat satu contoh atau demonstrasi sederhana.','Tantangan evaluasi: buat dua pertanyaan untuk menguji pemahamanmu.','Tantangan koneksi: temukan satu contoh konsep ini dalam kehidupan sehari-hari.']);
 $('#recommendResult').innerHTML=`<article class="recommend-card"><span class="recommend-icon">🎯</span><span class="eyebrow">RENCANA BELAJAR</span><h3>${esc(s)} · Tingkat ${esc(l)}</h3><p>Berikut beberapa strategi yang dipilih untuk sesi belajarmu:</p><ul>${chosen.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></article><article class="recommend-card"><span class="recommend-icon">🧩</span><h3>Metode belajar pilihan</h3><p>${esc(methods[0])}</p><h3>Tips tambahan</h3><p>${esc(methods[1])}</p><p><b>${esc(challenges[0])}</b></p><p class="muted">Tekan tombol rekomendasi lagi untuk mendapatkan kombinasi tips yang berbeda.</p></article>`;
});
let chatHistory=[];
// Basis pengetahuan lokal: jawaban disimpan di aplikasi, tanpa API key atau koneksi AI eksternal.
const localLessons=[
 {keys:['fotosintesis','klorofil','kloroplas'],title:'Fotosintesis',body:'Fotosintesis adalah proses tumbuhan hijau membuat makanan dengan bantuan energi cahaya. Proses ini terutama berlangsung di kloroplas yang mengandung klorofil. Bahan yang diperlukan adalah air (H₂O) dan karbon dioksida (CO₂); hasil utamanya glukosa dan oksigen (O₂). Persamaan sederhananya: 6CO₂ + 6H₂O + energi cahaya → C₆H₁₂O₆ + 6O₂. Tahap umumnya meliputi reaksi terang dan siklus Calvin.'},
 {keys:['persamaan linear','persamaan garis','linear satu variabel','plsv'],title:'Persamaan linear',body:'Persamaan linear adalah persamaan dengan variabel berpangkat tertinggi satu. Contoh: 2x + 3 = 11. Kurangi kedua ruas dengan 3 sehingga 2x = 8, lalu bagi kedua ruas dengan 2. Hasilnya x = 4. Prinsip penting: operasi yang dilakukan pada satu ruas harus dilakukan juga pada ruas lainnya agar kesetaraan tetap terjaga.'},
 {keys:['html','css','javascript','js','website','web development'],title:'HTML, CSS, dan JavaScript',body:'HTML menyusun struktur dan konten halaman web, misalnya judul, paragraf, gambar, dan formulir. CSS mengatur tampilan seperti warna, ukuran, jarak, dan tata letak. JavaScript menambahkan perilaku interaktif, misalnya tombol, validasi formulir, dan perubahan konten. Ketiganya bekerja bersama: HTML sebagai struktur, CSS sebagai tampilan, dan JavaScript sebagai interaksi.'},
 {keys:['database','sql','mysql','basis data'],title:'Database dan SQL',body:'Database adalah kumpulan data yang disimpan secara terstruktur agar mudah dikelola. DBMS adalah perangkat lunak untuk mengelola database, contohnya MySQL dan PostgreSQL. SQL adalah bahasa untuk berinteraksi dengan database. Contoh: SELECT * FROM siswa; digunakan untuk mengambil semua kolom dari tabel siswa. Perintah umum lain: INSERT untuk menambah data, UPDATE untuk mengubah data, dan DELETE untuk menghapus data.'},
 {keys:['hukum newton','newton','gaya','gerak'],title:'Hukum Newton',body:'Hukum I Newton: benda mempertahankan keadaan diam atau gerak lurus beraturan jika resultan gaya nol (inersia). Hukum II Newton: resultan gaya sama dengan massa dikali percepatan, ΣF = m × a. Hukum III Newton: setiap aksi memiliki reaksi yang sama besar dan berlawanan arah, bekerja pada dua benda yang berbeda.'},
 {keys:['sel','organel','mitokondria'],title:'Sel dan organel',body:'Sel adalah unit struktural dan fungsional terkecil makhluk hidup. Membran sel mengatur keluar-masuk zat, sitoplasma menjadi tempat berbagai reaksi, inti sel menyimpan DNA dan mengatur aktivitas sel, sedangkan mitokondria berperan dalam respirasi sel untuk menghasilkan ATP sebagai sumber energi yang dapat digunakan sel.'},
 {keys:['teks eksposisi','eksposisi','tesis','argumentasi'],title:'Teks eksposisi',body:'Teks eksposisi menyampaikan pendapat atau informasi disertai alasan dan bukti. Struktur yang umum dipelajari adalah tesis (pernyataan pendapat), rangkaian argumentasi (alasan atau bukti pendukung), dan penegasan ulang (penguatan pendapat). Gunakan fakta yang relevan dan bahasa yang jelas.'},
 {keys:['simple present','present tense','bahasa inggris','simple past','tenses'],title:'Tata bahasa Inggris dasar',body:'Simple present digunakan untuk kebiasaan, fakta umum, atau keadaan. Pola positif: Subject + V1 (tambahkan -s/-es untuk he/she/it). Contoh: “She studies every day.” Untuk kalimat negatif gunakan do not/does not + V1. Simple past digunakan untuk kejadian yang selesai di masa lalu, biasanya memakai V2, misalnya “They visited the museum yesterday.”'},
 {keys:['atom','proton','neutron','elektron'],title:'Struktur atom',body:'Atom tersusun atas inti atom dan elektron. Inti atom mengandung proton bermuatan positif dan neutron yang tidak bermuatan. Elektron bermuatan negatif berada pada daerah di sekitar inti. Nomor atom menunjukkan jumlah proton, sedangkan pada atom netral jumlah elektron sama dengan jumlah proton.'}
];
// Assistant lokal: materi bawaan + materi buatan pengguna disimpan di browser.
const assistantViews=['assistantSummary','assistantQuiz','assistantMaterials'];
const customMaterialsKey='customLessons';
function getLessons(){return [...localLessons,...store.get(customMaterialsKey)];}
function showAssistantPanel(name){
  $('#assistantHome').hidden=true;
  assistantViews.forEach(id=>$('#'+id).hidden=id!=='assistant'+name[0].toUpperCase()+name.slice(1));
  if(name==='materials')renderMaterials();
  if(name==='quiz')fillQuizTopics();
}
function showAssistantHome(){
  $('#assistantHome').hidden=false;
  assistantViews.forEach(id=>$('#'+id).hidden=true);
  $('#materialDetail').hidden=true;$('#summaryOutput').hidden=true;$('#quizOutput').hidden=true;
}
$$('[data-assistant]').forEach(btn=>btn.addEventListener('click',()=>showAssistantPanel(btn.dataset.assistant)));
$$('[data-assistant-back]').forEach(btn=>btn.addEventListener('click',showAssistantHome));
function fillQuizTopics(){
  const lessons=getLessons();
  $('#quizTopic').innerHTML=lessons.map((lesson,i)=>`<option value="${i}">${esc(lesson.title)}${lesson.custom?' · Materi saya':''}</option>`).join('');
}
function renderMaterials(){
  const lessons=getLessons();
  $('#materialCount').textContent=`${lessons.length} materi`;
  $('#materialTopics').innerHTML=lessons.map((lesson,i)=>`<button class="material-topic" data-lesson-index="${i}" type="button"><span>${lesson.custom?'🗂️':'📘'}</span><b>${esc(lesson.title)}</b><small>${esc(lesson.subject||'Materi umum')} · Buka materi →</small></button>`).join('');
  $$('[data-lesson-index]').forEach(btn=>btn.addEventListener('click',()=>{
    const lesson=getLessons()[Number(btn.dataset.lessonIndex)];
    $('#materialDetail').hidden=false;
    $('#materialDetail').innerHTML=`<div class="panel-heading"><h3>${esc(lesson.title)}</h3>${lesson.custom?'<span class="count-pill">Materi pribadi</span>':''}</div><p class="muted">${esc(lesson.subject||'Materi umum')}</p><p>${esc(lesson.body)}</p><p class="muted">${lesson.custom?'Materi ini ditambahkan secara manual dan tersimpan di browser ini.':'Materi pengantar dari basis pengetahuan lokal SmartStudy.'}</p>`;
    $('#materialDetail').scrollIntoView({behavior:'smooth',block:'nearest'});
  }));
  renderCustomMaterialList();
  fillQuizTopics();
}
function renderCustomMaterialList(){
  const items=store.get(customMaterialsKey);
  const el=$('#customMaterialList');
  if(!items.length){el.innerHTML='<p class="muted">Belum ada materi tambahan.</p>';return;}
  el.innerHTML='<h4>Materi yang kamu tambahkan</h4>'+items.map(item=>`<div class="custom-material-item"><div><b>${esc(item.title)}</b><small>${esc(item.subject||'Materi umum')}</small></div><button class="small-btn delete" type="button" data-delete-material="${esc(item.id)}">Hapus</button></div>`).join('');
  $$('[data-delete-material]').forEach(btn=>btn.addEventListener('click',()=>{
    if(!confirm('Hapus materi ini dari browser?'))return;
    store.set(customMaterialsKey,store.get(customMaterialsKey).filter(x=>x.id!==btn.dataset.deleteMaterial));
    renderMaterials();toast('Materi berhasil dihapus.');
  }));
}
$('#customMaterialForm').addEventListener('submit',e=>{
  e.preventDefault();
  const title=$('#customMaterialTitle').value.trim(),subject=$('#customMaterialSubject').value.trim(),body=$('#customMaterialBody').value.trim();
  if(title.length<3||body.length<40){toast('Isi judul dan materi minimal 40 karakter.');return;}
  const items=store.get(customMaterialsKey);
  items.push({id:'m_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,7),title,subject,body,custom:true,keys:[...title.toLowerCase().split(/\W+/).filter(x=>x.length>3)]});
  store.set(customMaterialsKey,items);e.target.reset();renderMaterials();toast('Materi berhasil disimpan di perangkat ini.');
});
$('#makeSummaryBtn').addEventListener('click',()=>{
  const value=$('#summaryInput').value.trim();
  $('#summaryOutput').hidden=false;
  $('#summaryOutput').textContent=localSummary(value);
});
function shuffle(items){return [...items].sort(()=>Math.random()-.5);}
function makeQuestions(lesson,count,type,difficulty){
  const sentences=(lesson.body.match(/[^.!?]+[.!?]+|[^.!?]+$/g)||[]).map(x=>x.trim()).filter(x=>x.length>18);
  const words=[...new Set((lesson.title+' '+lesson.body).match(/[A-Za-zÀ-ÿ0-9₂₃Σ]+/g)||[])].filter(w=>w.length>4);
  const modes=type==='campuran'?shuffle(['pilihan','benar-salah','isian','uraian']):[type];
  const questions=[];
  for(let i=0;i<count;i++){
    const mode=modes[i%modes.length],sentence=sentences[i%Math.max(1,sentences.length)]||lesson.body;
    if(mode==='pilihan'){
      const correct=sentence.replace(/[.!?]+$/,'');
      const distractors=shuffle(sentences.filter(x=>x!==sentence)).slice(0,3).map(x=>x.replace(/[.!?]+$/,''));
      while(distractors.length<3)distractors.push(`Pernyataan yang tidak sesuai dengan konsep ${lesson.title.toLowerCase()}`+(distractors.length+1));
      const opts=shuffle([correct,...distractors]);
      questions.push({kind:'Pilihan ganda',q:`Pernyataan manakah yang sesuai dengan materi ${lesson.title}?`,opts,answer:opts.indexOf(correct),explain:'Cocokkan pilihan dengan kalimat materi yang menjadi sumber soal.'});
    }else if(mode==='benar-salah'){
      questions.push({kind:'Benar / salah',q:`Benar atau salah: ${sentence}`,answer:'Benar',explain:'Pernyataan ini diambil langsung dari isi materi.'});
    }else if(mode==='isian'){
      const target=words.length?words[(i*3)%words.length]:lesson.title;
      const masked=sentence.replace(new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i'),'________');
      questions.push({kind:'Isian singkat',q:`Lengkapi bagian kosong: ${masked===sentence?`Tuliskan satu istilah penting yang berkaitan dengan ${lesson.title}.`:masked}`,answer:target,explain:'Gunakan istilah yang terdapat pada materi.'});
    }else{
      const prompt=difficulty==='mudah'?'Jelaskan kembali dengan bahasamu sendiri':difficulty==='sulit'?'Analisis hubungan gagasan ini dengan konsep lain dan berikan alasan':'Jelaskan gagasan utama berikut dan berikan satu contoh';
      questions.push({kind:'Uraian',q:`${prompt}: ${sentence}`,answer:'Jawaban dinilai berdasarkan ketepatan konsep, kelengkapan penjelasan, dan kesesuaian dengan materi.',explain:'Bandingkan jawabanmu dengan materi yang dipilih.'});
    }
  }
  return questions;
}
$('#makeQuizBtn').addEventListener('click',()=>{
  const lesson=getLessons()[Number($('#quizTopic').value)];if(!lesson)return;
  const count=Number($('#quizCount').value),type=$('#quizType').value,difficulty=$('#quizDifficulty').value;
  const questions=makeQuestions(lesson,count,type,difficulty);
  $('#quizOutput').hidden=false;
  const fields=questions.map((q,i)=>{
    let answerField='';
    if(q.kind==='Pilihan ganda') answerField=`<label class="quiz-answer-label">Jawabanmu<select class="quiz-answer-input" data-answer="${i}"><option value="">Pilih jawaban</option>${q.opts.map((o,j)=>`<option value="${j}">${String.fromCharCode(65+j)}. ${esc(o)}</option>`).join('')}</select></label>`;
    else if(q.kind==='Benar / salah') answerField=`<label class="quiz-answer-label">Jawabanmu<select class="quiz-answer-input" data-answer="${i}"><option value="">Pilih jawaban</option><option value="Benar">Benar</option><option value="Salah">Salah</option></select></label>`;
    else if(q.kind==='Isian singkat') answerField=`<label class="quiz-answer-label">Jawabanmu<input class="quiz-answer-input" data-answer="${i}" placeholder="Tulis jawabanmu..."></label>`;
    else answerField=`<label class="quiz-answer-label">Jawabanmu<textarea class="quiz-answer-input" data-answer="${i}" rows="3" placeholder="Tuliskan penjelasanmu..."></textarea></label>`;
    return `<div class="quiz-question"><b>${i+1}. [${esc(q.kind)}]</b><p>${esc(q.q)}</p>${q.opts?`<ol type="A">${q.opts.map(opt=>`<li>${esc(opt)}</li>`).join('')}</ol>`:''}${answerField}<div class="quiz-key" hidden><b>Kunci / panduan jawaban:</b><p>${q.opts?`Jawaban: ${String.fromCharCode(65+q.answer)}. ${esc(q.opts[q.answer])}`:esc(q.answer)}</p><small>${esc(q.explain)}</small></div></div>`;
  }).join('');
  $('#quizOutput').innerHTML=`<div class="quiz-heading"><h3>Latihan: ${esc(lesson.title)}</h3><p class="muted">${count} soal · ${esc($('#quizType').selectedOptions[0].textContent)} · Kesulitan ${esc(difficulty)}</p><p>Jawab semua pertanyaan terlebih dahulu. Kunci jawaban baru akan ditampilkan setelah kamu menekan tombol selesai.</p></div>${fields}<button class="primary-btn" id="finishQuizBtn" type="button">Selesai & lihat kunci jawaban</button><p class="muted" id="quizFinishNote">Kunci jawaban masih disembunyikan.</p><p class="muted">Soal dibuat otomatis dari materi yang dipilih. Untuk soal uraian, gunakan panduan jawaban untuk mengevaluasi jawabanmu sendiri.</p>`;
  $('#finishQuizBtn').addEventListener('click',()=>{
    $$('#quizOutput .quiz-key').forEach(el=>el.hidden=false);
    const unanswered=$$('#quizOutput [data-answer]').filter(el=>!el.value.trim()).length;
    $('#quizFinishNote').textContent=unanswered?`Latihan selesai. Ada ${unanswered} jawaban yang belum diisi. Kunci jawaban ditampilkan di bawah setiap soal.`:'Latihan selesai! Kunci jawaban dan panduan sudah ditampilkan di bawah setiap soal.';
    $('#finishQuizBtn').disabled=true;$('#finishQuizBtn').textContent='Latihan selesai';
  });
});

function findLesson(q){const text=q.toLowerCase();return getLessons().find(item=>item.keys.some(k=>text.includes(k))||text.includes(item.title.toLowerCase()));}
function localSummary(text){const clean=text.replace(/\s+/g,' ').trim();if(clean.length<80)return 'Tempelkan teks materi yang lebih panjang (minimal sekitar 80 karakter), lalu minta “buat ringkasan”.';const sentences=clean.match(/[^.!?]+[.!?]+|[^.!?]+$/g)||[clean];const chosen=sentences.slice(0,Math.min(4,sentences.length)).map(x=>x.trim()).filter(Boolean);return 'Ringkasan awal berdasarkan kalimat dalam teks yang kamu kirim:\n• '+chosen.join('\n• ')+'\n\nCatatan: ini ringkasan sederhana, jadi periksa kembali apakah semua gagasan penting sudah tercakup.';}
function localAnswer(q){
 const text=q.trim(),low=text.toLowerCase();
 if(/^(halo|hai|hello|hi|assalamualaikum|selamat pagi|selamat siang|selamat sore|selamat malam)\b/.test(low))return 'Halo! Aku StudyBot Mode Lokal. Aku bisa membantu materi yang tersedia, membuat latihan sederhana, dan merangkum teks yang kamu tempelkan. Coba tanyakan topik pelajaran atau kirim materi yang ingin dipelajari.';
 if(/(ringkas|rangkuman|rangkumin|buat ringkasan|summarize)/.test(low))return localSummary(text.replace(/^(tolong\s+)?(buat\s+)?(ringkasan|rangkuman|ringkas(kan)?)(\s+materi)?\s*[:\-]?/i,'').trim());
 if(/(kuis|quiz|latihan soal|buat soal|contoh soal)/.test(low)){
   const lesson=findLesson(text);if(lesson)return `Latihan singkat: ${lesson.title}\n\n1. Apa pengertian ${lesson.title.toLowerCase()}?\n2. Sebutkan dua konsep penting dari materi tersebut.\n3. Jelaskan bagaimana konsep itu bekerja atau digunakan.\n\nCoba jawab satu per satu. Karena ini mode lokal, soal dibuat sebagai latihan terbuka, bukan dinilai otomatis.`;
   return 'Aku bisa membuat latihan terbuka dari topik yang tersedia. Coba tulis misalnya: “Buat kuis tentang fotosintesis” atau tempelkan materi agar aku bisa menyusun pertanyaan dari teks tersebut.';
 }
 const lesson=findLesson(text);
 if(lesson){const prefix=/(contoh|misalnya)/.test(low)?'Berikut penjelasannya beserta konsep utama: ':'Berikut penjelasan singkatnya: ';return `${prefix}\n${lesson.title}\n${lesson.body}\n\nCoba jelaskan kembali dengan bahasamu sendiri untuk mengecek pemahaman.`;}
 if(/(terima kasih|makasih|thanks)/.test(low))return 'Sama-sama! Semangat belajar. Kalau ada materi tertentu, tuliskan topiknya atau tempelkan teksnya di sini.';
 if(/(siapa kamu|apa yang bisa kamu lakukan|fitur kamu|studybot)/.test(low))return 'Aku StudyBot Mode Lokal. Aku dapat menjelaskan beberapa materi yang tersedia di basis pengetahuan aplikasi, memberi latihan terbuka sederhana, dan membuat ringkasan awal dari teks yang kamu tempelkan. Aku tidak mengakses internet atau model AI eksternal, jadi pengetahuanku terbatas.';
 return 'Aku belum menemukan topik itu di basis pengetahuan lokal SmartStudy. Mode ini tidak menggunakan model AI online, sehingga belum bisa menjawab semua pertanyaan bebas.\n\nCoba salah satu cara berikut:\n• Tulis topik yang lebih spesifik, misalnya “Jelaskan fotosintesis”.\n• Tempelkan teks materi lalu tulis “buat ringkasan”.\n• Tulis “buat kuis tentang HTML”.\n\nKamu juga bisa menambahkan materi dari guru atau buku pelajaran agar bisa dibantu diringkas.';
}
async function sendChat(q){
  q=q.trim();if(!q)return;
  const box=$('#chatMessages'),input=$('#chatInput'),send=$('.send-btn');
  box.insertAdjacentHTML('beforeend',`<div class="message user">${esc(q)}</div>`);input.value='';input.disabled=true;send.disabled=true;
  const loading=document.createElement('div');loading.className='message bot typing';loading.textContent='StudyBot sedang menyusun jawaban...';box.appendChild(loading);box.scrollTop=box.scrollHeight;
  chatHistory.push({role:'user',content:q});
  // Beri jeda singkat agar indikator proses terlihat; semua jawaban dibuat lokal di browser.
  await new Promise(resolve=>setTimeout(resolve,350));
  const reply=localAnswer(q);chatHistory.push({role:'assistant',content:reply});
  loading.classList.remove('typing');loading.textContent=reply;
  input.disabled=false;send.disabled=false;input.focus();box.scrollTop=box.scrollHeight;
}
renderAll();
initializeAccount();
let deferredPrompt;window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;$('#installBtn').hidden=false;$('#installHint').textContent='Perangkat ini mendukung pemasangan langsung. Tekan tombol Install Aplikasi.';$('#installPageBtn').textContent='⬇ Install Aplikasi Sekarang'});
async function installSmartStudy(){if(!deferredPrompt){const isAndroid=/Android/i.test(navigator.userAgent);toast(isAndroid?'Di Chrome Android: tekan ⋮ lalu pilih “Install aplikasi” atau “Tambahkan ke layar utama”.':'Buka menu browser lalu pilih Install app / Tambahkan ke layar utama.');$('#installHint').textContent=isAndroid?'Chrome Android: buka menu ⋮ → Install aplikasi / Tambahkan ke layar utama. Pastikan website memakai HTTPS.':'Jika tombol belum tersedia, buka menu browser lalu pilih Install app atau Tambahkan ke layar utama. Gunakan HTTPS.';return}deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;$('#installBtn').hidden=true;$('#installHint').textContent='Jika belum terpasang, coba lagi melalui menu browser.'}
$('#installBtn').addEventListener('click',installSmartStudy);
$('#installPageBtn').addEventListener('click',installSmartStudy);
window.addEventListener('appinstalled',()=>{toast('SmartStudy berhasil dipasang!');$('#installBtn').hidden=true;$('#installPageBtn').textContent='Aplikasi sudah terpasang'});
if('serviceWorker'in navigator && location.protocol.startsWith('http'))window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
