/**
 * ---------------------------------------------------------------------------
 * Raporlar
 * ---------------------------------------------------------------------------
 * Arıza kayıtları, envanter ve servis maliyeti (13.10.2026: rakip fiyat ve
 * künye raporları kaldırıldı, envanter raporu eklendi).
 *
 * Kapsam sunucuda belirleniyor: kullanıcı rolünün ve temsilcisi olduğu
 * departmanların verisini görüyor; hangi sekmelerin çıkacağı da rolde
 * seçiliyor (Yönetim › Roller). Tutarlar yalnızca maliyet yetkisinde.
 *
 * Her rapor Excel'e aktarılabiliyor. Kırılım tablosu (pivot) seçilen iki
 * alana göre sayıları çapraz veriyor: "hangi departmanda hangi durumda kaç
 * kayıt" sorusu tek tabloda cevaplanıyor.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  Empty,
  Row,
  Segmented,
  Select,
  Space,
  Spin,
  Statistic,
  Tabs,
  Typography,
  message,
} from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { Download } from "lucide-react";

import { api } from "../api";
import { RENK } from "../sabitler";
import { Cubuk, Halka, Satirlar } from "../Grafik";

const { Text } = Typography;

/* -------------------------------------------------------------------------- */

const DURUM_ADLARI: Record<string, string> = {
  acik: "Açık",
  yeni: "Yeni",
  atandi: "Atandı",
  islemde: "İşlemde",
  beklemede: "Beklemede",
  devam: "Devam ediyor",
  cozuldu: "Çözüldü",
  kapandi: "Kapandı",
  iptal: "İptal",
};

const paraYaz = (d: any) =>
  d === null || d === undefined || Number.isNaN(Number(d))
    ? "—"
    : Number(d).toLocaleString("tr-TR", { minimumFractionDigits: 2 }) + " ₺";

/**
 * Tabloyu Excel'in açabileceği bir dosyaya çevirir.
 *
 * Noktalı virgül ve BOM: Excel Türkçe yerelde virgülü ondalık ayıracı
 * sayıyor ve BOM olmadan Türkçe karakterler bozuluyor. Kütüphane
 * eklemeden çözülebilen bir iş.
 */
function disaAktar(ad: string, basliklar: string[], satirlar: any[][]) {
  const csv =
    "\uFEFF" +
    [basliklar, ...satirlar]
      .map((satir) =>
        satir
          .map((h) => `"${String(h ?? "").replace(/"/g, '""')}"`)
          .join(";")
      )
      .join("\r\n");

  const bag = document.createElement("a");

  bag.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  bag.download = `${ad}-${dayjs().format("YYYYMMDD-HHmm")}.csv`;
  bag.click();

  URL.revokeObjectURL(bag.href);
}

/* ========================================================================== */

export default function Raporlar() {
  const [secenekler, setSecenekler] = useState<any>(null);

  const [aralik, setAralik] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(29, "day"),
    dayjs(),
  ]);

  const [departmanId, setDepartmanId] = useState<number | undefined>();
  const [sube, setSube] = useState<string | undefined>();

  const [hata, setHata] = useState<string | null>(null);

  useEffect(() => {
    api
      .getir<any>("Rapor/Secenekler")
      .then((c) => {
        setSecenekler(c);
        if (c?.sube) setSube(c.sube);
      })
      .catch((h) => setHata(h instanceof Error ? h.message : "Seçenekler alınamadı."));
  }, []);


  const sorgu = `bas=${aralik[0].format("YYYY-MM-DD")}&bit=${aralik[1].format(
    "YYYY-MM-DD"
  )}${departmanId ? `&departmanId=${departmanId}` : ""}${
    sube ? `&sube=${encodeURIComponent(sube)}` : ""
  }`;

  /* Sekmeler rolde seçilenler; sunucu da yalnızca onları veriyor */
  const izinli: string[] = (secenekler?.raporlar ?? []).map((r: any) => r.kod);
  const maliyet = !!secenekler?.maliyet;

  const sekmeler = [
    izinli.includes("ariza") && { key: "ariza", label: "Arıza Kayıtları", children: <ArizaRaporu sorgu={sorgu} maliyet={maliyet} /> },
    izinli.includes("envanter") && { key: "envanter", label: "Envanter", children: <EnvanterRaporu sorgu={sorgu} /> },
    izinli.includes("maliyet") && { key: "maliyet", label: "Servis Maliyeti", children: <MaliyetRaporu sorgu={sorgu} /> },
  ].filter(Boolean) as { key: string; label: string; children: JSX.Element }[];

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Card size="small" className="ik-filtre">
        <Space wrap>
          <DatePicker.RangePicker
            format="DD.MM.YYYY"
            value={aralik}
            allowClear={false}
            onChange={(d) => d && setAralik(d as [Dayjs, Dayjs])}
          />

          {/* Departman süzgeci yalnızca birden çok departmana yetkisi
              olanda: tek departmanı olan kullanıcıya seçenek sunmak
              gereksiz bir adım. */}
          {(secenekler?.departmanlar?.length ?? 0) > 1 && (
            <Select
              allowClear
              style={{ width: 220 }}
              placeholder={
                secenekler?.tumunuGorur ? "Tüm departmanlar" : "Departman"
              }
              value={departmanId}
              onChange={setDepartmanId}
              options={(secenekler?.departmanlar ?? []).map((d: any) => ({
                value: d.id,
                label: d.ad,
              }))}
            />
          )}

          <Select
            allowClear={!secenekler?.sube}
            disabled={!!secenekler?.sube}
            showSearch
            style={{ width: 190 }}
            placeholder="Tüm şubeler"
            value={sube}
            onChange={setSube}
            options={(secenekler?.subeler ?? []).map((x: string) => ({
              value: x,
              label: x,
            }))}
          />

          <Segmented
            options={[
              { value: 7, label: "7 gün" },
              { value: 30, label: "30 gün" },
              { value: 90, label: "90 gün" },
            ]}
            onChange={(d) =>
              setAralik([dayjs().subtract(Number(d) - 1, "day"), dayjs()])
            }
          />
        </Space>
      </Card>

      {secenekler && !secenekler.tumunuGorur && (
        <Alert
          type="info"
          showIcon
          message={`Kapsam: ${secenekler.kapsamAdi || "departman tanımlı değil"}`}
          description={
            secenekler.sube
              ? "Şube kullanıcısı olarak yalnızca kendi şubenizin verileri gösteriliyor."
              : "Rolünüzün ve temsilcisi olduğunuz departmanların verileri gösteriliyor. Kapsam Yönetim › Roller'den değiştirilir."
          }
        />
      )}

      {hata && <Alert type="error" showIcon message={hata} />}

      {secenekler && sekmeler.length === 0 && <Empty description="Size tanımlı rapor yok." />}

      {sekmeler.length > 0 && <Tabs items={sekmeler} />}
    </Space>
  );
}

/* ========================================================================== */

/** Rapor verisini çeken ortak kanca */
function raporuKullan(yol: string, sorgu: string) {
  const [veri, setVeri] = useState<any>(null);
  const [yukleniyor, setYukleniyor] = useState(true);

  const getir = useCallback(async () => {
    setYukleniyor(true);

    try {
      setVeri(await api.getir<any>(`Rapor/${yol}?${sorgu}`));
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Rapor alınamadı.");
      setVeri(null);
    } finally {
      setYukleniyor(false);
    }
  }, [yol, sorgu]);

  useEffect(() => {
    getir();
  }, [getir]);

  return { veri, yukleniyor, getir };
}

/* ========================================================================== */

function ArizaRaporu({ sorgu, maliyet }: { sorgu: string; maliyet: boolean }) {
  const { veri, yukleniyor } = raporuKullan("Ariza", sorgu);

  if (yukleniyor && !veri) return <Yukleme />;

  const o = veri?.ozet ?? {};
  const kayitlar: any[] = veri?.kayitlar ?? [];

  /* Günlük eğilim veriden çıkarılıyor; boş günler sıfırla dolduruluyor
     ki grafikte gün atlaması olmasın. */
  const gunler = gunlukSay(kayitlar, "olusturma", veri?.baslangic, veri?.bitis);

  const durumDilimleri = [
    { kod: ["acik", "yeni"], ad: "Açık", renk: "#e8481c" },
    { kod: ["devam", "islemde", "atandi"], ad: "Devam ediyor", renk: "#1a4d80" },
    { kod: ["beklemede"], ad: "Beklemede", renk: "#d48806" },
    { kod: ["cozuldu"], ad: "Çözüldü", renk: "#7cb518" },
    { kod: ["kapandi"], ad: "Kapandı", renk: "#9aa3af" },
    { kod: ["iptal"], ad: "İptal", renk: "#d9d9d9" },
  ]
    .map((d) => ({
      ad: d.ad,
      renk: d.renk,
      deger: kayitlar.filter((k) => d.kod.includes(k.durum)).length,
    }))
    .filter((d) => d.deger > 0);

  const oncelikDilimleri = [
    { kod: "acil", ad: "Acil", renk: "#a8071a" },
    { kod: "yuksek", ad: "Yüksek", renk: "#e8481c" },
    { kod: "orta", ad: "Orta", renk: "#d48806" },
    { kod: "dusuk", ad: "Düşük", renk: "#7cb518" },
  ]
    .map((d) => ({
      ad: d.ad,
      renk: d.renk,
      deger: kayitlar.filter((k) => k.oncelik === d.kod).length,
    }))
    .filter((d) => d.deger > 0);

  const cozumSureleri = kayitlar
    .filter((k) => k.cozumSaati)
    .map((k) => Number(k.cozumSaati));

  /* Çözüm süresi dağılımı: ortalama tek başına yanıltıyor, üç kaydın
     biri çok uzun sürünce ortalama fırlıyor. Aralıklara bölmek nerede
     yığıldığını gösteriyor. */
  const sureAraliklari = [
    { ad: "< 4 sa", alt: 0, ust: 4 },
    { ad: "4–24 sa", alt: 4, ust: 24 },
    { ad: "1–3 gün", alt: 24, ust: 72 },
    { ad: "3–7 gün", alt: 72, ust: 168 },
    { ad: "> 7 gün", alt: 168, ust: Infinity },
  ].map((a) => ({
    etiket: a.ad,
    deger: cozumSureleri.filter((x) => x >= a.alt && x < a.ust).length,
  }));

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Row gutter={[12, 12]}>
        <Kutu ad="Toplam kayıt" deger={o.toplam ?? 0} />
        <Kutu ad="Kapanmamış" deger={(o.acik ?? 0) + (o.islemde ?? 0) + (o.beklemede ?? 0)} renk="#e8481c" />
        <Kutu ad="Çözülen" deger={(o.cozuldu ?? 0) + (o.kapandi ?? 0)} renk={RENK.yesilKoyu} />
        <Kutu ad="SLA aşıldı" deger={o.geciken ?? 0} renk="#cf1322" />
        <Kutu
          ad="SLA içinde çözülen"
          deger={(o.cozuldu ?? 0) + (o.kapandi ?? 0) ? `%${Math.round(((o.slaIcinde ?? 0) / ((o.cozuldu ?? 0) + (o.kapandi ?? 0))) * 100)}` : "—"}
          renk={RENK.yesilKoyu}
        />
        <Kutu ad="Ortalama çözüm" deger={o.ortalamaSaat ? `${o.ortalamaSaat} sa` : "—"} renk="#1a4d80" />
        <Kutu ad="Atanmamış" deger={o.atanmamis ?? 0} renk="#d48806" />
        {maliyet && <Kutu ad="Toplam maliyet" deger={paraYaz(o.maliyet)} renk="#722ed1" />}
      </Row>

      <Row gutter={[14, 14]}>
        <Col xs={24} lg={14}>
          <Card size="small" title="Günlük açılan kayıt" style={{ height: "100%" }}>
            <Cubuk kayitlar={gunler} />
          </Card>
        </Col>

        <Col xs={24} lg={10}>
          <Card size="small" title="Durum dağılımı" style={{ height: "100%" }}>
            <Halka dilimler={durumDilimleri} />
          </Card>
        </Col>
      </Row>

      <Row gutter={[14, 14]}>
        <Col xs={24} lg={8}>
          <Card size="small" title="Departmanlara göre" style={{ height: "100%" }}>
            <Satirlar kayitlar={grupla(kayitlar, "departman")} renk="#1a4d80" />
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Card size="small" title="Şubelere göre" style={{ height: "100%" }}>
            <Satirlar kayitlar={grupla(kayitlar, "subeKodu").slice(0, 10)} renk={RENK.yesil} />
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Card size="small" title="Öncelik" style={{ height: "100%" }}>
            <Halka dilimler={oncelikDilimleri} />
          </Card>
        </Col>
      </Row>

      <Row gutter={[14, 14]}>
        <Col xs={24} lg={12}>
          <Card size="small" title="Çözüm süresi dağılımı" style={{ height: "100%" }}>
            {cozumSureleri.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Çözülen kayıt yok." />
            ) : (
              <Cubuk kayitlar={sureAraliklari} renk="#1a4d80" />
            )}
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card size="small" title="Cihaz türüne göre" style={{ height: "100%" }}>
            <Satirlar
              kayitlar={grupla(kayitlar.filter((k) => k.cihazTuru), "cihazTuru").slice(0, 8)}
              renk="#722ed1"
            />
          </Card>
        </Col>
      </Row>

      <Kirilim
        kayitlar={kayitlar}
        alanlar={[
          { deger: "departman", ad: "Departman" },
          { deger: "subeKodu", ad: "Şube" },
          { deger: "durum", ad: "Durum", cevir: (d: string) => DURUM_ADLARI[d] ?? d },
          { deger: "oncelik", ad: "Öncelik" },
          { deger: "kategori", ad: "Kategori" },
          { deger: "cihazTuru", ad: "Cihaz türü" },
        ]}
        varsayilanSatir="departman"
        varsayilanSutun="durum"
      />

      <DisaAktarCubugu
        ad="ariza-raporu"
        basliklar={["#", "Başlık", "Departman", "Şube", "Durum", "Öncelik",
          "Açan", "Atanan", "Cihaz", "Açılış", "Çözüm saati", "Maliyet"]}
        satirlar={kayitlar.map((k: any) => [
          k.id, k.baslik, k.departman, k.subeKodu,
          DURUM_ADLARI[k.durum] ?? k.durum, k.oncelik, k.acanAdi, k.atananAdi,
          [k.marka, k.model].filter(Boolean).join(" "),
          dayjs(k.olusturma).format("DD.MM.YYYY HH:mm"),
          k.cozumSaati ? Number(k.cozumSaati).toFixed(1) : "",
          maliyet ? k.maliyet ?? "" : "",
        ])}
        adet={kayitlar.length}
      />
    </Space>
  );
}

/* ========================================================================== */

const ENVANTER_DURUM: Record<string, { ad: string; renk: string }> = {
  aktif: { ad: "Çalışıyor", renk: "#7cb518" },
  bakimda: { ad: "Bakımda", renk: "#d48806" },
  arizali: { ad: "Arızalı", renk: "#cf1322" },
  pasif: { ad: "Kullanım dışı", renk: "#9aa3af" },
};

/**
 * Envanter raporu (13.10.2026): kapsamdaki cihazların durum, tür ve mağaza
 * dağılımı; garantisi 90 günde bitenler, bakımı gecikenler ve seçilen
 * dönemde en çok arıza açılan cihazlar. Tutarlar yalnızca maliyet
 * yetkisinde geliyor.
 */
function EnvanterRaporu({ sorgu }: { sorgu: string }) {
  const { veri, yukleniyor } = raporuKullan("Envanter", sorgu);

  if (yukleniyor && !veri) return <Yukleme />;

  const o = veri?.ozet ?? {};
  const cihazlar: any[] = veri?.cihazlar ?? [];
  const maliyet = !!veri?.maliyet;
  const ad = (c: any) => [c.tur, c.marka, c.model].filter(Boolean).join(" ") || `#${c.id}`;

  const durumDilimleri = Object.entries(ENVANTER_DURUM)
    .map(([k, v]) => ({ ad: v.ad, renk: v.renk, deger: cihazlar.filter((c) => c.durum === k).length }))
    .filter((d) => d.deger > 0);

  const bugun = dayjs().startOf("day");
  const garanti = cihazlar
    .filter((c) => c.garantiBitis && !dayjs(c.garantiBitis).isBefore(bugun) && dayjs(c.garantiBitis).diff(bugun, "day") <= 90)
    .sort((a, b) => dayjs(a.garantiBitis).valueOf() - dayjs(b.garantiBitis).valueOf());
  const bakim = cihazlar
    .filter((c) => c.sonrakiBakim && dayjs(c.sonrakiBakim).isBefore(bugun))
    .sort((a, b) => dayjs(a.sonrakiBakim).valueOf() - dayjs(b.sonrakiBakim).valueOf());
  const arizali = [...cihazlar].filter((c) => c.arizaSayisi > 0).sort((a, b) => b.arizaSayisi - a.arizaSayisi).slice(0, 10);

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Row gutter={[12, 12]}>
        <Kutu ad="Cihaz" deger={o.toplam ?? 0} />
        <Kutu ad="Arızalı" deger={o.arizali ?? 0} renk="#cf1322" />
        <Kutu ad="Bakımda" deger={o.bakimda ?? 0} renk="#d48806" />
        <Kutu ad="Garantisi 90 günde biten" deger={o.garantiBitiyor ?? 0} renk="#1a4d80" />
        <Kutu ad="Bakımı geciken" deger={o.bakimGecti ?? 0} renk="#e8481c" />
        <Kutu ad="Dönemde arıza açılan" deger={o.arizaAcilan ?? 0} renk="#722ed1" />
        {maliyet && <Kutu ad="Dönem tamir tutarı" deger={paraYaz(o.tamirToplam)} renk="#722ed1" />}
        {maliyet && <Kutu ad="Toplam alış bedeli" deger={paraYaz(o.alisToplam)} renk={RENK.yesilKoyu} />}
      </Row>

      <Row gutter={[14, 14]}>
        <Col xs={24} lg={8}>
          <Card size="small" title="Duruma göre" style={{ height: "100%" }}>
            {durumDilimleri.length ? <Halka dilimler={durumDilimleri} etiket="cihaz" /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Cihaz yok." />}
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card size="small" title="Türe göre" style={{ height: "100%" }}>
            <Satirlar kayitlar={grupla(cihazlar.filter((c) => c.tur), "tur").slice(0, 10)} renk="#1a4d80" />
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card size="small" title="Mağazaya göre" style={{ height: "100%" }}>
            <Satirlar kayitlar={grupla(cihazlar, "subeKodu").slice(0, 10)} renk={RENK.yesil} />
          </Card>
        </Col>
      </Row>

      <Row gutter={[14, 14]}>
        <Col xs={24} lg={8}>
          <Card size="small" title="En çok arıza açılan cihazlar" style={{ height: "100%" }}>
            {arizali.length ? (
              <Satirlar kayitlar={arizali.map((c) => ({ ad: ad(c), deger: c.arizaSayisi, yan: c.subeKodu ?? "" }))} renk="#722ed1" />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Bu dönemde cihaza bağlı arıza yok." />
            )}
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card size="small" title={`Garantisi bitecek (${garanti.length})`} style={{ height: "100%" }}>
            <Liste satirlar={garanti.slice(0, 10).map((c) => [ad(c), c.subeKodu, dayjs(c.garantiBitis).format("DD.MM.YYYY")])} bos="90 gün içinde garantisi biten cihaz yok." />
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card size="small" title={`Bakımı geciken (${bakim.length})`} style={{ height: "100%" }}>
            <Liste satirlar={bakim.slice(0, 10).map((c) => [ad(c), c.subeKodu, dayjs(c.sonrakiBakim).format("DD.MM.YYYY")])} bos="Bakımı geciken cihaz yok." kirmizi />
          </Card>
        </Col>
      </Row>

      <Kirilim
        kayitlar={cihazlar.map((c) => ({ ...c, durumAdi: ENVANTER_DURUM[c.durum]?.ad ?? c.durum }))}
        alanlar={[
          { deger: "subeKodu", ad: "Şube" },
          { deger: "tur", ad: "Tür" },
          { deger: "durumAdi", ad: "Durum" },
          { deger: "departman", ad: "Departman" },
        ]}
        varsayilanSatir="tur"
        varsayilanSutun="durumAdi"
      />

      <DisaAktarCubugu
        ad="envanter-raporu"
        basliklar={["#", "Tür", "Marka", "Model", "Şube", "Departman", "Durum", "Garanti bitiş", "Sonraki bakım", "Dönem arıza", ...(maliyet ? ["Alış bedeli", "Dönem tamir"] : [])]}
        satirlar={cihazlar.map((c: any) => [
          c.id, c.tur, c.marka, c.model, c.subeKodu, c.departman, ENVANTER_DURUM[c.durum]?.ad ?? c.durum,
          c.garantiBitis ? dayjs(c.garantiBitis).format("DD.MM.YYYY") : "",
          c.sonrakiBakim ? dayjs(c.sonrakiBakim).format("DD.MM.YYYY") : "",
          c.arizaSayisi, ...(maliyet ? [c.alisBedeli ?? "", c.tamirToplam ?? ""] : []),
        ])}
        adet={cihazlar.length}
      />
    </Space>
  );
}

/** Kısa üç sütunlu liste (ad · şube · tarih) */
function Liste({ satirlar, bos, kirmizi }: { satirlar: any[][]; bos: string; kirmizi?: boolean }) {
  if (satirlar.length === 0) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={bos} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {satirlar.map((s, i) => (
        <div key={i} style={{ display: "flex", gap: 8, fontSize: 13, alignItems: "baseline" }}>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s[0]}</span>
          <Text type="secondary" style={{ fontSize: 12 }}>{s[1]}</Text>
          <b style={{ fontVariantNumeric: "tabular-nums", color: kirmizi ? "#cf1322" : undefined }}>{s[2]}</b>
        </div>
      ))}
    </div>
  );
}

/* ========================================================================== */

function MaliyetRaporu({ sorgu }: { sorgu: string }) {
  const { veri, yukleniyor } = raporuKullan("Maliyet", sorgu);

  if (yukleniyor && !veri) return <Yukleme />;

  const o = veri?.ozet ?? {};
  const kayitlar: any[] = veri?.kayitlar ?? [];

  const gunler = gunlukTopla(kayitlar, "olusturma", "toplam", veri?.baslangic, veri?.bitis);

  const mudahaleDilimleri = [
    { kod: "uzaktan", ad: "Uzaktan", renk: "#7cb518" },
    { kod: "yerinde", ad: "Yerinde", renk: "#1a4d80" },
    { kod: "merkezde", ad: "Merkezde", renk: "#d48806" },
  ]
    .map((d) => ({
      ad: d.ad,
      renk: d.renk,
      deger: kayitlar.filter((k) => k.mudahale === d.kod).length,
    }))
    .filter((d) => d.deger > 0);

  /* Parça mı işçilik mi: raporda en sık sorulan soru bu */
  const kalemDilimleri = [
    { ad: "Parça", deger: Math.round(Number(o.parca ?? 0)), renk: "#1a4d80" },
    { ad: "İşçilik", deger: Math.round(Number(o.iscilik ?? 0)), renk: "#7cb518" },
  ].filter((d) => d.deger > 0);

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Row gutter={[12, 12]}>
        <Kutu ad="Servis kaydı" deger={o.adet ?? 0} />
        <Kutu ad="Toplam" deger={paraYaz(o.toplam)} renk="#722ed1" />
        <Kutu ad="Parça" deger={paraYaz(o.parca)} renk="#1a4d80" />
        <Kutu ad="İşçilik" deger={paraYaz(o.iscilik)} renk={RENK.yesilKoyu} />
        <Kutu
          ad="Kayıt başına"
          deger={o.adet ? paraYaz(Number(o.toplam) / Number(o.adet)) : "—"}
          renk="#d48806"
        />
      </Row>

      <Row gutter={[14, 14]}>
        <Col xs={24} lg={14}>
          <Card size="small" title="Günlük maliyet" style={{ height: "100%" }}>
            <Cubuk kayitlar={gunler} renk="#722ed1" biciml={paraYaz} />
          </Card>
        </Col>

        <Col xs={24} lg={10}>
          <Card size="small" title="Parça / işçilik" style={{ height: "100%" }}>
            <Halka dilimler={kalemDilimleri} etiket="₺" />
          </Card>
        </Col>
      </Row>

      <Row gutter={[14, 14]}>
        <Col xs={24} lg={8}>
          <Card size="small" title="Şubelere göre maliyet" style={{ height: "100%" }}>
            <Satirlar
              kayitlar={topla(kayitlar, "subeKodu", "toplam").slice(0, 10)}
              renk="#722ed1"
              biciml={paraYaz}
            />
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Card size="small" title="Departmanlara göre" style={{ height: "100%" }}>
            <Satirlar
              kayitlar={topla(kayitlar, "departman", "toplam")}
              renk="#1a4d80"
              biciml={paraYaz}
            />
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Card size="small" title="Müdahale biçimi" style={{ height: "100%" }}>
            <Halka dilimler={mudahaleDilimleri} />
          </Card>
        </Col>
      </Row>

      <Row gutter={[14, 14]}>
        <Col xs={24} lg={12}>
          <Card size="small" title="En çok harcanan parçalar" style={{ height: "100%" }}>
            <Satirlar
              kayitlar={(veri?.parcalar ?? []).slice(0, 10).map((p: any) => ({
                ad: p.ad,
                deger: Number(p.tutar ?? 0),
                yan: `${p.adet} adet`,
              }))}
              renk="#d48806"
              biciml={paraYaz}
            />
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card size="small" title="Cihaz türüne göre" style={{ height: "100%" }}>
            <Satirlar
              kayitlar={topla(kayitlar.filter((k) => k.cihazTuru), "cihazTuru", "toplam").slice(0, 8)}
              renk={RENK.yesil}
              biciml={paraYaz}
            />
          </Card>
        </Col>
      </Row>

      <Kirilim
        kayitlar={kayitlar}
        alanlar={[
          { deger: "departman", ad: "Departman" },
          { deger: "subeKodu", ad: "Şube" },
          { deger: "mudahale", ad: "Müdahale" },
          { deger: "cihazTuru", ad: "Cihaz türü" },
        ]}
        varsayilanSatir="subeKodu"
        varsayilanSutun="mudahale"
        toplamAlani="toplam"
      />

      <DisaAktarCubugu
        ad="servis-maliyeti"
        basliklar={["Form no", "Tarih", "Arıza", "Departman", "Şube", "Cihaz",
          "Müdahale", "Parça", "İşçilik", "Toplam", "Teknisyen"]}
        satirlar={kayitlar.map((k: any) => [
          k.formNo, dayjs(k.olusturma).format("DD.MM.YYYY"), k.baslik, k.departman,
          k.subeKodu, [k.marka, k.model].filter(Boolean).join(" "), k.mudahale,
          k.parcaTutari, k.iscilik, k.toplam, k.teknisyen,
        ])}
        adet={kayitlar.length}
      />
    </Space>
  );
}

/* ========================================================================== */

/* Rakip fiyat ve künye raporları bu sayfadan kaldırıldı (13.10.2026):
   o veriler kendi sayfalarında (Rakip Fiyat, Künye Analizi). */

/* ========================================================================== */

/** Alan değerine göre sayım; oranlı satır listesi için */
function grupla(kayitlar: any[], alan: string) {
  const sayac = new Map<string, number>();

  kayitlar.forEach((k) => {
    const ad = k[alan] ?? "—";
    sayac.set(ad, (sayac.get(ad) ?? 0) + 1);
  });

  return [...sayac.entries()]
    .map(([ad, deger]) => ({ ad, deger }))
    .sort((a, b) => b.deger - a.deger);
}

/** Alan değerine göre tutar toplamı */
function topla(kayitlar: any[], alan: string, tutarAlani: string) {
  const sayac = new Map<string, number>();

  kayitlar.forEach((k) => {
    const ad = k[alan] ?? "—";
    sayac.set(ad, (sayac.get(ad) ?? 0) + Number(k[tutarAlani] ?? 0));
  });

  return [...sayac.entries()]
    .map(([ad, deger]) => ({ ad, deger }))
    .sort((a, b) => b.deger - a.deger);
}

/**
 * Günlük sayım; boş günler sıfırla dolduruluyor.
 *
 * Grafikte gün atlaması yanıltıcı: kayıt olmayan gün gösterilmezse eğri
 * olduğundan yoğun görünüyor.
 */
function gunlukSay(kayitlar: any[], tarihAlani: string, bas?: string, bit?: string) {
  return gunlukTopla(kayitlar, tarihAlani, null, bas, bit);
}

function gunlukTopla(
  kayitlar: any[],
  tarihAlani: string,
  tutarAlani: string | null,
  bas?: string,
  bit?: string
) {
  if (!bas || !bit) return [];

  const sayac = new Map<string, number>();

  kayitlar.forEach((k) => {
    const gun = dayjs(k[tarihAlani]).format("YYYY-MM-DD");
    sayac.set(gun, (sayac.get(gun) ?? 0) + (tutarAlani ? Number(k[tutarAlani] ?? 0) : 1));
  });

  const sonuc: { etiket: string; deger: number }[] = [];

  /* Doksan günden uzun aralıkta çubuklar okunmuyor; haftalık toplanıyor */
  const gunSayisi = dayjs(bit).diff(dayjs(bas), "day") + 1;
  const adim = gunSayisi > 92 ? 7 : 1;

  for (let g = dayjs(bas); !g.isAfter(dayjs(bit)); g = g.add(adim, "day")) {
    let toplam = 0;

    for (let i = 0; i < adim; i++)
      toplam += sayac.get(g.add(i, "day").format("YYYY-MM-DD")) ?? 0;

    sonuc.push({
      etiket: g.format(adim === 1 ? "DD.MM" : "DD.MM") + (adim > 1 ? " hf" : ""),
      deger: tutarAlani ? Math.round(toplam) : toplam,
    });
  }

  return sonuc;
}

/**
 * Dışa aktarma çubuğu.
 *
 * Kayıt listesi ekranda gösterilmiyor: aynı liste Arıza Kayıtları
 * sayfasında zaten var ve raporda yer kaplayıp grafikleri aşağı
 * itiyordu. Ham veri isteyen Excel'e alıyor.
 */
function DisaAktarCubugu({
  ad,
  basliklar,
  satirlar,
  adet,
}: {
  ad: string;
  basliklar: string[];
  satirlar: any[][];
  adet: number;
}) {
  return (
    <Card size="small">
      <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
        <Text type="secondary" style={{ fontSize: 12.5 }}>
          Bu rapor {adet} kayıttan üretildi. Ham veriyi Excel'de incelemek için
          dışa aktarabilirsiniz.
        </Text>

        <Button
          icon={<Download size={15} strokeWidth={2} />}
          onClick={() => disaAktar(ad, basliklar, satirlar)}
          disabled={adet === 0}
        >
          Ham veriyi Excel'e aktar
        </Button>
      </Space>
    </Card>
  );
}

/* ========================================================================== */

/**
 * Kırılım tablosu.
 *
 * Seçilen iki alana göre sayıları çapraz veriyor: "hangi departmanda hangi
 * durumda kaç kayıt" sorusu tek tabloda cevaplanıyor. Toplam alanı
 * verilirse adet yerine o alanın toplamı gösteriliyor; maliyet raporunda
 * kayıt sayısı değil tutar anlamlı.
 */
function Kirilim({
  kayitlar,
  alanlar,
  varsayilanSatir,
  varsayilanSutun,
  toplamAlani,
}: {
  kayitlar: any[];
  alanlar: { deger: string; ad: string; cevir?: (d: any) => string }[];
  varsayilanSatir: string;
  varsayilanSutun: string;
  toplamAlani?: string;
}) {
  const [satirAlani, setSatirAlani] = useState(varsayilanSatir);
  const [sutunAlani, setSutunAlani] = useState(varsayilanSutun);

  const cevir = (alan: string, deger: any) => {
    const tanim = alanlar.find((a) => a.deger === alan);
    const ham = deger ?? "—";

    return tanim?.cevir ? tanim.cevir(ham) : String(ham);
  };

  /* Satır ve sütun değerleri veriden çıkarılıyor: sabit liste tutmak,
     yeni bir durum ya da şube eklendiğinde tabloda görünmemesine yol
     açardı. */
  const satirlar = [
    ...new Set(kayitlar.map((k) => cevir(satirAlani, k[satirAlani]))),
  ].sort();

  const sutunlar = [
    ...new Set(kayitlar.map((k) => cevir(sutunAlani, k[sutunAlani]))),
  ].sort();

  const hucre = (s: string, t: string) => {
    const uyanlar = kayitlar.filter(
      (k) => cevir(satirAlani, k[satirAlani]) === s &&
             cevir(sutunAlani, k[sutunAlani]) === t
    );

    if (!toplamAlani) return uyanlar.length;

    return uyanlar.reduce((toplam, k) => toplam + Number(k[toplamAlani] ?? 0), 0);
  };

  const yaz = (d: number) =>
    d === 0 ? "" : toplamAlani ? paraYaz(d) : d;

  if (kayitlar.length === 0) return null;

  return (
    <Card
      size="small"
      title="Kırılım"
      extra={
        <Space wrap>
          <Select
            size="small"
            style={{ width: 140 }}
            value={satirAlani}
            onChange={setSatirAlani}
            options={alanlar.map((a) => ({ value: a.deger, label: a.ad }))}
          />

          <Text type="secondary" style={{ fontSize: 12 }}>
            ×
          </Text>

          <Select
            size="small"
            style={{ width: 140 }}
            value={sutunAlani}
            onChange={setSutunAlani}
            options={alanlar.map((a) => ({ value: a.deger, label: a.ad }))}
          />

          <Button
            size="small"
            icon={<Download size={14} />}
            onClick={() =>
              disaAktar(
                "kirilim",
                ["", ...sutunlar, "Toplam"],
                satirlar.map((s) => [
                  s,
                  ...sutunlar.map((t) => hucre(s, t)),
                  sutunlar.reduce((toplam, t) => toplam + hucre(s, t), 0),
                ])
              )
            }
          >
            Excel'e aktar
          </Button>
        </Space>
      }
      styles={{ body: { overflowX: "auto", padding: 12 } }}
    >
      <table className="rp-kirilim">
        <thead>
          <tr>
            <th>{alanlar.find((a) => a.deger === satirAlani)?.ad}</th>
            {sutunlar.map((t) => (
              <th key={t}>{t}</th>
            ))}
            <th>Toplam</th>
          </tr>
        </thead>

        <tbody>
          {satirlar.map((s) => {
            const satirToplam = sutunlar.reduce((t, x) => t + hucre(s, x), 0);

            return (
              <tr key={s}>
                <td className="rp-kirilim-ad">{s}</td>

                {sutunlar.map((t) => (
                  <td key={t}>{yaz(hucre(s, t))}</td>
                ))}

                <td className="rp-kirilim-toplam">{yaz(satirToplam)}</td>
              </tr>
            );
          })}

          <tr className="rp-kirilim-alt">
            <td className="rp-kirilim-ad">Toplam</td>

            {sutunlar.map((t) => (
              <td key={t}>
                {yaz(satirlar.reduce((toplam, s) => toplam + hucre(s, t), 0))}
              </td>
            ))}

            <td className="rp-kirilim-toplam">
              {yaz(
                satirlar.reduce(
                  (toplam, s) =>
                    toplam + sutunlar.reduce((x, t) => x + hucre(s, t), 0),
                  0
                )
              )}
            </td>
          </tr>
        </tbody>
      </table>
    </Card>
  );
}

/* ========================================================================== */

function Kutu({ ad, deger, renk }: { ad: string; deger: any; renk?: string }) {
  return (
    <Col xs={12} md={4}>
      <Card size="small">
        <Statistic
          title={ad}
          value={deger}
          valueStyle={{ fontSize: 20, fontWeight: 700, color: renk ?? RENK.metin }}
        />
      </Card>
    </Col>
  );
}

function Yukleme() {
  return (
    <div style={{ padding: 50, textAlign: "center" }}>
      <Spin size="large" />
    </div>
  );
}
