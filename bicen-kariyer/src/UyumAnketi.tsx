/**
 * ---------------------------------------------------------------------------
 * İşe Uyum Anketi
 * ---------------------------------------------------------------------------
 * SMS ile gönderilen bağlantının açtığı ekran. İki taraf da buradan doldurur:
 *
 *  - tur = "calisan"  : personel kendi deneyimini değerlendirir
 *  - tur = "yonetici" : yönetici, dönemi dolan personeli değerlendirir
 *
 * Bağlantı 72 saat geçerlidir; süresi dolmuş ya da daha önce doldurulmuş
 * bağlantılarda form yerine açıklama gösterilir.
 *
 * Sorular burada tanımlıdır, sunucuda değil. Yanıtlar tek bir JSON olarak
 * gönderilir; böylece soru metni ileride değişse bile geçmiş kayıtlar
 * kendi soru metinleriyle birlikte durur.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useState } from "react";
import { AYARLAR } from "./sabitler";

interface Props {
  kod: string;
}

type Tur = "olcek" | "on" | "secim" | "acik";

interface Soru {
  tur: Tur;
  metin: string;
  secenekler?: string[];

  /**
   * Bu seçenek işaretlendiğinde altında zorunlu bir açıklama alanı açılır.
   *
   * "İK'ya iletmek istediğiniz bir konu var mı?" sorusuna yalnızca "Evet"
   * denmesi İK'ya hiçbir şey söylemiyordu; kişiyi arayıp ne olduğunu
   * sormak gerekiyordu. Açıklama zorunlu olunca konu formla birlikte
   * geliyor.
   */
  aciklamaIsteyen?: string;
}

const ASAMA_ADI: Record<string, string> = {
  "7g": "7. Gün",
  "2a": "2. Ay",
  "6a": "6. Ay",
  "1y": "1. Yıl",
};

/* ------------------------------------------------------ çalışan soruları */
const CALISAN: Record<string, Soru[]> = {
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
const YONETICI: Record<string, Soru[]> = {
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

export default function UyumAnketi({ kod }: Props) {
  const [durum, setDurum] = useState<
    "yukleniyor" | "acik" | "dolduruldu" | "suresiDoldu" | "hata"
  >("yukleniyor");

  const [kayit, setKayit] = useState<any>(null);
  const [mesaj, setMesaj] = useState("");
  const [yanitlar, setYanitlar] = useState<Record<number, any>>({});

  /* Seçime bağlı zorunlu açıklamalar; anahtar soru sırasıdır */
  const [aciklamalar, setAciklamalar] = useState<Record<number, string>>({});

  /* Yönetici formu çok kişiliktir: önce liste, sonra seçilen kişinin
     formu. Tamamlananlar listede işaretli kalır. */
  const [kisiler, setKisiler] = useState<any[]>([]);

  /* Liste boşsa sebebi sunucudan geliyor: "görünmüyor" demek yöneticiyi
     İK'yı aramaya itiyordu, oysa sebep çoğu zaman gün aralığı. */
  const [personelNotu, setPersonelNotu] = useState("");
  const [secilenKisi, setSecilenKisi] = useState<any>(null);
  const [bitenler, setBitenler] = useState<string[]>([]);
  const [gonderiliyor, setGonderiliyor] = useState(false);

  useEffect(() => {
    if (!kod) {
      setDurum("hata");
      setMesaj("Bağlantı kodu okunamadı.");
      return;
    }

    (async () => {
      try {
        const yanit = await fetch(`${AYARLAR.apiTaban}/api/Uyum/${kod}`, {
          cache: "no-store",
        });

        const veri = await yanit.json();

        if (!yanit.ok) {
          setDurum("hata");
          setMesaj(veri?.hata ?? "Bağlantı açılamadı.");
          return;
        }

        if (veri.durum === "acik") {
          setKayit(veri.kayit);
          setKisiler(veri.kisiler ?? []);
          setPersonelNotu(veri.personelNotu ?? "");
          setDurum("acik");
        } else {
          setDurum(veri.durum);
          setMesaj(veri.aciklama ?? "");
        }
      } catch {
        setDurum("hata");
        setMesaj("Sunucuya bağlanılamadı. İnternet bağlantınızı kontrol ediniz.");
      }
    })();
  }, [kod]);

  const sorular: Soru[] =
    kayit === null
      ? []
      : (kayit.tur === "yonetici" ? YONETICI : CALISAN)[kayit.asama] ?? [];

  /** Ölçek soruları yüzdeye çevrilip ortalanır (1–5 ve 0–10 birlikte) */
  const puanHesapla = (): number | null => {
    const puanli = sorular
      .map((s, i) => ({ s, d: yanitlar[i] }))
      .filter((x) => (x.s.tur === "olcek" || x.s.tur === "on") && x.d != null);

    if (puanli.length === 0) return null;

    const oran =
      puanli.reduce(
        (t, x) => t + Number(x.d) / (x.s.tur === "on" ? 10 : 5),
        0
      ) / puanli.length;

    return Math.round(oran * 500) / 100;
  };

  /** Bu soruda zorunlu açıklama isteniyor mu (seçenek işaretlenmişse) */
  const aciklamaGerek = (s: Soru, i: number) =>
    !!s.aciklamaIsteyen && yanitlar[i] === s.aciklamaIsteyen;

  const eksikVar = sorular.some(
    (s, i) =>
      (s.tur !== "acik" && yanitlar[i] == null) ||
      (aciklamaGerek(s, i) && (aciklamalar[i] ?? "").trim().length < 3)
  );

  const gonder = async () => {
    if (eksikVar) {
      const aciklamaEksik = sorular.some(
        (s, i) => aciklamaGerek(s, i) && (aciklamalar[i] ?? "").trim().length < 3
      );

      alert(
        aciklamaEksik
          ? "\"Evet\" işaretlediğiniz soruda açıklama yazmanız gerekiyor."
          : "Lütfen işaretlenmemiş soruları tamamlayınız."
      );
      return;
    }

    setGonderiliyor(true);

    try {
      const govde = {
        personelKodu: secilenKisi?.personelKodu ?? null,
        cevaplarJson: JSON.stringify({
          asama: kayit.asama,
          tur: kayit.tur,
          personelKodu: secilenKisi?.personelKodu ?? null,
          adSoyad: secilenKisi?.adSoyad ?? kayit.adSoyad,
          /* Soru metni yanıtla birlikte saklanır: metin ileride değişse
             bile geçmiş kayıtlar kendi sorularıyla okunur. */
          /* Açıklama ayrı alanda taşınır: yanıtın kendisi "Evet" kalmalı,
             yoksa raporlardaki evet/hayır sayımı bozulur. */
          sorular: sorular.map((s, i) => ({
            soru: s.metin,
            tur: s.tur,
            yanit: yanitlar[i] ?? null,
            aciklama: aciklamaGerek(s, i)
              ? (aciklamalar[i] ?? "").trim()
              : undefined,
          })),
        }),
        puan: puanHesapla(),
      };

      const yanit = await fetch(
        `${AYARLAR.apiTaban}/api/Uyum/${kod}/Cevap`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(govde),
        }
      );

      const veri = await yanit.json();

      if (!yanit.ok) {
        alert(veri?.hata ?? "Form kaydedilemedi.");
        return;
      }

      /* Yönetici formunda listeye dönülür; diğer kişiler bekliyor */
      if (kayit.tur === "yonetici" && secilenKisi) {
        setBitenler((o) => [...o, secilenKisi.personelKodu]);
        setSecilenKisi(null);
        setYanitlar({});
      } else {
        setDurum("dolduruldu");
      }
    } catch {
      alert("Sunucuya bağlanılamadı. Lütfen tekrar deneyiniz.");
    } finally {
      setGonderiliyor(false);
    }
  };

  /* ------------------------------------------------------------ görünüm */

  if (durum === "yukleniyor")
    return (
      <div className="uy-kap">
        <div className="uy-kart uy-orta">Yükleniyor…</div>
      </div>
    );

  if (durum !== "acik")
    return (
      <div className="uy-kap">
        <div className="uy-kart uy-orta">
          <div className="uy-simge">
            {durum === "dolduruldu" ? "✓" : "!"}
          </div>

          <h1 className="uy-baslik">
            {durum === "dolduruldu"
              ? "Teşekkür ederiz"
              : durum === "suresiDoldu"
              ? "Bağlantının süresi dolmuş"
              : "Bağlantı açılamadı"}
          </h1>

          <p className="uy-alt">
            {durum === "dolduruldu"
              ? "Yanıtlarınız kaydedildi. Görüşleriniz bizim için değerli."
              : mesaj ||
                "Bu bağlantı artık geçerli değil. İnsan Kaynakları ile görüşebilirsiniz."}
          </p>
        </div>
      </div>
    );

  const yonetici = kayit.tur === "yonetici";
  const puan = puanHesapla();

  /* Yönetici formunda önce değerlendirilecek kişi seçilir */
  if (yonetici && !secilenKisi) {
    const kalan = kisiler.filter(
      (k) => !bitenler.includes(k.personelKodu)
    );

    return (
      <div className="uy-kap">
        <div className="uy-kart">
          <div className="uy-ust">
            <div className="uy-rozet">
              {ASAMA_ADI[kayit.asama] ?? kayit.asama}
            </div>

            <h1 className="uy-baslik">Değerlendirme bekleyenler</h1>

            <p className="uy-alt">
              {kayit.subeAdi ? `${kayit.subeAdi} · ` : ""}
              {kalan.length} kişi bekliyor
              {bitenler.length > 0 ? ` · ${bitenler.length} tamamlandı` : ""}
            </p>
          </div>

          {kayit.testMi && (
            <div className="uy-uyari">
              Bu bir <b>sınama</b> gönderimidir. Yanıtlar raporlara girmez.
            </div>
          )}

          <div className="uy-not">
            Her personel için ayrı bir değerlendirme doldurulur. Yarım
            bırakıp sonra devam edebilirsiniz.
          </div>

          {kisiler.length === 0 ? (
            <p className="uy-alt" style={{ marginTop: 18 }}>
              Bu dönemde değerlendirme bekleyen personeliniz görünmüyor.
              {personelNotu ? (
                <>
                  <br />
                  <span style={{ fontSize: 12.5, opacity: 0.8 }}>{personelNotu}</span>
                </>
              ) : null}
            </p>
          ) : (
            kisiler.map((k) => {
              const bitti = bitenler.includes(k.personelKodu);

              return (
                <button
                  key={k.personelKodu}
                  type="button"
                  className={`uy-kisi${bitti ? " uy-kisi-bitti" : ""}`}
                  disabled={bitti}
                  onClick={() => {
                    setSecilenKisi(k);
                    setYanitlar({});
                  }}
                >
                  <span className="uy-kisi-harf">
                    {(k.adSoyad || "")
                      .split(" ")
                      .map((x: string) => x[0])
                      .slice(0, 2)
                      .join("")}
                  </span>

                  <span className="uy-kisi-orta">
                    <span className="uy-kisi-ad">{k.adSoyad}</span>
                    <span className="uy-kisi-alt">
                      {k.gorev}
                      {k.gun ? ` · ${k.gun}. gün` : ""}
                    </span>
                  </span>

                  <span className={`uy-kisi-durum${bitti ? " uy-bitti" : ""}`}>
                    {bitti ? "tamamlandı" : "değerlendir"}
                  </span>
                </button>
              );
            })
          )}

          {kalan.length === 0 && kisiler.length > 0 && (
            <p className="uy-dip" style={{ marginTop: 18 }}>
              Tüm değerlendirmeler tamamlandı. Teşekkür ederiz.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="uy-kap">
      <div className="uy-kart">
        <div className="uy-ust">
          <div className="uy-rozet">{ASAMA_ADI[kayit.asama] ?? kayit.asama}</div>

          <h1 className="uy-baslik">
            {yonetici
              ? `${secilenKisi?.adSoyad ?? "Personel"} değerlendirmesi`
              : `Merhaba ${(kayit.adSoyad || "").split(" ")[0]},`}
          </h1>

          <p className="uy-alt">
            {yonetici
              ? `${secilenKisi?.gorev || ""}${kayit.subeAdi ? " · " + kayit.subeAdi : ""}`
              : "Deneyiminiz bizim için önemli. Yaklaşık 2 dakikanızı alacak."}
          </p>
        </div>

        {kayit.testMi && (
          <div className="uy-uyari">
            Bu bir <b>sınama</b> gönderimidir. Yanıtlar raporlara girmez.
          </div>
        )}

        <div className="uy-not">
          {yonetici
            ? "Bu form performans kararı için değil, erken dönemde bir sorun varsa görebilmek içindir."
            : "Yanıtlarınız yöneticinizle paylaşılmaz. İnsan Kaynakları yalnızca genel değerlendirmeyi görür."}
        </div>

        {sorular.map((s, i) => (
          <div className="uy-soru" key={i}>
            <p className="uy-metin">
              {i + 1}. {s.metin}
              {s.tur === "acik" && <span className="uy-istege"> (isteğe bağlı)</span>}
            </p>

            {(s.tur === "olcek" || s.tur === "on") && (
              <div className="uy-olcek">
                {Array.from(
                  { length: s.tur === "on" ? 11 : 5 },
                  (_, k) => (s.tur === "on" ? k : k + 1)
                ).map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={`uy-secenek${yanitlar[i] === v ? " uy-secili" : ""}`}
                    onClick={() => setYanitlar((o) => ({ ...o, [i]: v }))}
                  >
                    {v}
                  </button>
                ))}
              </div>
            )}

            {s.tur === "secim" && (
              <div className="uy-olcek">
                {(s.secenekler ?? []).map((o) => (
                  <button
                    key={o}
                    type="button"
                    className={`uy-secenek uy-genis${
                      yanitlar[i] === o ? " uy-secili" : ""
                    }`}
                    onClick={() => setYanitlar((y) => ({ ...y, [i]: o }))}
                  >
                    {o}
                  </button>
                ))}
              </div>
            )}

            {aciklamaGerek(s, i) && (
              <div className="uy-aciklama">
                <p className="uy-aciklama-baslik">
                  Konuyu kısaca yazınız <span className="uy-zorunlu">(zorunlu)</span>
                </p>

                <textarea
                  className="uy-yazi"
                  value={aciklamalar[i] ?? ""}
                  onChange={(e) =>
                    setAciklamalar((o) => ({ ...o, [i]: e.target.value }))
                  }
                  placeholder="İnsan Kaynakları'nın bilmesini istediğiniz konu"
                  rows={3}
                  autoFocus
                />

                <p className="uy-aciklama-not">
                  Bu açıklamayı yalnızca İnsan Kaynakları görür.
                </p>
              </div>
            )}

            {s.tur === "acik" && (
              <textarea
                className="uy-yazi"
                value={yanitlar[i] ?? ""}
                onChange={(e) =>
                  setYanitlar((o) => ({ ...o, [i]: e.target.value }))
                }
                placeholder="Yanıtınız"
                rows={3}
              />
            )}
          </div>
        ))}

        {puan !== null && (
          <div className="uy-puan">
            Şu ana kadarki ortalama: <b>{puan.toFixed(1)}</b> / 5
          </div>
        )}

        <button
          type="button"
          className="uy-gonder"
          disabled={gonderiliyor}
          onClick={gonder}
        >
          {gonderiliyor
            ? "Gönderiliyor…"
            : eksikVar
            ? "Eksik soru var"
            : "Formu gönder"}
        </button>

        <p className="uy-dip">
          Bağlantı 3 gün geçerlidir · Biçen Market İnsan Kaynakları
        </p>
      </div>
    </div>
  );
}
