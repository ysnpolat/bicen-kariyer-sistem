/* ===========================================================================
   Personel Talepleri › Denkleştirme (23.10.2026)

   Fazla çalışma ×1,5 alacak, erken çıkış / geç geliş bire bir borç,
   denkleştirme izni alacaktan düşer. Personel Biçen360'tan formu doldurur,
   çıktısını imzalayıp yükler; birim yöneticisi onaylar, son onay İK'da.
   İK onaylayınca bakiyeye işlenir. Fazla mesai modülünde onaylanıp
   karşılığı "izin" olan kayıtlar bakiyeye kendiliğinden eklenir.
   =========================================================================== */

import { useCallback, useEffect, useMemo, useState } from "react";
import { App as AntdApp, DatePicker, Drawer, Input, Modal, Select, Spin, Table, Tooltip } from "antd";
import { Download, FileCheck2, Printer, RefreshCw, Scale, Search } from "lucide-react";
import dayjs from "dayjs";

import { api, oturumOku } from "./api";
import { sekmedeAc } from "./sekmedeAc";
import { PersonelAdi } from "./personelKarti";
import { tabloIndir } from "./raporExcel";

interface Kayit {
  id: number;
  formNo: string;
  personelKodu: string;
  adSoyad: string;
  gorev: string | null;
  sube: string | null;
  tur: "fazla" | "eksik" | "izin";
  turAdi: string;
  tarih: string;
  baslangic: string;
  bitis: string;
  dk: number;
  etkiDk: number;
  aciklama: string | null;
  durum: "imza" | "yonetici" | "ik" | "onaylandi" | "reddedildi" | "iptal";
  durumAdi: string;
  belgeVar: boolean;
  belgeTarihi: string | null;
  yoneticiAd: string | null;
  yoneticiTarih: string | null;
  yoneticiNot: string | null;
  ikAd: string | null;
  ikTarih: string | null;
  redNedeni: string | null;
  olusturma: string;
}
interface Bakiye {
  alacakDk: number;
  borcDk: number;
  netDk: number;
  bekleyen: number;
}
interface Satir {
  kayit: Kayit;
  bakiye: Bakiye;
}
type Gorunum = "ik" | "yonetici" | "imza" | "onaylandi" | "reddedildi" | "bakiyeler";

export const sure = (dk: number) => {
  const m = Math.round(Math.abs(dk ?? 0));
  const s = Math.floor(m / 60);
  const d = m % 60;
  return s && d ? `${s} sa ${d} dk` : s ? `${s} sa` : `${d} dk`;
};
export const isaretli = (dk: number) => (dk > 0 ? "+" : dk < 0 ? "−" : "") + (dk ? sure(dk) : "0");
const saatOndalik = (dk: number) => Math.round((dk / 60) * 100) / 100;

const TUR_SINIF: Record<string, string> = { fazla: "fm-r-yesil", eksik: "fm-r-sari", izin: "fm-r-mavi" };
const DURUM_SINIF: Record<string, string> = {
  imza: "fm-r-gri",
  yonetici: "fm-r-mavi",
  ik: "fm-r-sari",
  onaylandi: "fm-r-yesil",
  reddedildi: "fm-r-kirmizi",
  iptal: "fm-r-gri",
};
const renkEtki = (dk: number) => ({ color: dk > 0 ? "#3f6212" : dk < 0 ? "#c2410c" : undefined, fontWeight: 700 });

export default function DenklestirmeTalepleri({ sayacDegisti }: { sayacDegisti?: (n: number) => void }) {
  const { message } = AntdApp.useApp();
  const ustRol = ["Admin", "GenelMudurYardimcisi"].includes(oturumOku()?.rol ?? "");

  const [gorunum, setGorunum] = useState<Gorunum>("ik");
  const [satirlar, setSatirlar] = useState<Satir[]>([]);
  const [sayilar, setSayilar] = useState<any>({});
  const [subeler, setSubeler] = useState<string[]>([]);
  const [sube, setSube] = useState<string | undefined>();
  const [ay, setAy] = useState<dayjs.Dayjs | null>(null);
  const [arama, setArama] = useState("");
  const [yukleniyor, setYukleniyor] = useState(true);
  const [islenen, setIslenen] = useState<number | null>(null);
  const [red, setRed] = useState<Kayit | null>(null);
  const [sebep, setSebep] = useState("");
  const [kisi, setKisi] = useState<{ kod: string; ad: string } | null>(null);

  const getir = useCallback(async () => {
    if (gorunum === "bakiyeler") return;
    setYukleniyor(true);
    try {
      const q = new URLSearchParams({ durum: gorunum });
      if (sube) q.set("sube", sube);
      if (ay) q.set("ay", ay.format("YYYY-MM"));
      const c = await api.al<any>(`/api/Denklestirme/Liste?${q}`);
      setSatirlar(c.kayitlar ?? []);
      setSayilar(c.sayilar ?? {});
      setSubeler(c.subeler ?? []);
      sayacDegisti?.(c.sayilar?.ik ?? 0);
    } catch (h: any) {
      message.error(h?.message ?? "Liste alınamadı");
    } finally {
      setYukleniyor(false);
    }
  }, [gorunum, sube, ay, message, sayacDegisti]);

  useEffect(() => {
    getir();
  }, [getir]);

  const liste = useMemo(() => {
    const a = arama.trim().toLocaleLowerCase("tr");
    if (!a) return satirlar;
    return satirlar.filter((x) =>
      [x.kayit.adSoyad, x.kayit.personelKodu, x.kayit.sube, x.kayit.formNo].some((v) => (v ?? "").toLocaleLowerCase("tr").includes(a))
    );
  }, [satirlar, arama]);

  const karar = async (k: Kayit, onay: boolean, not = "") => {
    setIslenen(k.id);
    try {
      await api.gonder(`/api/Denklestirme/${k.id}/Karar`, { onay, not });
      message.success(onay ? `${k.adSoyad}: bakiyeye ${isaretli(k.etkiDk)} işlendi` : "Reddedildi; personele bildirildi");
      setRed(null);
      setSebep("");
      getir();
    } catch (h: any) {
      message.error(h?.message ?? "İşlenemedi");
    } finally {
      setIslenen(null);
    }
  };

  const formAc = (k: Kayit) => sekmedeAc(`/api/Denklestirme/${k.id}/Form?html=true`).catch((h: any) => message.error(h.message));
  const belgeAc = (k: Kayit) => sekmedeAc(`/api/Denklestirme/${k.id}/ImzaliForm`).catch((h: any) => message.error(h.message));

  const excel = () =>
    tabloIndir({
      baslik: "Denkleştirme formları",
      altBaslik: [
        { ik: "İK onayı bekleyen", yonetici: "Yönetici onayında", imza: "İmzalı form bekleniyor", onaylandi: "Onaylanan", reddedildi: "Reddedilen" }[
          gorunum as string
        ],
        ay ? ay.format("MM.YYYY") : null,
        sube,
      ]
        .filter(Boolean)
        .join(" · "),
      sayfaAdi: "Formlar",
      dosyaAdi: "denklestirme",
      sutunlar: [
        { ad: "Form no", genislik: 15 },
        { ad: "Sicil", genislik: 9 },
        { ad: "Ad soyad", genislik: 24 },
        { ad: "Görev", genislik: 20 },
        { ad: "Şube", genislik: 20 },
        { ad: "Tür", genislik: 18 },
        { ad: "Tarih", tip: "tarih" },
        { ad: "Saat", genislik: 13 },
        { ad: "Süre (sa)", tip: "ondalik" },
        { ad: "Etki (sa)", tip: "ondalik" },
        { ad: "Net bakiye (sa)", tip: "ondalik", toplam: false },
        { ad: "Durum", genislik: 20 },
        { ad: "Yönetici", genislik: 24 },
        { ad: "Açıklama", genislik: 30 },
      ],
      satirlar: liste.map(({ kayit: k, bakiye: b }) => [
        k.formNo,
        k.personelKodu,
        k.adSoyad,
        k.gorev,
        k.sube,
        k.turAdi,
        k.tarih,
        `${k.baslangic}–${k.bitis}`,
        saatOndalik(k.dk),
        saatOndalik(k.etkiDk),
        saatOndalik(b?.netDk ?? 0),
        k.durumAdi,
        k.yoneticiAd,
        k.aciklama,
      ]),
      genelToplam: true,
    });

  const kpiler: { k: Gorunum; et: string; d: number; alt: string; renk: string }[] = [
    { k: "ik", et: "İK onayı bekleyen", d: sayilar.ik ?? 0, alt: "imzalı form ve yönetici onayı tamam", renk: "sari" },
    { k: "yonetici", et: "Yönetici onayında", d: sayilar.yonetici ?? 0, alt: "birim yöneticisi Biçen360'tan onaylar", renk: "mavi" },
    { k: "imza", et: "İmzalı form bekleniyor", d: sayilar.imza ?? 0, alt: "personel çıktıyı yükleyecek", renk: "turuncu" },
    { k: "onaylandi", et: "Onaylanan", d: sayilar.onaylandi ?? 0, alt: `bu ay ${sayilar.buAy ?? 0} form`, renk: "yesil" },
    { k: "reddedildi", et: "Reddedilen", d: sayilar.reddedildi ?? 0, alt: "sebebiyle", renk: "kirmizi" },
    { k: "bakiyeler", et: "Bakiyeler", d: 0, alt: "kişi kişi alacak / borç", renk: "yesil" },
  ];

  return (
    <div className="fm">
      <div className="it-kpiler">
        {kpiler.map((x) => (
          <button key={x.k} type="button" className={`it-kpi it-kpi-${x.renk}${gorunum === x.k ? " secili" : ""}`} onClick={() => setGorunum(x.k)}>
            <span className="et">{x.et}</span>
            <span className="d">{x.k === "bakiyeler" ? "±" : x.d.toLocaleString("tr-TR")}</span>
            <span className="alt">{x.alt}</span>
          </button>
        ))}
      </div>

      {gorunum === "bakiyeler" ? (
        <Bakiyeler ac={(kod, ad) => setKisi({ kod, ad })} />
      ) : (
        <div className="it-kart">
          <div className="it-kart-bas">
            <span className="it-kart-simge fm-simge">
              <Scale size={15} strokeWidth={2} />
            </span>
            <h3>Denkleştirme</h3>
            <span>fazla çalışma ×1,5 alacak · eksik çalışma borç · personel → imzalı form → yönetici → İK</span>
            <div className="it-sag">
              <Input
                allowClear
                size="small"
                prefix={<Search size={14} />}
                placeholder="Ad, sicil, şube, form no"
                value={arama}
                onChange={(e) => setArama(e.target.value)}
                style={{ width: 200 }}
              />
              <Select
                allowClear
                size="small"
                placeholder="Tüm şubeler"
                value={sube}
                onChange={setSube}
                options={subeler.map((x) => ({ value: x, label: x }))}
                style={{ width: 170 }}
                showSearch
              />
              <DatePicker picker="month" size="small" value={ay} onChange={setAy} format="MM.YYYY" placeholder="Tüm aylar" />
              <button type="button" className="it-dg kucuk" onClick={getir} disabled={yukleniyor}>
                <RefreshCw size={14} strokeWidth={2} className={yukleniyor ? "it-don" : undefined} /> Yenile
              </button>
              <button type="button" className="it-dg kucuk" onClick={excel} disabled={!liste.length}>
                <Download size={14} strokeWidth={2} /> Excel
              </button>
            </div>
          </div>

          <div className="it-kart-ic">
            <Table<Satir>
              rowKey={(x) => x.kayit.id}
              size="small"
              loading={yukleniyor}
              dataSource={liste}
              pagination={{ pageSize: 25, hideOnSinglePage: true }}
              scroll={{ x: 1100 }}
              locale={{ emptyText: gorunum === "ik" ? "İK onayı bekleyen denkleştirme formu yok." : "Kayıt yok." }}
              onRow={({ kayit: k }) => ({
                onClick: (e) => {
                  if ((e.target as HTMLElement).closest("button, a, input")) return;
                  setKisi({ kod: k.personelKodu, ad: k.adSoyad });
                },
                style: { cursor: "pointer" },
              })}
              columns={[
                {
                  title: "Personel",
                  key: "kisi",
                  render: (_, { kayit: k }) => (
                    <div className="fm-kisi">
                      <b className="fm-kisi-ad">
                        <PersonelAdi kod={k.personelKodu}>{k.adSoyad}</PersonelAdi>
                      </b>
                      <small>
                        {k.personelKodu} · {k.gorev}
                      </small>
                      <small>{k.sube}</small>
                    </div>
                  ),
                },
                {
                  title: "Form",
                  key: "form",
                  render: (_, { kayit: k }) => (
                    <div className="fm-kisi">
                      <span className={`fm-rozet ${TUR_SINIF[k.tur]}`}>{k.turAdi}</span>
                      <small>
                        {dayjs(k.tarih).format("DD.MM.YYYY")} · {k.baslangic}–{k.bitis}
                      </small>
                      <small style={{ color: "#8a9184" }}>{k.formNo}</small>
                      {k.aciklama ? <small>{k.aciklama}</small> : null}
                    </div>
                  ),
                },
                { title: "Süre", key: "sure", align: "right", render: (_, { kayit: k }) => sure(k.dk) },
                {
                  title: "Etki",
                  key: "etki",
                  align: "right",
                  render: (_, { kayit: k }) => (
                    <span style={renkEtki(k.etkiDk)}>
                      {isaretli(k.etkiDk)}
                      {k.tur === "fazla" ? <small style={{ display: "block", color: "#8a9184", fontWeight: 500 }}>×1,5</small> : null}
                    </span>
                  ),
                },
                {
                  title: "Bakiye",
                  key: "bakiye",
                  align: "right",
                  render: (_, { kayit: k, bakiye: b }) => {
                    const net = b?.netDk ?? 0;
                    const sonra = k.durum === "onaylandi" || k.durum === "reddedildi" ? null : net + k.etkiDk;
                    return (
                      <span style={{ whiteSpace: "nowrap" }}>
                        <span style={renkEtki(net)}>{isaretli(net)}</span>
                        {sonra != null ? (
                          <>
                            {" → "}
                            <span style={renkEtki(sonra)}>{isaretli(sonra)}</span>
                          </>
                        ) : null}
                      </span>
                    );
                  },
                },
                {
                  title: "Durum",
                  key: "durum",
                  render: (_, { kayit: k }) => (
                    <div className="fm-kisi">
                      <span className={`fm-rozet ${DURUM_SINIF[k.durum]}`}>{k.durumAdi}</span>
                      {k.yoneticiAd ? (
                        <small>
                          Yönetici: {k.yoneticiAd}
                          {k.yoneticiTarih ? ` · ${dayjs(k.yoneticiTarih).format("DD.MM HH:mm")}` : ""}
                        </small>
                      ) : null}
                      {k.ikAd ? (
                        <small>
                          İK: {k.ikAd}
                          {k.ikTarih ? ` · ${dayjs(k.ikTarih).format("DD.MM HH:mm")}` : ""}
                        </small>
                      ) : null}
                      {k.redNedeni ? <small style={{ color: "#c2410c" }}>{k.redNedeni}</small> : null}
                    </div>
                  ),
                },
                {
                  title: "",
                  key: "islem",
                  width: 260,
                  render: (_, { kayit: k }) => (
                    <div className="fm-dugmeler">
                      <Tooltip title="Formu aç / yazdır">
                        <button type="button" className="it-dg kucuk" onClick={() => formAc(k)}>
                          <Printer size={14} />
                        </button>
                      </Tooltip>
                      {k.belgeVar && (
                        <Tooltip title={`İmzalı form${k.belgeTarihi ? ` · ${dayjs(k.belgeTarihi).format("DD.MM HH:mm")}` : ""}`}>
                          <button type="button" className="it-dg kucuk" onClick={() => belgeAc(k)} style={{ color: "#1f4f82" }}>
                            <FileCheck2 size={14} />
                          </button>
                        </Tooltip>
                      )}
                      {(k.durum === "ik" || (ustRol && (k.durum === "yonetici" || k.durum === "imza"))) && (
                        <>
                          <button
                            type="button"
                            className="it-dg kucuk fm-onayla"
                            disabled={islenen === k.id}
                            onClick={() => karar(k, true)}
                          >
                            {k.durum === "ik" ? "Onayla" : "Adına onayla"}
                          </button>
                          <button type="button" className="it-dg kucuk fm-reddet" onClick={() => setRed(k)}>
                            Reddet
                          </button>
                        </>
                      )}
                    </div>
                  ),
                },
              ]}
            />
          </div>
        </div>
      )}

      <Modal
        open={!!red}
        title={red ? `${red.adSoyad} · ${red.turAdi} ${sure(red.dk)} reddedilsin mi?` : ""}
        okText="Reddet"
        okButtonProps={{ danger: true, disabled: sebep.trim().length < 3, loading: islenen === red?.id }}
        cancelText="Vazgeç"
        onOk={() => red && karar(red, false, sebep.trim())}
        onCancel={() => {
          setRed(null);
          setSebep("");
        }}
      >
        <Input.TextArea rows={3} value={sebep} onChange={(e) => setSebep(e.target.value)} placeholder="Red nedeni (personele gider)" maxLength={500} />
      </Modal>

      <KisiBakiyesi kisi={kisi} kapat={() => setKisi(null)} />
    </div>
  );
}

/* ------------------------------------------------------------- bakiyeler */

function Bakiyeler({ ac }: { ac: (kod: string, ad: string) => void }) {
  const { message } = AntdApp.useApp();
  const [veri, setVeri] = useState<any>(null);
  const [arama, setArama] = useState("");
  const [suz, setSuz] = useState<"hepsi" | "alacak" | "borc">("hepsi");

  const getir = useCallback(() => {
    setVeri(null);
    api
      .al<any>("/api/Denklestirme/Bakiyeler")
      .then(setVeri)
      .catch((h: any) => message.error(h?.message ?? "Bakiyeler alınamadı"));
  }, [message]);

  useEffect(() => {
    getir();
  }, [getir]);

  const liste = useMemo(() => {
    const a = arama.trim().toLocaleLowerCase("tr");
    return (veri?.kisiler ?? []).filter(
      (x: any) =>
        (suz === "hepsi" || (suz === "alacak" ? x.netDk > 0 : x.netDk < 0)) &&
        (!a || [x.adSoyad, x.kod, x.sube].some((v: string) => (v ?? "").toLocaleLowerCase("tr").includes(a)))
    );
  }, [veri, arama, suz]);

  const excel = () =>
    tabloIndir({
      baslik: "Denkleştirme bakiyeleri",
      altBaslik: `${dayjs().format("DD.MM.YYYY")} itibarıyla · onaylanan formlar ve karşılığı izin olan fazla mesailer`,
      sayfaAdi: "Bakiyeler",
      dosyaAdi: "denklestirme-bakiyeleri",
      sutunlar: [
        { ad: "Sicil", genislik: 9 },
        { ad: "Ad soyad", genislik: 24 },
        { ad: "Görev", genislik: 20 },
        { ad: "Şube", genislik: 22 },
        { ad: "Alacak (sa)", tip: "ondalik" },
        { ad: "Borç / kullanılan (sa)", tip: "ondalik" },
        { ad: "Net (sa)", tip: "ondalik", renkOlcegi: true },
        { ad: "Süreçteki form", tip: "sayi" },
      ],
      satirlar: liste.map((x: any) => [x.kod, x.adSoyad, x.gorev, x.sube, saatOndalik(x.alacakDk), saatOndalik(x.borcDk), saatOndalik(x.netDk), x.bekleyen]),
      genelToplam: true,
    });

  return (
    <div className="it-kart">
      <div className="it-kart-bas">
        <span className="it-kart-simge fm-simge">
          <Scale size={15} strokeWidth={2} />
        </span>
        <h3>Bakiyeler</h3>
        <span>
          {veri ? `toplam alacak ${sure(veri.toplamAlacakDk ?? 0)} · ${veri.borclu ?? 0} borçlu personel` : "hesaplanıyor…"}
        </span>
        <div className="it-sag">
          <Input allowClear size="small" prefix={<Search size={14} />} placeholder="Ad, sicil, şube" value={arama} onChange={(e) => setArama(e.target.value)} style={{ width: 190 }} />
          <Select
            size="small"
            value={suz}
            onChange={setSuz}
            style={{ width: 120 }}
            options={[
              { value: "hepsi", label: "Hepsi" },
              { value: "alacak", label: "Alacaklılar" },
              { value: "borc", label: "Borçlular" },
            ]}
          />
          <button type="button" className="it-dg kucuk" onClick={getir}>
            <RefreshCw size={14} strokeWidth={2} /> Yenile
          </button>
          <button type="button" className="it-dg kucuk" onClick={excel} disabled={!liste.length}>
            <Download size={14} strokeWidth={2} /> Excel
          </button>
        </div>
      </div>
      <div className="it-kart-ic">
        <Table
          rowKey="kod"
          size="small"
          loading={!veri}
          dataSource={liste}
          pagination={{ pageSize: 30, hideOnSinglePage: true }}
          onRow={(x: any) => ({ onClick: () => ac(x.kod, x.adSoyad), style: { cursor: "pointer" } })}
          columns={[
            {
              title: "Personel",
              key: "kisi",
              render: (_: any, x: any) => (
                <div className="fm-kisi">
                  <b className="fm-kisi-ad">{x.adSoyad}</b>
                  <small>
                    {x.kod} · {x.gorev ?? "ayrılmış"}
                  </small>
                </div>
              ),
            },
            { title: "Şube", dataIndex: "sube" },
            { title: "Alacak", key: "a", align: "right", render: (_: any, x: any) => <span style={renkEtki(x.alacakDk)}>+{sure(x.alacakDk)}</span> },
            { title: "Borç / kullanılan", key: "b", align: "right", render: (_: any, x: any) => <span style={renkEtki(-x.borcDk)}>−{sure(x.borcDk)}</span> },
            {
              title: "Net",
              key: "n",
              align: "right",
              sorter: (a: any, b: any) => a.netDk - b.netDk,
              render: (_: any, x: any) => <b style={renkEtki(x.netDk)}>{isaretli(x.netDk)}</b>,
            },
            { title: "Süreçte", dataIndex: "bekleyen", align: "right", render: (v: number) => (v ? `${v} form` : "") },
          ]}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- kişi */

function KisiBakiyesi({ kisi, kapat }: { kisi: { kod: string; ad: string } | null; kapat: () => void }) {
  const [veri, setVeri] = useState<any>(null);

  useEffect(() => {
    setVeri(null);
    if (!kisi) return;
    api
      .al<any>(`/api/Denklestirme/Bakiye/${encodeURIComponent(kisi.kod)}`)
      .then(setVeri)
      .catch(() => setVeri({ hata: true }));
  }, [kisi]);

  const hareketler = useMemo(() => {
    if (!veri?.formlar) return [];
    return [
      ...veri.formlar.map((f: any) => ({ ...f, kaynak: "form" })),
      ...(veri.fazlaMesai ?? []).map((f: any) => ({ ...f, kaynak: "fazlamesai", formNo: "Fazla mesai", durum: "onaylandi", durumAdi: "Otomatik" })),
    ].sort((a, b) => (a.tarih < b.tarih ? 1 : -1));
  }, [veri]);

  const b = veri?.bakiye;

  return (
    <Drawer open={!!kisi} onClose={kapat} width="min(620px, 100vw)" title={kisi ? `${kisi.ad} · denkleştirme` : ""}>
      {!veri ? (
        <Spin />
      ) : veri.hata ? (
        <div>Bakiye alınamadı.</div>
      ) : (
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ color: "#6b7280", fontSize: 13 }}>
            {veri.kod} · {veri.gorev ?? "—"} · {veri.sube ?? "—"}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
            {[
              ["Alacak", `+${sure(b.alacakDk)}`, b.alacakDk],
              ["Borç / kullanılan", `−${sure(b.borcDk)}`, -b.borcDk],
              ["Net", isaretli(b.netDk), b.netDk],
            ].map(([a, d, n]) => (
              <div key={a as string} style={{ background: "#f4f6f1", borderRadius: 12, padding: "10px 12px" }}>
                <div style={{ fontSize: 12, color: "#6b7280" }}>{a}</div>
                <div style={{ fontSize: 18, ...renkEtki(n as number) }}>{d}</div>
              </div>
            ))}
          </div>
          {b.netDk < 0 ? (
            <div style={{ fontSize: 13, color: "#9a3412" }}>Borcu kapatmak için {sure(Math.ceil(Math.abs(b.netDk) / 1.5))} fazla çalışma yeterli.</div>
          ) : null}
          <Table
            rowKey={(x: any) => `${x.kaynak}${x.id}`}
            size="small"
            pagination={false}
            dataSource={hareketler}
            columns={[
              {
                title: "Tarih",
                key: "t",
                render: (_: any, x: any) => (
                  <div className="fm-kisi">
                    <b>{dayjs(x.tarih).format("DD.MM.YYYY")}</b>
                    <small>
                      {x.baslangic}–{x.bitis}
                    </small>
                  </div>
                ),
              },
              {
                title: "Hareket",
                key: "h",
                render: (_: any, x: any) => (
                  <div className="fm-kisi">
                    <span>{x.kaynak === "fazlamesai" ? "Fazla mesai (karşılığı izin)" : x.turAdi}</span>
                    <small>{x.kaynak === "form" ? x.formNo : "fazla mesai modülünden"}</small>
                  </div>
                ),
              },
              { title: "Süre", key: "s", align: "right", render: (_: any, x: any) => sure(x.dk) },
              {
                title: "Etki",
                key: "e",
                align: "right",
                render: (_: any, x: any) => (
                  <span style={x.durum === "onaylandi" ? renkEtki(x.etkiDk) : { color: "#9aa093" }}>{isaretli(x.etkiDk)}</span>
                ),
              },
              {
                title: "Durum",
                key: "d",
                render: (_: any, x: any) => <span className={`fm-rozet ${DURUM_SINIF[x.durum] ?? "fm-r-gri"}`}>{x.durumAdi}</span>,
              },
            ]}
          />
          <small style={{ color: "#8a9184" }}>Bakiyeye yalnız onaylananlar işlenir; süreçteki formların etkisi soluk gösterilir.</small>
        </div>
      )}
    </Drawer>
  );
}
