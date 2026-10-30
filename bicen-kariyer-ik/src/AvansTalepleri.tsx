/**
 * Avans Talepleri (Personel Talepleri › Avans)
 * ---------------------------------------------------------------------------
 * Personelin mobil uygulamadan gönderdiği avans talepleri. İK tutarı,
 * taksit sayısını ve ilk kesinti ayını değiştirip onaylar ya da
 * açıklamayla reddeder; ödeme yapılınca "ödendi" işaretlenir. Kesintiler
 * ayın kesinti gününde (kural) bordrodan yapılır.
 *
 * Maaş ve üst limit yalnızca ücret alanını görebilen rollere sunucudan
 * dönüyor; diğerlerinde sütun boş.
 *
 * Görsel dil İzin Talepleri ile aynı ("it-" sınıfları); ek sınıflar "av-".
 */

import { PersonelAdi } from "./personelKarti";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  App as AntdApp,
  Button,
  DatePicker,
  Drawer,
  Empty,
  Input,
  InputNumber,
  Modal,
  Segmented,
  Select,
  Spin,
  Timeline,
} from "antd";
import { FileSpreadsheet, Plus, Printer, RefreshCw, Search, Wallet } from "lucide-react";
import dayjs from "dayjs";
import type { Dayjs } from "dayjs";

import Tablo from "./Tablo";
import { useUzman, uzmanSorgu } from "./uzmanFiltresi";
import { api } from "./api";
import { sekmedeAc } from "./sekmedeAc";
import { EksikDugmesi, useTalepEksikleri } from "./TalepEksik";
import "./AvansTalepleri.css";
import { AvansRaporu } from "./DonemRaporu";

const { TextArea } = Input;

/* ========================================================================== */
/* Tipler                                                                     */
/* ========================================================================== */

interface Taksit {
  sira: number;
  tarih: string;
  tutar: number;
  durum: "plan" | "kesildi" | "siradaki" | "bekliyor";
}

interface Ozet {
  taksitler: Taksit[];
  odenen: number;
  kalan: number;
  kalanTaksit: number;
  devamEdiyor: boolean;
  sonKesinti: string | null;
}

interface Gecmis {
  adet: number;
  toplam: number;
  buYil: number;
  devamEden: number;
  kalanBorc: number;
  kalanTaksit: number;
}

interface Kayit {
  id: number;
  personelKodu: string;
  adSoyad: string;
  sube: string | null;
  pozisyon: string | null;
  tutar: number;
  taksit: number;
  ilkKesinti: string;
  onayTutar: number | null;
  onayTaksit: number | null;
  onayIlkKesinti: string | null;
  gecerliTutar: number;
  aciklama: string | null;
  neden?: string | null;
  /** belge: nedene göre istenen belge bekleniyor, onaya gitmedi (09.10.2026) */
  durum: "bekliyor" | "belge" | "onaylandi" | "odendi" | "reddedildi" | "iptal";
  durumAdi: string;
  /** Onay akışı (07.10.2026): bekleyen talebin adımı */
  asama?: number | null;
  asamaAdi?: string | null;
  araNot?: string | null;
  kararVerebilir?: boolean;
  /** Onay sırası (08.10.2026, Avans onay tablosu) */
  onaySirasi?: { ad: string; tur: string; kisiler: string[]; karar: string | null; kim: string | null; tarih: string | null; not: string | null; simdi: boolean }[] | null;
  ikAdimi?: boolean;
  ikNotu: string | null;
  kararVeren: string | null;
  kararTarihi: string | null;
  odemeTarihi: string | null;
  odeyen: string | null;
  kaynak: string;
  limitAsimi: boolean;
  olusturma: string;
  maas: number | null;
  limit: number | null;
  ozet: Ozet;
  gecmis: Gecmis | null;
}

interface Kural {
  acik: boolean;
  yuzde: number;
  ustuAcik: boolean;
  ustCarpan: number;
  taksitler: number[];
  yillikHak: number;
  kesintiGunu: number;
  devamEngel: boolean;
  enAzTutar: number;
  /** Hazır ret gerekçeleri (Yönetim › Avans kuralları) */
  redGerekceleri?: string[];
}

type Gorunum = "bekliyor" | "odeme" | "devam" | "tumu";

/* ========================================================================== */
/* Yardımcılar                                                                */
/* ========================================================================== */

export const tl = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : `₺${Number(v).toLocaleString("tr-TR", { maximumFractionDigits: 2 })}`;

export const tarih = (v: string | null | undefined) => (v ? dayjs(v).format("DD.MM.YYYY") : "—");

export const ayKisa = (v: string) => dayjs(v).locale("tr").format("D MMM YYYY");

const DURUM_RENK: Record<string, string> = {
  bekliyor: "it-e-sari",
  belge: "it-e-turuncu",
  onaylandi: "it-e-mavi",
  odendi: "it-e-yesil",
  reddedildi: "it-e-kirmizi",
  iptal: "it-e-gri",
};

export const durumEtiketi = (durum: string, ad: string, devam: boolean) => (
  <span className={`it-e ${durum === "odendi" && !devam ? "it-e-gri" : DURUM_RENK[durum] ?? "it-e-gri"}`}>{ad}</span>
);

/** Taksit planı önizlemesi: sunucudaki Plan() ile aynı hesap */
const planHesapla = (tutar: number, taksit: number, ilk: Dayjs, gun: number) => {
  const n = Math.max(1, taksit);
  const temel = Math.floor(tutar / n);
  const sonuc: { sira: number; tarih: Dayjs; tutar: number }[] = [];
  let toplam = 0;

  for (let i = 0; i < n; i++) {
    const ay = ilk.add(i, "month");
    const t = ay.date(Math.min(gun, ay.daysInMonth()));
    const tt = i === n - 1 ? Math.round((tutar - toplam) * 100) / 100 : temel;
    toplam += tt;
    sonuc.push({ sira: i + 1, tarih: t, tutar: tt });
  }

  return sonuc;
};

/** Kesinti tarihi seçenekleri: bu aydan itibaren 12 ay, ayın kesinti günü */
const kesintiSecenekleri = (gun: number) => {
  const l: { value: string; label: string }[] = [];
  let ay = dayjs().startOf("month");

  for (let i = 0; i < 12; i++) {
    const t = ay.date(Math.min(gun, ay.daysInMonth()));
    if (t.isAfter(dayjs(), "day")) l.push({ value: t.format("YYYY-MM-DD"), label: t.format("D MMMM YYYY") });
    ay = ay.add(1, "month");
  }

  return l;
};

export const TaksitSeridi = ({ ozet }: { ozet: Ozet }) => (
  <div className="av-taksitler">
    {ozet.taksitler.map((t) => (
      <div key={t.sira} className={`av-taksit av-t-${t.durum}`}>
        <span>
          {t.sira} ·{" "}
          {t.durum === "kesildi" ? "KESİLDİ" : t.durum === "siradaki" ? "SIRADAKİ" : t.durum === "plan" ? "PLAN" : "BEKLİYOR"}
        </span>
        <b>{ayKisa(t.tarih)}</b>
        <small>{tl(t.tutar)}</small>
      </div>
    ))}
  </div>
);

/* ========================================================================== */
/* Sayfa                                                                      */
/* ========================================================================== */

/** Sunucudaki AvansController.Nedenler ile aynı */
const AVANS_NEDENLERI = [
  "Sağlık giderleri",
  "Eğitim / okul giderleri",
  "Kira / konut",
  "Fatura / borç ödemesi",
  "Düğün / nişan",
  "Ev eşyası / beyaz eşya",
  "Araç / ulaşım",
  "Acil aile ihtiyacı",
  "Diğer",
];

export default function AvansTalepleri({ sayacDegisti }: { sayacDegisti?: (n: number) => void }) {
  const { message, modal } = AntdApp.useApp();

  const [veri, setVeri] = useState<{ kural: Kural; maasGorunur: boolean; kayitlar: Kayit[] } | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [gorunum, setGorunum] = useState<Gorunum>("bekliyor");
  const [arama, setArama] = useState("");
  const [secili, setSecili] = useState<Kayit | null>(null);
  const [ekleAcik, setEkleAcik] = useState(false);
  const eksik = useTalepEksikleri("avans");

  const uzman = useUzman();

  const getir = useCallback(async () => {
    setYukleniyor(true);

    try {
      const d = await api.al<any>(`/api/Avans/Liste${uzmanSorgu(uzman)}`);
      setVeri(d);
      sayacDegisti?.((d?.kayitlar ?? []).filter((x: Kayit) => x.durum === "bekliyor" && x.kararVerebilir !== false).length);
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setYukleniyor(false);
    }
  }, [message, sayacDegisti, uzman]);

  useEffect(() => {
    getir();
  }, [getir]);

  const kayitlar = veri?.kayitlar ?? [];

  const sayilar = useMemo(
    () => ({
      bekliyor: kayitlar.filter((x) => x.durum === "bekliyor").length,
      belge: kayitlar.filter((x) => x.durum === "belge").length,
      odeme: kayitlar.filter((x) => x.durum === "onaylandi").length,
      devam: kayitlar.filter((x) => x.ozet?.devamEdiyor).length,
      kalan: kayitlar.filter((x) => x.ozet?.devamEdiyor).reduce((t, x) => t + (x.ozet?.kalan ?? 0), 0),
      buAy: kayitlar
        .flatMap((x) => (x.durum === "onaylandi" || x.durum === "odendi" ? x.ozet.taksitler : []))
        .filter((t) => dayjs(t.tarih).isSame(dayjs(), "month") || (t.durum === "siradaki" && dayjs(t.tarih).isSame(dayjs().add(1, "month"), "month")))
        .reduce((tp, t) => tp + t.tutar, 0),
    }),
    [kayitlar]
  );

  const liste = useMemo(() => {
    const q = arama.trim().toLocaleLowerCase("tr");

    return kayitlar
      .filter((x) =>
        gorunum === "bekliyor"
          ? x.durum === "bekliyor" || x.durum === "belge"
          : gorunum === "odeme"
          ? x.durum === "onaylandi"
          : gorunum === "devam"
          ? x.ozet?.devamEdiyor
          : true
      )
      .filter(
        (x) =>
          !q ||
          `${x.adSoyad} ${x.personelKodu} ${x.sube ?? ""} ${x.pozisyon ?? ""}`.toLocaleLowerCase("tr").includes(q)
      );
  }, [kayitlar, gorunum, arama]);

  const maasGorunur = !!veri?.maasGorunur;

  return (
    <div className="av">
      <div className="it-kpiler">
        {[
          {
            k: "bekliyor" as Gorunum,
            et: "Onay bekleyen",
            d: sayilar.bekliyor,
            alt: sayilar.belge ? `talep · ${sayilar.belge} belge bekliyor` : "talep",
            renk: "sari",
          },
          { k: "odeme" as Gorunum, et: "Ödeme bekleyen", d: sayilar.odeme, alt: "onaylandı, ödenmedi", renk: "turuncu" },
          { k: "devam" as Gorunum, et: "Devam eden", d: sayilar.devam, alt: `kalan ${tl(sayilar.kalan)}`, renk: "yesil" },
          { k: "tumu" as Gorunum, et: "Tümü", d: kayitlar.length, alt: "son 12 ay ve süren avanslar", renk: "kirmizi" },
        ].map((x) => (
          <button
            key={x.k}
            type="button"
            className={`it-kpi it-kpi-${x.renk}${gorunum === x.k ? " secili" : ""}`}
            onClick={() => setGorunum(x.k)}
          >
            <span className="et">{x.et}</span>
            <span className="d">{x.d.toLocaleString("tr-TR")}</span>
            <span className="alt">{x.alt}</span>
          </button>
        ))}
      </div>

      <div className="it-kart">
        <div className="it-kart-bas">
          <span className="it-kart-simge av-simge">
            <Wallet size={15} strokeWidth={2} />
          </span>
          <h3>Avans talepleri</h3>
          <span>
            kesinti her ayın {veri?.kural?.kesintiGunu ?? 5}'i · üst limit maaşın %{veri?.kural?.yuzde ?? 95}'i
            {veri?.kural && !veri.kural.acik ? " · mobilde talep kapalı" : ""}
          </span>
          <div className="it-sag">
            <Input
              allowClear
              size="small"
              prefix={<Search size={14} />}
              placeholder="Ad, sicil, şube"
              value={arama}
              onChange={(e) => setArama(e.target.value)}
              style={{ width: 200 }}
            />
            <AvansRaporu
              dugme={
                <button type="button" className="it-dg kucuk">
                  <FileSpreadsheet size={14} strokeWidth={2} /> Rapor (Excel)
                </button>
              }
            />
            <button type="button" className="it-dg kucuk" onClick={() => setEkleAcik(true)}>
              <Plus size={14} strokeWidth={2.2} /> Elle avans ekle
            </button>
            <button type="button" className="it-dg kucuk" onClick={getir} disabled={yukleniyor}>
              <RefreshCw size={14} strokeWidth={2} className={yukleniyor ? "it-don" : undefined} /> Yenile
            </button>
          </div>
        </div>

        <div className="it-kart-ic">
          <Tablo<Kayit>
            rowKey="id"
            size="small"
            loading={yukleniyor}
            dataSource={liste}
            pagination={{ pageSize: 20, showSizeChanger: false }}
            locale={{ emptyText: gorunum === "bekliyor" ? "Onay bekleyen avans talebi yok." : "Kayıt yok." }}
            onRow={(k) => ({ onClick: () => setSecili(k), style: { cursor: "pointer" } })}
            columns={[
              {
                title: "Personel",
                key: "personel",
                width: 230,
                render: (_, k) => (
                  <div className="av-kisi">
                    <b><PersonelAdi kod={k.personelKodu}>{k.adSoyad}</PersonelAdi></b>
                    <small>
                      {k.personelKodu} · {k.sube ?? "—"}
                      {k.pozisyon ? ` · ${k.pozisyon}` : ""}
                    </small>
                  </div>
                ),
              },
              {
                title: "Talep",
                key: "talep",
                width: 220,
                render: (_, k) => {
                  const degisti =
                    k.onayTutar !== null &&
                    (k.onayTutar !== k.tutar || k.onayTaksit !== k.taksit || !dayjs(k.onayIlkKesinti).isSame(k.ilkKesinti, "day"));

                  return (
                    <div className="av-kisi">
                      <b>
                        {tl(k.gecerliTutar)}{" "}
                        <span className="av-soluk">
                          · {(k.onayTaksit ?? k.taksit) === 1 ? "tek" : `${k.onayTaksit ?? k.taksit} taksit`}
                        </span>
                      </b>
                      <small>
                        ilk kesinti {tarih(k.onayIlkKesinti ?? k.ilkKesinti)}
                        {degisti ? ` · personel: ${tl(k.tutar)}, ${k.taksit} taksit` : ""}
                      </small>
                      {k.neden && <small>neden: {k.neden}</small>}
                    </div>
                  );
                },
              },
              {
                title: "Avans geçmişi",
                key: "gecmis",
                width: 220,
                render: (_, k) =>
                  k.gecmis ? (
                    <div className="av-kisi">
                      <b>
                        {k.gecmis.adet} avans · {tl(k.gecmis.toplam)}
                      </b>
                      <small>
                        bu yıl {k.gecmis.buYil}/{veri?.kural?.yillikHak ?? 2}
                        {k.gecmis.devamEden > 0 ? (
                          <span className="it-uyari-yazi">
                            {" "}
                            · devam eden {tl(k.gecmis.kalanBorc)} ({k.gecmis.kalanTaksit} taksit)
                          </span>
                        ) : (
                          " · devam eden yok"
                        )}
                      </small>
                    </div>
                  ) : (
                    <span className="av-soluk">İlk avans</span>
                  ),
              },
              ...(maasGorunur
                ? [
                    {
                      title: "Maaş · limit",
                      key: "limit",
                      width: 160,
                      render: (_: any, k: Kayit) =>
                        k.maas ? (
                          <div className="av-kisi">
                            <b className={k.gecerliTutar > (k.limit ?? 0) ? "it-kirmizi-yazi" : undefined}>
                              limit {tl(k.limit)}
                            </b>
                            <small>
                              maaş {tl(k.maas)}
                              {k.gecerliTutar > (k.limit ?? 0) ? <span className="it-kirmizi-yazi"> · limit aşıyor</span> : null}
                            </small>
                          </div>
                        ) : (
                          <span className="it-uyari-yazi">maaş bulunamadı</span>
                        ),
                    },
                  ]
                : []),
              {
                title: "Talep tarihi",
                key: "olusturma",
                width: 120,
                render: (_, k) => (
                  <div className="av-kisi">
                    <b>{tarih(k.olusturma)}</b>
                    <small>{k.kaynak === "ik" ? "İK girdi" : "mobil"}</small>
                  </div>
                ),
              },
              {
                title: "Durum",
                key: "durum",
                width: 170,
                render: (_, k) => (
                  <div className="av-kisi">
                    {durumEtiketi(k.durum, k.durumAdi, k.ozet?.devamEdiyor)}
                    {/* Sıra İK'da değilse kimde (09.10.2026) */}
                    {(() => {
                      const s = k.onaySirasi?.find((x) => x.simdi);
                      if (!s || s.tur === "ik" || !s.kisiler?.length) return null;
                      return (
                        <small className="av-sirada">
                          Sırada: <b>{s.kisiler.join(", ")}</b>
                        </small>
                      );
                    })()}
                    {k.ozet?.devamEdiyor && (
                      <small>
                        {k.ozet.kalanTaksit} taksit · {tl(k.ozet.kalan)} kaldı
                      </small>
                    )}
                  </div>
                ),
              },
              {
                title: "Eksik",
                key: "eksik",
                width: 140,
                render: (_, k) =>
                  k.durum === "reddedildi" || k.durum === "iptal" ? null : (
                    <EksikDugmesi tur="avans" talepId={k.id} e={eksik.harita[k.id]} yenile={eksik.yenile} yetkili={eksik.yetkili} />
                  ),
              },
            ]}
          />
        </div>
      </div>

      {secili && veri && (
        <AvansCekmece
          kayit={secili}
          kural={veri.kural}
          maasGorunur={maasGorunur}
          kapat={() => setSecili(null)}
          bitti={() => {
            setSecili(null);
            getir();
          }}
          message={message}
          modal={modal}
        />
      )}

      {ekleAcik && veri && (
        <ElleEkle
          kural={veri.kural}
          kapat={() => setEkleAcik(false)}
          bitti={() => {
            setEkleAcik(false);
            getir();
          }}
          message={message}
        />
      )}
    </div>
  );
}

/* ========================================================================== */
/* Çekmece: inceleme ve karar                                                 */
/* ========================================================================== */

function AvansCekmece({
  kayit,
  kural,
  maasGorunur,
  kapat,
  bitti,
  message,
  modal,
}: {
  kayit: Kayit;
  kural: Kural;
  maasGorunur: boolean;
  kapat: () => void;
  bitti: () => void;
  message: any;
  modal: any;
}) {
  const [tutar, setTutar] = useState<number>(kayit.onayTutar ?? kayit.tutar);
  const [taksit, setTaksit] = useState<number>(kayit.onayTaksit ?? kayit.taksit);
  const [ilk, setIlk] = useState<string>(dayjs(kayit.onayIlkKesinti ?? kayit.ilkKesinti).format("YYYY-MM-DD"));
  const [not, setNot] = useState("");
  const [isleniyor, setIsleniyor] = useState(false);
  const [ayrinti, setAyrinti] = useState<any>(null);

  useEffect(() => {
    api
      .al<any>(`/api/Avans/${kayit.id}`)
      .then(setAyrinti)
      .catch(() => setAyrinti({ hareketler: [], personel: null }));
  }, [kayit.id]);

  const bekliyor = kayit.durum === "bekliyor";
  const onayli = kayit.durum === "onaylandi" || kayit.durum === "odendi";
  const ilkKesildi = onayli && kayit.ozet.taksitler.some((t) => t.durum === "kesildi");
  const duzenlenebilir = bekliyor || (onayli && !ilkKesildi);

  const plan = planHesapla(tutar || 0, taksit, dayjs(ilk), kural.kesintiGunu);
  const limitAsildi = maasGorunur && kayit.limit !== null && tutar > (kayit.limit ?? 0);
  const ustLimit = kayit.limit !== null && kural.ustuAcik ? (kayit.limit ?? 0) * kural.ustCarpan : kayit.limit;

  const secenekler = useMemo(() => {
    const l = kesintiSecenekleri(kural.kesintiGunu);
    if (!l.some((x) => x.value === ilk)) l.unshift({ value: ilk, label: dayjs(ilk).format("D MMMM YYYY") });
    return l;
  }, [kural.kesintiGunu, ilk]);

  const taksitSecenekleri = Array.from(new Set([...kural.taksitler, ...Array.from({ length: 12 }, (_, i) => i + 1), taksit]))
    .sort((a, b) => a - b)
    .map((x) => ({ value: x, label: x === 1 ? "Tek seferde" : `${x} taksit` }));

  const karar = async (onay: boolean) => {
    if (!onay && not.trim().length < 3) {
      message.error("Ret sebebini yazınız.");
      return;
    }

    if (onay && (!tutar || tutar <= 0)) {
      message.error("Tutarı yazınız.");
      return;
    }

    setIsleniyor(true);

    try {
      const c = await api.gonder<any>(`/api/Avans/${kayit.id}/Karar`, {
        onay,
        tutar: onay ? tutar : null,
        taksit: onay ? taksit : null,
        ilkKesinti: onay ? ilk : null,
        not: not.trim(),
      });

      message.success(
        c?.sonrakiAdim
          ? `Kararınız kaydedildi; talep ${c.sonrakiAdim} onayına geçti.`
          : onay
            ? bekliyor
              ? "Onaylandı; personele bildirim gitti."
              : "Plan güncellendi."
            : "Reddedildi."
      );
      bitti();
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setIsleniyor(false);
    }
  };

  const odendi = () => {
    let gun: Dayjs | null = dayjs();

    modal.confirm({
      title: "Ödeme yapıldı mı?",
      content: (
        <div>
          <p style={{ fontSize: 13.5 }}>
            {kayit.adSoyad} · {tl(kayit.gecerliTutar)}. Personele "avansınız ödendi" bildirimi gider.
          </p>
          <DatePicker defaultValue={dayjs()} format="DD.MM.YYYY" onChange={(d) => (gun = d)} />
        </div>
      ),
      okText: "Ödendi",
      cancelText: "Vazgeç",
      onOk: async () => {
        try {
          await api.gonder(`/api/Avans/${kayit.id}/Odendi`, { tarih: (gun ?? dayjs()).format("YYYY-MM-DD") });
          message.success("Ödendi olarak işaretlendi.");
          bitti();
        } catch (h: any) {
          message.error(h.message);
          return Promise.reject();
        }
      },
    });
  };

  const iptal = () => {
    let sebep = "";

    modal.confirm({
      title: "Avans iptal edilsin mi?",
      content: (
        <TextArea rows={3} placeholder="İptal sebebi (zorunlu)" onChange={(e) => (sebep = e.target.value)} />
      ),
      okText: "İptal et",
      okButtonProps: { danger: true },
      cancelText: "Vazgeç",
      onOk: async () => {
        if (sebep.trim().length < 3) {
          message.error("İptal sebebini yazınız.");
          return Promise.reject();
        }

        try {
          await api.gonder(`/api/Avans/${kayit.id}/IkIptal`, { onay: false, not: sebep.trim() });
          message.success("İptal edildi.");
          bitti();
        } catch (h: any) {
          message.error(h.message);
          return Promise.reject();
        }
      },
    });
  };

  const p = ayrinti?.personel;

  return (
    <Drawer
      open
      onClose={kapat}
      width={560}
      rootClassName="it-cekmece av-cekmece"
      title={
        <div className="av-cekmece-bas">
          <b><PersonelAdi kod={kayit.personelKodu}>{kayit.adSoyad}</PersonelAdi></b>
          <small>
            {kayit.personelKodu} · {kayit.sube ?? "—"}
            {kayit.pozisyon ? ` · ${kayit.pozisyon}` : ""}
          </small>
        </div>
      }
      extra={durumEtiketi(kayit.durum, kayit.durumAdi, kayit.ozet?.devamEdiyor)}
    >
      <div className="av-bolum">
        <div className="av-ikili">
          <div>
            <span>Personelin talebi</span>
            <b>{tl(kayit.tutar)}</b>
            <small>
              {kayit.taksit === 1 ? "tek seferde" : `${kayit.taksit} taksit`} · ilk kesinti {tarih(kayit.ilkKesinti)}
            </small>
          </div>
          <div>
            <span>Talep tarihi</span>
            <b>{tarih(kayit.olusturma)}</b>
            <small>{kayit.kaynak === "ik" ? "İK elle girdi" : "mobil uygulama"}</small>
          </div>
        </div>

        {kayit.neden && (
          <div className="av-limit">
            Talep nedeni: <b>{kayit.neden}</b>
          </div>
        )}
        {kayit.aciklama && <div className="av-not">“{kayit.aciklama}”</div>}

        {maasGorunur && (
          <div className="av-limit">
            {kayit.maas ? (
              <>
                Maaş <b>{tl(kayit.maas)}</b> · üst limit (%{kural.yuzde}) <b>{tl(kayit.limit)}</b>
                {kural.ustuAcik ? (
                  <>
                    {" "}
                    · maaşın üzerinde en fazla <b>{tl(ustLimit)}</b>
                  </>
                ) : null}
              </>
            ) : (
              <span className="it-uyari-yazi">Maaş bulunamadı; limit denetimi yapılamadı.</span>
            )}
          </div>
        )}
      </div>

      {(duzenlenebilir || onayli) && (
        <div className="av-bolum">
          <h4>{bekliyor ? "Onay" : "Ödeme planı"}</h4>

          {duzenlenebilir ? (
            <>
              <div className="av-form">
                <label>
                  <span>Tutar</span>
                  <InputNumber
                    value={tutar}
                    min={1}
                    step={500}
                    onChange={(v) => setTutar(Number(v ?? 0))}
                    formatter={(v) => `₺ ${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}
                    parser={(v) => Number((v ?? "").replace(/[₺\s.]/g, "").replace(",", ".")) as any}
                    style={{ width: "100%" }}
                    status={limitAsildi ? "warning" : undefined}
                  />
                </label>
                <label>
                  <span>Taksit</span>
                  <Select value={taksit} options={taksitSecenekleri} onChange={setTaksit} style={{ width: "100%" }} />
                </label>
                <label>
                  <span>İlk kesinti</span>
                  <Select value={ilk} options={secenekler} onChange={setIlk} style={{ width: "100%" }} />
                </label>
              </div>

              {limitAsildi && (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginTop: 10 }}
                  message={`Tutar üst limitin (${tl(kayit.limit)}) üzerinde.`}
                />
              )}

              <div className="av-plan">
                {plan.map((t) => (
                  <div key={t.sira}>
                    <span>{t.sira}.</span>
                    <b>{t.tarih.format("D MMM YYYY")}</b>
                    <small>{t.tarih.subtract(1, "month").format("MMMM")} maaşından</small>
                    <em>{tl(t.tutar)}</em>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <TaksitSeridi ozet={kayit.ozet} />
          )}

          {onayli && (
            <p className="av-soluk" style={{ marginTop: 8 }}>
              {kayit.kararVeren ? `Onaylayan ${kayit.kararVeren} · ${tarih(kayit.kararTarihi)}` : ""}
              {kayit.odemeTarihi ? ` · ödendi ${tarih(kayit.odemeTarihi)}${kayit.odeyen ? ` (${kayit.odeyen})` : ""}` : ""}
              {ilkKesildi ? " · ilk taksit kesildiği için plan değiştirilemez" : ""}
            </p>
          )}
        </div>
      )}

      {kayit.onaySirasi && kayit.onaySirasi.length > 0 && (
        <div className="av-bolum">
          <h4>Onay sırası</h4>
          <div className="av-sira">
            {kayit.onaySirasi.map((a, i) => {
              const renk = a.karar === "onay" ? "av-sira-ok" : a.karar === "red" ? "av-sira-red" : a.karar === "atlandi" ? "av-sira-atla" : a.simdi ? "av-sira-simdi" : "";
              return (
                <div key={i} className={`av-sira-adim ${renk}`}>
                  <span className="av-sira-no">{i + 1}</span>
                  <div style={{ minWidth: 0 }}>
                    <b>{a.ad}</b>
                    <div className="av-soluk">
                      {a.karar === "onay"
                        ? `Onayladı · ${a.kim ?? ""}${a.tarih ? ` · ${tarih(a.tarih)}` : ""}`
                        : a.karar === "red"
                        ? `Reddetti · ${a.kim ?? ""}${a.tarih ? ` · ${tarih(a.tarih)}` : ""}`
                        : a.karar === "atlandi"
                        ? `Atlandı${a.not ? ` · ${a.not}` : ""}`
                        : a.tur === "ik"
                        ? a.simdi
                          ? "Sizde bekliyor (panel)"
                          : "Panelde"
                        : a.kisiler.length
                        ? `${a.simdi ? "Bekliyor · " : ""}${a.kisiler.slice(0, 3).join(", ")}${a.kisiler.length > 3 ? ` +${a.kisiler.length - 3}` : ""} (Biçen360)`
                        : "Onaylayan bulunamadı"}
                    </div>
                    {a.not && a.karar !== "atlandi" && <div className="av-soluk">“{a.not}”</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {bekliyor && (
        <div className="av-bolum">
          <h4>Onay akışı</h4>
          <div className="av-not">
            Şu an <b>{kayit.asamaAdi ?? "İnsan Kaynakları"}</b> onayında.
            {kayit.kararVerebilir === false && " Bu adımda karar yetkiniz yok; talebi yalnızca görüntüleyebilirsiniz."}
            {kayit.araNot &&
              kayit.araNot.split("\n").map((x, i) => (
                <div key={i} className="av-soluk" style={{ marginTop: 4 }}>
                  {x}
                </div>
              ))}
          </div>
        </div>
      )}

      {kayit.ikNotu && (
        <div className="av-bolum">
          <h4>İK açıklaması</h4>
          <div className="av-not">{kayit.ikNotu}</div>
        </div>
      )}

      <div className="av-bolum">
        <h4>Avans geçmişi</h4>
        {!ayrinti ? (
          <Spin size="small" />
        ) : !p || p.avanslar.length <= 1 ? (
          <span className="av-soluk">Daha önce avans almamış.</span>
        ) : (
          <>
            <div className="av-ikili av-uclu">
              <div>
                <span>Toplam</span>
                <b>{p.toplamAdet} avans</b>
                <small>{tl(p.toplamAlinan)}</small>
              </div>
              <div>
                <span>Bu yıl</span>
                <b>
                  {p.buYil} / {p.yillikHak}
                </b>
                <small>talep</small>
              </div>
              <div>
                <span>Devam eden</span>
                <b className={p.kalanBorc > 0 ? "it-uyari-yazi" : undefined}>{p.kalanBorc > 0 ? tl(p.kalanBorc) : "Yok"}</b>
                <small>{p.devamEden ? `${p.devamEden.ozet.kalanTaksit} taksit kaldı` : "kalan borç"}</small>
              </div>
            </div>

            <div className="av-gecmis">
              {p.avanslar
                .filter((a: any) => a.id !== kayit.id)
                .slice(0, 8)
                .map((a: any) => (
                  <div key={a.id}>
                    <b>{tl(a.tutar)}</b>
                    <span>
                      {tarih(a.olusturma)} · {a.taksit === 1 ? "tek" : `${a.taksit} taksit`}
                    </span>
                    {durumEtiketi(a.durum, a.durumAdi, a.ozet?.devamEdiyor)}
                  </div>
                ))}
            </div>
          </>
        )}
      </div>

      {(kayit.durum === "belge" || ayrinti?.belgeler?.length > 0) && (
        <div className="av-bolum">
          <h4>Belge</h4>
          {kayit.durum === "belge" && (
            <div className="av-belge-uyari">
              <b>Belge bekleniyor{ayrinti?.belgeAdi ? `: ${ayrinti.belgeAdi}` : ""}</b>
              <span>Personel Biçen360'tan belgeyi yükleyince talep onay sırasına girer ve ilk onaycıya bildirim gider.</span>
            </div>
          )}
          {(ayrinti?.belgeler ?? []).map((b: any) => (
            <div key={b.id} className="av-belge">
              <span>
                <b>{b.tur ?? "Belge"}</b>
                <small>
                  {[b.dosyaAdi, b.tip === "application/pdf" ? "PDF" : "Fotoğraf", `${Math.max(1, Math.round(b.boyut / 1024))} KB`]
                    .filter(Boolean)
                    .join(" · ")}{" "}
                  · {dayjs(b.tarih).format("DD.MM.YYYY HH:mm")}
                </small>
              </span>
              <button
                type="button"
                className="it-dg"
                onClick={() => sekmedeAc(`/api/Avans/Belge/${b.id}`).catch((h: any) => message.error(h.message))}
              >
                Aç
              </button>
            </div>
          ))}
        </div>
      )}

      {ayrinti?.hareketler?.length > 0 && (
        <div className="av-bolum">
          <h4>Hareketler</h4>
          <Timeline
            items={ayrinti.hareketler.map((h: any) => ({
              children: (
                <div className="av-hareket">
                  <b>{h.olay}</b>
                  {h.aciklama && <span>{h.aciklama}</span>}
                  <small>
                    {h.yapan} · {dayjs(h.zaman).format("DD.MM.YYYY HH:mm")}
                  </small>
                </div>
              ),
            }))}
          />
        </div>
      )}

      {duzenlenebilir && (
        <div className="av-bolum">
          <h4>{bekliyor ? "İK açıklaması" : "Değişiklik notu"}</h4>
          {bekliyor && (kural.redGerekceleri?.length ?? 0) > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
              {kural.redGerekceleri!.map((g) => (
                <button
                  key={g}
                  type="button"
                  className="it-dg kucuk"
                  title="Ret gerekçesi olarak yaz"
                  onClick={() => setNot((o) => (o.trim() ? (o.includes(g) ? o : `${o.trim()} ${g}`) : g))}
                >
                  {g}
                </button>
              ))}
            </div>
          )}
          <TextArea
            rows={3}
            value={not}
            onChange={(e) => setNot(e.target.value)}
            placeholder={
              bekliyor
                ? "Reddederken zorunlu; onayda isteğe bağlı. Talep sonuçlanırsa personel, sonraki adıma geçerse o adımdaki kişi görür."
                : "İsteğe bağlı"
            }
          />
        </div>
      )}

      <div className="av-dugmeler">
        <button
          type="button"
          className="it-dg"
          onClick={() => sekmedeAc(`/api/Avans/${kayit.id}/Form`).catch((h: any) => message.error(h.message))}
        >
          <Printer size={15} strokeWidth={2} /> Formu yazdır
        </button>

        {kayit.durum === "onaylandi" && (
          <Button onClick={odendi} disabled={isleniyor}>
            Ödendi işaretle
          </Button>
        )}

        {(bekliyor || kayit.durum === "belge" || (onayli && !ilkKesildi)) && (
          <Button danger type="text" onClick={iptal} disabled={isleniyor}>
            İptal et
          </Button>
        )}

        <span style={{ flex: 1 }} />

        {bekliyor && kayit.kararVerebilir !== false && (
          <>
            <Button danger onClick={() => karar(false)} loading={isleniyor}>
              Reddet
            </Button>
            <Button type="primary" onClick={() => karar(true)} loading={isleniyor}>
              Onayla
            </Button>
          </>
        )}

        {onayli && !ilkKesildi && (
          <Button type="primary" onClick={() => karar(true)} loading={isleniyor}>
            Planı kaydet
          </Button>
        )}
      </div>
    </Drawer>
  );
}

/* ========================================================================== */
/* Elle avans ekle                                                            */
/* ========================================================================== */

function ElleEkle({
  kural,
  kapat,
  bitti,
  message,
}: {
  kural: Kural;
  kapat: () => void;
  bitti: () => void;
  message: any;
}) {
  const [personeller, setPersoneller] = useState<any[]>([]);
  /* Nedenler Ayarlar Merkezi › Seçenek listeleri'nden; gelmezse yedek liste */
  const [nedenler, setNedenler] = useState<string[]>(AVANS_NEDENLERI);
  useEffect(() => {
    api
      .al<any>("/api/Avans/Kural")
      .then((c) => c?.nedenler?.length && setNedenler(c.nedenler))
      .catch(() => undefined);
  }, []);
  const [kod, setKod] = useState<string | null>(null);
  const [tutar, setTutar] = useState<number | null>(null);
  const [taksit, setTaksit] = useState(1);
  const [ilk, setIlk] = useState<Dayjs | null>(dayjs().startOf("month"));
  const [odeme, setOdeme] = useState<Dayjs | null>(dayjs());
  const [aciklama, setAciklama] = useState("");
  const [neden, setNeden] = useState<string | null>(null);
  const [isleniyor, setIsleniyor] = useState(false);

  useEffect(() => {
    api
      .al<{ personeller: any[] }>("/api/Personel?durum=calisan")
      .then((c) => setPersoneller(c?.personeller ?? []))
      .catch(() => setPersoneller([]));
  }, []);

  const kaydet = async () => {
    if (!kod || !tutar || !ilk) {
      message.error("Personel, tutar ve ilk kesinti ayını seçiniz.");
      return;
    }

    if (neden === "Diğer" && aciklama.trim().length < 3) {
      message.error("\"Diğer\" seçildiğinde açıklama zorunludur.");
      return;
    }

    setIsleniyor(true);

    try {
      await api.gonder("/api/Avans/Ekle", {
        personelKodu: kod,
        tutar,
        taksit,
        ilkKesinti: ilk.format("YYYY-MM-DD"),
        odemeTarihi: odeme?.format("YYYY-MM-DD") ?? null,
        aciklama: aciklama.trim(),
        neden,
      });

      message.success("Avans kaydedildi.");
      bitti();
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setIsleniyor(false);
    }
  };

  return (
    <Modal
      open
      title="Elle avans ekle"
      onCancel={kapat}
      onOk={kaydet}
      okText="Kaydet"
      cancelText="Vazgeç"
      confirmLoading={isleniyor}
      rootClassName="it-modal"
      width={520}
    >
      <p className="av-soluk" style={{ marginTop: 0 }}>
        Sistemden önce verilmiş ya da mobil dışından gelen avans. Ödendi olarak kaydedilir; geçmiş tarihli
        taksitler kesildi sayılır ve personel kartında, mobil Avanslarım ekranında görünür.
      </p>

      <div className="av-form av-form-dikey">
        <label>
          <span>Personel</span>
          <Select
            showSearch
            value={kod}
            onChange={setKod}
            placeholder="Ad, sicil ya da T.C."
            optionFilterProp="label"
            options={personeller.map((p) => ({
              value: p.personelKodu,
              label: `${`${p.ad ?? ""} ${p.soyad ?? ""}`.trim()} · ${p.personelKodu}${p.sube ? ` · ${p.sube}` : ""}`,
            }))}
            notFoundContent={personeller.length === 0 ? <Spin size="small" /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          />
        </label>
        <div className="av-form">
          <label>
            <span>Tutar</span>
            <InputNumber value={tutar} min={1} step={500} onChange={(v) => setTutar(v as number)} style={{ width: "100%" }} />
          </label>
          <label>
            <span>Taksit</span>
            <Select
              value={taksit}
              onChange={setTaksit}
              options={Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: i === 0 ? "Tek" : `${i + 1} taksit` }))}
            />
          </label>
          <label>
            <span>İlk kesinti ayı</span>
            <DatePicker picker="month" value={ilk} onChange={setIlk} format="MMMM YYYY" style={{ width: "100%" }} />
          </label>
        </div>
        <label>
          <span>Ödeme tarihi</span>
          <DatePicker value={odeme} onChange={setOdeme} format="DD.MM.YYYY" />
        </label>
        <label>
          <span>Talep nedeni</span>
          <Select
            allowClear
            value={neden}
            onChange={(v) => setNeden(v ?? null)}
            placeholder="Biliniyorsa seçin"
            options={nedenler.map((x) => ({ value: x, label: x }))}
          />
        </label>
        <label>
          <span>Açıklama{neden === "Diğer" ? " *" : ""}</span>
          <TextArea rows={2} value={aciklama} onChange={(e) => setAciklama(e.target.value)} />
        </label>
        <small className="av-soluk">Kesinti günü ayın {kural.kesintiGunu}'i.</small>
      </div>
    </Modal>
  );
}
