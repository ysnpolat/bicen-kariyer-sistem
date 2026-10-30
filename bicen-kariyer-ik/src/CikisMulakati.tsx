/**
 * Çıkış Mülakatı
 * ---------------------------------------------------------------------------
 * İşten ayrılan personelle yapılan görüşmelerin kaydı.
 *
 * Sorular kod içinde sabit değildir: Yönetim → Form Ayarları'ndan yönetilen
 * havuzdan rastgele seçilir. "Soruları değiştir" denildiğinde yalnızca cevabı
 * boş olan sorular yenilenir; doldurulmuş cevaplar korunur.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  App as AntdApp,
  Avatar,
  Button,
  Card,
  Col,
  DatePicker,
  Drawer,
  Empty,
  Input,
  Row,
  Segmented,
  Select,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import dayjs, { Dayjs } from "dayjs";
import {
  BrainCircuit,
  LogOut,
  MessageSquareText,
  RefreshCw,
  Save,
  Search,
} from "lucide-react";

import { anketGonderme, api, oturumOku, sekmeGizli,
  tamYonetim,
} from "./api";
import Tablo from "./Tablo";
import CikisMulakatPanosu, { kaynakAdi } from "./CikisMulakatPanosu";
import "./CikisMulakat.css";
import { PersonelAdi } from "./personelKarti";

/** Sunucudaki gruplarla aynı (CikisAnalizi.cs); ayrıntıda elle değiştirmek için */
const GRUP_LISTESI = [
  "İşveren kaynaklı çıkış",
  "Yönetici ve iletişim",
  "Ücret ve yan haklar",
  "Çalışma koşulları ve saatler",
  "Başka iş / kariyer",
  "Eğitim ve okul",
  "Görev değişikliği ve rotasyon",
  "Sağlık",
  "Taşınma ve ulaşım",
  "Ailevi ve kişisel",
  "Uyum sağlayamama",
  "Diğer",
  "Belirtilmemiş",
];

const { Title, Text, Paragraph } = Typography;

/**
 * Çıkış nedeni sınıflandırması.
 *
 * Neden alanı serbest metin olduğu için rapor her farklı yazımı ayrı satır
 * sayıyordu: "Kaba Mağaza müdürü" ile "hiç muhatap alınmamam" aynı konu
 * olduğu hâlde iki satır çıkıyordu. Metin anahtar kelimelere göre bir üst
 * başlığa toplanır; ham metin kaybolmaz, satır açılınca görünür.
 *
 * Sıra önemlidir: ilk eşleşen başlık kazanır, o yüzden daha özel olanlar
 * üstte durur.
 */
const NEDEN_GRUPLARI: { ad: string; anahtarlar: string[] }[] = [
  { ad: "Yönetici ve iletişim", anahtarlar: [
      "müdür", "mudur", "yönetici", "yonetici", "amir", "şef", "sef",
      "muhatap", "muhatba", "kaba", "saygı", "saygi", "baskı", "baski",
      "mobbing", "değer görmedim", "deger gormedim", "dışlan", "dislan"] },

  { ad: "Ücret ve yan haklar", anahtarlar: [
      "ücret", "ucret", "maaş", "maas", "para", "zam", "prim", "ekonomik",
      "geçim", "gecim", "yan hak"] },

  { ad: "Çalışma koşulları ve saatler", anahtarlar: [
      "çalışma koşul", "calisma kosul", "koşullar", "kosullar", "mesai",
      "saat", "vardiya", "yoğun", "yogun", "ağır", "agir", "izin",
      "tatil", "yorucu", "iş yükü", "is yuku"] },

  { ad: "Başka iş / kariyer", anahtarlar: [
      "başka iş", "baska is", "yeni iş", "yeni is", "iş buldum", "is buldum",
      "kariyer", "terfi", "gelişme", "gelisme"] },

  { ad: "Eğitim ve okul", anahtarlar: [
      "okul", "eğitim", "egitim", "üniversite", "universite", "sınav", "sinav",
      "öğrenci", "ogrenci", "staj"] },

  { ad: "Görev değişikliği ve rotasyon", anahtarlar: [
      "rotasyon", "görev değişik", "gorev degisik", "birim değişik",
      "şube değişik", "sube degisik", "yer değişik"] },

  { ad: "Sağlık", anahtarlar: [
      "sağlık", "saglik", "hastalık", "hastalik", "rahatsız", "rahatsiz",
      "ameliyat", "doğum izni", "dogum izni", "hamile"] },

  { ad: "Taşınma ve ulaşım", anahtarlar: [
      "taşın", "tasin", "ulaşım", "ulasim", "servis", "uzak", "mesafe",
      "yol", "şehir değiş", "sehir degis", "memleket"] },

  { ad: "Ailevi ve kişisel", anahtarlar: [
      "ailevi", "aile", "ailsel", "kişisel", "kisisel", "askerlik", "evlilik"] },

  { ad: "Uyum sağlayamama", anahtarlar: [
      "uyum", "yetersiz", "zorland", "ağır geldi", "agir geldi",
      "beklediğim gibi değil", "bekledigim gibi degil"] },

  { ad: "İşveren kaynaklı çıkış", anahtarlar: [
      "çıkart", "cikart", "işten çıkar", "isten cikar", "fesih", "kod 25",
      "performans düşük", "performans dusuk"] },
];

/** Serbest metni bir üst başlığa yerleştirir */
const nedenGrubu = (ham: string): string => {
  const metin = (ham ?? "").trim();

  if (metin.length === 0) return "Belirtilmemiş";
  if (/^belirtilmemiş$/i.test(metin)) return "Belirtilmemiş";

  const kucuk = metin.toLocaleLowerCase("tr");

  for (const g of NEDEN_GRUPLARI)
    if (g.anahtarlar.some((a) => kucuk.includes(a))) return g.ad;

  /* Hiçbirine girmeyenler ayrı tutulur: listeye yeni anahtar eklemek
     gerektiğini gösterirler, gizlenmemeleri gerekiyor. */
  return "Sınıflandırılmamış";
};

/**
 * Kaydın neden grubu: sunucuda yapay zekâyla seçilip kaydedilen grup
 * (neden_grubu); henüz işlenmemiş kayıtta anahtar kelime yedeği.
 */
const kayitGrubu = (m: any): string =>
  m?.nedenGrubu || nedenGrubu((m?.cikisNedeni || "").trim() || "Belirtilmemiş");

const { TextArea } = Input;
const { RangePicker } = DatePicker;

interface Ayrilan {
  personelKodu: string;
  adSoyad: string;
  resimVar: boolean;
  resimSurumu: number | null;
  telefon: string | null;
  subeAdi: string | null;
  gorev: string | null;
  girisTarihi: string | null;
  cikisTarihi: string | null;
  /** Mikro'daki çıkış sebebi; mülakatta neden alanı bununla ön dolu gelir */
  cikisSebebi: string | null;
  mulakatVar: boolean;
}

interface Soru {
  soru: string;
  cevap: string;
}

export default function CikisMulakati() {
  const { message, modal } = AntdApp.useApp();

  const [sekme, setSekme] = useState<"yeni" | "liste" | "anket" | "aktarim">("liste");

  /* ---------------------------------------------------------- ayarlar */
  const [nedenler, setNedenler] = useState<string[]>([]);

  /* ------------------------------------------------------ yeni mülakat */
  const [ayrilanlar, setAyrilanlar] = useState<Ayrilan[]>([]);
  const [ayrilanArama, setAyrilanArama] = useState("");
  const [ayrilanYukleniyor, setAyrilanYukleniyor] = useState(false);
  const [secilen, setSecilen] = useState<Ayrilan | null>(null);
  const [sorular, setSorular] = useState<Soru[]>([]);
  const [neden, setNeden] = useState<string | undefined>();

  /* Nedenin açıklaması: neden Mikro'dan sabit geliyor ("İstifa" gibi),
     görüşmede öğrenilen asıl sebep buraya yazılır. */
  const [nedenAciklama, setNedenAciklama] = useState("");
  const [puanBasliklari, setPuanBasliklari] = useState<string[]>([]);
  const [puanlar, setPuanlar] = useState<Record<string, number>>({});
  const [tekrarCalisir, setTekrarCalisir] = useState<boolean | undefined>();
  const [tavsiye, setTavsiye] = useState<number | undefined>();
  const [yorum, setYorum] = useState("");
  const [kaydediliyor, setKaydediliyor] = useState(false);

  /* ------------------------------------------------------------ liste */
  const [liste, setListe] = useState<any[]>([]);

  /* Rapordaki çıkış nedeni satırına tıklanınca o gruba giren mülakatlar
     listelenir; tek başına yüzde görmek yetmiyor, kimler olduğu gerekiyor. */
  const [nedenGrup, setNedenGrup] = useState<string | null>(null);
  const [listeYukleniyor, setListeYukleniyor] = useState(false);
  const [aralik, setAralik] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(6, "month"),
    dayjs(),
  ]);
  const [detay, setDetay] = useState<any | null>(null);

  /* ------------------------------------------------------------- özet */
  const [ozet, setOzet] = useState<string | null>(null);
  const [ozetAliniyor, setOzetAliniyor] = useState(false);
  const [seciliIdler, setSeciliIdler] = useState<number[]>([]);

  /* ==================================================================== */

  useEffect(() => {
    api
      .al<any>("/api/CikisMulakat/Ayar")
      .then((a) => {
        setNedenler(a.nedenler ?? []);
        setPuanBasliklari(a.puanlamalar ?? []);
      })
      .catch(() => undefined);
  }, []);

  const ayrilanGetir = useCallback(async () => {
    setAyrilanYukleniyor(true);
    try {
      setAyrilanlar(
        await api.al<Ayrilan[]>(
          `/api/CikisMulakat/Ayrilanlar?arama=${encodeURIComponent(ayrilanArama)}`
        )
      );
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setAyrilanYukleniyor(false);
    }
  }, [ayrilanArama, message]);

  const listeGetir = useCallback(async () => {
    setListeYukleniyor(true);
    try {
      const bas = aralik[0].format("YYYY-MM-DD");
      const bit = aralik[1].format("YYYY-MM-DD");

      setListe(await api.al<any[]>(`/api/CikisMulakat?bas=${bas}&bit=${bit}`));
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setListeYukleniyor(false);
    }
  }, [aralik, message]);

  useEffect(() => {
    if (sekme === "liste") listeGetir();
    else ayrilanGetir();
  }, [sekme, listeGetir, ayrilanGetir]);

  /** Soruları havuzdan çeker; dolu cevaplar korunur */
  const sorulariYenile = async (mevcut: Soru[]) => {
    const korunan = mevcut
      .filter((s) => s.cevap.trim().length > 0)
      .map((s) => s.soru);

    try {
      const yeni = await api.gonder<string[]>(
        "/api/CikisMulakat/Sorular",
        korunan
      );

      setSorular(
        yeni.map((soru) => ({
          soru,
          cevap: mevcut.find((m) => m.soru === soru)?.cevap ?? "",
        }))
      );
    } catch (hata: any) {
      message.error(hata.message);
    }
  };

  const personelSec = async (a: Ayrilan) => {
    setSecilen(a);
    /* Neden Mikro'daki çıkış sebebiyle ön dolu gelir; uzman değiştirebilir */
    setNeden(a.cikisSebebi || undefined);
    setNedenAciklama("");
    setYorum("");
    setPuanlar({});
    setTekrarCalisir(undefined);
    setTavsiye(undefined);
    await sorulariYenile([]);
  };

  const kaydet = async () => {
    if (!secilen) return;

    if (sorular.every((s) => !s.cevap.trim())) {
      message.warning("En az bir soruyu cevaplayınız.");
      return;
    }

    setKaydediliyor(true);
    try {
      await api.gonder("/api/CikisMulakat", {
        personelKodu: secilen.personelKodu,
        adSoyad: secilen.adSoyad,
        subeAdi: secilen.subeAdi,
        gorev: secilen.gorev,
        girisTarihi: secilen.girisTarihi,
        cikisTarihi: secilen.cikisTarihi,
        telefon: secilen.telefon,
        cikisNedeni: neden,
        cikisNedeniAciklama: nedenAciklama.trim() || null,
        sorular,
        puanlar: Object.entries(puanlar).map(([baslik, puan]) => ({
          baslik,
          puan,
        })),
        tekrarCalisir,
        tavsiyePuani: tavsiye,
        uzmanYorumu: yorum,
      });

      message.success("Mülakat kaydedildi.");
      setSecilen(null);
      setSorular([]);
      setSekme("liste");
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setKaydediliyor(false);
    }
  };

  /* Özeti eksik eski kayıtları tamamlar. Yeni mülakatlarda özet kayıt
     anında üretilip saklandığı için bu düğme yalnızca özet özelliği
     eklenmeden önceki kayıtlar için gerekir. */
  const [eksikUretiliyor, setEksikUretiliyor] = useState(false);

  /* Özeti ya da neden grubu eksik kayıtlar (anketten gelenler,
     sınıflandırma eklenmeden önceki kayıtlar) */
  const eksikOzetler = liste.filter((m) => !m.ozet || !m.nedenGrubu).length;

  /** Ekrandaki dönemin eksiklerini tamamlar; sessiz = yalnızca hata gösterilir */
  const eksikleriUret = async (sessiz = false) => {
    setEksikUretiliyor(true);
    try {
      const d = await api.gonder<any>("/api/CikisMulakat/EksikOzetler", {
        baslangic: aralik[0].format("YYYY-MM-DD"),
        bitis: aralik[1].format("YYYY-MM-DD"),
      });

      if (d.hata)
        message.warning(
          `${d.uretilen ?? 0} özet üretildi, ${d.siniflandirilan ?? 0} kayıt sınıflandırıldı. Yapay zekâ hatası: ${d.hata}`,
          8
        );
      else if (!sessiz)
        message.success(
          d.toplam > 0
            ? `${d.uretilen} özet üretildi, ${d.siniflandirilan} kayıt sınıflandırıldı.`
            : d.mesaj ?? "Eksik özet yok."
        );

      await listeGetir();
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setEksikUretiliyor(false);
    }
  };

  /* ------------------------------------------------------------------ */
  /* Anket gönderimi                                                     */
  /* ------------------------------------------------------------------ */

  const [anketYil, setAnketYil] = useState(new Date().getFullYear());
  const [anketAy, setAnketAy] = useState(new Date().getMonth() + 1);
  const [anketListe, setAnketListe] = useState<any[]>([]);
  const [anketElenen, setAnketElenen] = useState(0);

  /* Anketi dolduranlar listede gösterilmez: onlara tekrar gönderilmeyecek
     ve liste yalnızca yapılacak işi göstermeli. İstenirse açılabilir. */
  const [dolduranGoster, setDolduranGoster] = useState(false);
  const [anketYukleniyor, setAnketYukleniyor] = useState(false);
  const [gonderiliyor, setGonderiliyor] = useState<string | null>(null);

  /* Elle gönderim alanları */
  /* Toplu seçim: birden çok kişiye tek seferde gönderim */
  const [secililer, setSecililer] = useState<React.Key[]>([]);
  const [topluGonderiliyor, setTopluGonderiliyor] = useState(false);

  const gonderebilir = anketGonderme(oturumOku());

  const topluGonder = async () => {
    const hedefler = anketListe.filter(
      (k) =>
        secililer.includes(k.personelKodu ?? k.adSoyad) &&
        k.telefon &&
        !k.dolduruldu
    );

    if (hedefler.length === 0) {
      message.warning("Telefonu olan kimse seçilmedi.");
      return;
    }

    setTopluGonderiliyor(true);

    let basarili = 0;
    const hatalar: string[] = [];

    /* Tek tek gönderilir: biri başarısız olursa diğerleri etkilenmesin
       ve hangisinin gitmediği görünsün. */
    for (const k of hedefler) {
      try {
        await api.gonder("/api/CikisAnket/Gonder", k);
        basarili++;
      } catch (hata: any) {
        hatalar.push(`${k.adSoyad}: ${hata.message}`);
      }
    }

    setTopluGonderiliyor(false);
    setSecililer([]);
    anketGetir();

    if (basarili > 0) message.success(`${basarili} kişiye anket gönderildi.`);

    if (hatalar.length > 0)
      modal.warning({
        title: `${hatalar.length} gönderim başarısız`,
        content: (
          <div style={{ maxHeight: 260, overflowY: "auto" }}>
            {hatalar.map((h, i) => (
              <div key={i} style={{ fontSize: 12.5, marginBottom: 4 }}>
                {h}
              </div>
            ))}
          </div>
        ),
      });
  };

  const [elleAd, setElleAd] = useState("");
  const [elleTel, setElleTel] = useState("");
  const [elleTc, setElleTc] = useState("");
  const [elleSube, setElleSube] = useState("");

  /* Eski çizelgeden toplu aktarım */
  const [aktarSatirlar, setAktarSatirlar] = useState<any[]>([]);
  const [aktariliyor, setAktariliyor] = useState(false);

  /* Aktarılmış kayıtların özeti; geri alma bunu kullanır */
  const [aktarimOzeti, setAktarimOzeti] = useState<any>(null);

  /* Şube kırılımı: dönem raporundan bir şubeye tıklanınca açılır */
  const [subeDetay, setSubeDetay] = useState<any>(null);
  const [subeYukleniyor, setSubeYukleniyor] = useState(false);
  const [subeOzetleniyor, setSubeOzetleniyor] = useState(false);

  /**
   * Bir şubenin dönem içindeki mülakatlarını getirir.
   *
   * Özet ayrı bir düğmeyle istenir: her tıklamada yapay zekâ çağrısı
   * yapmak hem yavaş hem maliyetli, oysa çoğu zaman yalnızca listeye
   * bakmak isteniyor.
   */
  const subeAc = async (subeAdi: string, ozetIste = false) => {
    if (ozetIste) setSubeOzetleniyor(true);
    else {
      setSubeDetay({ subeAdi, yukleniyor: true });
      setSubeYukleniyor(true);
    }

    try {
      const d = await api.gonder<any>("/api/CikisMulakat/SubeOzeti", {
        subeAdi,
        baslangic: aralik[0].format("YYYY-MM-DD"),
        bitis: aralik[1].format("YYYY-MM-DD"),
        ozetIste,
      });

      setSubeDetay({ subeAdi, ...d });
    } catch (hata: any) {
      message.error(hata.message);
      if (!ozetIste) setSubeDetay(null);
    } finally {
      setSubeYukleniyor(false);
      setSubeOzetleniyor(false);
    }
  };

  const ozetGetir = useCallback(async () => {
    try {
      setAktarimOzeti(await api.al<any>("/api/CikisMulakat/AktarimOzeti"));
    } catch {
      setAktarimOzeti(null);
    }
  }, []);

  useEffect(() => {
    if (sekme === "aktarim") ozetGetir();
  }, [sekme, ozetGetir]);

  /**
   * Aktarımı geri alır.
   *
   * Yalnızca çizelgeden gelen kayıtlar silinir; elle girilen ve anketten
   * gelen mülakatlara dokunulmaz.
   */
  const geriAl = (donem?: string) => {
    const adet = donem
      ? aktarimOzeti?.donemler?.find((d: any) => d.donem === donem)?.adet ?? 0
      : aktarimOzeti?.ozet?.adet ?? 0;

    modal.confirm({
      title: donem ? `${donem} dönemi silinsin mi?` : "Tüm aktarım silinsin mi?",
      width: 470,
      content: (
        <Paragraph style={{ fontSize: 13.5, marginBottom: 0 }}>
          <b>{adet} mülakat kaydı</b> silinecek. Bu işlem geri alınamaz.
          <br />
          <br />
          Elle girilen ve anketten gelen mülakatlar etkilenmez; yalnızca
          çizelgeden aktarılanlar silinir.
        </Paragraph>
      ),
      okText: "Sil",
      cancelText: "Vazgeç",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const d = await api.gonder<any>("/api/CikisMulakat/AktarimGeriAl", {
            deger: donem ?? "",
          });

          message.success(`${d.silinen} kayıt silindi.`);
          ozetGetir();
          listeGetir();
        } catch (hata: any) {
          message.error(hata.message);
        }
      },
    });
  };

  /**
   * Çizelgeyi çözümler.
   *
   * Sütunlar başlık adına göre bulunur; sabit konum kullanmak çizelgeye
   * bir sütun eklendiğinde her şeyi kaydırıyor.
   */
  const cizelgeOku = (dosya: File) => {
    const cozumle = (metin: string) => {
      const temiz = metin.replace(/^\uFEFF/, "");
      const satirlar = temiz.split(/\r?\n/).filter((x) => x.trim());

      if (satirlar.length < 2) {
        message.error("Dosya boş görünüyor.");
        return;
      }

      const ornek = satirlar[Math.min(1, satirlar.length - 1)];

      const ayrac =
        (ornek.match(/;/g)?.length ?? 0) >= (ornek.match(/\t/g)?.length ?? 0)
          ? ";"
          : "\t";

      const basIndeksi = satirlar.findIndex((x) =>
        x.toLocaleUpperCase("tr").includes("AD SOYAD")
      );

      if (basIndeksi < 0) {
        message.error("Başlık satırı bulunamadı. 'AD SOYAD' sütunu olmalı.");
        return;
      }

      const basliklar = satirlar[basIndeksi]
        .split(ayrac)
        .map((x) => x.replace(/^"|"$/g, "").trim().toLocaleUpperCase("tr"));

      const bul = (...adaylar: string[]) => {
        for (const a of adaylar) {
          const i = basliklar.findIndex((b) => b.includes(a));
          if (i >= 0) return i;
        }
        return -1;
      };

      const sutun = {
        donem: bul("DÖNEM", "DONEM"),
        ad: bul("AD SOYAD", "ADI SOYADI"),
        sube: bul("ŞUBE", "SUBE"),
        gorev: bul("GÖREV", "GOREV"),
        giris: bul("İŞE GİRİŞ", "ISE GIRIS"),
        cikis: bul("AYRILIŞ", "AYRILIS", "ÇIKIŞ TARİH"),
        neden: bul("ÇIKIŞ NEDENİ", "CIKIS NEDENI"),
        yonetici: bul("YÖNETİCİ YORUM", "YONETICI YORUM"),
        ikNeden: bul("İK ÇIKIŞ NEDENİ", "IK CIKIS NEDENI"),
        ikYorum: bul("İK YORUM", "IK YORUM"),
      };

      if (sutun.ad < 0) {
        message.error("AD SOYAD sütunu bulunamadı.");
        return;
      }

      /* Tarih: 20.08.2020 ya da 1.07.2026 biçiminde geliyor */
      const tarihOku = (h: string) => {
        const t = (h ?? "").trim();
        if (!t) return null;

        const p = t.split(/[./-]/);
        if (p.length !== 3) return null;

        const g = Number(p[0]);
        const a = Number(p[1]);
        const y = Number(p[2]);

        if (!g || !a || !y) return null;

        return dayjs(`${y}-${String(a).padStart(2, "0")}-${String(g).padStart(2, "0")}`);
      };

      const al = (p: string[], i: number) =>
        i >= 0 ? (p[i] ?? "").replace(/^"|"$/g, "").trim() : "";

      const veriler = satirlar
        .slice(basIndeksi + 1)
        .map((satir) => {
          const p = satir.split(ayrac);

          const ad = al(p, sutun.ad);
          const cikis = tarihOku(al(p, sutun.cikis));

          return {
            donem: al(p, sutun.donem),
            adSoyad: ad,
            subeAdi: al(p, sutun.sube),
            gorev: al(p, sutun.gorev),
            girisTarihi: tarihOku(al(p, sutun.giris)),
            cikisTarihi: cikis,
            cikisNedeni: al(p, sutun.neden),
            yoneticiYorumu: al(p, sutun.yonetici),
            ikCikisNedeni: al(p, sutun.ikNeden),
            ikYorum: al(p, sutun.ikYorum),
            sorun: !ad ? "ad boş" : !cikis ? "çıkış tarihi okunamadı" : null,
          };
        })
        .filter((x) => x.adSoyad || x.cikisTarihi);

      if (veriler.length === 0) {
        message.error("Okunacak satır bulunamadı.");
        return;
      }

      setAktarSatirlar(veriler);

      message.success(
        `${veriler.length} satır okundu, ${
          veriler.filter((x) => !x.sorun).length
        } tanesi aktarılabilir.`
      );
    };

    /* Türkçe Excel CSV'yi windows-1254 kaydediyor */
    const oku = (kodlama: string, sonraki?: () => void) => {
      const okuyucu = new FileReader();

      okuyucu.onerror = () => message.error("Dosya okunamadı.");

      okuyucu.onload = () => {
        try {
          const metin = String(okuyucu.result ?? "");

          if (sonraki && metin.includes("\uFFFD")) {
            sonraki();
            return;
          }

          cozumle(metin);
        } catch (hata: any) {
          message.error(`Çözümlenemedi: ${hata?.message ?? hata}`);
        }
      };

      okuyucu.readAsText(dosya, kodlama);
    };

    oku("utf-8", () => oku("windows-1254"));
  };

  const cizelgeAktar = async () => {
    const gecerli = aktarSatirlar.filter((x) => !x.sorun);

    if (gecerli.length === 0) {
      message.warning("Aktarılabilecek satır yok.");
      return;
    }

    setAktariliyor(true);

    try {
      const d = await api.gonder<any>(
        "/api/CikisMulakat/TopluAktar",
        gecerli.map((x) => ({
          donem: x.donem || null,
          adSoyad: x.adSoyad,
          subeAdi: x.subeAdi || null,
          gorev: x.gorev || null,
          girisTarihi: x.girisTarihi?.format("YYYY-MM-DD") ?? null,
          cikisTarihi: x.cikisTarihi?.format("YYYY-MM-DD") ?? null,
          cikisNedeni: x.cikisNedeni || null,
          yoneticiYorumu: x.yoneticiYorumu || null,
          ikCikisNedeni: x.ikCikisNedeni || null,
          ikYorum: x.ikYorum || null,
        }))
      );

      message.success(
        `${d.yazilan} mülakat aktarıldı · ${d.eslesen} tanesi personel kaydıyla eşleşti.`
      );

      if (d.atlanan?.length > 0)
        modal.info({
          title: `${d.atlanan.length} satır atlandı`,
          content: (
            <div style={{ maxHeight: 260, overflowY: "auto" }}>
              {d.atlanan.map((x: string, i: number) => (
                <div key={i} style={{ fontSize: 12.5 }}>
                  {x}
                </div>
              ))}
            </div>
          ),
        });

      setAktarSatirlar([]);
      listeGetir();
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setAktariliyor(false);
    }
  };

  const anketGetir = useCallback(async () => {
    setAnketYukleniyor(true);

    try {
      const d = await api.al<any>(
        `/api/CikisAnket/Ayrilanlar?yil=${anketYil}&ay=${anketAy}`
      );

      setAnketListe(d.kayitlar ?? []);
      setAnketElenen(d.elenen ?? 0);
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setAnketYukleniyor(false);
    }
  }, [anketYil, anketAy, message]);

  useEffect(() => {
    if (sekme === "anket") anketGetir();
  }, [sekme, anketGetir]);

  const anketGorunen = useMemo(
    () => anketListe.filter((k) => dolduranGoster || !k.dolduruldu),
    [anketListe, dolduranGoster]
  );

  const dolduranSayisi = useMemo(
    () => anketListe.filter((k) => k.dolduruldu).length,
    [anketListe]
  );

  const anketGonder = async (k: any, anahtar: string) => {
    setGonderiliyor(anahtar);

    try {
      await api.gonder("/api/CikisAnket/Gonder", k);
      message.success(`${k.adSoyad} adlı kişiye anket gönderildi.`);
      anketGetir();
      return true;
    } catch (hata: any) {
      message.error(hata.message);
      return false;
    } finally {
      setGonderiliyor(null);
    }
  };

  const elleGonder = async () => {
    if (!elleAd.trim() || !elleTel.trim()) {
      message.warning("Ad soyad ve telefon gereklidir.");
      return;
    }

    const oldu = await anketGonder(
      {
        adSoyad: elleAd.trim(),
        telefon: elleTel.trim(),
        kimlikNo: elleTc.trim() || null,
        subeAdi: elleSube.trim() || null,
      },
      "elle"
    );

    if (oldu) {
      setElleAd("");
      setElleTel("");
      setElleTc("");
      setElleSube("");
    }
  };

  const ozetAl = async () => {
    setOzetAliniyor(true);
    setOzet(null);

    /* Rapor tablosundaki neden grupları doğru çıksın: dönemde özeti ya da
       grubu eksik kayıt varsa önce onlar tamamlanıyor */
    if (eksikOzetler > 0) await eksikleriUret(true);

    try {
      const d = await api.gonder<any>("/api/CikisMulakat/Ozet", {
        idler: seciliIdler,
        baslangic: aralik[0].format("YYYY-MM-DD"),
        bitis: aralik[1].format("YYYY-MM-DD"),
      });

      setOzet(d.ozet);
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setOzetAliniyor(false);
    }
  };

  const sil = (id: number, ad: string) => {
    modal.confirm({
      title: `${ad} mülakatı silinsin mi?`,
      okText: "Sil",
      cancelText: "Vazgeç",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api.sil(`/api/CikisMulakat/${id}`);
          message.success("Silindi.");
          listeGetir();
        } catch (hata: any) {
          message.error(hata.message);
        }
      },
    });
  };

  /* ------------------------------------------------------------------ */
  /* Dönem raporu                                                        */
  /* ------------------------------------------------------------------ */

  /* Sayılar modele sorulmaz, veriden hesaplanır: model aritmetikte
     yanılabilir ve rapor rakamlarının her zaman doğru olması gerekir.
     Modelin işi yorum, sayım değil. */
  const rapor = useMemo(() => {
    const alan = (n: any, ...adlar: string[]) => {
      for (const a of adlar) if (n?.[a] != null) return n[a];
      return undefined;
    };

    const nedenSayaci = new Map<string, number>();

    /* Üst başlık → (ham metin → adet). Rapor satırı açılınca gösterilir */
    const nedenAyrinti = new Map<string, Map<string, number>>();
    const puanToplam = new Map<string, { toplam: number; adet: number }>();
    const subeSayaci = new Map<string, number>();

    let tavsiyeToplam = 0;
    let tavsiyeAdet = 0;
    let tekrarEvet = 0;
    let tekrarAdet = 0;

    liste.forEach((m) => {
      /* Ham metin üst başlığa toplanır; özgün ifadeler ayrıca saklanır */
      const hamNeden = (m.cikisNedeni || "").trim() || "Belirtilmemiş";
      const neden = kayitGrubu(m);

      nedenSayaci.set(neden, (nedenSayaci.get(neden) ?? 0) + 1);

      if (!nedenAyrinti.has(neden)) nedenAyrinti.set(neden, new Map());

      const ic = nedenAyrinti.get(neden)!;
      ic.set(hamNeden, (ic.get(hamNeden) ?? 0) + 1);

      const sube = m.subeAdi || "Belirtilmemiş";
      subeSayaci.set(sube, (subeSayaci.get(sube) ?? 0) + 1);

      try {
        const ham = JSON.parse(m.sorularJson || "{}");
        const k = Array.isArray(ham) ? {} : ham;

        (alan(k, "puanlar", "Puanlar") ?? []).forEach((p: any) => {
          const baslik = alan(p, "baslik", "Baslik");
          const puan = Number(alan(p, "puan", "Puan") ?? 0);
          if (!baslik || puan <= 0) return;

          const o = puanToplam.get(baslik) ?? { toplam: 0, adet: 0 };
          puanToplam.set(baslik, { toplam: o.toplam + puan, adet: o.adet + 1 });
        });

        const tav = alan(k, "tavsiyePuani", "TavsiyePuani");
        if (typeof tav === "number") {
          tavsiyeToplam += tav;
          tavsiyeAdet++;
        }

        const tek = alan(k, "tekrarCalisir", "TekrarCalisir");
        if (typeof tek === "boolean") {
          tekrarAdet++;
          if (tek) tekrarEvet++;
        }
      } catch {
        /* bozuk kayıt atlanır */
      }
    });

    return {
      adet: liste.length,
      nedenler: [...nedenSayaci.entries()]
        .map(([ad, sayi]) => ({
          ad,
          sayi,
          /* Bu başlığa toplanan özgün ifadeler, çoktan aza */
          ayrinti: [...(nedenAyrinti.get(ad) ?? new Map()).entries()]
            .map(([metin, adet]) => ({ metin, adet }))
            .sort((a, b) => b.adet - a.adet),
        }))
        .sort((a, b) => b.sayi - a.sayi),
      subeler: [...subeSayaci.entries()]
        .map(([ad, sayi]) => ({ ad, sayi }))
        .sort((a, b) => b.sayi - a.sayi),
      puanlar: [...puanToplam.entries()]
        .map(([ad, o]) => ({ ad, ort: o.toplam / o.adet, adet: o.adet }))
        .sort((a, b) => a.ort - b.ort),
      tavsiyeOrt: tavsiyeAdet > 0 ? tavsiyeToplam / tavsiyeAdet : null,
      tekrarOrani: tekrarAdet > 0 ? (tekrarEvet / tekrarAdet) * 100 : null,
    };
  }, [liste]);

  const cevaplanan = useMemo(
    () => sorular.filter((s) => s.cevap.trim().length > 0).length,
    [sorular]
  );

  /* ==================================================================== */

  return (
    <div>
      {/* ------------------------------------------------------------ başlık */}
      <div className="cmp-ust">
        <div>
          <h2>
            <i>
              <LogOut size={17} strokeWidth={2.2} />
            </i>
            Çıkış Mülakatı
          </h2>
          <p>
            İşten ayrılan personelle yapılan görüşmeler ve çıkış anketleri. Her kayıt yapay zekâyla
            özetlenip ayrılma nedenine göre gruplanır; sorular Yönetim → Form Ayarları'ndaki havuzdan seçilir.
          </p>
        </div>

        <div className="cmp-sekmeler" role="tablist">
          {[
            { label: "Mülakatlar", value: "liste" },
            /* Rol yetkilerinde gizlenmişse sekme hiç çıkmaz */
            ...(sekmeGizli(oturumOku(), "cikismulakat.yeni") ? [] : [{ label: "Yeni mülakat", value: "yeni" }]),
            ...(sekmeGizli(oturumOku(), "cikismulakat.anket") ? [] : [{ label: "Anket gönder", value: "anket" }]),
            ...(tamYonetim(oturumOku()) ? [{ label: "Çizelgeden aktar", value: "aktarim" }] : []),
          ].map((x) => (
            <button
              key={x.value}
              role="tab"
              aria-selected={sekme === x.value}
              className={sekme === x.value ? "acik" : ""}
              onClick={() => setSekme(x.value as any)}
            >
              {x.label}
            </button>
          ))}
        </div>
      </div>

      {sekme === "aktarim" ? (
        /* ------------------------------------ çizelgeden aktarım */
        <Card size="small" title="Eski Çıkış Mülakatlarını Aktar">
          <Paragraph type="secondary" style={{ fontSize: 12.5 }}>
            Çıkış mülakatı çizelgenizi Excel'de <b>Farklı Kaydet → CSV</b>
            ile kaydedip yükleyin. Sütunlar başlık adına göre bulunur:
            DÖNEM, AD SOYAD, ŞUBE, GÖREV, İŞE GİRİŞ TARİHİ, İŞTEN AYRILIŞ
            TARİHİ, ÇIKIŞ NEDENİ, YÖNETİCİ YORUMU, İK ÇIKIŞ NEDENİ, İK YORUM.
          </Paragraph>

          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 14 }}
            message="Eşleştirme ad ve şubeye göre yapılır"
            description="Çizelgede kimlik ya da sicil numarası yok. Eşleşmeyen kayıtlar da aktarılır; mülakat içeriği kişi bağlantısı olmasa da raporlarda görünür."
          />

          {/* --------------------------------------- aktarılmışlar */}
          {aktarimOzeti?.ozet?.adet > 0 && (
            <Card
              size="small"
              style={{ marginBottom: 14, background: "#fbfcfa" }}
              title={`Aktarılmış kayıtlar · ${aktarimOzeti.ozet.adet}`}
              extra={
                <Button size="small" danger onClick={() => geriAl()}>
                  Tümünü geri al
                </Button>
              }
            >
              <Text type="secondary" style={{ fontSize: 12.5 }}>
                {aktarimOzeti.ozet.enEski &&
                  `${dayjs(aktarimOzeti.ozet.enEski).format(
                    "DD.MM.YYYY"
                  )} – ${dayjs(aktarimOzeti.ozet.enYeni).format("DD.MM.YYYY")}`}
              </Text>

              <div style={{ marginTop: 10 }}>
                <Space size={[6, 6]} wrap>
                  {(aktarimOzeti.donemler ?? []).map((d: any) => (
                    <Tag
                      key={d.donem ?? "bos"}
                      closable
                      onClose={(e) => {
                        e.preventDefault();
                        geriAl(d.donem ?? "");
                      }}
                    >
                      {d.donem || "dönemsiz"} · {d.adet}
                    </Tag>
                  ))}
                </Space>
              </div>

              <Paragraph
                type="secondary"
                style={{ fontSize: 11.5, marginTop: 10, marginBottom: 0 }}
              >
                Dönem etiketindeki çarpıya basarak yalnızca o dönemi
                silebilirsiniz. Elle girilen ve anketten gelen mülakatlar
                etkilenmez.
              </Paragraph>
            </Card>
          )}

          <Space wrap style={{ marginBottom: 14 }}>
            <Button
              onClick={() => document.getElementById("mulakat-dosya")?.click()}
            >
              Dosya seç
            </Button>

            <input
              id="mulakat-dosya"
              type="file"
              accept=".csv,.txt,text/csv"
              style={{ display: "none" }}
              onChange={(e) => {
                const d = e.target.files?.[0];
                if (d) cizelgeOku(d);
                e.target.value = "";
              }}
            />

            {aktarSatirlar.length > 0 && (
              <>
                <Button
                  type="primary"
                  loading={aktariliyor}
                  onClick={cizelgeAktar}
                >
                  Aktar ({aktarSatirlar.filter((x) => !x.sorun).length})
                </Button>

                <Button onClick={() => setAktarSatirlar([])}>Temizle</Button>
              </>
            )}
          </Space>

          {aktarSatirlar.length > 0 && (
            <Tablo
              rowKey={(k: any, i?: number) => `${k.adSoyad}-${i}`}
              size="small"
              dataSource={aktarSatirlar}
              pagination={{ pageSize: 10, showSizeChanger: false }}
              scroll={{ x: 1100 }}
              rowClassName={(k: any) => (k.sorun ? "iz-sorunlu" : "")}
              columns={[
                { title: "Dönem", dataIndex: "donem", width: 90 },
                { title: "Ad Soyad", dataIndex: "adSoyad", width: 175 },
                { title: "Şube", dataIndex: "subeAdi", width: 130, ellipsis: true },
                { title: "Görev", dataIndex: "gorev", width: 150, ellipsis: true },
                {
                  title: "Çıkış",
                  dataIndex: "cikisTarihi",
                  width: 105,
                  render: (v: any) => (v ? v.format("DD.MM.YYYY") : "—"),
                },
                {
                  title: "Neden",
                  key: "neden",
                  width: 160,
                  render: (_v: any, k: any) => (
                    <span style={{ fontSize: 12.5 }}>
                      {k.ikCikisNedeni || k.cikisNedeni || "—"}
                    </span>
                  ),
                },
                {
                  title: "Yorum",
                  key: "yorum",
                  ellipsis: true,
                  render: (_v: any, k: any) => (
                    <Tooltip title={k.ikYorum || k.yoneticiYorumu}>
                      <span style={{ fontSize: 12.5 }}>
                        {k.ikYorum || k.yoneticiYorumu || "—"}
                      </span>
                    </Tooltip>
                  ),
                },
                {
                  title: "Durum",
                  dataIndex: "sorun",
                  width: 140,
                  render: (v: string | null) =>
                    v ? <Tag color="red">{v}</Tag> : <Tag color="green">hazır</Tag>,
                },
              ]}
            />
          )}
        </Card>
      ) : sekme === "anket" ? (
        /* ------------------------------------------------ anket gönderimi */
        <>
          <div className="cm-bilgi">
            Seçtiğiniz ayda ayrılan personele SMS ile anket gönderilir. Her
            bağlantı kişiye özeldir ve bir kez kullanılır. Sorular Yönetim →
            Çıkış Mülakatı ekranındaki havuzdan gelir.
            {dolduranSayisi > 0 && !dolduranGoster && (
              <>
                {" "}
                <b>{dolduranSayisi} kişi anketi doldurdu</b> ve listede
                gösterilmiyor; yanıtları Mülakatlar sekmesinde.
              </>
            )}
            {anketElenen > 0 && (
              <>
                {" "}
                <b>{anketElenen} kişi listeye alınmadı:</b> çıkış sebebi
                usulsüzlük, hırsızlık ya da disiplin kaynaklı olanlara anket
                gönderilmez.
              </>
            )}
          </div>

          <Card size="small" style={{ marginBottom: 12 }}>
            <Space wrap>
              <Select
                style={{ width: 100 }}
                value={anketYil}
                onChange={setAnketYil}
                options={[0, 1].map((i) => {
                  const y = new Date().getFullYear() - i;
                  return { value: y, label: String(y) };
                })}
              />

              <Select
                style={{ width: 150 }}
                value={anketAy}
                onChange={setAnketAy}
                options={[
                  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
                  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
                ].map((a, i) => ({ value: i + 1, label: `${i + 1} - ${a}` }))}
              />

              <Button loading={anketYukleniyor} onClick={anketGetir}>
                Listele
              </Button>

              {gonderebilir && (
                <Button
                  type="primary"
                  disabled={secililer.length === 0}
                  loading={topluGonderiliyor}
                  onClick={topluGonder}
                >
                  Seçilenlere gönder ({secililer.length})
                </Button>
              )}

              {dolduranSayisi > 0 && (
                <Button
                  type={dolduranGoster ? "default" : "text"}
                  onClick={() => setDolduranGoster(!dolduranGoster)}
                >
                  {dolduranGoster
                    ? "Dolduranları gizle"
                    : `Dolduranları göster (${dolduranSayisi})`}
                </Button>
              )}
            </Space>

            {!gonderebilir && (
              <div style={{ marginTop: 10 }}>
                <Text type="secondary" style={{ fontSize: 12.5 }}>
                  Anket gönderme yetkisi yöneticidedir. Listeyi ve durumları
                  görebilirsiniz.
                </Text>
              </div>
            )}
          </Card>

          <Card size="small" style={{ marginBottom: 12 }}>
            <Tablo
              rowKey={(k: any) => k.personelKodu ?? k.adSoyad}
              size="small"
              loading={anketYukleniyor}
              dataSource={anketGorunen}
              pagination={false}
              locale={{ emptyText: "Bu ayda ayrılan personel bulunamadı." }}
              rowSelection={
                gonderebilir
                  ? {
                      selectedRowKeys: secililer,
                      onChange: setSecililer,
                      /* Telefonu olmayan ve zaten doldurmuş olanlar
                         seçilemez: gönderim başarısız olur ya da
                         gereksiz tekrar olurdu. */
                      getCheckboxProps: (k: any) => ({
                        disabled: !k.telefon || !!k.dolduruldu,
                      }),
                    }
                  : undefined
              }
              columns={[
                {
                  title: "Personel",
                  dataIndex: "adSoyad",
                  width: 210,
                  render: (v: string, k: any) => (
                    <div>
                      <b><PersonelAdi kod={k.personelKodu}>{v}</PersonelAdi></b>
                      <div>
                        <Text
                          type="secondary"
                          style={{
                            fontSize: 12,
                            color: k.telefon ? undefined : "#e8481c",
                          }}
                        >
                          {k.telefon || "telefon kayıtlı değil"}
                        </Text>
                      </div>
                    </div>
                  ),
                },
                {
                  title: "Görev",
                  dataIndex: "gorev",
                  width: 160,
                  ellipsis: true,
                  render: (v: string) => (v ? <Tag color="green">{v}</Tag> : "—"),
                },
                { title: "Şube", dataIndex: "subeAdi", width: 140, ellipsis: true },
                {
                  title: "Çıkış",
                  dataIndex: "cikisTarihi",
                  width: 105,
                  render: (v: string) => (v ? dayjs(v).format("DD.MM.YYYY") : "—"),
                },
                {
                  title: "Durum",
                  key: "durum",
                  width: 165,
                  render: (_v: any, k: any) => {
                    if (k.dolduruldu)
                      return (
                        <Tooltip
                          title={`Yanıt: ${dayjs(k.dolduruldu).format(
                            "DD.MM.YYYY HH:mm"
                          )}`}
                        >
                          <Tag color="green">dolduruldu</Tag>
                        </Tooltip>
                      );

                    if (k.gonderim) {
                      /* Bekleme süresi: bir günden kısaysa saat, uzunsa gün.
                         "0 gün" demek yerine "3 saat" demek, hangi davetin
                         gerçekten yanıtsız kaldığını ayırt ettiriyor. */
                      const saat = dayjs().diff(dayjs(k.gonderim), "hour");
                      const gun = Math.floor(saat / 24);

                      const sure =
                        saat < 1 ? "az önce"
                        : saat < 24 ? `${saat} saat`
                        : `${gun} gün`;

                      /* Üç günden uzun süredir yanıt yoksa dikkat çeker */
                      const gecikti = gun >= 3;

                      return (
                        <Tooltip
                          title={`Gönderim: ${dayjs(k.gonderim).format(
                            "DD.MM.YYYY HH:mm"
                          )} · henüz yanıt yok`}
                        >
                          <Tag color={gecikti ? "orange" : "blue"}>
                            {gecikti ? "yanıt yok · " : "gönderildi · "}
                            {sure}
                          </Tag>
                        </Tooltip>
                      );
                    }

                    if (k.mulakatVar)
                      return (
                        <Tooltip title="Yüz yüze mülakatı yapılmış; anket göndermeye gerek yok.">
                          <Tag>mülakat yapıldı</Tag>
                        </Tooltip>
                      );

                    return <Text type="secondary">gönderilmedi</Text>;
                  },
                },
                {
                  title: "",
                  key: "islem",
                  width: 130,
                  align: "right" as const,
                  render: (_v: any, k: any) =>
                    !gonderebilir ? (
                      <Text type="secondary">—</Text>
                    ) : !k.telefon ? (
                      <Tooltip title="Telefon numarası yok; aşağıdaki elle gönderim bölümünü kullanın.">
                        <Button size="small" disabled>
                          Gönderilemez
                        </Button>
                      </Tooltip>
                    ) : k.dolduruldu ? (
                      <Text type="secondary" style={{ fontSize: 12.5 }}>
                        yanıtlandı
                      </Text>
                    ) : (
                      <Button
                        size="small"
                        type={k.gonderim ? "default" : "primary"}
                        loading={gonderiliyor === k.personelKodu}
                        onClick={() => anketGonder(k, k.personelKodu)}
                      >
                        {k.gonderim ? "Tekrar gönder" : "Anket gönder"}
                      </Button>
                    ),
                },
              ]}
            />
          </Card>

          {/* --------------------------------------------- elle gönderim */}
          {gonderebilir && (
          <Card size="small" title="Elle gönderim">
            <Paragraph type="secondary" style={{ fontSize: 12.5 }}>
              Listede olmayan biri ya da telefonu kayıtlı olmayan personel
              için. Ankette kişiye kimlik ve şube sorulmaz; buradaki
              bilgiler raporlamada kullanılır, boş bırakılırsa yanıt yine
              kaydedilir ama şube kırılımına giremez.
            </Paragraph>

            <Row gutter={[10, 10]}>
              <Col xs={24} md={7}>
                <Input
                  placeholder="Adı Soyadı"
                  value={elleAd}
                  onChange={(e) => setElleAd(e.target.value)}
                />
              </Col>
              <Col xs={12} md={6}>
                <Input
                  placeholder="5xxxxxxxxx"
                  value={elleTel}
                  onChange={(e) => setElleTel(e.target.value)}
                />
              </Col>
              <Col xs={12} md={5}>
                <Input
                  placeholder="T.C. Kimlik (isteğe bağlı)"
                  maxLength={11}
                  value={elleTc}
                  onChange={(e) => setElleTc(e.target.value)}
                />
              </Col>
              <Col xs={12} md={5}>
                <Input
                  placeholder="Son çalıştığı şube"
                  value={elleSube}
                  onChange={(e) => setElleSube(e.target.value)}
                />
              </Col>
              <Col xs={24} md={4}>
                <Button
                  type="primary"
                  block
                  loading={gonderiliyor === "elle"}
                  onClick={elleGonder}
                >
                  Anket gönder
                </Button>
              </Col>
            </Row>
          </Card>
          )}
        </>
      ) : sekme === "yeni" ? (
        secilen ? (
          /* ------------------------------------------------ mülakat formu */
          <Card size="small">
            <div className="cm-kisi">
              <Avatar
                size={46}
                src={
                  secilen.resimVar
                    ? api.resimAdresi(secilen.personelKodu, secilen.resimSurumu)
                    : undefined
                }
                style={{
                  background: "var(--yesil-acik)",
                  color: "var(--yesil-koyu)",
                  fontSize: 15,
                  fontWeight: 700,
                  flex: "0 0 auto",
                }}
              >
                {secilen.adSoyad
                  .split(" ")
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((x) => x[0])
                  .join("")}
              </Avatar>

              <div className="cm-kisi-govde">
                <p className="cm-kisi-ad"><PersonelAdi kod={secilen.personelKodu}>{secilen.adSoyad}</PersonelAdi></p>
                <Space size={6} wrap style={{ marginBottom: 5 }}>
                  {secilen.gorev && <Tag color="green">{secilen.gorev}</Tag>}
                  {secilen.subeAdi && <Tag>{secilen.subeAdi}</Tag>}
                </Space>
                <div className="cm-kisi-meta">
                  {secilen.telefon && <span>{secilen.telefon}</span>}
                  <span>
                    Giriş{" "}
                    {secilen.girisTarihi
                      ? dayjs(secilen.girisTarihi).format("DD.MM.YYYY")
                      : "—"}
                  </span>
                  <span>
                    Çıkış{" "}
                    {secilen.cikisTarihi
                      ? dayjs(secilen.cikisTarihi).format("DD.MM.YYYY")
                      : "—"}
                  </span>
                </div>
              </div>

              <div className="cm-kisi-islem">
                <span
                  className={
                    cevaplanan > 0 ? "cm-ilerleme cm-basladi" : "cm-ilerleme"
                  }
                >
                  {cevaplanan} / {sorular.length} cevap
                </span>
                <Button
                  icon={<RefreshCw size={14} strokeWidth={2} />}
                  onClick={() => sorulariYenile(sorular)}
                >
                  Soruları değiştir
                </Button>
                <Button onClick={() => setSecilen(null)}>Vazgeç</Button>
              </div>
            </div>

            <div className="cm-bilgi">
              <b>Cevapladığınız sorular korunur.</b> "Soruları değiştir"
              dediğinizde yalnızca boş bıraktığınız sorular havuzdan yenileriyle
              değişir.
            </div>

            {sorular.map((s, i) => (
              <div
                key={s.soru}
                className={s.cevap.trim() ? "cm-soru cm-cevapli" : "cm-soru"}
              >
                <div className="cm-soru-ust">
                  <span className="cm-soru-no">{i + 1}</span>
                  <span className="cm-soru-metin">{s.soru}</span>
                </div>

                <TextArea
                  autoSize={{ minRows: 2, maxRows: 8 }}
                  value={s.cevap}
                  onChange={(e) => {
                    const yeni = [...sorular];
                    yeni[i] = { ...yeni[i], cevap: e.target.value };
                    setSorular(yeni);
                  }}
                  placeholder="Personelin cevabı..."
                  maxLength={2000}
                />
              </div>
            ))}

            {puanBasliklari.length > 0 && (
              <div className="cm-puan-kart">
                <p className="cm-puan-baslik">Değerlendirme</p>
                <p className="cm-puan-aciklama">
                  1 = çok kötü, 5 = çok iyi. Bu başlıklar her mülakatta sorulur;
                  şubeler ve dönemler arası karşılaştırma buradan çıkar.
                </p>

                {puanBasliklari.map((baslik) => (
                  <div className="cm-puan-satir" key={baslik}>
                    <label className="cm-puan-etiket">{baslik}</label>

                    <div className="cm-olcek">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          type="button"
                          /* Seçili düşük puanlar turuncu: sorun sinyali
                             yeşille aynı görünmemeli. */
                          className={n <= 2 ? "cm-dusuk" : undefined}
                          aria-pressed={puanlar[baslik] === n}
                          aria-label={`${baslik}: ${n}`}
                          onClick={() =>
                            setPuanlar({
                              ...puanlar,
                              [baslik]: puanlar[baslik] === n ? 0 : n,
                            })
                          }
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="cm-puan-kart">
              <div className="cm-puan-satir">
                <label className="cm-puan-etiket">
                  Aynı şartlarda tekrar çalışmak ister miydiniz?
                </label>

                <div className="cm-olcek">
                  <button
                    type="button"
                    style={{ width: 62 }}
                    aria-pressed={tekrarCalisir === true}
                    onClick={() =>
                      setTekrarCalisir(tekrarCalisir === true ? undefined : true)
                    }
                  >
                    Evet
                  </button>
                  <button
                    type="button"
                    className="cm-dusuk"
                    style={{ width: 62 }}
                    aria-pressed={tekrarCalisir === false}
                    onClick={() =>
                      setTekrarCalisir(tekrarCalisir === false ? undefined : false)
                    }
                  >
                    Hayır
                  </button>
                </div>
              </div>

              <div className="cm-puan-satir">
                <label className="cm-puan-etiket">
                  Bir tanıdığınıza burada çalışmayı önerir miydiniz?
                  <span className="cm-olcek-uc"> · 0 hiç önermem, 10 kesinlikle</span>
                </label>

                <div className="cm-olcek cm-olcek-genis">
                  {Array.from({ length: 11 }, (_, n) => (
                    <button
                      key={n}
                      type="button"
                      className={n <= 6 ? "cm-dusuk" : undefined}
                      aria-pressed={tavsiye === n}
                      aria-label={`Tavsiye: ${n}`}
                      onClick={() => setTavsiye(tavsiye === n ? undefined : n)}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <Row gutter={[12, 12]} style={{ marginTop: 18 }}>
              <Col xs={24} md={10}>
                <Text strong style={{ fontSize: 13.5 }}>
                  Çıkış nedeni
                </Text>
                <Select
                  showSearch
                  allowClear
                  style={{ width: "100%", marginTop: 6 }}
                  placeholder="Seçiniz"
                  value={neden}
                  onChange={setNeden}
                  options={(() => {
                    /* Mikro'daki sebep ayar listesinde yoksa da seçili
                       görünebilsin: listeye o değer de eklenir */
                    const liste = [...nedenler];
                    if (neden && !liste.includes(neden)) liste.unshift(neden);
                    return liste.map((x) => ({ value: x, label: x }));
                  })()}
                />

                {secilen?.cikisSebebi && (
                  <div style={{ marginTop: 4 }}>
                    <Text type="secondary" style={{ fontSize: 11.5 }}>
                      {neden === secilen.cikisSebebi
                        ? "Mikro'daki çıkış sebebinden geldi; gerekirse değiştirin."
                        : `Mikro'daki kayıt: ${secilen.cikisSebebi}`}
                    </Text>
                  </div>
                )}

                <Text strong style={{ fontSize: 13.5, display: "block", marginTop: 12 }}>
                  Nedenin açıklaması
                </Text>
                <TextArea
                  rows={3}
                  style={{ marginTop: 6 }}
                  value={nedenAciklama}
                  onChange={(e) => setNedenAciklama(e.target.value)}
                  placeholder="Görüşmede öğrenilen asıl sebep, ayrıntı"
                  maxLength={2000}
                />
              </Col>

              <Col xs={24} md={14}>
                <Text strong style={{ fontSize: 13.5 }}>
                  Değerlendirenin notu
                </Text>
                <TextArea
                  rows={3}
                  style={{ marginTop: 6 }}
                  value={yorum}
                  onChange={(e) => setYorum(e.target.value)}
                  placeholder="Kendi gözlem ve değerlendirmeniz..."
                  maxLength={4000}
                />
              </Col>
            </Row>

            <div style={{ textAlign: "right", marginTop: 16 }}>
              <Button
                type="primary"
                icon={<Save size={15} strokeWidth={2} />}
                loading={kaydediliyor}
                onClick={kaydet}
              >
                Mülakatı kaydet
              </Button>
            </div>
          </Card>
        ) : (
          /* ------------------------------------------------ personel seçimi */
          <Card size="small">
            <Space style={{ marginBottom: 12 }} wrap>
              <Input
                allowClear
                prefix={<Search size={14} strokeWidth={2} />}
                placeholder="Ad, soyad veya personel kodu"
                style={{ width: 280 }}
                value={ayrilanArama}
                onChange={(e) => setAyrilanArama(e.target.value)}
                onPressEnter={ayrilanGetir}
              />
              <Button loading={ayrilanYukleniyor} onClick={ayrilanGetir}>
                Ara
              </Button>
            </Space>

            <Tablo
              className="cm-secim-tablo"
              rowKey="personelKodu"
              size="small"
              loading={ayrilanYukleniyor}
              dataSource={ayrilanlar}
              locale={{ emptyText: "Ayrılan personel bulunamadı." }}
              columns={[
                {
                  title: "Personel",
                  dataIndex: "adSoyad",
                  width: 250,
                  render: (v: string, k: Ayrilan) => (
                    <Space size={10}>
                      <Avatar
                        size={36}
                        src={
                          k.resimVar
                            ? api.resimAdresi(k.personelKodu, k.resimSurumu)
                            : undefined
                        }
                        style={{
                          background: "var(--yesil-acik)",
                          color: "var(--yesil-koyu)",
                          fontSize: 12.5,
                          fontWeight: 700,
                          flex: "0 0 auto",
                        }}
                      >
                        {v
                          .split(" ")
                          .filter(Boolean)
                          .slice(0, 2)
                          .map((x) => x[0])
                          .join("")}
                      </Avatar>
                      <span>
                        <div style={{ fontWeight: 600 }}><PersonelAdi kod={k.personelKodu}>{v}</PersonelAdi></div>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {k.telefon || "telefon yok"}
                        </Text>
                      </span>
                    </Space>
                  ),
                },
                {
                  title: "Görev",
                  dataIndex: "gorev",
                  width: 160,
                  ellipsis: true,
                  render: (v: string) =>
                    v ? <Tag color="green">{v}</Tag> : "—",
                },
                { title: "Şube", dataIndex: "subeAdi", width: 150, ellipsis: true },
                {
                  title: "Çıkış",
                  dataIndex: "cikisTarihi",
                  width: 110,
                  render: (v: string) =>
                    v ? dayjs(v).format("DD.MM.YYYY") : "—",
                },
                {
                  title: "",
                  key: "islem",
                  width: 170,
                  align: "right" as const,
                  render: (_v: any, k: Ayrilan) => (
                    <Space size={6}>
                      {k.mulakatVar && <Tag color="green">yapıldı</Tag>}
                      <Button
                        type="primary"
                        size="small"
                        icon={<MessageSquareText size={13} strokeWidth={2} />}
                        onClick={() => personelSec(k)}
                      >
                        Mülakat yap
                      </Button>
                    </Space>
                  ),
                },
              ]}
            />
          </Card>
        )
      ) : (
        /* ---------------------------------------------------------- liste */
        <CikisMulakatPanosu
          liste={liste}
          yukleniyor={listeYukleniyor}
          aralik={aralik}
          setAralik={setAralik}
          yenile={listeGetir}
          grupBul={kayitGrubu}
          eksik={eksikOzetler}
          eksikIsleniyor={eksikUretiliyor}
          eksikTamamla={() => eksikleriUret()}
          ozet={ozet}
          ozetAliniyor={ozetAliniyor}
          ozetAl={ozetAl}
          ozetKapat={() => setOzet(null)}
          seciliIdler={seciliIdler}
          setSeciliIdler={setSeciliIdler}
          detayAc={setDetay}
          sil={sil}
          subeDetay={subeDetay}
          subeYukleniyor={subeYukleniyor}
          subeOzetleniyor={subeOzetleniyor}
          subeAc={subeAc}
          subeKapat={() => setSubeDetay(null)}
        />
      )}

      {/* --------------------------------------------------- mülakat detayı */}
      {/* ------------------------------------- çıkış nedeni grubu listesi */}
      <Drawer
        open={!!nedenGrup}
        onClose={() => setNedenGrup(null)}
        width="min(620px, 96vw)"
        title={
          nedenGrup && (
            <Space size={8} wrap>
              <Text strong>{nedenGrup}</Text>
              <Tag color="orange">
                {liste.filter((m) => kayitGrubu(m) === nedenGrup).length} mülakat
              </Tag>
            </Space>
          )
        }
      >
        <Text type="secondary" style={{ fontSize: 12.5 }}>
          Bu başlığa toplanan mülakatlar. Satıra tıklayınca mülakatın tamamı
          açılır.
        </Text>

        <div style={{ marginTop: 14 }}>
          {liste
            .filter(
              (m) => kayitGrubu(m) === nedenGrup
            )
            .map((m) => (
              <Card
                key={m.id}
                size="small"
                hoverable
                style={{ marginBottom: 8 }}
                onClick={() => {
                  setNedenGrup(null);
                  setDetay(m);
                }}
              >
                <Space
                  align="start"
                  style={{ width: "100%", justifyContent: "space-between" }}
                >
                  <div>
                    <Text strong><PersonelAdi kod={m.personelKodu}>{m.adSoyad}</PersonelAdi></Text>
                    <div>
                      <Text type="secondary" style={{ fontSize: 12.5 }}>
                        {[m.gorev, m.subeAdi].filter(Boolean).join(" · ")}
                      </Text>
                    </div>

                    {/* Kişinin kendi ifadesi: grup başlığı bunu gizlemesin */}
                    {m.cikisNedeni && (
                      <div style={{ marginTop: 5 }}>
                        <Text style={{ fontSize: 13 }}>{m.cikisNedeni}</Text>
                      </div>
                    )}
                  </div>

                  <Text type="secondary" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                    {m.cikisTarihi
                      ? dayjs(m.cikisTarihi).format("DD.MM.YYYY")
                      : ""}
                  </Text>
                </Space>
              </Card>
            ))}
        </div>
      </Drawer>

      <Drawer
        open={!!detay}
        onClose={() => setDetay(null)}
        width="min(680px, 96vw)"
        title={
          detay && (
            <Space size={8} wrap>
              <Text strong><PersonelAdi kod={detay.personelKodu}>{detay.adSoyad}</PersonelAdi></Text>
              <Tag color="orange">{kayitGrubu(detay)}</Tag>
              <Tag>{kaynakAdi(detay)}</Tag>
            </Space>
          )
        }
      >
        {detay && (
          <>
            <Text type="secondary" style={{ fontSize: 12.5 }}>
              {detay.subeAdi} · {detay.gorev} · Görüşen: {detay.uzmanAdi} ·{" "}
              {dayjs(detay.olusturma).format("DD.MM.YYYY HH:mm")}
            </Text>

            {/* Ayrılma nedeninin grubu: yapay zekâ seçiyor, yanlışsa
                buradan düzeltiliyor; rapor bu gruba göre sayıyor */}
            <div className="cmp-ust" style={{ display: "block", margin: 0 }}>
              <div className="cmp-grupSec">
                <small>Ayrılma nedeni grubu</small>
                <Space size={8} wrap>
                  <Select
                    size="small"
                    style={{ minWidth: 250 }}
                    value={kayitGrubu(detay)}
                    options={GRUP_LISTESI.map((g) => ({ value: g, label: g }))}
                    onChange={async (g: string) => {
                      try {
                        await api.gonder(`/api/CikisMulakat/${detay.id}/NedenGrubu`, { grup: g });
                        setDetay({ ...detay, nedenGrubu: g });
                        setListe((l) => l.map((m) => (m.id === detay.id ? { ...m, nedenGrubu: g } : m)));
                        message.success("Neden grubu güncellendi.");
                      } catch (hata: any) {
                        message.error(hata.message);
                      }
                    }}
                  />
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {detay.nedenGrubu ? "Yapay zekâ seçti · yanlışsa değiştirin" : "Henüz sınıflandırılmadı"}
                  </Text>
                </Space>
                {detay.cikisNedeni && <div className="ham">Personelin ifadesi: "{detay.cikisNedeni}"</div>}
              </div>
            </div>

            {detay.cikisNedeniAciklama && (
              <div className="cm-neden-aciklama">
                <Text strong style={{ fontSize: 12.5 }}>
                  Nedenin açıklaması
                </Text>
                <div style={{ fontSize: 13, marginTop: 3, whiteSpace: "pre-wrap" }}>
                  {detay.cikisNedeniAciklama}
                </div>
              </div>
            )}

            <div style={{ marginTop: 16 }}>
              {(() => {
                try {
                  const ham = JSON.parse(detay.sorularJson || "{}");

                  /* Kayıtlar üç ayrı biçimde yazılmış olabilir: düz dizi
                     (ilk sürüm), PascalCase alanlar (Cevap/Baslik) ve
                     bugünkü camelCase. Eski kayıtları yeniden girmek
                     gerekmesin diye üçü de okunur. */
                  const al = (n: any, ...adlar: string[]) => {
                    for (const a of adlar) if (n?.[a] != null) return n[a];
                    return undefined;
                  };

                  const k = Array.isArray(ham) ? { sorular: ham } : ham;

                  const sorular: any[] = al(k, "sorular", "Sorular") ?? [];
                  const puanlar: any[] = al(k, "puanlar", "Puanlar") ?? [];
                  const telefon = al(k, "telefon", "Telefon");
                  const tekrar = al(k, "tekrarCalisir", "TekrarCalisir");
                  const tavsiye = al(k, "tavsiyePuani", "TavsiyePuani");

                  const dolu = sorular.filter((x) =>
                    String(al(x, "cevap", "Cevap") ?? "").trim()
                  );

                  return (
                    <>
                      {telefon && (
                        <div style={{ marginBottom: 12 }}>
                          <Tag>{telefon}</Tag>
                        </div>
                      )}

                      {detay.ozet && (
                        <div className="cm-detay-kart">
                          <div className="cm-detay-baslik cm-koyu">Özet</div>
                          <div style={{ padding: "12px 14px", fontSize: 13 }}>
                            {detay.ozet}
                          </div>
                        </div>
                      )}

                      <div className="cm-detay-kart">
                        <div className="cm-detay-baslik">Sorular ve cevaplar</div>
                        <div className="cm-detay-govde">
                          {dolu.length === 0 ? (
                            <div style={{ padding: 14 }}>
                              <Empty description="Cevap bulunmuyor." />
                            </div>
                          ) : (
                            dolu.map((x, i) => (
                              <div className="cm-detay-soru" key={i}>
                                <p>{al(x, "soru", "Soru")}</p>
                                <div>{al(x, "cevap", "Cevap")}</div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>

                      {puanlar.length > 0 && (
                        <div className="cm-detay-kart">
                          <div className="cm-detay-baslik">Değerlendirme</div>
                          <div className="cm-detay-govde">
                            {puanlar.map((p: any, i: number) => {
                              const puan = Number(al(p, "puan", "Puan") ?? 0);

                              return (
                                <div className="cm-detay-puan" key={i}>
                                  <span>{al(p, "baslik", "Baslik")}</span>

                                  {/* Çubuk, sayıyı okumadan da farkı
                                      göstersin: yedi satırı tarayan göz
                                      düşük olanı hemen bulur. */}
                                  <span className="cm-detay-cubuk">
                                    <i
                                      className={puan < 3 ? "cm-dusuk-dolgu" : undefined}
                                      style={{ width: `${(puan / 5) * 100}%` }}
                                    />
                                  </span>

                                  <span
                                    className="cm-detay-deger"
                                    style={{
                                      color:
                                        puan < 3
                                          ? "var(--turuncu)"
                                          : "var(--yesil-koyu)",
                                    }}
                                  >
                                    {puan} / 5
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {(typeof tekrar === "boolean" ||
                        typeof tavsiye === "number") && (
                        <div className="cm-detay-kart">
                          <div className="cm-detay-baslik cm-turuncu">
                            Bağlılık göstergeleri
                          </div>
                          <div className="cm-detay-govde">
                            {typeof tekrar === "boolean" && (
                              <div className="cm-detay-puan">
                                <span>Aynı şartlarda tekrar çalışır mıydı?</span>
                                <span
                                  className="cm-detay-deger"
                                  style={{
                                    width: 60,
                                    color: tekrar
                                      ? "var(--yesil-koyu)"
                                      : "var(--turuncu)",
                                  }}
                                >
                                  {tekrar ? "Evet" : "Hayır"}
                                </span>
                              </div>
                            )}

                            {typeof tavsiye === "number" && (
                              <div className="cm-detay-puan">
                                <span>Bir tanıdığına önerir miydi?</span>
                                <span className="cm-detay-cubuk">
                                  <i
                                    className={
                                      tavsiye < 7 ? "cm-dusuk-dolgu" : undefined
                                    }
                                    style={{ width: `${(tavsiye / 10) * 100}%` }}
                                  />
                                </span>
                                <span
                                  className="cm-detay-deger"
                                  style={{
                                    color:
                                      tavsiye < 7
                                        ? "var(--turuncu)"
                                        : "var(--yesil-koyu)",
                                  }}
                                >
                                  {tavsiye} / 10
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </>
                  );
                } catch {
                  return <Empty description="Kayıt okunamadı." />;
                }
              })()}
            </div>

            {detay.uzmanYorumu && (
              <div className="cm-detay-kart">
                <div className="cm-detay-baslik cm-koyu">
                  Değerlendirenin notu
                </div>
                <div
                  style={{
                    padding: "12px 14px",
                    fontSize: 13,
                    lineHeight: 1.6,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {detay.uzmanYorumu}
                </div>
              </div>
            )}
          </>
        )}
      </Drawer>
    </div>
  );
}
