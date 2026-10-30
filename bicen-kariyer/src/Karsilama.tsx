/**
 * ---------------------------------------------------------------------------
 * Karşılama Ekranı
 * ---------------------------------------------------------------------------
 * Aday sayfası açıldığında ilk gelen ekran. Birim türleri kart olarak
 * listelenir: Şube, Genel Müdürlük, Lojistik Depo...
 *
 * Tek birimi olan türlerde (Genel Müdürlük, Depo) birim doğrudan belirlenir.
 * Birden fazla birimi olan türlerde (Şube) seçim başvuru formunda yapılır.
 *
 * QR kodla gelen adaylar bu ekranı görmez; birim adresten belirlenir.
 * ---------------------------------------------------------------------------
 */

import { useMemo } from "react";
import { Typography } from "antd";
import {
  ArrowRight,
  Briefcase,
  Building2,
  Search,
  ShieldCheck,
  Store,
  Warehouse,
} from "lucide-react";

import { AYARLAR, BIRIM_TURLERI, SUBELER, turleriSirala } from "./sabitler";
import { FORM_DURUMU } from "./ayarYukle";

const { Title, Paragraph } = Typography;

/** Tür adına göre simge seçimi */
const turIkonu = (ad: string) => {
  const kucuk = (ad || "").toLocaleLowerCase("tr");

  if (kucuk.includes("şube") || kucuk.includes("mağaza")) {
    return <Store size={30} strokeWidth={1.9} />;
  }
  if (kucuk.includes("müdürlük") || kucuk.includes("ofis") || kucuk.includes("merkez")) {
    return <Building2 size={30} strokeWidth={1.9} />;
  }
  if (kucuk.includes("depo") || kucuk.includes("lojistik")) {
    return <Warehouse size={30} strokeWidth={1.9} />;
  }
  return <Briefcase size={30} strokeWidth={1.9} />;
};

/**
 * Kart rengi tür adına göre belirlenir; sıralama değişse de renkler sabit kalır.
 * Tanınmayan türlerde sıraya göre dağıtılır.
 */
const RENK_SIRASI = ["yesil", "turuncu", "koyu"];

const turRengi = (ad: string, sira: number): string => {
  const kucuk = (ad || "").toLocaleLowerCase("tr");

  if (kucuk.includes("şube") || kucuk.includes("mağaza")) return "yesil";
  if (kucuk.includes("depo") || kucuk.includes("lojistik")) return "turuncu";
  if (kucuk.includes("müdürlük") || kucuk.includes("merkez") || kucuk.includes("ofis")) {
    return "koyu";
  }

  return RENK_SIRASI[sira % RENK_SIRASI.length];
};

export default function Karsilama({
  birimSecildi,
  turSecildi,
  sorgulamayaGit,
  logoHata,
  logoHataBildir,
}: {
  /** Tek birimi olan türlerde doğrudan birim seçilir */
  birimSecildi: (kod: string) => void;
  /** Birden fazla birimi olan türlerde birim, formda seçilir */
  turSecildi: (tur: string) => void;
  sorgulamayaGit: () => void;
  logoHata: boolean;
  logoHataBildir: () => void;
}) {

  /* Tür başına birimler (kart sırası KART_SIRASI ile belirlenir) */
  const turler = useMemo(() => {
    return turleriSirala(BIRIM_TURLERI).map((tur, sira) => {
      const birimler = SUBELER.filter((s) => (s.tur || "Şube") === tur.ad);
      return {
        ...tur,
        birimler,
        renk: turRengi(tur.ad, sira),
      };
    }).filter((t) => t.birimler.length > 0 || (t.bolumler ?? []).length > 0);
  }, []);

  /**
   * Tür seçimi.
   * Tek birimi olan türlerde birim doğrudan belirlenir; birden fazla birim
   * varsa (şubeler) seçim başvuru formunda yapılır.
   */
  const turSec = (turAdi: string) => {
    const tur = turler.find((t) => t.ad === turAdi);
    if (!tur || tur.birimler.length === 0) return;

    if (tur.birimler.length === 1) {
      birimSecildi(tur.birimler[0].kod);
      return;
    }

    turSecildi(turAdi);
  };

  const Marka = (
    <div className="krs-ust">
      {logoHata ? (
        <div className="krs-yazi-logo">
          bi<span>ç</span>en
        </div>
      ) : (
        <img
          src={AYARLAR.logoYolu}
          alt="Biçen Market"
          className="krs-logo"
          onError={logoHataBildir}
        />
      )}
    </div>
  );

  /* ==================================================================== */
  /* 1. Adım: birim türü kartları                                         */
  /* ==================================================================== */

  return (
    <div className="krs-sayfa">
      <div className="krs-leke krs-leke1" />
      <div className="krs-leke krs-leke2" />
      <div className="krs-leke krs-leke3" />

      <div className="krs-kapsayici">
        {Marka}

        <div className="krs-baslik-alan">
          <Title level={2} className="krs-baslik">
            Biçen Market'te Kariyer
          </Title>
          <Paragraph className="krs-alt-baslik">
            Ekibimize katılmak için başvurunuzu birkaç dakikada
            tamamlayabilirsiniz. Başvurunuz İnsan Kaynakları ekibimize doğrudan
            ulaşır.
          </Paragraph>
          <div className="krs-ayrac" />
        </div>

        {FORM_DURUMU.duyuru && <div className="krs-duyuru">{FORM_DURUMU.duyuru}</div>}

        <div className="krs-soru">
          <span className="krs-rakam">1</span>
          Başvuru yapmak istediğiniz birimi seçiniz
        </div>

        <div className="krs-kartlar">
          {turler.map((tur) => {
            const ornekler = (tur.bolumler ?? []).slice(0, 3);
            const kalan = (tur.bolumler ?? []).length - ornekler.length;
            const tekBirim = tur.birimler.length === 1;

            return (
              <button
                key={tur.ad}
                className={`krs-kart krs-${tur.renk}`}
                onClick={() => turSec(tur.ad)}
              >
                <span className="krs-kart-icerik">
                  <span className="krs-ikon">{turIkonu(tur.ad)}</span>

                  <span className="krs-kart-baslik">{tur.ad}</span>

                  <span className="krs-kart-aciklama">
                    {tur.aciklama || "Bu birimdeki açık pozisyonlara başvurun."}
                  </span>

                  {(tur.rozet || !tekBirim) && (
                    <span className="krs-rozet">
                      {tur.rozet || `${tur.birimler.length} birim`}
                    </span>
                  )}

                  {ornekler.length > 0 && (
                    <span className="krs-pozisyonlar">
                      {ornekler.map((p) => (
                        <span key={p}>{p}</span>
                      ))}
                      {kalan > 0 && <span className="krs-daha">+{kalan} pozisyon</span>}
                    </span>
                  )}

                  <span className="krs-devam">
                    Başvuru formuna geç
                    <ArrowRight className="krs-ok" size={18} strokeWidth={2.5} />
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="krs-alt">
          <button className="krs-baglanti" onClick={sorgulamayaGit}>
            <Search size={16} strokeWidth={2} />
            Daha önce başvurdum, başvurumu görüntüle
          </button>

          <div className="krs-kvkk">
            <ShieldCheck size={14} strokeWidth={2} />
            Bilgileriniz yalnızca işe alım süreçlerinde kullanılır.
          </div>

          <div className="krs-marka">Biçen Market · İnsan Kaynakları</div>
        </div>
      </div>
    </div>
  );
}
