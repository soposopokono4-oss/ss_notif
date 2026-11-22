# SmartStudy – Assistant Lokal dengan Materi Manual

## Pembaruan
- Menu Assistant berisi Ringkas Materi, Latihan Soal, dan Materi Pelajaran.
- Pengguna dapat menambahkan materi sendiri (judul, mata pelajaran, isi), lalu menghapusnya.
- Materi tambahan tersimpan di localStorage browser/perangkat yang digunakan.
- Latihan soal dapat dibuat sebanyak 5, 10, atau 15 soal dengan bentuk campuran, pilihan ganda, benar/salah, isian singkat, atau uraian.
- Tingkat kesulitan dapat dipilih.
- Tidak memerlukan API key atau Edge Function AI.

## Catatan penyimpanan
Materi manual disimpan lokal di browser menggunakan localStorage. Materi tidak otomatis tersinkron ke perangkat lain dan dapat hilang jika data situs/browser dihapus. Ekspor/cadangkan materi secara terpisah sebelum membersihkan data browser.

## Supabase
File konfigurasi dan skema Supabase tetap disertakan karena fitur login dan sinkronisasi jadwal/tugas masih menggunakannya. Supabase tidak diperlukan untuk fitur Assistant lokal. Jangan menghapus tabel atau konfigurasi Supabase jika fitur akun dan sinkronisasi masih dipakai.

## Instalasi
Unggah seluruh isi folder ini ke repository GitHub Pages, lalu lakukan hard refresh (Ctrl+Shift+R). Jika PWA masih menampilkan versi lama, tutup aplikasi dan buka ulang setelah service worker diperbarui.


## Profil pengembang
Halaman Pengembang menampilkan foto dan biodata Muhammad Fajar Devandra serta Natanael Barzilai, siswa SMKN 1 Blitar jurusan Teknik Komputer dan Jaringan (TKJ), beserta tautan media sosial yang diberikan.

## Push Notification lintas perangkat (Laptop + Android)
Fitur ini menggunakan Web Push, Service Worker, Supabase Edge Function, dan Supabase Cron. Backend memeriksa jadwal/tugas setiap menit sehingga pengingat dapat diterima ketika halaman SmartStudy tidak sedang terbuka, selama perangkat online, izin notifikasi aktif, dan browser/OS mendukung Push.

### Jadwal pengingat
- Jadwal mingguan: 1 jam sebelum waktu mulai, mengikuti zona waktu perangkat ketika jadwal dibuat.
- Tugas belum selesai: sehari sebelum tenggat, mulai pukul 09.00 hingga sebelum 09.05 zona waktu perangkat ketika tugas dibuat.
- Pemeriksaan jadwal memiliki toleransi keterlambatan Cron hingga 5 menit; riwayat pengiriman mencegah pengingat terkirim berulang.
- Satu akun dapat mendaftarkan beberapa perangkat. Tekan tombol aktivasi pada Dashboard dari setiap laptop/HP.
- Perangkat yang sudah tidak valid akan dibersihkan dari daftar langganan.

### Batasan suara
Suara tiga nada khusus dapat diputar saat halaman aplikasi sedang aktif dan browser mengizinkan audio. Ketika aplikasi tertutup, suara mengikuti pengaturan notifikasi browser dan sistem operasi; standar Web Push tidak menyediakan cara lintas-platform untuk memaksa file suara khusus. Pastikan volume dan suara notifikasi perangkat aktif.

### A. Siapkan VAPID keys
Di komputer yang memiliki Node.js, jalankan:
```bash
npx web-push generate-vapid-keys
```
Simpan **Public Key** dan **Private Key**. Jangan bagikan Private Key dan jangan masukkan ke file frontend/GitHub.

### B. Isi konfigurasi frontend
Edit `supabase-config.js`:
- `SUPABASE_URL`: URL project Supabase.
- `SUPABASE_ANON_KEY`: publishable/anon key project yang sama.
- `VAPID_PUBLIC_KEY`: Public Key dari langkah A.
Private Key tidak boleh ditaruh di file ini.

### C. Jalankan SQL
1. Buka Supabase Dashboard → SQL Editor.
2. Jalankan seluruh `supabase-schema.sql` (termasuk tabel `push_subscriptions` dan `sent_reminders`).
3. Buka Database → Extensions, aktifkan `pg_cron`, `pg_net`, dan `supabase_vault` bila belum aktif.

### D. Siapkan Edge Function
Pasang Supabase CLI dan login ke project milikmu. Dari folder proyek:
```bash
supabase link --project-ref PROJECT_REF
supabase secrets set VAPID_PUBLIC_KEY=PUBLIC_KEY VAPID_PRIVATE_KEY=PRIVATE_KEY VAPID_SUBJECT=mailto:alamat-kontak@example.com CRON_SECRET=BUAT_SECRET_PANJANG_ACAK
supabase functions deploy send-reminders
```
Gunakan nilai CRON_SECRET yang sama persis pada langkah E. `SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY` dibaca dari environment Supabase Edge Functions; jangan pernah memasukkan service role key ke frontend.

### E. Aktifkan jadwal server
1. Di Supabase SQL Editor, buat dua secret di Vault (ganti placeholder):
```sql
select vault.create_secret('https://PROJECT_REF.supabase.co', 'smartstudy_project_url');
select vault.create_secret('NILAI_CRON_SECRET_YANG_SAMA', 'smartstudy_cron_secret');
```
2. Jalankan isi file `supabase/cron-schedule.sql`. Job akan memanggil Edge Function setiap menit.
3. Periksa hasil job di Supabase → Integrations → Cron dan log Edge Function `send-reminders`.

### F. Aktifkan di setiap perangkat
1. Deploy seluruh isi folder frontend ke GitHub Pages (HTTPS).
2. Login ke SmartStudy di laptop, buka Dashboard, tekan **Aktifkan Push Notification di Perangkat Ini**, lalu izinkan notifikasi.
3. Ulangi langkah yang sama di Chrome Android. Untuk pengalaman seperti aplikasi, pasang SmartStudy ke layar utama terlebih dahulu.
4. Uji dengan jadwal/tugas yang waktu pengingatnya akan tiba. Jangan mengandalkan suara khusus saat aplikasi tertutup; suara push mengikuti pengaturan perangkat.

### Keamanan
- Jangan commit VAPID Private Key, CRON_SECRET, atau Supabase service role key ke GitHub.
- Endpoint PushSubscription adalah data privat; tabel dilindungi RLS per user.
- Jika project Supabase menggunakan pengaturan akses khusus, deployment Edge Function dan pengelolaan Vault mungkin memerlukan peran Owner/Administrator.
- Web Push memerlukan HTTPS, izin pengguna, browser yang mendukung Push API, dan koneksi internet saat pengiriman.
