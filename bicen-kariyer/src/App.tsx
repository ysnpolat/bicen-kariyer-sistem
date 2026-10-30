import { useEffect, useState } from "react";
import { App as AntdApp, ConfigProvider, Spin } from "antd";
import trTR from "antd/locale/tr_TR";
import dayjs from "dayjs";
import "dayjs/locale/tr";

import BasvuruFormu from "./BasvuruFormu";
import BasvuruSorgula from "./BasvuruSorgula";
import Karsilama from "./Karsilama";
import CikisAnketi from "./CikisAnketi";
import UyumAnketi from "./UyumAnketi";
import KartBaglantisi from "./KartBaglantisi";
import { ayarlariYukle } from "./ayarYukle";
import { RENK, SUBELER } from "./sabitler";

dayjs.locale("tr");

type Ekran = "karsilama" | "form" | "sorgula" | "anket" | "uyum" | "kart";

const adresiOku = (): Ekran => {
  const yol = window.location.hash.replace("#", "").toLowerCase();

  /* Ayrılan personelin Biçen Kart bağlantısı: #/kart/KOD */
  if (/^\/?kart\//.test(yol)) return "kart";

  /* "uyum" önce bakılır: "#/uyum/KOD" içinde "anket" geçmiyor ama
     sıralamanın belirgin olması ileride karışıklığı önler. */
  if (yol.includes("uyum")) return "uyum";
  if (yol.includes("anket")) return "anket";
  if (yol.includes("sorgula")) return "sorgula";

  return "karsilama";
};

/** #/anket/KOD adresindeki anket kodu */
const anketKodu = (): string => {
  const eslesme = window.location.hash.match(/anket\/([A-Za-z0-9]+)/);
  return eslesme ? eslesme[1].toUpperCase() : "";
};

/** #/uyum/KOD adresindeki işe uyum anketi kodu */
const uyumKodu = (): string => {
  const eslesme = window.location.hash.match(/uyum\/([A-Za-z0-9]+)/);
  return eslesme ? eslesme[1].toUpperCase() : "";
};

/** #/kart/KOD adresindeki kart bağlantısı kodu */
const kartKodu = (): string => {
  const eslesme = window.location.hash.match(/kart\/([A-Za-z0-9]+)/);
  return eslesme ? eslesme[1].toUpperCase() : "";
};

/** QR adresindeki ?sube= parametresi */
const qrBirimi = (): string => {
  const p = new URLSearchParams(window.location.search);
  return (p.get("sube") ?? "").trim().toUpperCase();
};

export default function App() {
  const [ekran, setEkran] = useState<Ekran>(adresiOku);
  const [hazir, setHazir] = useState(false);
  const [birim, setBirim] = useState<string>("");
  const [tur, setTur] = useState<string>("");
  /* Birim değiştirilirken doldurulan bilgiler kaybolmasın diye saklanır */
  const [taslak, setTaslak] = useState<Record<string, unknown> | null>(null);
  const [logoHata, setLogoHata] = useState(false);

  /* Form içeriği (birimler, pozisyonlar, duyuru) sunucudan çekilir */
  useEffect(() => {
    ayarlariYukle().finally(() => {
      // QR ile gelindiyse karşılama ekranı atlanır
      const kod = qrBirimi();
      const qrBirim = SUBELER.find((s) => s.kod === kod);
      if (qrBirim) {
        setBirim(qrBirim.kod);
        setTur(qrBirim.tur || "Şube");
        if (adresiOku() !== "sorgula") setEkran("form");
      }

      setHazir(true);
    });
  }, []);

  /* Tarayıcının geri tuşu ile sorgulama ekranına geçiş */
  useEffect(() => {
    const dinleyici = () => {
      if (window.location.hash.toLowerCase().includes("sorgula")) setEkran("sorgula");
    };
    window.addEventListener("hashchange", dinleyici);
    return () => window.removeEventListener("hashchange", dinleyici);
  }, []);

  /**
   * Ekran değiştirir ve başa kaydırır.
   *
   * Kaydırma çizimden SONRA yapılır. Aynı anda çağrılınca tarayıcı eski
   * sayfanın yüksekliğine göre kaydırmaya başlıyor, yeni içerik gelince
   * yarıda kalıyor ve sayfa ortasında açılmış görünüyor. Mobilde adres
   * çubuğu da yüksekliği değiştirdiği için sorun orada belirginleşiyor.
   *
   * Yumuşak kaydırma yerine anlık: ekran değişiminde kaydırma animasyonu
   * yeni içeriğin çizimiyle yarışıyor ve düzensiz görünüyor.
   */
  const ekranaGit = (hedef: Ekran) => {
    window.location.hash = hedef === "sorgula" ? "/sorgula" : "";
    setEkran(hedef);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.scrollTo({ top: 0, behavior: "auto" });
      });
    });
  };

  /**
   * Tek birimli türlerde birim doğrudan belirlenir.
   *
   * Birim, tür ve ekran aynı anda yazılır. Ayrı ayrı yazıldığında
   * ekran "form" olup tür henüz boşken bir çizim yapılabiliyor ve
   * form açılmadan karşılamaya dönülüyordu.
   */
  const birimSecildi = (kod: string) => {
    const secilen = SUBELER.find((s) => s.kod === kod);

    setBirim(kod);
    setTur(secilen?.tur || "Şube");

    /* Tür yazıldıktan sonra ekran değiştirilir */
    queueMicrotask(() => ekranaGit("form"));
  };

  /** Çok birimli türlerde (şubeler) seçim formda yapılır */
  const turSecildi = (turAdi: string) => {
    setBirim("");
    setTur(turAdi);

    queueMicrotask(() => ekranaGit("form"));
  };

  const icerik = () => {
    if (!hazir) {
      return (
        <div className="bsv-yukleniyor">
          <Spin size="large" tip="Yükleniyor..." />
        </div>
      );
    }

    if (ekran === "anket") {
      return <CikisAnketi kod={anketKodu()} />;
    }

    if (ekran === "uyum") {
      return <UyumAnketi kod={uyumKodu()} />;
    }

    if (ekran === "kart") {
      return <KartBaglantisi kod={kartKodu()} />;
    }

    if (ekran === "sorgula") {
      return <BasvuruSorgula geriDon={() => ekranaGit("karsilama")} />;
    }

    /* Birim ya da tür yoksa form açılamaz ve karşılamaya düşülür.
       Bu sessiz düşüş "karta bastım, form gelmedi" olarak görülüyordu:
       durum güncellemeleri toplu işlendiği için ekran "form" olurken
       tür henüz yazılmamış olabiliyor. Seçim tek bir güncellemede
       yapılarak bu yarış ortadan kaldırıldı. */
    if (ekran === "form" && (birim || tur)) {
      return (
        <BasvuruFormu
          secilenBirim={birim}
          secilenTur={tur}
          taslak={taslak}
          birimiDegistir={(mevcut) => {
            // Girilen bilgiler saklanır; birim seçildikten sonra geri yüklenir
            setTaslak(mevcut);
            setBirim("");
            setTur("");
            ekranaGit("karsilama");
          }}
          sorgulamayaGit={() => ekranaGit("sorgula")}
        />
      );
    }

    return (
      <Karsilama
        birimSecildi={birimSecildi}
        turSecildi={turSecildi}
        sorgulamayaGit={() => ekranaGit("sorgula")}
        logoHata={logoHata}
        logoHataBildir={() => setLogoHata(true)}
      />
    );
  };

  return (
    <ConfigProvider
      locale={trTR}
      /* Açılır listeler ve takvim panelleri doğrudan sayfa gövdesine
         eklenir. Aksi hâlde üst öğelerdeki overflow/transform ayarları
         yüzünden bazı telefon tarayıcılarında görünmez kalıyorlar. */
      getPopupContainer={() => document.body}
      theme={{
        token: {
          colorPrimary: RENK.yesil,
          colorLink: RENK.yesilKoyu,
          colorError: RENK.turuncu,
          borderRadius: 10,
          fontSize: 14,
          fontFamily:
            "'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, 'Helvetica Neue', Arial, sans-serif",
        },
        components: {
          Input: { controlHeight: 42, controlHeightLG: 46 },
          InputNumber: { controlHeight: 42 },
          Select: { controlHeight: 42, controlHeightLG: 46 },
          DatePicker: { controlHeight: 42 },
          Button: { controlHeightLG: 48, fontWeight: 600 },
          Radio: { buttonSolidCheckedBg: RENK.yesil },
        },
      }}
    >
      <AntdApp>{icerik()}</AntdApp>
    </ConfigProvider>
  );
}
