/**
 * Stok Yönetimi
 * ---------------------------------------------------------------------------
 * Sipariş önerisi, sipariş takibi, şubeler arası transfer, raf denetimi,
 * depo stok durumu ve fire analizi tek sayfada; üstte pano.
 *
 * Hepsi salt görüntüleme: portal veriyi hesaplayıp gösteriyor, sipariş ve
 * transfer işlemleri Mikro'da yapılıyor.
 *
 * Her tabloda ürüne tıklayınca sağdan stok kartı ekstresi açılıyor —
 * hareket hareket miktar, yürüyen kalan, birim maliyet ve kaydı giren
 * kullanıcı. "Bu üründe ne olmuş" sorusunun cevabı her ekrandan bir
 * tık uzakta.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Drawer,
  Empty,
  Input,
  Segmented,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import dayjs, { Dayjs } from "dayjs";
import { api } from "../api";
import { Halka, Satirlar } from "../Grafik";

const { Text } = Typography;

/* -------------------------------------------------------------------------- */

const sayi = (d: any, basamak = 0) =>
  d === null || d === undefined || Number.isNaN(Number(d))
    ? "—"
    : Number(d).toLocaleString("tr-TR", {
        minimumFractionDigits: basamak,
        maximumFractionDigits: basamak,
      });

const para = (d: any) => (d === null || d === undefined ? "—" : `${sayi(d)} ₺`);

/** Sipariş durumlarının rengi; her ekranda aynı anlam. */
const DURUM_RENK: Record<string, string> = {
  "DEPODAN SİPARİŞ": "blue",
  "SATICIDAN SİPARİŞ": "orange",
  "ÇOK YAVAŞ SATIYOR": "default",
  "ÜRÜN HİÇ SATMIYOR": "default",
  "STOĞUNUZU DÜZELTİN": "red",
  "MAL KABULE KAPALI": "purple",
  YS: "red",
  ÜS: "gold",
  ÜY: "gold",
  MK: "purple",
};

const olcumKart = (baslik: string, deger: string, alt?: string, renk?: string) => (
  <Card size="small" key={baslik}>
    <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.5, color: renk }}>{deger}</div>
    <div style={{ fontSize: 12.5, color: "#5b6875", fontWeight: 600 }}>{baslik}</div>
    {alt && <div style={{ fontSize: 11.5, color: "#8d99a6", marginTop: 2 }}>{alt}</div>}
  </Card>
);

/* ========================================================================== */

export default function Stok() {
  const [depolar, setDepolar] = useState<any[]>([]);
  const [depo, setDepo] = useState<number | null>(null);
  const [bolum, setBolum] = useState("pano");
  const [kart, setKart] = useState<any>(null);

  /* Depo listesi bir kez; seçim tarayıcıda hatırlanıyor */
  useEffect(() => {
    api
      .getir<any>("Stok/Depolar")
      .then((c) => {
        setDepolar(c.depolar ?? []);

        const kayitli = Number(localStorage.getItem("stok.depo"));

        setDepo(
          kayitli && (c.depolar ?? []).some((d: any) => d.no === kayitli)
            ? kayitli
            : c.depolar?.[0]?.no ?? null
        );
      })
      .catch((h) => message.error(h.message));
  }, []);

  const depoSec = (no: number) => {
    setDepo(no);
    localStorage.setItem("stok.depo", String(no));
  };

  const depoAdi = depolar.find((d) => d.no === depo)?.ad ?? "";

  const ortak = { depo, depoAdi, kartAc: (stokKod: string, stokIsim: string) => setKart({ stokKod, stokIsim }) };

  return (
    <div>
      <Space wrap style={{ width: "100%", justifyContent: "space-between", marginBottom: 14 }}>
        <Space wrap>
          <Text strong style={{ fontSize: 16 }}>
            Stok Yönetimi
          </Text>

          <Select
            showSearch
            style={{ width: 260 }}
            placeholder="Depo seçin"
            value={depo ?? undefined}
            onChange={depoSec}
            optionFilterProp="label"
            options={depolar.map((d) => ({ value: d.no, label: `${d.ad} (${d.no})` }))}
          />
        </Space>

        <Segmented
          value={bolum}
          onChange={(v) => setBolum(String(v))}
          options={[
            { value: "pano", label: "Pano" },
            { value: "oneri", label: "Sipariş Önerisi" },
            { value: "takip", label: "Sipariş Takibi" },
            { value: "transfer", label: "Transfer" },
            { value: "raf", label: "Raf Denetimi" },
            { value: "depo", label: "Depo Durumu" },
            { value: "fire", label: "Fire" },
          ]}
        />
      </Space>

      {!depo ? (
        <Card size="small">
          <Empty description="Depo seçiniz." />
        </Card>
      ) : (
        <>
          {bolum === "pano" && <Pano {...ortak} git={setBolum} />}
          {bolum === "oneri" && <SiparisOnerisi {...ortak} />}
          {bolum === "takip" && <SiparisTakibi {...ortak} />}
          {bolum === "transfer" && <Transfer {...ortak} />}
          {bolum === "raf" && <RafDenetimi {...ortak} />}
          {bolum === "depo" && <DepoDurum {...ortak} />}
          {bolum === "fire" && <Fire {...ortak} />}
        </>
      )}

      <StokKarti kayit={kart} depo={depo} kapat={() => setKart(null)} />
    </div>
  );
}

/* ========================================================================== */
/* Ortak veri çekme                                                           */
/* ========================================================================== */

function useVeri(yol: string | null) {
  const [veri, setVeri] = useState<any>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);

  const getir = useCallback(
    async (yenile = false) => {
      if (!yol) return;

      setYukleniyor(true);
      setHata(null);

      try {
        setVeri(await api.getir<any>(yol + (yenile ? (yol.includes("?") ? "&" : "?") + "yenile=true" : "")));
      } catch (h: any) {
        setHata(h.message);
        setVeri(null);
      } finally {
        setYukleniyor(false);
      }
    },
    [yol]
  );

  useEffect(() => {
    getir();
  }, [getir]);

  useEffect(() => {
    if (hata) message.error(hata);
  }, [hata]);

  return { veri, yukleniyor, hata, getir };
}

/** Sorgu ağır olduğu için ilk açılış uzun sürebiliyor; bunu söylüyoruz. */
function Bekleme({ yukleniyor, hata }: { yukleniyor: boolean; hata: string | null }) {
  if (hata)
    return <Alert type="error" showIcon message="Veri alınamadı" description={hata} style={{ marginBottom: 12 }} />;

  if (!yukleniyor) return null;

  return (
    <Card size="small" style={{ marginBottom: 12 }}>
      <Space>
        <Spin size="small" />
        <Text type="secondary">
          Mikro'dan hesaplanıyor. İlk açılış bir dakikayı bulabilir; sonraki açılışlar önbellekten gelir.
        </Text>
      </Space>
    </Card>
  );
}

const hesapNotu = (hesap?: string) =>
  hesap ? `Son hesaplama: ${dayjs(hesap).format("DD.MM.YYYY HH:mm")}` : "";

/* ========================================================================== */
/* Pano                                                                       */
/* ========================================================================== */

function Pano({ depo, depoAdi, git }: any) {
  /* Dört bölüm ayrı ayrı ve paralel çekiliyor: biri uzun sürse de
     diğerleri geldikçe kartlar doluyor. Hepsini tek istekte beklemek
     panoyu dakikalarca boş bırakıyordu. */
  const [veri, setVeri] = useState<Record<string, any>>({});
  const [bekleyen, setBekleyen] = useState<string[]>([]);

  const getir = useCallback(
    (yenile = false) => {
      if (!depo) return;

      const bolumler = ["oneri", "depo", "raf", "transfer"];

      setBekleyen(bolumler);

      bolumler.forEach((b) => {
        api
          .getir<any>(`Stok/Pano?depo=${depo}&bolum=${b}${yenile ? "&yenile=true" : ""}`)
          .then((c) => setVeri((v) => ({ ...v, [b]: c[b] ?? c, hesap: c.hesap ?? v.hesap })))
          .catch((h) => message.error(`${b}: ${h.message}`))
          .finally(() => setBekleyen((x) => x.filter((k) => k !== b)));
      });
    },
    [depo]
  );

  useEffect(() => {
    setVeri({});
    getir();
  }, [getir]);

  const o = veri.oneri ?? {};
  const d = veri.depo ?? {};

  const bekliyor = (b: string) => bekleyen.includes(b);
  const goster = (b: string, deger: any, bicim: (x: any) => string) =>
    bekliyor(b) ? "…" : bicim(deger);

  const uyarilar = [
    d.eksi > 0 && {
      renk: "#cf1322",
      baslik: `${d.eksi} üründe eksi stok`,
      alt: "Mal kabul, transfer ya da sayım hatası",
      sayfa: "depo",
      ad: "Depo Durumu",
    },
    o.merkezYok > 0 && {
      renk: "#e8481c",
      baslik: `${o.merkezYok} üründe merkez stoğu yok`,
      alt: "Satıcıdan sipariş gerekiyor",
      sayfa: "oneri",
      ad: "Sipariş Önerisi",
    },
    o.yokSatma > 0 && {
      renk: "#b7791f",
      baslik: `${o.yokSatma} üründe yok satma riski`,
      alt: "Stok gün sayısı 3 günün altında",
      sayfa: "oneri",
      ad: "Sipariş Önerisi",
    },
    d.hareketsiz > 0 && {
      renk: "#1a4d80",
      baslik: `${d.hareketsiz} kalem 90+ gündür hareketsiz`,
      alt: `Ölü stok değeri ${para(d.oluDeger)}`,
      sayfa: "depo",
      ad: "Depo Durumu",
    },
    veri.transfer?.toplam > 0 && {
      renk: "#5f8c10",
      baslik: `${veri.transfer.toplam} ürün transferle karşılanabilir`,
      alt: "Başka şubede fazla stok var",
      sayfa: "transfer",
      ad: "Transfer",
    },
    veri.raf?.toplam > 0 && {
      renk: "#5b3fa8",
      baslik: `${veri.raf.toplam} ürün raf denetimi bekliyor`,
      alt: "Başka mağazalarda satıyor, burada satmıyor",
      sayfa: "raf",
      ad: "Raf Denetimi",
    },
  ].filter(Boolean) as any[];

  return (
    <>
      <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 10 }}>
        <Space size={8}>
          {bekleyen.length > 0 && <Spin size="small" />}
          <Text type="secondary" style={{ fontSize: 12.5 }}>
            {depoAdi}
            {bekleyen.length > 0
              ? ` · ${bekleyen.length} bölüm hesaplanıyor, ilk açılış bir dakikayı bulabilir`
              : ` · ${hesapNotu(veri.hesap)}`}
          </Text>
        </Space>
        <Button size="small" onClick={() => getir(true)} loading={bekleyen.length > 0}>
          Yenile
        </Button>
      </Space>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
        {olcumKart(
          "Sipariş önerisi",
          goster("oneri", o.toplam, (x) => sayi(x)),
          bekliyor("oneri") ? "hesaplanıyor" : `${sayi(o.yokSatma)} yok satma riski`,
          "#e8481c"
        )}
        {olcumKart("Önerilen tutar", goster("oneri", o.tutar, para))}
        {olcumKart(
          "Stoklu kalem",
          goster("depo", d.kalem, (x) => sayi(x)),
          bekliyor("depo") ? "hesaplanıyor" : `Envanter ${para(d.deger)}`
        )}
        {olcumKart(
          "Eksi bakiyeli",
          goster("depo", d.eksi, (x) => sayi(x)),
          "düzeltme gerekli",
          d.eksi > 0 ? "#cf1322" : undefined
        )}
      </div>

      {/* Grafikler: sipariş dağılımı, stok sağlığı, öneri çıkan reyonlar */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1.3fr", gap: 10, marginTop: 12 }}>
        <Card size="small" title="Sipariş önerisi dağılımı">
          {bekliyor("oneri") ? (
            <Spin />
          ) : (
            <Halka
              etiket="ürün"
              dilimler={[
                { ad: "Depodan", deger: o.depodan ?? 0, renk: "#1a4d80" },
                { ad: "Satıcıdan", deger: o.merkezYok ?? 0, renk: "#e8481c" },
                { ad: "Yavaş satan", deger: o.yavas ?? 0, renk: "#b7791f" },
              ]}
            />
          )}
        </Card>

        <Card size="small" title="Stok sağlığı">
          {bekliyor("depo") ? (
            <Spin />
          ) : (
            <Halka
              etiket="kalem"
              dilimler={[
                {
                  ad: "Normal",
                  deger: Math.max(0, (d.kalem ?? 0) - (d.eksi ?? 0) - (d.hareketsiz ?? 0)),
                  renk: "#7cb518",
                },
                { ad: "Hareketsiz", deger: d.hareketsiz ?? 0, renk: "#b7791f" },
                { ad: "Eksi bakiye", deger: d.eksi ?? 0, renk: "#cf1322" },
              ]}
            />
          )}
        </Card>

        <Card size="small" title="Sipariş önerisi çıkan reyonlar">
          {bekliyor("oneri") ? (
            <Spin />
          ) : (
            <Satirlar
              renk="#7cb518"
              kayitlar={(o.reyonlar ?? []).map((r: any) => ({
                ad: r.ad,
                deger: r.adet,
                yan: `${sayi(r.adet)} ürün`,
                bas: () => git("oneri"),
              }))}
            />
          )}
        </Card>
      </div>

      <Card size="small" title="Dikkat isteyenler" style={{ marginTop: 12 }}>
        {bekleyen.length > 0 && uyarilar.length === 0 ? (
          <Space>
            <Spin size="small" />
            <Text type="secondary">Hesaplanıyor…</Text>
          </Space>
        ) : uyarilar.length === 0 ? (
          <Text type="secondary">Bu depoda dikkat isteyen bir durum görünmüyor.</Text>
        ) : (
          uyarilar.map((u, i) => (
            <div
              key={i}
              onClick={() => git(u.sayfa)}
              style={{
                display: "flex",
                gap: 10,
                alignItems: "center",
                padding: "10px 0",
                borderBottom: i < uyarilar.length - 1 ? "1px solid #f0f3ee" : undefined,
                cursor: "pointer",
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: 4, background: u.renk, flex: "none" }} />
              <div style={{ flex: 1 }}>
                <b style={{ fontSize: 13 }}>{u.baslik}</b>
                <div style={{ fontSize: 11.5, color: "#8d99a6" }}>{u.alt}</div>
              </div>
              <Text style={{ fontSize: 12, color: "#5f8c10", fontWeight: 700 }}>{u.ad} →</Text>
            </div>
          ))
        )}
      </Card>

      <Alert
        style={{ marginTop: 12 }}
        type="info"
        showIcon
        message="Bu bölüm salt görüntülemedir"
        description="Veriler Mikro'dan hesaplanıp gösterilir. Sipariş, transfer ve stok düzeltme işlemleri Mikro üzerinden yapılır."
      />
    </>
  );
}

/* ========================================================================== */
/* Sipariş önerisi                                                            */
/* ========================================================================== */

function SiparisOnerisi({ depo, kartAc }: any) {
  const { veri, yukleniyor, hata, getir } = useVeri(depo ? `Stok/SiparisOnerisi?depo=${depo}` : null);

  const [suz, setSuz] = useState("hepsi");
  const [ara, setAra] = useState("");

  const kayitlar = veri?.kayitlar ?? [];

  const liste = useMemo(() => {
    const q = ara.trim().toLocaleLowerCase("tr");

    return kayitlar.filter((k: any) => {
      if (suz === "depodan" && k.durum !== "DEPODAN SİPARİŞ") return false;
      if (suz === "saticidan" && k.durum !== "SATICIDAN SİPARİŞ") return false;
      if (suz === "riskli" && !(Number(k.sdg) <= 3)) return false;
      if (suz === "sorunlu" && !["STOĞUNUZU DÜZELTİN", "ÇOK YAVAŞ SATIYOR", "ÜRÜN HİÇ SATMIYOR"].includes(k.durum))
        return false;

      if (q) {
        const metin = `${k.stokIsim} ${k.stokKod} ${k.barkod} ${k.satici ?? ""}`.toLocaleLowerCase("tr");
        if (!metin.includes(q)) return false;
      }

      return true;
    });
  }, [kayitlar, suz, ara]);

  return (
    <>
      <Bekleme yukleniyor={yukleniyor} hata={hata} />

      {kayitlar.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10, marginBottom: 12 }}>
          {olcumKart("Öneri çıkan ürün", sayi(kayitlar.length))}
          {olcumKart(
            "Önerilen tutar",
            para(kayitlar.reduce((a: number, k: any) => a + Number(k.oneri ?? 0) * Number(k.fiyat ?? 0), 0))
          )}
          {olcumKart(
            "Yok satma riski",
            sayi(kayitlar.filter((k: any) => Number(k.sdg) <= 3).length),
            "SDG 3 günün altında",
            "#cf1322"
          )}
          {olcumKart("Eksi stoklu", sayi(kayitlar.filter((k: any) => Number(k.stok) < 0).length), "önce düzeltme gerekli")}
        </div>
      )}

      <Space wrap style={{ width: "100%", justifyContent: "space-between", marginBottom: 10 }}>
        <Segmented
          value={suz}
          onChange={(v) => setSuz(String(v))}
          options={[
            { value: "hepsi", label: `Tümü · ${kayitlar.length}` },
            { value: "depodan", label: `Depodan · ${kayitlar.filter((k: any) => k.durum === "DEPODAN SİPARİŞ").length}` },
            { value: "saticidan", label: `Satıcıdan · ${kayitlar.filter((k: any) => k.durum === "SATICIDAN SİPARİŞ").length}` },
            { value: "riskli", label: `Yok satma riski · ${kayitlar.filter((k: any) => Number(k.sdg) <= 3).length}` },
            { value: "sorunlu", label: "Sorunlu" },
          ]}
        />

        <Space>
          <Input.Search allowClear placeholder="Ürün, barkod ya da tedarikçi" style={{ width: 260 }} onChange={(e) => setAra(e.target.value)} />
          <Button onClick={() => getir(true)} loading={yukleniyor}>
            Yenile
          </Button>
        </Space>
      </Space>

      <Text type="secondary" style={{ fontSize: 12 }}>
        {hesapNotu(veri?.hesap)}
      </Text>

      <Table
        rowKey="stokKod"
        size="small"
        style={{ marginTop: 8 }}
        loading={yukleniyor}
        dataSource={liste}
        scroll={{ x: 1100 }}
        pagination={{ pageSize: 50, showSizeChanger: true }}
        columns={[
          {
            title: "Ürün",
            fixed: "left" as const,
            width: 280,
            render: (_: unknown, k: any) => (
              <a onClick={() => kartAc(k.stokKod, k.stokIsim)}>
                <b>{k.stokIsim}</b>
                <div style={{ fontSize: 11.5, color: "#8d99a6" }}>
                  {k.stokKod} · {k.anaGrup}
                </div>
              </a>
            ),
          },
          {
            title: "Durum",
            dataIndex: "durum",
            width: 170,
            render: (d: string) => <Tag color={DURUM_RENK[d] ?? "default"}>{d}</Tag>,
          },
          {
            title: "Kendi stok",
            dataIndex: "stok",
            align: "right" as const,
            width: 100,
            render: (d: any) => (
              <span style={{ color: Number(d) < 0 ? "#cf1322" : undefined, fontWeight: Number(d) < 0 ? 800 : 400 }}>
                {sayi(d, 1)}
              </span>
            ),
          },
          { title: "Merkez", dataIndex: "merkezStok", align: "right" as const, width: 90, render: (d: any) => sayi(d, 1) },
          { title: "21 gün satış", dataIndex: "satis", align: "right" as const, width: 100, render: (d: any) => sayi(d, 1) },
          {
            title: "SDG",
            dataIndex: "sdg",
            align: "right" as const,
            width: 80,
            render: (d: any) => (
              <Tooltip title="Stok kaç güne yeter">
                <span style={{ fontWeight: Number(d) <= 3 ? 800 : 400, color: Number(d) <= 3 ? "#cf1322" : undefined }}>
                  {sayi(d)}
                </span>
              </Tooltip>
            ),
          },
          { title: "Koli", dataIndex: "koli", align: "right" as const, width: 70, render: (d: any) => sayi(d) },
          {
            title: "Öneri",
            dataIndex: "oneri",
            align: "right" as const,
            width: 90,
            render: (d: any) => <b>{sayi(d)}</b>,
          },
          { title: "Tedarikçi", dataIndex: "satici", width: 200, ellipsis: true },
        ]}
      />
    </>
  );
}

/* ========================================================================== */
/* Sipariş takibi                                                             */
/* ========================================================================== */

function SiparisTakibi({ depo, kartAc }: any) {
  const [aralik, setAralik] = useState<[Dayjs, Dayjs]>([dayjs().add(-7, "day"), dayjs()]);
  const [sekme, setSekme] = useState("siparis");
  const [gun, setGun] = useState(3);

  const yol =
    sekme === "siparis"
      ? `Stok/SiparisTakibi?depo=${depo}&bas=${aralik[0].format("YYYY-MM-DD")}&bit=${aralik[1].format("YYYY-MM-DD")}`
      : `Stok/MalGirisleri?depo=${depo}&gun=${gun}`;

  const { veri, yukleniyor, hata, getir } = useVeri(depo ? yol : null);

  const kayitlar = veri?.kayitlar ?? [];
  const eksik = kayitlar.filter((k: any) => Number(k.eksik) > 0);

  return (
    <>
      <Bekleme yukleniyor={yukleniyor} hata={hata} />

      <Space wrap style={{ width: "100%", justifyContent: "space-between", marginBottom: 10 }}>
        <Segmented
          value={sekme}
          onChange={(v) => setSekme(String(v))}
          options={[
            { value: "siparis", label: "Siparişlerim" },
            { value: "giris", label: "Mal girişleri" },
          ]}
        />

        <Space>
          {sekme === "siparis" ? (
            <DatePicker.RangePicker
              value={aralik}
              format="DD.MM.YYYY"
              allowClear={false}
              onChange={(d) => d && setAralik(d as [Dayjs, Dayjs])}
            />
          ) : (
            <Select
              value={gun}
              style={{ width: 150 }}
              onChange={setGun}
              options={[
                { value: 1, label: "Bugün" },
                { value: 3, label: "Son 3 gün" },
                { value: 7, label: "Son 7 gün" },
                { value: 30, label: "Son 30 gün" },
              ]}
            />
          )}
          <Button onClick={() => getir(true)} loading={yukleniyor}>
            Yenile
          </Button>
        </Space>
      </Space>

      {sekme === "siparis" ? (
        <>
          {eksik.length > 0 && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 10 }}
              message={`${eksik.length} siparişte eksik geldi`}
              description="Merkez stoğu sütunu, siparişin verildiği gün merkezde ne kadar olduğunu gösterir."
            />
          )}

          <Table
            rowKey="kayitNo"
            size="small"
            loading={yukleniyor}
            dataSource={kayitlar}
            scroll={{ x: 1100 }}
            pagination={{ pageSize: 50 }}
            columns={[
              { title: "Evrak", dataIndex: "evrak", width: 130 },
              { title: "Tarih", dataIndex: "tarih", width: 110, render: (d: any) => dayjs(d).format("DD.MM.YYYY") },
              {
                title: "Ürün",
                width: 280,
                render: (_: unknown, k: any) => (
                  <a onClick={() => kartAc(k.stokKod, k.stokIsim)}>
                    <b>{k.stokIsim}</b>
                    <div style={{ fontSize: 11.5, color: "#8d99a6" }}>{k.stokKod}</div>
                  </a>
                ),
              },
              { title: "İstenen", dataIndex: "istenen", align: "right" as const, width: 90, render: (d: any) => sayi(d, 1) },
              { title: "Gelen", dataIndex: "gelen", align: "right" as const, width: 90, render: (d: any) => sayi(d, 1) },
              {
                title: "Eksik",
                dataIndex: "eksik",
                align: "right" as const,
                width: 90,
                render: (d: any) =>
                  Number(d) > 0 ? <b style={{ color: "#cf1322" }}>{sayi(d, 1)}</b> : <span style={{ color: "#8d99a6" }}>—</span>,
              },
              {
                title: "Merkez stok",
                dataIndex: "merkezStok",
                align: "right" as const,
                width: 110,
                render: (d: any) => sayi(d, 1),
              },
              { title: "Palet", dataIndex: "palet", width: 130, render: (d: any) => d ?? "—" },
              {
                title: "Durum",
                width: 150,
                render: (_: unknown, k: any) => {
                  const d = k.paletDurum ?? (k.nakliye === "teslim" ? "Teslim alındı" : k.nakliye === "yolda" ? "Yolda" : null);

                  if (Number(k.eksik) > 0 && !k.gelen) return <Tag color="red">Gelmedi</Tag>;
                  if (Number(k.eksik) > 0) return <Tag color="orange">Eksik geldi</Tag>;
                  if (d === "Yolda") return <Tag color="gold">Yolda</Tag>;
                  if (d) return <Tag color="green">{d}</Tag>;

                  return <Tag>Bekliyor</Tag>;
                },
              },
            ]}
          />
        </>
      ) : (
        <Table
          rowKey={(k: any) => `${k.stokKod}-${k.tarih}-${k.miktar}`}
          size="small"
          loading={yukleniyor}
          dataSource={kayitlar}
          scroll={{ x: 900 }}
          pagination={{ pageSize: 50 }}
          columns={[
            { title: "Tarih", dataIndex: "tarih", width: 140, render: (d: any) => dayjs(d).format("DD.MM.YYYY HH:mm") },
            {
              title: "Ürün",
              width: 300,
              render: (_: unknown, k: any) => (
                <a onClick={() => kartAc(k.stokKod, k.stokIsim)}>
                  <b>{k.stokIsim}</b>
                  <div style={{ fontSize: 11.5, color: "#8d99a6" }}>{k.stokKod}</div>
                </a>
              ),
            },
            { title: "Miktar", dataIndex: "miktar", align: "right" as const, width: 90, render: (d: any) => sayi(d, 1) },
            { title: "Evrak türü", dataIndex: "evrakTuru", width: 160 },
            { title: "Karşı depo", dataIndex: "karsiDepo", width: 160 },
            { title: "Firma", dataIndex: "firma", ellipsis: true },
          ]}
        />
      )}
    </>
  );
}

/* ========================================================================== */
/* Transfer                                                                   */
/* ========================================================================== */

function Transfer({ depo, kartAc }: any) {
  const [yon, setYon] = useState("gelen");

  const { veri, yukleniyor, hata, getir } = useVeri(depo ? `Stok/Transfer?depo=${depo}&yon=${yon}` : null);

  const [depolar, setDepolar] = useState<Record<number, string>>({});

  useEffect(() => {
    api
      .getir<any>("Stok/Depolar")
      .then((c) => setDepolar(Object.fromEntries((c.depolar ?? []).map((d: any) => [d.no, d.ad]))))
      .catch(() => setDepolar({}));
  }, []);

  const kayitlar = veri?.kayitlar ?? [];

  return (
    <>
      <Bekleme yukleniyor={yukleniyor} hata={hata} />

      <Space wrap style={{ width: "100%", justifyContent: "space-between", marginBottom: 10 }}>
        <Segmented
          value={yon}
          onChange={(v) => setYon(String(v))}
          options={[
            { value: "gelen", label: "Bana gelebilecekler" },
            { value: "veren", label: "Verebileceklerim" },
          ]}
        />
        <Button onClick={() => getir(true)} loading={yukleniyor}>
          Yenile
        </Button>
      </Space>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 10 }}
        message={
          yon === "gelen"
            ? "Burada yok satan, başka şubede fazla duran ürünler"
            : "Burada fazla duran, başka şubede yok satan ürünler"
        }
        description="Öneri miktarı, veren şubenin stoğunun yarısıdır; karşı şube açıkta kalmaz. Transfer işlemi Mikro'da yapılır."
      />

      <Table
        rowKey={(k: any) => `${k.stokKod}-${k.karsiDepo}`}
        size="small"
        loading={yukleniyor}
        dataSource={kayitlar}
        scroll={{ x: 1000 }}
        pagination={{ pageSize: 50 }}
        columns={[
          {
            title: "Ürün",
            fixed: "left" as const,
            width: 280,
            render: (_: unknown, k: any) => (
              <a onClick={() => kartAc(k.stokKod, k.stokIsim)}>
                <b>{k.stokIsim}</b>
                <div style={{ fontSize: 11.5, color: "#8d99a6" }}>
                  {k.stokKod} · {k.anaGrup}
                </div>
              </a>
            ),
          },
          {
            title: yon === "gelen" ? "Bendeki durum" : "Karşı şube durumu",
            width: 130,
            render: (_: unknown, k: any) => {
              const d = yon === "gelen" ? k.durum : k.karsiDurum;
              return <Tag color={DURUM_RENK[d] ?? "default"}>{d}</Tag>;
            },
          },
          {
            title: "Karşı şube",
            dataIndex: "karsiDepo",
            width: 180,
            render: (d: number) => <b>{depolar[d] ?? `Depo ${d}`}</b>,
          },
          { title: "Bendeki stok", dataIndex: "stok", align: "right" as const, width: 110, render: (d: any) => sayi(d, 1) },
          { title: "Bendeki SDG", dataIndex: "sdg", align: "right" as const, width: 110, render: (d: any) => sayi(d) },
          { title: "Onda stok", dataIndex: "karsiStok", align: "right" as const, width: 100, render: (d: any) => sayi(d, 1) },
          { title: "Onun SDG", dataIndex: "karsiSdg", align: "right" as const, width: 100, render: (d: any) => sayi(d) },
          {
            title: "Öneri",
            dataIndex: "oneri",
            align: "right" as const,
            width: 90,
            render: (d: any) => <b>{sayi(d)}</b>,
          },
        ]}
      />
    </>
  );
}

/* ========================================================================== */
/* Raf denetimi                                                               */
/* ========================================================================== */

function RafDenetimi({ depo, kartAc }: any) {
  const { veri, yukleniyor, hata, getir } = useVeri(depo ? `Stok/RafDenetimi?depo=${depo}` : null);

  const kayitlar = veri?.kayitlar ?? [];

  return (
    <>
      <Bekleme yukleniyor={yukleniyor} hata={hata} />

      <Space wrap style={{ width: "100%", justifyContent: "space-between", marginBottom: 10 }}>
        <Text type="secondary" style={{ fontSize: 12.5 }}>
          {kayitlar.length} ürün · {hesapNotu(veri?.hesap)}
        </Text>
        <Space>
          <Button onClick={() => window.print()}>Yazdır</Button>
          <Button onClick={() => getir(true)} loading={yukleniyor}>
            Yenile
          </Button>
        </Space>
      </Space>

      {kayitlar.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10, marginBottom: 12 }}>
          {olcumKart("Kontrol bekleyen", sayi(kayitlar.length))}
          {olcumKart("Bekleyen stok adedi", sayi(kayitlar.reduce((a: number, k: any) => a + Number(k.stok ?? 0), 0), 1))}
          {olcumKart(
            "Ortalama satmama süresi",
            `${sayi(kayitlar.reduce((a: number, k: any) => a + Number(k.satisGun ?? 0), 0) / kayitlar.length)} gün`
          )}
          {olcumKart(
            "En çok ürün çıkan reyon",
            (() => {
              const g: Record<string, number> = {};
              kayitlar.forEach((x: any) => (g[x.anaGrup || "—"] = (g[x.anaGrup || "—"] ?? 0) + 1));
              const en = Object.entries(g).sort((a, b) => b[1] - a[1])[0];
              return en ? en[0] : "—";
            })()
          )}
        </div>
      )}

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 10 }}
        message="Stokta duruyor, burada satmıyor, başka mağazalarda satıyor"
        description="Bu ürünler en az 20 mağazada iyi satıyor ama burada 15 günden uzun süredir hareket görmemiş. Sorun büyük ihtimalle üründe değil: raf arkasında, etiketi yok ya da yanlış reyonda olabilir. Liste reyon sırasına göre dizilidir."
      />

      <Table
        rowKey="stokKod"
        size="small"
        loading={yukleniyor}
        dataSource={kayitlar}
        scroll={{ x: 1000 }}
        pagination={{ pageSize: 100 }}
        columns={[
          {
            title: "Ürün",
            fixed: "left" as const,
            width: 300,
            render: (_: unknown, k: any) => (
              <a onClick={() => kartAc(k.stokKod, k.stokIsim)}>
                <b>{k.stokIsim}</b>
                <div style={{ fontSize: 11.5, color: "#8d99a6" }}>
                  {k.stokKod} · {k.barkod}
                </div>
              </a>
            ),
          },
          { title: "Ana grup", dataIndex: "anaGrup", width: 170, ellipsis: true },
          { title: "Kategori", dataIndex: "kategori", width: 170, ellipsis: true },
          { title: "Stok", dataIndex: "stok", align: "right" as const, width: 90, render: (d: any) => sayi(d, 1) },
          {
            title: "Kaç gündür satmıyor",
            dataIndex: "satisGun",
            align: "right" as const,
            width: 150,
            render: (d: any) => <b>{sayi(d)} gün</b>,
          },
          { title: "Kaç gün önce geldi", dataIndex: "girisGun", align: "right" as const, width: 140, render: (d: any) => `${sayi(d)} gün` },
          {
            title: "Kaç mağazada satıyor",
            dataIndex: "magazaSayisi",
            align: "right" as const,
            width: 160,
            render: (d: any) => (
              <Tooltip title="Bu ürün kaç mağazada iyi satıyor">
                <b style={{ color: "#5f8c10" }}>{sayi(d)}</b>
              </Tooltip>
            ),
          },
          {
            title: "Durum",
            dataIndex: "durum",
            width: 90,
            render: (d: string) => <Tag color={DURUM_RENK[d] ?? "default"}>{d}</Tag>,
          },
        ]}
      />
    </>
  );
}

/* ========================================================================== */
/* Depo durumu                                                                */
/* ========================================================================== */

function DepoDurum({ depo, kartAc }: any) {
  const { veri, yukleniyor, hata, getir } = useVeri(depo ? `Stok/DepoDurum?depo=${depo}` : null);

  const [suz, setSuz] = useState("hepsi");
  const [ara, setAra] = useState("");

  const kayitlar = veri?.kayitlar ?? [];
  const eksi = kayitlar.filter((k: any) => Number(k.stok) < 0);
  const hareketsiz = kayitlar.filter((k: any) => Number(k.hareketsizGun) >= 90);

  const liste = useMemo(() => {
    const q = ara.trim().toLocaleLowerCase("tr");

    return kayitlar.filter((k: any) => {
      if (suz === "eksi" && !(Number(k.stok) < 0)) return false;
      if (suz === "hareketsiz" && !(Number(k.hareketsizGun) >= 90)) return false;

      if (q) {
        const metin = `${k.stokIsim} ${k.stokKod} ${k.barkod} ${k.satici ?? ""}`.toLocaleLowerCase("tr");
        if (!metin.includes(q)) return false;
      }

      return true;
    });
  }, [kayitlar, suz, ara]);

  const deger = (k: any) => Number(k.stok ?? 0) * Number(k.fiyat ?? 0);

  return (
    <>
      <Bekleme yukleniyor={yukleniyor} hata={hata} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10, marginBottom: 12 }}>
        {olcumKart("Stoklu kalem", sayi(kayitlar.length))}
        {olcumKart("Envanter değeri", para(kayitlar.reduce((a: number, k: any) => a + deger(k), 0)))}
        {olcumKart("Eksi bakiyeli", sayi(eksi.length), "düzeltme gerekli", eksi.length ? "#cf1322" : undefined)}
        {olcumKart("90+ gün hareketsiz", sayi(hareketsiz.length), para(hareketsiz.reduce((a: number, k: any) => a + deger(k), 0)))}
      </div>

      <Space wrap style={{ width: "100%", justifyContent: "space-between", marginBottom: 10 }}>
        <Segmented
          value={suz}
          onChange={(v) => setSuz(String(v))}
          options={[
            { value: "hepsi", label: `Tümü · ${kayitlar.length}` },
            { value: "eksi", label: `Eksi bakiyeli · ${eksi.length}` },
            { value: "hareketsiz", label: `Hareketsiz · ${hareketsiz.length}` },
          ]}
        />
        <Space>
          <Input.Search allowClear placeholder="Ürün, barkod ya da tedarikçi" style={{ width: 260 }} onChange={(e) => setAra(e.target.value)} />
          <Button onClick={() => getir(true)} loading={yukleniyor}>
            Yenile
          </Button>
        </Space>
      </Space>

      <Table
        rowKey="stokKod"
        size="small"
        loading={yukleniyor}
        dataSource={liste}
        scroll={{ x: 1000 }}
        pagination={{ pageSize: 50, showSizeChanger: true }}
        columns={[
          {
            title: "Ürün",
            fixed: "left" as const,
            width: 300,
            render: (_: unknown, k: any) => (
              <a onClick={() => kartAc(k.stokKod, k.stokIsim)}>
                <b>{k.stokIsim}</b>
                <div style={{ fontSize: 11.5, color: "#8d99a6" }}>
                  {k.stokKod} · {k.anaGrup}
                </div>
              </a>
            ),
          },
          { title: "Tedarikçi", dataIndex: "satici", width: 200, ellipsis: true },
          {
            title: "Stok",
            dataIndex: "stok",
            align: "right" as const,
            width: 100,
            render: (d: any) => (
              <span style={{ color: Number(d) < 0 ? "#cf1322" : undefined, fontWeight: Number(d) < 0 ? 800 : 400 }}>
                {sayi(d, 1)}
              </span>
            ),
          },
          { title: "Değer", align: "right" as const, width: 120, render: (_: unknown, k: any) => para(deger(k)) },
          {
            title: "Son hareket",
            dataIndex: "sonHareket",
            align: "right" as const,
            width: 130,
            render: (d: any) => (d ? dayjs(d).format("DD.MM.YYYY") : "—"),
          },
          {
            title: "Durum",
            width: 130,
            render: (_: unknown, k: any) =>
              Number(k.stok) < 0 ? (
                <Tag color="red">Eksi bakiye</Tag>
              ) : Number(k.hareketsizGun) >= 90 ? (
                <Tag color="gold">{sayi(k.hareketsizGun)} gün hareketsiz</Tag>
              ) : (
                <Tag color="green">Normal</Tag>
              ),
          },
        ]}
      />
    </>
  );
}

/* ========================================================================== */
/* Fire                                                                       */
/* ========================================================================== */

function Fire({ depo, kartAc }: any) {
  const [yil, setYil] = useState(dayjs().year());

  /* Fire toplamının nereden geldiğini görmek için ürün bazında hareket
     listesi: hangi gün, hangi evrakla, ne kadar. */
  const [detay, setDetay] = useState<any>(null);

  const { veri, yukleniyor, hata, getir } = useVeri(depo ? `Stok/Fire?depo=${depo}&yil=${yil}` : null);

  const kayitlar = veri?.kayitlar ?? [];
  const toplam = kayitlar.reduce((a: number, k: any) => a + Number(k.tutar ?? 0), 0);
  const receteli = kayitlar.filter((k: any) => k.receteli);

  const AYLAR = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

  /* Isı haritası: en yüksek aylık miktara göre koyuluk */
  const enYuksek = Math.max(
    1,
    ...kayitlar.flatMap((k: any) => AYLAR.map((_, i) => Math.abs(Number(k[`ay${i + 1}`] ?? 0))))
  );

  return (
    <>
      <Bekleme yukleniyor={yukleniyor} hata={hata} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10, marginBottom: 12 }}>
        {olcumKart(`${yil} fire tutarı`, para(toplam), undefined, "#cf1322")}
        {olcumKart("Kalem sayısı", sayi(kayitlar.length))}
        {olcumKart("Reçeteli ürün payı", `%${sayi(kayitlar.length ? (receteli.length / kayitlar.length) * 100 : 0)}`, "üretim kaybı")}
        {olcumKart(
          "En yüksek kalem",
          kayitlar[0] ? para(kayitlar[0].tutar) : "—",
          kayitlar[0]?.stokIsim
        )}
      </div>

      <Space wrap style={{ width: "100%", justifyContent: "space-between", marginBottom: 10 }}>
        <Select
          value={yil}
          style={{ width: 140 }}
          onChange={setYil}
          options={[0, 1, 2, 3].map((i) => ({ value: dayjs().year() - i, label: String(dayjs().year() - i) }))}
        />
        <Button onClick={() => getir(true)} loading={yukleniyor}>
          Yenile
        </Button>
      </Space>

      <Table
        rowKey="stokKod"
        size="small"
        loading={yukleniyor}
        dataSource={kayitlar}
        scroll={{ x: 1400 }}
        pagination={{ pageSize: 50 }}
        columns={[
          {
            title: "Ürün",
            fixed: "left" as const,
            width: 260,
            render: (_: unknown, k: any) => (
              <a onClick={() => kartAc(k.stokKod, k.stokIsim)}>
                <b>{k.stokIsim}</b>
                <div style={{ fontSize: 11.5, color: "#8d99a6" }}>{k.anaGrup}</div>
              </a>
            ),
          },
          {
            title: "Reçete",
            dataIndex: "receteli",
            width: 90,
            render: (d: any) => (d ? <Tag color="purple">Reçeteli</Tag> : <Tag>—</Tag>),
          },
          {
            title: "",
            width: 80,
            render: (_: unknown, k: any) => (
              <Button size="small" onClick={() => setDetay(k)}>
                Detay
              </Button>
            ),
          },
          { title: "Miktar", dataIndex: "miktar", align: "right" as const, width: 100, render: (d: any) => sayi(d, 1) },
          { title: "Tutar", dataIndex: "tutar", align: "right" as const, width: 120, render: (d: any) => <b>{para(d)}</b> },
          ...AYLAR.map((ad, i) => ({
            title: ad,
            dataIndex: `ay${i + 1}`,
            align: "right" as const,
            width: 72,
            render: (d: any) => {
              const v = Number(d ?? 0);

              if (!v) return <span style={{ color: "#d8ddd4" }}>—</span>;

              const t = Math.min(1, Math.abs(v) / enYuksek);

              return (
                <span
                  style={{
                    display: "inline-block",
                    width: "100%",
                    textAlign: "center",
                    borderRadius: 6,
                    padding: "2px 0",
                    fontSize: 11.5,
                    fontWeight: 700,
                    background: `rgba(207,19,34,${0.07 + t * 0.33})`,
                    color: t > 0.7 ? "#7a1a1a" : "#5b6875",
                  }}
                >
                  {sayi(v, 1)}
                </span>
              );
            },
          })),
        ]}
      />

      <FireDetay kayit={detay} depo={depo} yil={yil} kapat={() => setDetay(null)} kartAc={kartAc} />
    </>
  );
}

/** Bir ürünün o yıldaki fire hareketleri. */
function FireDetay({ kayit, depo, yil, kapat, kartAc }: any) {
  const yol =
    kayit && depo
      ? `Stok/FireDetay?stok=${encodeURIComponent(kayit.stokKod)}&depo=${depo}&yil=${yil}`
      : null;

  const { veri, yukleniyor, hata } = useVeri(yol);

  const hareketler = veri?.hareketler ?? [];
  const toplam = hareketler.reduce((a: number, h: any) => a + Math.abs(Number(h.miktar ?? 0)), 0);

  return (
    <Drawer open={!!kayit} width={680} onClose={kapat} title={kayit?.stokIsim ?? ""}>
      {!kayit ? null : (
        <>
          <Space split="·" wrap>
            <Text type="secondary">{kayit.stokKod}</Text>
            <Text type="secondary">{yil}</Text>
            <a onClick={() => kartAc(kayit.stokKod, kayit.stokIsim)}>Stok kartını aç</a>
          </Space>

          <Bekleme yukleniyor={yukleniyor} hata={hata} />

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, margin: "12px 0" }}>
            {olcumKart("Fire tutarı", para(kayit.tutar), undefined, "#cf1322")}
            {olcumKart("Fire miktarı", sayi(toplam, 1))}
            {olcumKart("Hareket sayısı", sayi(hareketler.length))}
          </div>

          <Table
            rowKey={(h: any, i: any) => `${h.tarih}-${i}`}
            size="small"
            loading={yukleniyor}
            dataSource={hareketler}
            pagination={{ pageSize: 25 }}
            columns={[
              { title: "Tarih", dataIndex: "tarih", width: 100, render: (d: any) => dayjs(d).format("DD.MM.YY") },
              { title: "Evrak türü", dataIndex: "evrakTuru", width: 150, ellipsis: true },
              { title: "Evrak", dataIndex: "evrak", width: 130, ellipsis: true },
              {
                title: "Miktar",
                dataIndex: "miktar",
                align: "right" as const,
                width: 90,
                render: (d: any) => <b style={{ color: "#cf1322" }}>{sayi(Math.abs(Number(d)), 1)}</b>,
              },
              { title: "Açıklama", dataIndex: "aciklama", ellipsis: true },
              { title: "Kaydeden", dataIndex: "kullanici", width: 120, ellipsis: true },
            ]}
          />

          <Alert
            style={{ marginTop: 12 }}
            type="info"
            showIcon
            message="Fire hareketleri"
            description="Sarf, imha ve üretim (reçete) hareketleri listelenir. Tek seferlik büyük bir imha mı yoksa günlük küçük kayıplar mı olduğu buradan görülür."
          />
        </>
      )}
    </Drawer>
  );
}

/* ========================================================================== */
/* Stok kartı ekstresi                                                        */
/* ========================================================================== */

function StokKarti({ kayit, depo, kapat }: any) {
  const yol = kayit && depo ? `Stok/StokKarti?stok=${encodeURIComponent(kayit.stokKod)}&depo=${depo}` : null;

  const { veri, yukleniyor, hata } = useVeri(yol);

  const hareketler = veri?.hareketler ?? [];

  return (
    <Drawer open={!!kayit} width={720} onClose={kapat} title={kayit?.stokIsim ?? ""}>
      {!kayit ? null : (
        <>
          <Text type="secondary">{kayit.stokKod}</Text>

          <Bekleme yukleniyor={yukleniyor} hata={hata} />

          {hareketler.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, margin: "12px 0" }}>
              {olcumKart("Güncel stok", sayi(hareketler[0]?.kalan, 1))}
              {olcumKart("Son hareket", dayjs(hareketler[0]?.tarih).format("DD.MM.YYYY"))}
              {olcumKart("Kayıt sayısı", sayi(hareketler.length))}
            </div>
          )}

          <Table
            rowKey={(h: any, i: any) => `${h.tarih}-${i}`}
            size="small"
            loading={yukleniyor}
            dataSource={hareketler}
            pagination={{ pageSize: 25 }}
            columns={[
              { title: "Tarih", dataIndex: "tarih", width: 100, render: (d: any) => dayjs(d).format("DD.MM.YY") },
              { title: "Evrak", dataIndex: "evrakTuru", width: 150, ellipsis: true },
              {
                title: "Karşı taraf",
                width: 160,
                ellipsis: true,
                render: (_: unknown, h: any) => h.karsiDepo || h.firma || "—",
              },
              {
                title: "Miktar",
                dataIndex: "miktar",
                align: "right" as const,
                width: 90,
                render: (d: any) => (
                  <b style={{ color: Number(d) < 0 ? "#cf1322" : "#5f8c10" }}>
                    {Number(d) > 0 ? "+" : ""}
                    {sayi(d, 1)}
                  </b>
                ),
              },
              {
                title: "Kalan",
                dataIndex: "kalan",
                align: "right" as const,
                width: 90,
                render: (d: any) => (
                  <span style={{ color: Number(d) < 0 ? "#cf1322" : undefined, fontWeight: Number(d) < 0 ? 800 : 400 }}>
                    {sayi(d, 1)}
                  </span>
                ),
              },
              {
                title: "Birim maliyet",
                dataIndex: "birimMaliyet",
                align: "right" as const,
                width: 120,
                render: (d: any) => (Number(d) ? para(d) : "—"),
              },
            ]}
          />

          <Alert
            style={{ marginTop: 12 }}
            type="info"
            showIcon
            message="Kalan miktar her hareketten sonra yürütülür"
            description="Eksiye düşen satır kırmızı görünür; orada mal kabul yapılmamış, transfer tek yönlü girilmiş ya da sayım kaçmış olabilir."
          />
        </>
      )}
    </Drawer>
  );
}
