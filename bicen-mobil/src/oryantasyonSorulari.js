/**
 * Oryantasyon (işe uyum) anketi soruları
 * ---------------------------------------------------------------------------
 * Web'deki anket ekranıyla (bicen-kariyer/src/UyumAnketi.tsx) bire bir aynı
 * olmalı: yanıtlar soru metniyle birlikte saklanıyor ve raporlar iki
 * kanalı ayırt etmeden okuyor. Soru değişirse iki yerde birden değişmeli.
 *
 * tur: olcek (1–5) | on (0–10) | secim | acik
 */

export const ASAMA_ADI = {
  "7g": "7. Gün",
  "2a": "2. Ay",
  "6a": "6. Ay",
  "1y": "1. Yıl",
};

/* ------------------------------------------------------ çalışan soruları */
export const CALISAN = {
  "7g": [
    { tur: "secim", metin: "İşe başladığınızda görev ve sorumluluklarınız size yeterince anlatıldı mı?",
      secenekler: ["Kesinlikle evet", "Evet", "Kısmen", "Hayır"] },
    { tur: "olcek", metin: "İlk gününüzde kendinizi karşılanmış ve ekibin bir parçası gibi hissettiniz mi?" },
    { tur: "olcek", metin: "Yöneticinizin size yaklaşımından ve iletişiminden memnun musunuz?" },
    { tur: "olcek", metin: "İşinizi yapabilmeniz için gerekli bilgi ve destek size sağlandı mı?" },
    { tur: "olcek", metin: "Çalışma ortamından şu ana kadar memnun musunuz?" },
    { tur: "secim", metin: "Beklentileriniz ile şu anki deneyiminiz arasında önemli bir fark var mı?",
      secenekler: ["Hayır", "Biraz", "Evet"] },
    { tur: "acik", metin: "İlk haftanızda sizi en çok memnun eden şey ne oldu?" },
    { tur: "acik", metin: "Değiştirilmesini veya iyileştirilmesini istediğiniz bir konu var mı?" },
    { tur: "secim", metin: "İnsan Kaynakları'nın özellikle bilmesini istediğiniz bir konu var mı?",
      secenekler: ["Hayır", "Evet"], aciklamaIsteyen: "Evet" },
  ],
  "2a": [
    { tur: "olcek", metin: "Görev ve sorumluluklarımın net olduğunu düşünüyorum." },
    { tur: "olcek", metin: "İşe ve çalışma düzenine uyum sağladım." },
    { tur: "olcek", metin: "Yöneticimden yeterli destek alıyorum." },
    { tur: "olcek", metin: "Ekibimle iletişimimden memnunum." },
    { tur: "olcek", metin: "Çalışma koşullarımdan memnunum." },
    { tur: "olcek", metin: "İşimi yapabilmek için yeterli bilgiye sahibim." },
    { tur: "olcek", metin: "Kendimi geliştirdiğimi düşünüyorum." },
    { tur: "olcek", metin: "Kendimi ekibin bir parçası olarak hissediyorum." },
    { tur: "on", metin: "Biçen'deki genel memnuniyetinizi değerlendirir misiniz? (0–10)" },
    { tur: "secim", metin: "Bugün tekrar tercih yapacak olsanız Biçen'de çalışmayı tercih eder miydiniz?",
      secenekler: ["Kesinlikle evet", "Evet", "Kararsızım", "Hayır"] },
    { tur: "acik", metin: "İşinizle ilgili en çok zorlandığınız konu nedir?" },
    { tur: "acik", metin: "Daha iyi bir çalışma deneyimi için neyi değiştirmeliyiz?" },
  ],
  "6a": [
    { tur: "olcek", metin: "İşimden genel olarak memnunum." },
    { tur: "olcek", metin: "Yöneticimden memnunum." },
    { tur: "olcek", metin: "Ekibimle çalışmaktan memnunum." },
    { tur: "olcek", metin: "Kendimi değerli hissediyorum." },
    { tur: "olcek", metin: "Gelişim fırsatı buluyorum." },
    { tur: "olcek", metin: "Görev ve sorumluluklarım beklentilerimle uyumlu." },
    { tur: "olcek", metin: "Kendimi Biçen'in bir parçası olarak hissediyorum." },
    { tur: "olcek", metin: "Biçen'de uzun süre çalışmayı düşünüyorum." },
    { tur: "olcek", metin: "Şirketin çalışanlarına değer verdiğini düşünüyorum." },
    { tur: "acik", metin: "Biçen'de çalışmaya devam etmenizi sağlayacak en önemli 3 konu nedir?" },
    { tur: "acik", metin: "Biçen'de değiştirmek istediğiniz tek bir şey olsaydı bu ne olurdu?" },
  ],
  "1y": [
    { tur: "olcek", metin: "Biçen'de çalışmaktan memnunum." },
    { tur: "olcek", metin: "Yöneticime güveniyorum." },
    { tur: "olcek", metin: "Yaptığım işin değerli olduğunu düşünüyorum." },
    { tur: "olcek", metin: "Kendimi Biçen'in bir parçası olarak hissediyorum." },
    { tur: "olcek", metin: "Kendimi geliştirme fırsatı buluyorum." },
    { tur: "olcek", metin: "Burada kariyer yapabileceğimi düşünüyorum." },
    { tur: "olcek", metin: "Çalışma ortamından memnunum." },
    { tur: "olcek", metin: "Şirketin çalışanlarına değer verdiğini düşünüyorum." },
    { tur: "on", metin: "Biçen'i çalışmak için bir arkadaşınıza tavsiye etme ihtimaliniz nedir? (0–10)" },
    { tur: "acik", metin: "Biçen'de sizi en çok memnun eden 3 konu nedir?" },
    { tur: "acik", metin: "Geliştirilmesini istediğiniz 3 konu nedir?" },
    { tur: "acik", metin: "Önümüzdeki yıl Biçen'den beklentiniz nedir?" },
  ],
};

/* ----------------------------------------------------- yönetici soruları */
export const YONETICI = {
  "7g": [
    { tur: "olcek", metin: "İşe ve çalışma düzenine uyumu" },
    { tur: "olcek", metin: "Verilen görevleri anlama düzeyi" },
    { tur: "olcek", metin: "Öğrenme ve öğrenilenleri uygulama isteği" },
    { tur: "olcek", metin: "İş yapma temposu" },
    { tur: "olcek", metin: "İş disiplinine uyumu" },
    { tur: "olcek", metin: "Ekip arkadaşlarıyla iletişimi" },
    { tur: "olcek", metin: "Yöneticiyle iletişimi" },
    { tur: "olcek", metin: "Müşteri iletişimi (uygunsa)" },
    { tur: "olcek", metin: "Şirket kurallarına uyumu" },
    { tur: "olcek", metin: "Sorumluluk alma isteği" },
    { tur: "secim", metin: "Genel performansını nasıl değerlendiriyorsunuz?",
      secenekler: ["Beklentimin üzerinde", "Beklentim doğrultusunda",
                   "Gelişime ihtiyacı var", "Beklentimin altında",
                   "Değerlendirme için erken"] },
    { tur: "secim", metin: "İşe devamlılığı ve dakikliği nasıl?",
      secenekler: ["Çok iyi", "İyi", "Orta", "Geliştirilmeli", "Sorun var"] },
    { tur: "acik", metin: "Güçlü bulduğunuz yönü nedir?" },
    { tur: "acik", metin: "Geliştirilmesi gereken konu nedir?" },
    { tur: "secim", metin: "İK'nın bilmesini istediğiniz bir konu var mı?",
      secenekler: ["Hayır", "Evet"], aciklamaIsteyen: "Evet" },
    { tur: "secim", metin: "Gelişiminin takibi konusunda görüşünüz?",
      secenekler: ["Kesinlikle olumlu", "Olumlu", "Takip edilmeli",
                   "Yakından desteklenmeli", "Olumsuz"] },
  ],
  "2a": [
    { tur: "olcek", metin: "İş bilgisini öğrenme" },
    { tur: "olcek", metin: "Görevleri doğru uygulama" },
    { tur: "olcek", metin: "İş kalitesi" },
    { tur: "olcek", metin: "İş yapma hızı" },
    { tur: "olcek", metin: "Verimlilik" },
    { tur: "olcek", metin: "Sorumluluk alma" },
    { tur: "olcek", metin: "Ekip çalışması" },
    { tur: "olcek", metin: "İletişim" },
    { tur: "olcek", metin: "Müşteri yaklaşımı" },
    { tur: "olcek", metin: "Şirket kurallarına uyum" },
    { tur: "secim", metin: "Mevcut görevinde beklenen seviyeye ulaşabilecek durumda mı?",
      secenekler: ["Evet", "Büyük ölçüde evet", "Gelişime ihtiyacı var",
                   "Beklentinin altında"] },
    { tur: "acik", metin: "Önümüzdeki 3 ayda geliştirmesi gereken en önemli 1–2 konu nedir?" },
    { tur: "secim", metin: "İK'nın bilmesini istediğiniz bir konu var mı?",
      secenekler: ["Hayır", "Evet"], aciklamaIsteyen: "Evet" },
  ],
  "6a": [
    { tur: "olcek", metin: "İş bilgisi" },
    { tur: "olcek", metin: "İş kalitesi" },
    { tur: "olcek", metin: "Verimlilik" },
    { tur: "olcek", metin: "Hedeflere ulaşma" },
    { tur: "olcek", metin: "Devamlılık" },
    { tur: "olcek", metin: "Dakiklik" },
    { tur: "olcek", metin: "Kurallara uyum" },
    { tur: "olcek", metin: "Ekip çalışması" },
    { tur: "olcek", metin: "İletişim" },
    { tur: "olcek", metin: "Müşteri yaklaşımı" },
    { tur: "olcek", metin: "İnisiyatif" },
    { tur: "olcek", metin: "Problem çözme" },
    { tur: "olcek", metin: "Öğrenme isteği" },
    { tur: "olcek", metin: "Geri bildirime açıklık" },
    { tur: "secim", metin: "Genel sonuç",
      secenekler: ["Beklentinin üzerinde", "Beklenen seviyede",
                   "Geliştirilmesi gerekiyor", "Beklentinin altında"] },
    { tur: "acik", metin: "Önümüzdeki 6 ayda geliştirmesi gereken en önemli konu nedir?" },
    { tur: "secim", metin: "İK'nın bilmesini istediğiniz bir konu var mı?",
      secenekler: ["Hayır", "Evet"], aciklamaIsteyen: "Evet" },
  ],
  "1y": [
    { tur: "olcek", metin: "İş bilgisi" },
    { tur: "olcek", metin: "İş kalitesi" },
    { tur: "olcek", metin: "Verimlilik" },
    { tur: "olcek", metin: "Hedeflere ulaşma" },
    { tur: "olcek", metin: "Devamlılık" },
    { tur: "olcek", metin: "Dakiklik" },
    { tur: "olcek", metin: "Kurallara uyum" },
    { tur: "olcek", metin: "Ekip çalışması" },
    { tur: "olcek", metin: "İletişim" },
    { tur: "olcek", metin: "Müşteri ilişkileri" },
    { tur: "olcek", metin: "Problem çözme" },
    { tur: "olcek", metin: "İnisiyatif" },
    { tur: "olcek", metin: "Sorumluluk alma" },
    { tur: "olcek", metin: "Öğrenme ve gelişim" },
    { tur: "secim", metin: "Genel performans",
      secenekler: ["Beklentinin çok üzerinde", "Beklentinin üzerinde",
                   "Beklenen seviyede", "Geliştirilmesi gerekiyor",
                   "Beklentinin altında"] },
    { tur: "secim", metin: "Daha fazla sorumluluk alabileceğini düşünüyor musunuz?",
      secenekler: ["Evet", "Kısmen", "Henüz değil"] },
    { tur: "acik", metin: "Gelişimi için öneriniz nedir?" },
    { tur: "acik", metin: "Değerlendirilebileceği farklı bir görev/departman var mı?" },
  ],
};

/** Ölçek soruları yüzdeye çevrilip ortalanır (1–5 ve 0–10 birlikte); 5'lik taban */
export const puanHesapla = (sorular, yanitlar) => {
  const puanli = sorular
    .map((s, i) => ({ s, d: yanitlar[i] }))
    .filter((x) => (x.s.tur === "olcek" || x.s.tur === "on") && x.d != null);

  if (puanli.length === 0) return null;

  const oran = puanli.reduce((t, x) => t + Number(x.d) / (x.s.tur === "on" ? 10 : 5), 0) / puanli.length;

  return Math.round(oran * 500) / 100;
};

/** Seçime bağlı zorunlu açıklama isteniyor mu */
export const aciklamaGerek = (s, yanit) => !!s.aciklamaIsteyen && yanit === s.aciklamaIsteyen;

/** Sunucuya giden yanıt gövdesi (web ile aynı biçim) */
export const cevapGovdesi = ({ asama, tur, personelKodu, adSoyad, sorular, yanitlar, aciklamalar }) => ({
  personelKodu: personelKodu ?? null,
  cevaplarJson: JSON.stringify({
    asama,
    tur,
    personelKodu: personelKodu ?? null,
    adSoyad,
    sorular: sorular.map((s, i) => ({
      soru: s.metin,
      tur: s.tur,
      yanit: yanitlar[i] ?? null,
      aciklama: aciklamaGerek(s, yanitlar[i]) ? (aciklamalar[i] ?? "").trim() : undefined,
    })),
  }),
  puan: puanHesapla(sorular, yanitlar),
});
