/**
 * Biçen Kart › Kart raporları
 * ---------------------------------------------------------------------------
 * Personel kartlarının toplu görünümü. Her alan tıklanabilir:
 *
 *  - Üstteki kutular ilgili kart listesini açar (bakiyeli kartlar, dönemde
 *    harcama yapanlar, hiç harcamayanlar, süresi yaklaşanlar…).
 *  - Aylık grafikte bir aya tıklanınca o ayın kart bazlı dökümü açılır.
 *  - Şube satırına tıklanınca o şubede kartla alışveriş yapanlar açılır.
 *  - Herhangi bir kart satırına tıklanınca kartın ayrıntısı (hareketler,
 *    şubelere göre harcama, panelden yapılan puan işlemleri) açılır.
 *
 * Bakiye Posback'in kendi hesabıyla (dbo.PuanBakiye), Posback ekranıyla
 * aynı. Veriler BicenKartRaporController'dan tek istekte geliyor.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Drawer, Input, Table, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { ChevronRight, Download, RefreshCw, Search } from "lucide-react";

import { api } from "./api";
import { tabloIndir, type TabloSutunu } from "./raporExcel";
import { PersonelAdi } from "./personelKarti";

/* -------------------------------------------------------------------------- */

export interface RaporKart {
  kartNo: string;
  sicil: string | null;
  adSoyad: string | null;
  sube: string | null;
  aktif?: boolean;
}

interface Kart extends RaporKart {
  /** TC kimlik no; Excel çıktısında sicil yerine. Rol yetkisinde gizliyse maskeli. */
  tc?: string | null;
  aktif: boolean;
  bakiye: number;
  dolacak: number;
  dolacakTarih: string | null;
  sonHarcama: string | null;
  toplamHarcama: number;
  donemHarcama: number;
  donemHarcamaAdet: number;
  sonYukleme: string | null;
  toplamYukleme: number;
  donemYukleme: number;
  donemSilme: number;
}

interface Rapor {
  gun: number;
  olusturma: string;
  kartlar: Kart[];
  subeler: { subeId: string; subeAdi: string; tutar: number; adet: number; kart: number; son: string | null; pay: number }[];
  aylik: {
    ay: string;
    yukleme: number;
    kazanma: number;
    harcama: number;
    harcamaAdet: number;
    iade: number;
    devir: number;
    silme: number;
  }[];
  sonYuklemeler: {
    tarih: string;
    kartNo: string;
    adSoyad: string | null;
    sicil: string | null;
    sube: string | null;
    tutar: number;
    sonKullanim: string | null;
    tur: string;
  }[];
}

type ListeTuru = "bakiye" | "harcayan" | "yuklenen" | "harcamayan" | "dolacak" | "ayrilan";

/* -------------------------------------------------------------------------- */

const tl = (d?: number | null) =>
  (d ?? 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₺";

const tlKisa = (d?: number | null) => {
  const n = d ?? 0;
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toLocaleString("tr-TR", { maximumFractionDigits: 1 }) + " mn ₺";
  if (Math.abs(n) >= 10_000) return (n / 1_000).toLocaleString("tr-TR", { maximumFractionDigits: 1 }) + " bin ₺";
  return n.toLocaleString("tr-TR", { maximumFractionDigits: 0 }) + " ₺";
};

const sayi = (d?: number | null) => (d ?? 0).toLocaleString("tr-TR");

const no4 = (d?: string | null) => (d ?? "").replace(/(.{4})/g, "$1 ").trim();

const tarih = (t?: string | null) => (t ? new Date(t).toLocaleDateString("tr-TR") : "—");

const tarihSaat = (t?: string | null) =>
  t
    ? new Date(t).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "—";

const AYLAR = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const ayAdi = (ay: string) => {
  const [y, m] = ay.split("-").map(Number);
  return `${AYLAR[m - 1]} ${String(y).slice(2)}`;
};
const ayUzun = (ay: string) => {
  const [y, m] = ay.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("tr-TR", { month: "long", year: "numeric" });
};

const gunOnce = (t?: string | null) => {
  if (!t) return null;
  return Math.floor((Date.now() - new Date(t).getTime()) / 86_400_000);
};

/** Ekseni yuvarlak bir üst değere taşır (1, 2, 2.5, 5 × 10^n) */
const yuvarlakUst = (v: number) => {
  if (v <= 0) return 1;
  const us = Math.pow(10, Math.floor(Math.log10(v)));
  for (const k of [1, 2, 2.5, 5, 10]) if (v <= k * us) return k * us;
  return 10 * us;
};

const YESIL = "#7cb518";
const TURUNCU = "#e8481c";

/* ========================================================================== */

export default function BicenKartRapor({ kartAc }: { kartAc: (k: RaporKart) => void }) {
  const [gun, setGun] = useState(90);
  const [veri, setVeri] = useState<Rapor | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [hata, setHata] = useState("");

  const [liste, setListe] = useState<ListeTuru | null>(null);
  const [ay, setAy] = useState<string | null>(null);
  const [sube, setSube] = useState<{ id: string; ad: string } | null>(null);
  const [tumSubeler, setTumSubeler] = useState(false);

  const getir = useCallback(async () => {
    setYukleniyor(true);
    setHata("");
    try {
      setVeri(await api.al<Rapor>(`/api/BicenKartRapor?gun=${gun}`));
    } catch (h: any) {
      setHata(h?.message ?? "Rapor alınamadı.");
    } finally {
      setYukleniyor(false);
    }
  }, [gun]);

  useEffect(() => {
    getir();
  }, [getir]);

  const k = veri?.kartlar ?? [];

  const hesap = useMemo(() => {
    const bakiyeli = k.filter((x) => x.bakiye > 0);
    const harcayan = k.filter((x) => x.donemHarcamaAdet > 0);
    const yuklenen = k.filter((x) => x.donemYukleme > 0);
    const harcamayan = bakiyeli.filter((x) => !x.sonHarcama);
    const dolacak = k.filter((x) => x.dolacak > 0);
    const ayrilan = bakiyeli.filter((x) => !x.aktif);
    const top = (l: Kart[], f: (x: Kart) => number) => l.reduce((t, x) => t + f(x), 0);

    return {
      bakiyeli,
      harcayan,
      yuklenen,
      harcamayan,
      dolacak,
      ayrilan,
      toplamBakiye: top(bakiyeli, (x) => x.bakiye),
      donemHarcama: top(k, (x) => x.donemHarcama),
      donemHarcamaAdet: top(k, (x) => x.donemHarcamaAdet),
      donemYukleme: top(k, (x) => x.donemYukleme),
      bekleyenHarcamayan: top(harcamayan, (x) => x.bakiye),
      dolacakTutar: top(dolacak, (x) => x.dolacak),
      ayrilanTutar: top(ayrilan, (x) => x.bakiye),
    };
  }, [k]);

  const kartTikla = (x: RaporKart) => kartAc({ kartNo: x.kartNo, sicil: x.sicil, adSoyad: x.adSoyad, sube: x.sube });

  const excel = async () => {
    if (!veri) return;
    try {
      await tabloIndir({
        baslik: "Biçen Kart · kart raporu",
        altBaslik: `Son ${gun} gün · ${new Date().toLocaleDateString("tr-TR")}`,
        sayfaAdi: "Kart raporu",
        dosyaAdi: `bicen-kart-rapor-${new Date().toISOString().slice(0, 10)}.xlsx`,
        sutunlar: [
          /* Sicil yerine TC kimlik no isteniyor */
          { ad: "TC Kimlik No", genislik: 14 },
          { ad: "Ad soyad", genislik: 26 },
          { ad: "Şube", genislik: 22 },
          { ad: "Durum", genislik: 11 },
          { ad: "Kart no", genislik: 22 },
          { ad: "Bakiye", tip: "para", genislik: 14 },
          { ad: `Harcama (${gun} gün)`, tip: "para", genislik: 16 },
          { ad: "Alışveriş", tip: "sayi", genislik: 10 },
          { ad: `Yükleme (${gun} gün)`, tip: "para", genislik: 16 },
          { ad: "Son harcama", tip: "tarih", genislik: 13 },
          { ad: "Son yükleme", tip: "tarih", genislik: 13 },
          { ad: "90 günde dolacak", tip: "para", genislik: 15 },
        ] as TabloSutunu[],
        satirlar: [...k]
          .sort((a, b) => b.bakiye - a.bakiye)
          .map((x) => [
            x.tc ?? "",
            x.adSoyad ?? "",
            x.sube ?? "",
            x.aktif ? "Çalışıyor" : "Ayrıldı",
            no4(x.kartNo),
            x.bakiye,
            x.donemHarcama,
            x.donemHarcamaAdet,
            x.donemYukleme,
            x.sonHarcama ?? "",
            x.sonYukleme ?? "",
            x.dolacak,
          ]),
        genelToplam: true,
      });
    } catch (h: any) {
      message.error(h?.message ?? "Excel oluşturulamadı.");
    }
  };

  /* ---------------------------------------------------------------- çizim */

  if (!veri && yukleniyor) return <div className="bk-panel bk-yukleniyor">Rapor hazırlanıyor…</div>;

  if (!veri && hata)
    return (
      <div className="bk-panel">
        <div className="bkp-hata" style={{ marginTop: 0 }}>
          {hata}
        </div>
        <button className="bk-d" style={{ marginTop: 10 }} onClick={getir}>
          Yeniden dene
        </button>
      </div>
    );

  if (!veri) return null;

  const subeListe = tumSubeler ? veri.subeler : veri.subeler.slice(0, 10);
  const subeEnCok = Math.max(1, ...veri.subeler.map((x) => x.tutar));

  return (
    <div className="bkr">
      {/* -------------------------------------------------------- araç çubuğu */}
      <div className="bkr-arac">
        <div className="bk-suzgec" style={{ margin: 0 }}>
          {[30, 90, 180, 365].map((g) => (
            <button key={g} className={`bk-cip ${gun === g ? "acik" : ""}`} onClick={() => setGun(g)}>
              {g === 365 ? "Son 1 yıl" : `Son ${g} gün`}
            </button>
          ))}
        </div>
        <div className="bkr-aracSag">
          <small>
            {sayi(k.length)} personel kartı · {tarihSaat(veri.olusturma)}
          </small>
          <button className="bk-d kucuk" onClick={getir} disabled={yukleniyor}>
            <RefreshCw size={14} className={yukleniyor ? "bk-donen" : undefined} /> Yenile
          </button>
          <button className="bk-d kucuk" onClick={excel}>
            <Download size={14} /> Excel'e aktar
          </button>
        </div>
      </div>

      {/* --------------------------------------------------------------- özet */}
      <div className="bkr-kpi">
        <button className="bk-kutu" onClick={() => setListe("bakiye")}>
          <small>Toplam bakiye</small>
          <div className="sayi" style={{ color: "var(--bk-yesilKoyu)" }}>
            {tlKisa(hesap.toplamBakiye)}
          </div>
          <div className="alt">
            {sayi(hesap.bakiyeli.length)} kartta · kart başı {tlKisa(hesap.bakiyeli.length ? hesap.toplamBakiye / hesap.bakiyeli.length : 0)}
          </div>
          <ChevronRight className="bkr-ok" size={16} />
        </button>
        <button className="bk-kutu" onClick={() => setListe("harcayan")}>
          <small>{gun} günde harcama</small>
          <div className="sayi">{tlKisa(hesap.donemHarcama)}</div>
          <div className="alt">
            {sayi(hesap.donemHarcamaAdet)} alışveriş · {sayi(hesap.harcayan.length)} kart
          </div>
          <ChevronRight className="bkr-ok" size={16} />
        </button>
        <button className="bk-kutu" onClick={() => setListe("yuklenen")}>
          <small>{gun} günde yükleme</small>
          <div className="sayi">{tlKisa(hesap.donemYukleme)}</div>
          <div className="alt">{sayi(hesap.yuklenen.length)} karta</div>
          <ChevronRight className="bkr-ok" size={16} />
        </button>
        <button className="bk-kutu" onClick={() => setListe("harcamayan")}>
          <small>Hiç harcanmayan</small>
          <div className="sayi" style={{ color: hesap.harcamayan.length ? "var(--bk-turuncu)" : undefined }}>
            {sayi(hesap.harcamayan.length)} <span>kart</span>
          </div>
          <div className="alt">{tlKisa(hesap.bekleyenHarcamayan)} kullanılmadan bekliyor</div>
          <ChevronRight className="bkr-ok" size={16} />
        </button>
        <button className="bk-kutu" onClick={() => setListe("dolacak")}>
          <small>90 günde süresi dolacak</small>
          <div className="sayi" style={{ color: hesap.dolacakTutar ? "var(--bk-sari)" : undefined }}>
            {tlKisa(hesap.dolacakTutar)}
          </div>
          <div className="alt">{sayi(hesap.dolacak.length)} kartta</div>
          <ChevronRight className="bkr-ok" size={16} />
        </button>
        <button className="bk-kutu" onClick={() => setListe("ayrilan")}>
          <small>Ayrılan personelde kalan</small>
          <div className="sayi" style={{ color: hesap.ayrilanTutar ? "var(--bk-kirmizi)" : undefined }}>
            {tlKisa(hesap.ayrilanTutar)}
          </div>
          <div className="alt">{sayi(hesap.ayrilan.length)} kart · transfer ya da silme bekliyor</div>
          <ChevronRight className="bkr-ok" size={16} />
        </button>
      </div>

      {/* ---------------------------------------------- aylık + şubeler */}
      <div className="bkr-iki">
        <div className="bk-panel">
          <div className="bkp-bash">
            <b>Aylık yükleme ve harcama</b>
            <div className="bkr-lejant">
              <span>
                <i style={{ background: YESIL }} /> Yükleme ve kazanma
              </span>
              <span>
                <i style={{ background: TURUNCU }} /> Harcama
              </span>
            </div>
          </div>
          <AylikGrafik aylik={veri.aylik} sec={setAy} />
          <p className="bkp-dip">Bir aya tıklayınca o ayın kart bazlı dökümü açılır. Son 12 ay, yalnızca personel kartları.</p>
        </div>

        <div className="bk-panel">
          <div className="bkp-bash">
            <b>En çok kart alışverişi yapılan şubeler</b>
            <small>son {gun} gün</small>
          </div>
          {veri.subeler.length === 0 ? (
            <div className="bk-bos">Bu dönemde kartla alışveriş yok.</div>
          ) : (
            <div className="bkr-subeler">
              {subeListe.map((s, i) => (
                <button key={s.subeId || "bos"} className="bkr-sube" onClick={() => setSube({ id: s.subeId, ad: s.subeAdi })}>
                  <span className="bkr-sira">{i + 1}</span>
                  <span className="bkr-subeAd">
                    <b>{s.subeAdi}</b>
                    <small>
                      {sayi(s.kart)} kart · {sayi(s.adet)} alışveriş · %{s.pay.toLocaleString("tr-TR")}
                    </small>
                    <span className="bkr-serit">
                      <i style={{ width: `${(s.tutar / subeEnCok) * 100}%` }} />
                    </span>
                  </span>
                  <span className="bkr-subeTutar">{tlKisa(s.tutar)}</span>
                </button>
              ))}
              {veri.subeler.length > 10 && (
                <button className="bkp-link" style={{ marginTop: 8 }} onClick={() => setTumSubeler(!tumSubeler)}>
                  {tumSubeler ? "▴ İlk 10 şube" : `▾ ${veri.subeler.length} şubenin tamamı`}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------- listeler */}
      <div className="bkr-izgara">
        <KisaListe
          baslik="En yüksek bakiyeli kartlar"
          alt="Posback bakiyesi"
          satirlar={[...hesap.bakiyeli].sort((a, b) => b.bakiye - a.bakiye)}
          deger={(x) => tl(x.bakiye)}
          ek={(x) => (x.sonHarcama ? `son harcama ${gunOnce(x.sonHarcama)} gün önce` : "hiç harcamadı")}
          tikla={kartTikla}
          tumu={() => setListe("bakiye")}
        />
        <KisaListe
          baslik="Puanı hiç harcanmayan kartlar"
          alt="bakiyesi var, hiç alışveriş yok"
          satirlar={[...hesap.harcamayan].sort((a, b) => b.bakiye - a.bakiye)}
          deger={(x) => tl(x.bakiye)}
          ek={(x) => (x.sonYukleme ? `son yükleme ${tarih(x.sonYukleme)}` : "")}
          tikla={kartTikla}
          tumu={() => setListe("harcamayan")}
          bos="Bakiyesi olup hiç harcamayan kart yok."
        />
        <KisaListe
          baslik="En çok harcayanlar"
          alt={`son ${gun} gün`}
          satirlar={[...hesap.harcayan].sort((a, b) => b.donemHarcama - a.donemHarcama)}
          deger={(x) => tl(x.donemHarcama)}
          ek={(x) => `${sayi(x.donemHarcamaAdet)} alışveriş`}
          tikla={kartTikla}
          tumu={() => setListe("harcayan")}
          bos="Bu dönemde harcama yok."
        />
        <div className="bk-panel bkr-kisa">
          <div className="bkp-bash">
            <b>Son yüklemeler</b>
            <button className="bkp-link" style={{ margin: 0 }} onClick={() => setListe("yuklenen")}>
              Yüklenen kartlar ›
            </button>
          </div>
          {veri.sonYuklemeler.length === 0 ? (
            <div className="bk-bos">Yükleme yok.</div>
          ) : (
            veri.sonYuklemeler.slice(0, 8).map((x, i) => (
              <button key={i} className="bkr-satir" onClick={() => kartTikla(x)}>
                <span>
                  <b><PersonelAdi kod={x.sicil}>{x.adSoyad ?? no4(x.kartNo)}</PersonelAdi></b>
                  <small>
                    {tarihSaat(x.tarih)}
                    {x.sube ? ` · ${x.sube}` : ""}
                    {x.tur === "kazanma" ? " · kazanma" : ""}
                  </small>
                </span>
                <span className="bkr-deger bkp-arti">+{tl(x.tutar)}</span>
              </button>
            ))
          )}
        </div>
        <KisaListe
          baslik="Süresi yaklaşan puanlar"
          alt="90 gün içinde dolacak"
          satirlar={[...hesap.dolacak].sort((a, b) => (a.dolacakTarih ?? "").localeCompare(b.dolacakTarih ?? ""))}
          deger={(x) => tl(x.dolacak)}
          ek={(x) => `son gün ${tarih(x.dolacakTarih)}`}
          tikla={kartTikla}
          tumu={() => setListe("dolacak")}
          bos="90 gün içinde süresi dolacak puan yok."
        />
        <KisaListe
          baslik="Ayrılan personelde kalan bakiye"
          alt="işten ayrılmış, kartında bakiye var"
          satirlar={[...hesap.ayrilan].sort((a, b) => b.bakiye - a.bakiye)}
          deger={(x) => tl(x.bakiye)}
          ek={(x) => (x.sonHarcama ? `son harcama ${tarih(x.sonHarcama)}` : "hiç harcamadı")}
          tikla={kartTikla}
          tumu={() => setListe("ayrilan")}
          bos="Ayrılan personelde bakiye yok."
        />
      </div>

      {/* ----------------------------------------------------------- çekmeceler */}
      <KartListesi tur={liste} kartlar={k} gun={gun} kapat={() => setListe(null)} tikla={kartTikla} />
      <AyDokumu ay={ay} kapat={() => setAy(null)} tikla={kartTikla} />
      <SubeDokumu sube={sube} gun={gun} kapat={() => setSube(null)} tikla={kartTikla} />
    </div>
  );
}

/* ========================================================================== */
/* Aylık grafik                                                               */
/* ========================================================================== */

function AylikGrafik({ aylik, sec }: { aylik: Rapor["aylik"]; sec: (ay: string) => void }) {
  const [uzerinde, setUzerinde] = useState<number | null>(null);

  const ust = yuvarlakUst(Math.max(0, ...aylik.map((a) => Math.max(a.yukleme + a.kazanma, a.harcama))));
  const yuk = (v: number) => `${Math.max(0, (v / ust) * 100)}%`;

  return (
    <div className="bkr-grafik">
      <div className="bkr-eksen">
        {[1, 0.5, 0].map((o) => (
          <div key={o} style={{ bottom: `${o * 100}%` }}>
            <span>{tlKisa(ust * o)}</span>
          </div>
        ))}
      </div>
      <div className="bkr-sutunlar">
        {aylik.map((a, i) => (
          <button
            key={a.ay}
            className={`bkr-ay ${uzerinde === i ? "uzerinde" : ""}`}
            onMouseEnter={() => setUzerinde(i)}
            onMouseLeave={() => setUzerinde(null)}
            onFocus={() => setUzerinde(i)}
            onBlur={() => setUzerinde(null)}
            onClick={() => sec(a.ay)}
            aria-label={`${ayUzun(a.ay)}: yükleme ${tl(a.yukleme + a.kazanma)}, harcama ${tl(a.harcama)}`}
          >
            <span className="bkr-cubuklar">
              <i style={{ height: yuk(a.yukleme + a.kazanma), background: YESIL }} />
              <i style={{ height: yuk(a.harcama), background: TURUNCU }} />
            </span>
            <span className="bkr-ayAd">{ayAdi(a.ay)}</span>

            {uzerinde === i && (
              <span className={`bkr-ipucu ${i > aylik.length - 4 ? "sag" : ""}`}>
                <b>{ayUzun(a.ay)}</b>
                <span>
                  <i style={{ background: YESIL }} /> Yükleme {tl(a.yukleme)}
                </span>
                {a.kazanma > 0 && (
                  <span>
                    <i style={{ background: YESIL }} /> Kazanma {tl(a.kazanma)}
                  </span>
                )}
                <span>
                  <i style={{ background: TURUNCU }} /> Harcama {tl(a.harcama)} · {sayi(a.harcamaAdet)} alışveriş
                </span>
                {a.silme > 0 && <span>Silme {tl(a.silme)}</span>}
                {a.devir > 0 && <span>Transfer {tl(a.devir)}</span>}
                <em>Ayrıntı için tıklayın</em>
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ========================================================================== */
/* Kısa liste paneli                                                          */
/* ========================================================================== */

function KisaListe({
  baslik,
  alt,
  satirlar,
  deger,
  ek,
  tikla,
  tumu,
  bos = "Kayıt yok.",
}: {
  baslik: string;
  alt: string;
  satirlar: Kart[];
  deger: (x: Kart) => string;
  ek: (x: Kart) => string;
  tikla: (x: Kart) => void;
  tumu: () => void;
  bos?: string;
}) {
  return (
    <div className="bk-panel bkr-kisa">
      <div className="bkp-bash">
        <span>
          <b>{baslik}</b>
          <small className="bkp-blok">{alt}</small>
        </span>
        {satirlar.length > 0 && (
          <button className="bkp-link" style={{ margin: 0 }} onClick={tumu}>
            Tümü ({sayi(satirlar.length)}) ›
          </button>
        )}
      </div>
      {satirlar.length === 0 ? (
        <div className="bk-bos">{bos}</div>
      ) : (
        satirlar.slice(0, 8).map((x) => (
          <button key={x.kartNo} className="bkr-satir" onClick={() => tikla(x)}>
            <span>
              <b>
                <PersonelAdi kod={x.sicil}>{x.adSoyad || no4(x.kartNo)}</PersonelAdi>
                {!x.aktif && <em className="bkr-ayrildi">ayrıldı</em>}
              </b>
              <small>
                {x.sube ? `${x.sube} · ` : ""}
                {ek(x)}
              </small>
            </span>
            <span className="bkr-deger">{deger(x)}</span>
          </button>
        ))
      )}
    </div>
  );
}

/* ========================================================================== */
/* Kart listesi çekmecesi (özet kutuları ve "Tümü")                            */
/* ========================================================================== */

const LISTE_BASLIK: Record<ListeTuru, string> = {
  bakiye: "Bakiyeli kartlar",
  harcayan: "Dönemde harcama yapan kartlar",
  yuklenen: "Dönemde yükleme yapılan kartlar",
  harcamayan: "Puanı hiç harcanmayan kartlar",
  dolacak: "Süresi 90 gün içinde dolacak puanlar",
  ayrilan: "Ayrılan personelde kalan bakiye",
};

function KartListesi({
  tur,
  kartlar,
  gun,
  kapat,
  tikla,
}: {
  tur: ListeTuru | null;
  kartlar: Kart[];
  gun: number;
  kapat: () => void;
  tikla: (x: Kart) => void;
}) {
  const [ara, setAra] = useState("");

  useEffect(() => setAra(""), [tur]);

  const satirlar = useMemo(() => {
    if (!tur) return [];
    let l = kartlar;
    if (tur === "bakiye") l = l.filter((x) => x.bakiye > 0).sort((a, b) => b.bakiye - a.bakiye);
    if (tur === "harcayan") l = l.filter((x) => x.donemHarcamaAdet > 0).sort((a, b) => b.donemHarcama - a.donemHarcama);
    if (tur === "yuklenen") l = l.filter((x) => x.donemYukleme > 0).sort((a, b) => b.donemYukleme - a.donemYukleme);
    if (tur === "harcamayan") l = l.filter((x) => x.bakiye > 0 && !x.sonHarcama).sort((a, b) => b.bakiye - a.bakiye);
    if (tur === "dolacak")
      l = l.filter((x) => x.dolacak > 0).sort((a, b) => (a.dolacakTarih ?? "").localeCompare(b.dolacakTarih ?? ""));
    if (tur === "ayrilan") l = l.filter((x) => x.bakiye > 0 && !x.aktif).sort((a, b) => b.bakiye - a.bakiye);

    const a = ara.trim().toLocaleLowerCase("tr-TR");
    if (a)
      l = l.filter((x) =>
        [x.adSoyad, x.sicil, x.sube, x.kartNo].some((d) => (d ?? "").toLocaleLowerCase("tr-TR").includes(a))
      );
    return l;
  }, [tur, kartlar, ara]);

  const sutunlar: ColumnsType<Kart> = [
    {
      title: "Personel",
      key: "kisi",
      render: (_, x) => (
        <span className="bkr-hucreKisi">
          <b>
            <PersonelAdi kod={x.sicil}>{x.adSoyad || "—"}</PersonelAdi>
            {!x.aktif && <em className="bkr-ayrildi">ayrıldı</em>}
          </b>
          <small>
            {x.sicil} · {x.sube}
          </small>
        </span>
      ),
      sorter: (a, b) => (a.adSoyad ?? "").localeCompare(b.adSoyad ?? "", "tr"),
    },
    { title: "Kart no", dataIndex: "kartNo", render: (v) => <span className="bk-no">{no4(v)}</span> },
    {
      title: "Bakiye",
      dataIndex: "bakiye",
      align: "right",
      render: (v) => tl(v),
      sorter: (a, b) => a.bakiye - b.bakiye,
    },
    {
      title: `Harcama (${gun} gün)`,
      dataIndex: "donemHarcama",
      align: "right",
      render: (v, x) => (
        <>
          {tl(v)}
          <small className="bkp-blok">{sayi(x.donemHarcamaAdet)} alışveriş</small>
        </>
      ),
      sorter: (a, b) => a.donemHarcama - b.donemHarcama,
    },
    {
      title: `Yükleme (${gun} gün)`,
      dataIndex: "donemYukleme",
      align: "right",
      render: (v) => tl(v),
      sorter: (a, b) => a.donemYukleme - b.donemYukleme,
    },
    {
      title: "Son harcama",
      dataIndex: "sonHarcama",
      render: (v) => (v ? tarih(v) : <span className="bk-rozet bk-r-sari">hiç</span>),
      sorter: (a, b) => (a.sonHarcama ?? "").localeCompare(b.sonHarcama ?? ""),
    },
    ...(tur === "dolacak"
      ? [
          {
            title: "Dolacak",
            dataIndex: "dolacak",
            align: "right" as const,
            render: (v: number, x: Kart) => (
              <>
                {tl(v)}
                <small className="bkp-blok">son gün {tarih(x.dolacakTarih)}</small>
              </>
            ),
            sorter: (a: Kart, b: Kart) => a.dolacak - b.dolacak,
          },
        ]
      : []),
  ];

  const excel = () =>
    tabloIndir({
      baslik: `Biçen Kart · ${tur ? LISTE_BASLIK[tur] : ""}`,
      altBaslik: `Son ${gun} gün · ${new Date().toLocaleDateString("tr-TR")}`,
      sayfaAdi: "Kartlar",
      dosyaAdi: `bicen-kart-${tur}-${new Date().toISOString().slice(0, 10)}.xlsx`,
      sutunlar: [
        /* Sicil yerine TC kimlik no isteniyor */
        { ad: "TC Kimlik No", genislik: 14 },
        { ad: "Ad soyad", genislik: 26 },
        { ad: "Şube", genislik: 22 },
        { ad: "Durum", genislik: 11 },
        { ad: "Kart no", genislik: 22 },
        { ad: "Bakiye", tip: "para", genislik: 14 },
        { ad: `Harcama (${gun} gün)`, tip: "para", genislik: 16 },
        { ad: `Yükleme (${gun} gün)`, tip: "para", genislik: 16 },
        { ad: "Son harcama", tip: "tarih", genislik: 13 },
        { ad: "90 günde dolacak", tip: "para", genislik: 15 },
      ],
      satirlar: satirlar.map((x) => [
        x.tc ?? "",
        x.adSoyad ?? "",
        x.sube ?? "",
        x.aktif ? "Çalışıyor" : "Ayrıldı",
        no4(x.kartNo),
        x.bakiye,
        x.donemHarcama,
        x.donemYukleme,
        x.sonHarcama ?? "",
        x.dolacak,
      ]),
      genelToplam: true,
    }).catch((h) => message.error(h?.message ?? "Excel oluşturulamadı."));

  const toplam = satirlar.reduce((t, x) => t + (tur === "dolacak" ? x.dolacak : tur === "harcayan" ? x.donemHarcama : tur === "yuklenen" ? x.donemYukleme : x.bakiye), 0);

  return (
    <Drawer
      open={!!tur}
      onClose={kapat}
      width="min(1080px, 96vw)"
      title={
        <span>
          {tur ? LISTE_BASLIK[tur] : ""} <small style={{ color: "#6b7280", fontWeight: 500 }}>· {sayi(satirlar.length)} kart · {tl(toplam)}</small>
        </span>
      }
      extra={
        <button className="bk-d kucuk" onClick={excel}>
          <Download size={14} /> Excel
        </button>
      }
    >
      <div className="bk">
        <Input
          allowClear
          prefix={<Search size={14} />}
          placeholder="Ad, sicil, şube ya da kart no"
          value={ara}
          onChange={(e) => setAra(e.target.value)}
          style={{ marginBottom: 12, maxWidth: 360 }}
        />
        <Table
          size="small"
          rowKey="kartNo"
          columns={sutunlar}
          dataSource={satirlar}
          pagination={{ pageSize: 50, showSizeChanger: false }}
          onRow={(x) => ({ onClick: () => tikla(x), style: { cursor: "pointer" } })}
        />
      </div>
    </Drawer>
  );
}

/* ========================================================================== */
/* Ay dökümü                                                                  */
/* ========================================================================== */

function AyDokumu({ ay, kapat, tikla }: { ay: string | null; kapat: () => void; tikla: (x: RaporKart) => void }) {
  const [veri, setVeri] = useState<any[] | null>(null);
  const [hata, setHata] = useState("");

  useEffect(() => {
    if (!ay) return;
    setVeri(null);
    setHata("");
    api
      .al<any>(`/api/BicenKartRapor/Ay?ay=${ay}`)
      .then((c) => setVeri(c?.kartlar ?? []))
      .catch((h) => setHata(h?.message ?? "Döküm alınamadı."));
  }, [ay]);

  const t = (f: string) => (veri ?? []).reduce((s, x) => s + Number(x[f] ?? 0), 0);

  return (
    <Drawer
      open={!!ay}
      onClose={kapat}
      width="min(980px, 96vw)"
      title={ay ? `${ayUzun(ay)} · kart hareketleri` : ""}
    >
      <div className="bk">
        {hata && <div className="bkp-hata">{hata}</div>}
        {!veri && !hata && <div className="bk-bos">Yükleniyor…</div>}
        {veri && (
          <>
            <div className="bkr-toplamlar">
              <span>
                <i style={{ background: YESIL }} /> Yükleme <b>{tl(t("yukleme"))}</b>
              </span>
              {t("kazanma") > 0 && (
                <span>
                  Kazanma <b>{tl(t("kazanma"))}</b>
                </span>
              )}
              <span>
                <i style={{ background: TURUNCU }} /> Harcama <b>{tl(t("harcama"))}</b> · {sayi(t("harcamaAdet"))} alışveriş
              </span>
              {t("silme") > 0 && (
                <span>
                  Silme <b>{tl(t("silme"))}</b>
                </span>
              )}
              {t("devir") > 0 && (
                <span>
                  Transfer <b>{tl(t("devir"))}</b>
                </span>
              )}
              <span>
                <b>{sayi(veri.length)}</b> kart
              </span>
            </div>
            <Table
              size="small"
              rowKey="kartNo"
              dataSource={veri}
              pagination={{ pageSize: 50, showSizeChanger: false }}
              onRow={(x) => ({ onClick: () => tikla(x), style: { cursor: "pointer" } })}
              columns={[
                {
                  title: "Personel",
                  key: "kisi",
                  render: (_: any, x: any) => (
                    <span className="bkr-hucreKisi">
                      <b>
                        <PersonelAdi kod={x.sicil}>{x.adSoyad || no4(x.kartNo)}</PersonelAdi>
                        {!x.aktif && <em className="bkr-ayrildi">ayrıldı</em>}
                      </b>
                      <small>
                        {x.sicil} · {x.sube}
                      </small>
                    </span>
                  ),
                },
                { title: "Yükleme", dataIndex: "yukleme", align: "right", render: (v: number) => (v ? tl(v) : "—"), sorter: (a: any, b: any) => a.yukleme - b.yukleme },
                {
                  title: "Harcama",
                  dataIndex: "harcama",
                  align: "right",
                  render: (v: number, x: any) => (v ? <>{tl(v)}<small className="bkp-blok">{sayi(x.harcamaAdet)} alışveriş</small></> : "—"),
                  sorter: (a: any, b: any) => a.harcama - b.harcama,
                },
                { title: "Transfer", dataIndex: "devir", align: "right", render: (v: number) => (v ? tl(v) : "—"), sorter: (a: any, b: any) => a.devir - b.devir },
                { title: "Silme", dataIndex: "silme", align: "right", render: (v: number) => (v ? tl(v) : "—"), sorter: (a: any, b: any) => a.silme - b.silme },
              ]}
            />
          </>
        )}
      </div>
    </Drawer>
  );
}

/* ========================================================================== */
/* Şube dökümü                                                                */
/* ========================================================================== */

function SubeDokumu({
  sube,
  gun,
  kapat,
  tikla,
}: {
  sube: { id: string; ad: string } | null;
  gun: number;
  kapat: () => void;
  tikla: (x: RaporKart) => void;
}) {
  const [veri, setVeri] = useState<any[] | null>(null);
  const [hata, setHata] = useState("");

  useEffect(() => {
    if (!sube) return;
    setVeri(null);
    setHata("");
    api
      .al<any>(`/api/BicenKartRapor/Sube?subeId=${encodeURIComponent(sube.id ?? "")}&gun=${gun}`)
      .then((c) => setVeri(c?.kartlar ?? []))
      .catch((h) => setHata(h?.message ?? "Döküm alınamadı."));
  }, [sube, gun]);

  const toplam = (veri ?? []).reduce((s, x) => s + Number(x.tutar ?? 0), 0);
  const adet = (veri ?? []).reduce((s, x) => s + Number(x.adet ?? 0), 0);

  return (
    <Drawer
      open={!!sube}
      onClose={kapat}
      width="min(900px, 96vw)"
      title={sube ? `${sube.ad} · kartla alışveriş (son ${gun} gün)` : ""}
    >
      <div className="bk">
        {hata && <div className="bkp-hata">{hata}</div>}
        {!veri && !hata && <div className="bk-bos">Yükleniyor…</div>}
        {veri && (
          <>
            <div className="bkr-toplamlar">
              <span>
                <b>{tl(toplam)}</b> harcama
              </span>
              <span>
                <b>{sayi(adet)}</b> alışveriş
              </span>
              <span>
                <b>{sayi(veri.length)}</b> kart
              </span>
              <span>
                kart başı <b>{tl(veri.length ? toplam / veri.length : 0)}</b>
              </span>
            </div>
            <Table
              size="small"
              rowKey="kartNo"
              dataSource={veri}
              pagination={{ pageSize: 50, showSizeChanger: false }}
              onRow={(x) => ({ onClick: () => tikla(x), style: { cursor: "pointer" } })}
              columns={[
                {
                  title: "Personel",
                  key: "kisi",
                  render: (_: any, x: any) => (
                    <span className="bkr-hucreKisi">
                      <b>
                        <PersonelAdi kod={x.sicil}>{x.adSoyad || no4(x.kartNo)}</PersonelAdi>
                        {!x.aktif && <em className="bkr-ayrildi">ayrıldı</em>}
                      </b>
                      <small>
                        {x.sicil} · kendi şubesi: {x.sube || "—"}
                      </small>
                    </span>
                  ),
                },
                { title: "Harcama", dataIndex: "tutar", align: "right", render: (v: number) => tl(v), sorter: (a: any, b: any) => a.tutar - b.tutar, defaultSortOrder: "descend" },
                { title: "Alışveriş", dataIndex: "adet", align: "right", sorter: (a: any, b: any) => a.adet - b.adet },
                { title: "Son alışveriş", dataIndex: "son", render: (v: string) => tarihSaat(v), sorter: (a: any, b: any) => (a.son ?? "").localeCompare(b.son ?? "") },
              ]}
            />
          </>
        )}
      </div>
    </Drawer>
  );
}
