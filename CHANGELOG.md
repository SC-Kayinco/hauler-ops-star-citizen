# HAULER OPS — Changelog

---

## v0.6.1 — 2026-07-05 (Filo düzeltmeleri + otomatik güncelleme)
- **Otomatik güncelleme (installer):** installer sürümü artık açılışta GitHub'dan yeni sürüm
  kontrol eder, arka planda indirir ve bir sonraki açılışta kurar — elle yeniden indirme yok.
  (Portable sürüm kendini güncellemez.) Sadece public sürüm bilgisini çeker; kullanıcı verisi
  gönderilmez.
- **Kurulan sürüm + portable:** artık iki dosya — kurulum sihirbazlı installer (masaüstü/Başlat
  kısayolu, Program Ekle/Kaldır) ve tek dosyalık portable.
- **Your Ships düzeltmesi:** Drake Clipper kaldırıldı (hauling gemisi değil). Kendi gemilerin artık
  **Argo MOTH + Gatac Railen**.
- **MOTH Right Rack düzeltmesi:** sağ raf yanlışlıkla sol duvara oturuyordu; artık doğru şekilde
  **sağ duvara** ("Right wall out →") — 2D/3D görünümde de doğru tarafta.

## v0.6.0 — 2026-07-04 (Ayarlar sekmesi + topluluk paylaşımı hazırlığı)
- **⚙ Ayarlar sekmesi (yeni):** üst menüde dişli butonu + Settings görünümü. **Foto klasörü seçici**
  (Missions'tan taşındı), **Backup/Restore** (Fleet'ten taşındı + ne kaydettiğini anlatan açıklama),
  **Mission OCR Reading** menüsü, ve **About** (versiyon + "unofficial fan tool" disclaimer + UEX kredisi).
- **OCR en-boy oto-algılama:** kırpma bölgesi zaten kesirli (çözünürlük ölçekleniyor); yeni `ocrMode`
  (auto/crop/full). Auto'da ~16:9 ise objectives kolonunu kırpar, ultrawide/16:10/32:9'da tam-ekran OCR'a
  düşer. Ayarlardan elle seçilebilir. OBS "sadece oyunu yakala" ipucu eklendi.
- **Varsayılan pilot avatarı:** foto yokken gösterilen nötr holografik kask SVG (`public/default-avatar.svg`);
  tıklayınca editör açılır ("＋ Add photo" ipucu).
- **Varsayılan bio:** İngilizce örnek pilot personası artık programla geliyor (kendi bio'nu ezmez).
- **Fleet referans notu:** "topluluk kaynaklı referans, oyun-içi doğrula/düzenle".
- **Gatac Railen (yeni yerleşik gemi):** 640 SCU (20×32) resmi geometriyle yerleşik referans gemi
  olarak eklendi — demolar salvage gemisi yerine gerçek bir hauler ile başlasın diye.
- **RAFT düzeltildi:** 192 → 96 SCU (4× 24 SCU konteyner).
- **GROUP BY taşındı:** LOAD PLAN başlığından çıkıp Route'un üstünde kendi kutusuna.
- **Yayın dosyaları:** halka açık README, MIT LICENSE, .gitignore. **Güvenlik denetimi: TEMİZ**
  (veri sızıntısı yok; tek egress UEX GET; `webSecurity:false` ve OCR CDN yedeği README'de şeffafça belirtildi).

## v0.5.10 — 2026-06-22 (Pickup'ı görevlere bölme — Q1/Q2 alt satırları)
- Bir toplama noktasında **birden çok sözleşme** varsa, route listesinde o pickup satırının hemen
  altına **Q1/Q2… alt satırları** gelir — her biri görev adı + varış + **+SCU** gösterir.
- Bir alt satıra tıklayınca **3D'de sadece o sözleşmenin kutuları** izole olur (gerisi gizlenir),
  COLLECT paneli o göreve daralır. Asansörle hepsini değil, tek görevi çekip düzenleyebilirsin.
- Tek sözleşme varsa alt satır çıkmaz (eski davranış).

## v0.5.9 — 2026-06-22 (3D gizli kutu hover düzeltmesi)
- Pickup izole edilince **gizlenen** kutular artık fareyle üstüne gelince **etiket göstermiyor**
  (hem hover hem yazı `!dim` ile kapatıldı).

## v0.5.8 — 2026-06-22 (OCR "0/"→"7" SCU hatası)
- OCR, görev ilerleme öneki **"0/"**'yi tek bir **"7"** glifi okuyordu → `0/48 SCU` → `748`
  (hep 7 öneki: 32→732, 40→740, 48→748). SCU regex'i yeniden yazıldı (SCU'dan önceki toplamı,
  ilerleme önekini atlayarak yakalar) + `fixProgressScu` 7 ile başlayan 3-4 haneli SCU'dan baştaki 7'yi
  atar. Gerçek 3 haneli değerler (120) korunur. Kaynak **çalıştırılarak** uçtan uca doğrulandı.

## v0.5.7 — 2026-06-21 (3D düzenleme — kutu yer değiştirme/swap)
- Load Plan 3D Edit'te bir kutuyu seçip **aynı boyuttaki** başka kutunun üstüne bırakınca artık
  **yer değiştiriyorlar** (eskiden sadece boş hücreye → zemine park). Yeşil hayalet önizleme; snap/swap
  fill-direction aynalamasıyla tutarlı. (Sınır: döndürülmüş raflar hâlâ sürükle hedefi değil — ayrı iş.)

## v0.5.6 — 2026-06-21 (Disket ikonu + bay doldurma yönü)
- 💾 ikonu emoji yerine HUD tarzı **SVG**, ortalandı + büyütüldü.
- Cargo Grid Editor'da her bay'e **"Fill direction"** dropdown'ı (W/L eksenini ters çevir). Duvar/tavan
  rafları için "üstten alta" diziliş (örn. **Gatac Railen** tavandan-aşağı rafları). 2D + 3D aynalanır.

## v0.5.5 — 2026-06-21 (OCR'a dayanıklı recall + 3D sadeleştirme)
- Şablon eşleşmesi artık **SCU'dan bağımsız** (komodite + varış). OCR SCU'yu yanlış okusa bile recall
  **kayıtlı doğru SCU'yu + kutuları geri yazar**. Eski imzalar migration v11 ile yeniden hesaplandı.
- **3D Load Plan sadeleştirildi:** etiketler artık **sadece hover'da**; yanıp sönen highlight kaldırıldı.

## v0.5.4 — 2026-06-21 (3 durumlu kaydet butonu)
- Kaydet butonu 3 durumlu: kaydedilmemiş (nötr) → **kaydedildi (yeşil)** → ayar değişince **değişti
  (kırmızı)** → tekrar bas → günceller.

## v0.5.3 — 2026-06-21 (Missions kartından şablon kaydet)
- 💾 sadece import kartında değil, **MISSIONS sözleşme kartında** da (✎/✓/✕ yanında). Missions ve import
  imzaları birebir aynı → biri kaydedince diğeri tanır.

## v0.5.2 — 2026-06-21 (Görev şablonu kaydet/hatırla + 2 düzeltme)
- **Görev şablonu sistemi (yeni):** **💾 Save** → sözleşmeyi imzasıyla (kim verdi + toplama istasyonları +
  komodite/varış leg'leri) kaydeder; kutu kırılımları + toplama dağılımı saklanır. Aynı görevin ekran
  görüntüsünü tekrar yükleyince **otomatik dolar** + "↩ saved layout applied" rozeti. Pickup-split
  düzenlemeleri şablona geri öğrenilir. Kalıcı (`missionTemplates`) + Backup'a dahil. Yeni
  `src/lib/templates.ts`, `useStore` migration v10.
- **RAILEN "CAN'T LOAD EVERYTHING" yanlış uyarısı düzeltildi:** advisor gerçek plandan farklı paketleme
  sırası kullanıyordu (pickupRank yoktu) → "sığmıyor" diyordu. Artık aynı `pickupRank` geçiliyor.
- **Route başlangıç-noktası toplaması:** başlangıç konumu aynı zamanda toplama istasyonuysa artık atlanmıyor;
  en üste **PICKUP #1 (0 dk)** olarak gelir. ([routeOptimizer.ts](src/lib/routeOptimizer.ts))

---

## v0.5.1 — 2026-06-20 (Market flip yenileme + profil koruması)

- **MarketBoard flip animasyonu yeniden yapıldı**: hücreler artık **gerçek 3D `rotateX`** ile yatay
  eksende dönüyor (fiyat ↔ supply %). Her kart 320ms `cubic-bezier(0.65,0,0.35,1)` (easeInOutCubic),
  75ms arayla başlar → akıcı, üst üste binen soldan-sağa dalga (~14s tam sweep). Eski split-flap orta
  çizgisi + parıltı efektleri kaldırıldı, yazılar net.
- **Hücre kenarlığı** dashed → solid (daha sade).
- **Hold input bug düzeltildi**: ilk flip artık `holdSec` kadar bekliyor (eskiden `sweep + holdSec`
  ~18s gecikme vardı, "çalışmıyor" gibi görünüyordu) — girilen değer anında etkili.
- **Profil kalıcı koruması**: pilot profili ayrı bir `hauler-profile-backup` localStorage anahtarına
  da yansıtılıyor; her yüklemede store'daki profil boşsa oradan otomatik geri yükleniyor (store reset /
  migration profili artık silemiyor). Profil zaten dosya Backup'ına da dahil.

---

## v0.5.0 — 2026-06-19 (Canlı UEX emtia borsası — uexcorp grid)

- Yeni paylaşılan **`<MarketBoard>`** bileşeni: **Load Plan**'da gemi seçim butonlarının üstüne ve
  **Earnings**'te başlıkların üstüne eklendi.
- **Görsel: uexcorp.space ana sayfa grid'inin birebir aynısı** — sabit, yoğun ızgara (akan ticker DEĞİL,
  kullanıcı geri bildirimi üzerine değiştirildi): her emtia **koda göre alfabetik** bir hücre (dashed
  kenarlık), kod + kompakt satış fiyatı/SCU (`9.6K`/`1.6M`), fiyatı yoksa **"—"**. Fareyle hücre üstüne
  gelince **tam isim tooltip'i** (FFOO → "Fresh Food"). 184 emtia (110 fiyatlı + 74 "—").
- **Canlı veri**: UEX public API (`/2.0/commodities`) — `price_sell` site ile **1:1** (Agricium 9.585 =
  "AGRI 9.6K"). Koda göre tekilleştirilir (ore/refined aynı kodu paylaşır → fiyatlısı tutulur).
- **Kırmızı hücreler** = sadece-satılabilir mallar (`price_buy == 0`: madenle/loot'la elde edilenler,
  yasadışılar) — sitedeki kırmızı renklendirmeyle aynı. Doğrulandı (Beradom, Hadanite, Quantainium, Maze…).
- **Slim header**: durum noktası (LIVE/CACHED/OFFLINE) + canlı **medyan aUEC/SCU** göstergesi (UEX'in
  tescilli "UEC IDX 636.42"'si public API'de yok → birebir üretilemez, dürüst medyan kullanıldı; ortalama
  uç değerlerce çarpıtılır — SALD 34M, JACO 22M) + son yenilemeye göre hareket % + manuel ↻.
- **Offline-dostu**: son snapshot localStorage'da (`uex-market-cache-v1`); offline'da cache'ten render +
  "OFFLINE" rozeti, 10 dk'dan eski cache'te arka planda yeniler. CORS `*` doğrulandı.
- Dev önizlemede iki sayfada da doğrulandı (grid + tooltip + renkler), tip kontrolü temiz.

---

## v0.4.3 — 2026-06-19 (Star Map'te görev takibi)

- Haritadaki **rota durakları artık tıklanabilir**: pickup durağına tıkla → **"✓ topladım"**
  (Plan'daki loaded ✓ ile aynı, kutular yüklü işaretlenir); delivery durağına tıkla →
  **"✓ teslim ettim"** (Plan'daki dropped ile aynı, kargo 3D'den kalkar).
- Biten duraklar grileşip ✓ gösterir. İki sekme **aynı store alanlarını** paylaştığı için ilerleme
  her yerde senkron. "Set as my location" ise sadece rotanın başlangıç noktasını ayarlar (değişmedi).

---

## v0.4.2 — 2026-06-19 (Star Map kamera kontrolleri)

- Star Map'e Load Plan'daki gibi **perspektif preset butonları** (Persp/Front/Back/Left/Right/Top)
  + **klavye kısayolları** (5 / 1 / ⌃1 / ⌃3 / 3 / 7) eklendi.
- **WASD/QE ile uçarak gezinme** (orbit kameranın üstünde, yumuşak ivmeli).
- **Tam ekran** butonu (⛶).

---

## v0.4.1 — 2026-06-19 (Star Map → 3D)

### Star Map artık 3D
- Harita **three.js ile 3D'ye** taşındı (CargoBay3D ile aynı altyapı): yıldız çevresinde yörünge
  halkaları, gezegenler küre olarak, istasyonlar gezegenin etrafında 3D bulut halinde.
- **Sürükle = döndür, scroll = yakınlaş** (orbit kamera) + yıldız alanı (starfield) arka plan.
- Rota overlay 3D çizgi olarak çiziliyor (◈ başlangıç + numaralı pickup/delivery durakları).
- **Gezegene tıkla** → yan panelde o gezegenin tüm konumları listelenir; konuma tıkla → "Set as my
  location" / ★. Konum bulutundaki noktalara da doğrudan tıklanabilir.

---

## v0.4.0 — 2026-06-19 (Star Map sekmesi)

### Yeni: Star Map
SC'nin starmap'i ruhunda holografik sistem haritası (yeni sekme — v0.4.1'de 3D'ye taşındı):
- **Stanton / Pyro** sistem seçici. Ortada yıldız, gezegenler yörünge halkalarında, her gezegenin
  istasyon/outpost'ları çevresinde küme halinde nokta olarak (gezegen rengiyle).
- **Konuma tıkla** → yan panelde bilgi kartı: **"Set as my location"** (rota başlangıcını ayarlar) + ★ favori.
- **Aktif optimize rotan harita üzerine çiziliyor**: ◈ başlangıç + numaralı duraklar (pickup amber /
  delivery cyan) + kesikli rota çizgisi. Rota diğer sistemi de geziyorsa "↔ switch systems" notu.
- Gezegen renk legend'ı + rota legend'ı.
- Not: SC'deki gibi gerçek yörünge koordinatı yok — konumlar gezegen grubuna göre **stilize** yerleştirilir
  (mesafeler bire bir ölçekli değil), ama haritanın holografik hissini verir.

---

## v0.3.7 / v0.3.8 / v0.3.9 — 2026-06-18 (pilot profili + Plan düzeni temizliği)

### Yeni: Pilot Profili (tüm sekmelerde sol panel)
Üst menü altında, her sekmede görünen kalıcı **sol profil paneli** (dar ekranda <1080px gizlenir;
veriler kalıcı + backup'a dahil):
- En üstte **PILOT PROFILE** header, yanında **düzenleme kalemi (✎)**.
- **4:5 profil fotoğrafı** — opsiyonel **holografik 3D efekt** (mouse'u takip eden eğilme + parıltı),
  düzenleme penceresinden açılıp kapatılabilir.
- **Karakter adı** + **oyun-içi handle** (`@deathburger`).
- **Cüzdan** (tüm kazançların tam sayıyla, ör. `2.348.000 aUEC`) + **tamamlanan hauler sayısı**
  (teslimat yaptıkça artar).
- **Meslek tag'leri** (Discord rank tarzı): Bounty Hunter **kırmızı** + Hauler/Trader/Miner/
  Mercenary/Explorer/Medic/Salvager/Pirate/Smuggler hazır renkli çipler + **özel meslek** girdisi.
- **Biyografi** panelde **BIO** başlığıyla düz metin olarak gösterilir (yazdıkça aşağı uzar).
- **OWN SHIPS** bloğu (bio'nun altında, cüzdan/hauls ile aynı kart stilinde): sahip olunan gemilerin
  isimleri — düzenleme penceresinden eklenir (filodaki gemi adları öneri olarak gelir).
- **Düzenleme penceresi (✎):** foto, ad, handle, bio, meslekler ve holografik efekt toggle'ı —
  hepsi tek pencerede; değişiklikler anında kaydedilir.

### Plan sekmesi düzeni
- **MY LOCATION kutusu kaldırıldı** → Route panelinin **ilk satırı (◈ start)** artık konum seçici:
  açılır menü + ★ favori + ✕ temizle.
- **OPTIMIZE** butonu minimalleştirildi (✦ Optimize) ve **ROUTE başlığının tam karşısına** taşındı.
- **MAX BOX seçici kaldırıldı** (paketleyici varsayılanı korur).

### Düzeltmeler
- **Pickup "loaded ✓" checkbox bug'ı**: bir toplama noktasını işaretleyince hepsi işaretleniyordu.
  Artık her kutu **tek bir toplama istasyonuna** atanır (çözülmemiş çok-pickup'ta rota sırasına göre
  en erken durak) → bir noktayı ✓'lemek yalnızca o noktanın kargosunu işaretler. (Çok-pickup'lı bir
  leg'de ikincil istasyon, görevin toplama yeri Missions ekranında seçilince güncellenir.)
- **HDMS-Perlman "?" → HUR**: OCR'ın 'l'yi 'i' okuması ("Periman"/"Perimon") yüzünden eşleşmiyordu;
  artık Hurston'daki (Aberdeen yörüngesi) HDMS-Perlman'a eşlenir — "unknown" bitti.
- Konum açılır menüsündeki **çift "Jumptown"** kaynaklı React key uyarısı giderildi.

---

## v0.3.2 → v0.3.6 — 2026-06-18 (çok-pickup & konum doğruluğu oturumu)

Bu oturum, gerçek 3 görevlik bir Stanton→Pyro run'ı üzerinden bulunan 4 sorunu çözdü
(detaylı teknik döküm: `SESSION-HANDOFF.md`).

### Konum veritabanı artık UEX'ten (v0.3.2 · "B")
- `src/data/scLocations.generated.ts` → **UEX Corp API**'sinden üretiliyor (164 canlı Stanton+Pyro
  istasyon/outpost/şehir), doğru gezegen gruplarıyla; koda gömülü, app offline kalıyor.
  Yenilemek için: `node scripts/genLocations.cjs`.
- Eksik yerler ("?" / "unknown") bitti: Brio's Breaker Yard (Daymar), ArcCorp Mining Area 157 (Yela),
  Rayari Kaltag (Calliope), HDMS-Perlman (Magda), Chawla's Beach (Pyro IV), Shepherd's Rest (Bloom),
  Jackson's Swap (Monox) vb. **Re-import gerekmez** — sadece "Optimize Route".

### Çok-pickup düzeltmeleri (v0.3.2/0.3.3 · "A" + "D")
- **A:** Bir kontrattaki her commodity artık KENDİ toplama noktasını taşıyor (eskiden tüm kontratın
  noktaları her commodity'ye yapışıyordu → ArcCorp'ta olmayan kutular, çift sayım).
- **D:** Bir commodity birden çok noktadan toplanıyorsa, **Missions ekranında "Collect from"
  açılır menüsü**: tek noktayı seç (diğeri rotadan düşer) ya da "Split between them" (noktaya göre
  SCU gir). Çift sayım bitti.

### Aynı yer tek durak (v0.3.4/0.3.6 · "C")
- OCR varyantları ("Pyro IV" / "Pyro Iv" / "Pyro n") ve **kıvrık apostrof (')** artık tek
  isme iniyor (`canonicalLocation` + `matchLocation` apostrof normalizasyonu) → mükerrer teslimat
  durakları birleşti.

### Rota & teslimat işaretleme (v0.3.5/0.3.6)
- **Route (1. adım)** artık START + PICKUP'lar; teslimatlar yalnızca Delivery (2. adım) bölümünde.
- **Pickup satırı ✓** → o noktanın kutularını "loaded ✓" yapar (3D/2D'de görünür); kargoyu kaldırmaz.
- **Delivery satırı ✓** → o durağın kargosunu 3D ambardan kaldırır (declutter), satır grileşir,
  geri alınabilir; kazanca/History'e dokunmaz (kontrat tüm duraklar bitince öder).
- Açılır menü ve checkbox'lar koyu temaya uyarlandı.

---

## v0.3.1 — 2026-06-19

### Yeni: Taban yüzeyi (gemi raflarının yönü)
- Her bay'e **Base surface** ayarı (Grid editör): Floor / Sol duvar / Sağ duvar / Tavan / Ön / Arka
- Duvar/kanat rafları (ör. Argo MOTH) artık gövdeden **dışa doğru** doluyor (dikey yukarı değil);
  3D'de dışa yatık çiziliyor, 2D'de "On surface / Out 2 / Out 3…" etiketleri
- Kargo, topladığın sıraya göre **içeriden dışarı** yığılıyor → plan fiziksel olarak yüklenebilir
  (çok-pickup'lı görevlerde en erken toplama durağına göre)

### Düzeltmeler / İyileştirmeler
- **Rota artık kalıcı**: optimize edip sekme değiştirince veya uygulamayı kapatıp açınca rota kalıyor
- **Sözleşmeyi komple düzenleme**: kontrat kartında tek ✎ → ortak alanlar + tüm teslimatlar +
  teslimat ekle/sil (bacak başına ✎ da duruyor)
- **Sürüm rozeti**: sol üstte `v0.3.1` — hangi build'in çalıştığını anında gör
- **Ekran görüntüsü import**: yalnızca `.png` / `.jpg` algılanıyor; HDR'de Windows'un kaydettiği
  `.jxr` dosyaları yok sayılıyor

---

## v0.3.0 — 2026-06-13

### Yeni: Türkçe yama desteği (OCR)
- Türkçe çeviri yamasıyla çekilen kontrat ekranları artık parse ediliyor
  ("N SCU miktarında X öğesini Y konumuna teslim et", "Kimden", toplama noktaları)
- İngilizce + Türkçe karışık ekranlar sorunsuz; ürün/istasyon adları İngilizce kalıyor

### Yeni: Konumum + Favoriler + Çoklu Toplama Rotası
- Plan sekmesinde **📍 My Location** kutusu: yazarak ara (datalist), ★ favorilere ekle,
  ✕ ile otomatiğe dön; rota artık senin bulunduğun yerden başlar
  (varsayılan "Auto" = aktif görevlerin en sık pickup istasyonu)
- Birden fazla toplama noktası olan kontratlar (örn. Waste'i CRU-L1 VE CRU-L4'ten al)
  rotaya **PICKUP** etiketli duraklar olarak eklenir: Konumum → toplamalar → teslimatlar
- "Pickup Points" alanı: import kartı + görev kartında toplama noktaları görünür ve
  `|` ile ayırarak elle düzenlenebilir

### Yeni: Plan sayfası 70/30 tasarımı
- Sol %70: 3D ambar + 2D bay haritaları; sağ %30 dikey panel: ① Route ② Delivery
  ③ Loading/Unloading (dar ekranda tek kolona iner)
- Rota dikey numaralı liste; her durakta süre yerine **+N SCU** (alınacak) /
  **−N SCU** (bırakılacak) gösterilir
- **PICKUP duraklarına tıklanabilir:** o istasyonda alınacak kutular (adet × SCU →
  hedef) listelenir ve 3D/2D planda parlar
- Loading Sequence çok istasyonlu seferlerde **PICKUP: <istasyon>** etiketi gösterir
- UI dili tamamen İngilizce'ye sabitlendi (Backup/Restore, Optimize Route, vb.)

### Yeni: Kalıcı "Loaded ✓" listesi
- Yükleme işaretleri artık diske kaydediliyor — oyun/uygulama çökse bile yükleme
  ilerlemen kaybolmaz. Görev teslim edilince/silinince işaretler otomatik temizlenir

### Yeni: Yedekleme
- Fleet sekmesinde **⬇ Yedekle / ⬆ Geri Yükle**: tüm veri (gemiler, gridler, görevler,
  kazançlar, yerleşimler) tek JSON dosyasına; başka PC'ye taşımak için ideal

### Yeni: Toplama sırasına duyarlı paketleme
- Rota optimize edildikten sonra paketleyici, aynı teslimat durağına giden kutulardan
  **erken topladıklarını dibe/alta, geç topladıklarını kapıya/üste** yerleştirir
  (teslimat LIFO sırası her zaman önceliklidir) — "kutu daha elimde yok ama yeri dipte"
  problemi çözülür
- Loading Sequence, çok istasyonlu seferlerde her kutunun **AL: <istasyon>** etiketini gösterir

### Düzeltme: OCR
- İki haneli SCU değerleri (0/32, 0/20) artık doğru okunuyor (32→2, 20→0 hatası giderildi)
- Bozuk okunan "<> 0/" önekleri hedefi kaybettirmiyor

### Yeni: Kazanç iyileştirmeleri
- Teslimat kayıtlarındaki ödül **✎ ile düzenlenebilir** (kargo kaybında eksik ödeme düzeltmesi)
- **Today's Rate**: bugünkü saatlik kazanç (aUEC/saat) istatistiği

---

## v0.2.0 — 2026-06-12

### Yeni: Rota Optimizer
- Plan sekmesine **✦ Rotayı Optimize Et** butonu eklendi
- Görevlerin pickup origin'i otomatik başlangıç noktası olarak alınır
- Greedy nearest-neighbor TSP ile en kısa QT rotası hesaplanır
- Hesaplama sonrası **Route Strip** görünür: her durak için planet etiketi `[HUR]` + kümülatif süre `+9dk`
- Rota sırası güncellendikten sonra LIFO kargo paketlemesi otomatik yeniden yapılır (en son durak en derine)
- **55 SC lokasyonu** seeded: Stanton (HUR/CRU/ARC/MIC) + Pyro (I–VI), lagrange noktaları, yüzey tesisleri
- Bilinmeyen lokasyonlar (DB'de eşleşme yok) rotanın sonuna eklenir
- QT süreleri yaklaşık ortalama — gerçekte ±%20–30 değişebilir

### Düzeltme
- OCR test script'inin bracket `[` kirliği production'ı etkilemiyordu (production `parseMission.ts` zaten temizliyordu); belgelendi

---

## v0.1.0 — 2026-06-07

### İlk Sürüm
- Misyon ekleme, kontrat bazlı gruplama, BoxEditor
- LIFO yükleme planı, 2D bay haritası, 3D kargo tutma
- Gizmo ile manuel 3D yerleştirme, zemin park sistemi
- OCR screenshot import (Tesseract.js, offline bundled)
- Kazanç sekmesi (SVG grafik, aUEC defteri)
- Misyon geçmişi, "loaded ✓" 2D+3D senkronizasyonu
- Portable .exe dağıtımı (zip ile)
