# Benim Borç

iPhone için Türkçe borç, gelir ve nakit akışı defteri. HTML, CSS ve vanilla JavaScript kullanır. Harici kütüphane, hesap veya veri senkronizasyonu yoktur.

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

Mobil yerleşim iPhone 15 Pro Max'in 430 × 932 CSS piksel ekranı ve güvenli alanları gözetilerek hazırlanmıştır. Masaüstü Edge'de hesaplama, mobil yerleşim ve yedekleme doğrulanmıştır; gerçek iPhone/Safari cihaz testi ayrıca yapılmalıdır.
