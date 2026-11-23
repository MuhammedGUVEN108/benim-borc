# Benim Borç

iPhone için Türkçe borç, gelir ve nakit akışı defteri. HTML, CSS ve vanilla JavaScript kullanır. Harici kütüphane veya hesap yoktur. İsteğe bağlı Claude eşitlemesi, defteri kullanıcının kendi Cloudflare sunucusuna (`sunucu/`) eşitler; bağlanılmazsa her şey yalnız cihazda kalır.

## iPhone'a ekleme

1. https://muhammedguven108.github.io/benim-borc/ adresini **Safari** ile açın.
2. İlk açılışta internet açık olsun. Ayarlar bölümünde **Çevrimdışı kullanıma hazır** yazısını görün.
3. **Paylaş → Ana Ekrana Ekle → Ekle** yolunu izleyin. Varsa **Web Uygulaması Olarak Aç** etkin olsun.
4. Ana ekrandaki simgeden açıp başlangıç bakiyesini ve kart günlerini girin.
5. **Ayarlar → Yedek al** ile düzenli olarak JSON yedeği kaydedin.

## Veri ve çevrimdışı kullanım

Finansal kayıtlar yalnız tarayıcının `localStorage` alanındadır. GitHub Pages yalnız uygulama dosyalarını sunar. Girilen kayıtlar, yedekler ve bakiyeler GitHub'a gönderilmez. Yedek paylaşımı yalnız kullanıcının seçtiği hedefe yapılır.

İlk çevrimiçi açılışta `sw.js` uygulama dosyalarını önbelleğe alır. Ardından uygulama çevrimdışı açılabilir. iOS site verilerini veya önbelleği temizlerse yeniden çevrimiçi açmak ve gerekirse JSON yedeğini yüklemek gerekir. Safari ve Ana Ekran uygulamasının depolama alanları farklı olabilir; verilerinizi ana ekran uygulamasında girin, taşıma için JSON kullanın.

`index.html` uygulamanın tüm arayüzünü ve hesaplama kodunu içerir. Güvenilir PWA kurulumu için ayrıca service worker, manifest ve yerel PNG simgeleri bulunur. İlk tek dosyalı sürümden bu nedenle ayrılır. İnternetten yazı tipi, kütüphane veya analitik yüklenmez.

## Hesaplama

- Tutarlar kuruş cinsinden tam sayı olarak saklanır.
- Kart harcaması kesim günü dahil ilgili ekstreye; kesimden sonraysa sonraki ekstreye girer.
- Nakit çıkışı, kesimden sonraki ilk son ödeme tarihinde oluşur.
- Bekleyen tekil gelir vadesinde onay ister; onaylanana kadar gerçekleşen bakiyeye eklenmez.
- Düzenli gelirler ve planlı ödemeler vadesinde gerçekleşmiş varsayılır. Değişen gerçek durumu kayıt düzenleme veya bakiye düzeltmesiyle yansıtın.
- Bakiye düzeltmesi geçmişi ezmeden bugüne bir fark kaydı ekler.
- Ayda bulunmayan günler ayın son gününe çekilir.

## KYK / düzenli gelir zammı

**Plan → ilgili gelir → Düzenle** bölümünde yeni tutarı ve **Yeni tutarın geçerlilik tarihi** alanını girin. Tarih bugünden sonra olmalıdır. Önceki dönemlerin tutarı ve bugüne kadar gerçekleşmiş gelirler korunur; yeni tutar seçilen tarihten sonraki vadelerde kullanılır. Birden fazla zam planlanabilir. Tutar geçmişi JSON yedeğine dahildir; eski yedekler de yüklenebilir. Başlangıç ve ödeme günü, geçmiş takvimi korumak için mevcut gelirde sabittir. Kuralı tamamen silmek ise geçmişini de kaldırır ve ayrıca onay ister.

Grafik mobilde doğal sağ-sol kaydırmayı destekler. Bir noktaya dokunarak veya kaydırırken grafiğin üstünde seçilen noktadaki bakiye okunur. Alt menü, kaydırılan içerikten ayrı yer kaplar.

Mobil yerleşim iPhone 15 Pro Max'in 430 × 932 CSS piksel ekranı ve güvenli alanları gözetilerek hazırlanmıştır. Masaüstü Edge'de hesaplama, mobil yerleşim ve yedekleme doğrulanmıştır; gerçek iPhone/Safari cihaz testi ayrıca yapılmalıdır.

## Claude eşitlemesi (isteğe bağlı)

`sunucu/` klasöründeki Cloudflare Worker, defteri D1 veritabanında saklar ve iki kapı açar:

- `/api/<ANAHTAR>/state` — uygulamanın eşitleme API'si (GET / PUT, sürüm numarasıyla iyimser kilit).
- `/mcp/<ANAHTAR>` — Claude için MCP sunucusu (harcama/gelir/plan ekleme, listeleme, düzenleme, silme, bakiye düzeltme, durum özeti, son değişikliği geri alma).

Anahtar Worker'da gizli değişkendir (`TOKEN`), repoda yer almaz. Uygulama: **Ayarlar → Claude eşitlemesi → Anahtarla bağlan**. Claude: claude.ai → Ayarlar → Bağlayıcılar → Özel bağlayıcı ekle → `https://benim-borc.gmuhammed108.workers.dev/mcp/<ANAHTAR>`.

Kayıt önce cihaza yazılır, sonra gönderilir. Çevrimdışı girişler bağlantı gelince gider. Çakışmada son eşitlenen sürüme göre üç yönlü birleştirme yapılır: bu cihazda değişen kayıtlar sunucudakinin üstüne uygulanır, diğer taraftaki yeni kayıtlar korunur. Sunucu son 300 sürümü saklar.

Sunucu hesaplaması `sunucu/src/core.js` içinde `index.html` ile aynıdır; hesaplama değişirse ikisi birlikte güncellenmeli. Testler (`sunucu/` içinde, yerel `wrangler dev` ile):

- `node test/core-parity.mjs` — uygulama ve sunucu hesaplamasının aynı olduğunu doğrular.
- `node test/api-test.mjs http://127.0.0.1:8787 <dev-anahtar>` — API ve MCP araçları (boş yerel D1 gerekir).
- `node test/app-test.cjs <puppeteer-core yolu>` — Edge'de eşitleme, çevrimdışı birleşme, ikinci cihaz.

Yayın: `wrangler d1 execute benim-borc --remote --file schema.sql`, `wrangler secret put TOKEN`, `wrangler deploy`.
