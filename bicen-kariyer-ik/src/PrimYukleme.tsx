/**
 * Prim Hak Edişi → Biçen Kart yükleme (21.10.2026).
 *
 * Biçen Kart › Prim Yükleme sekmesinde ve Prim Hak Edişi sayfasından açılan
 * pencerede aynı bileşen. Dönem (prim ayı) seçilir, hak edişi olan personel
 * kart numarasıyla listelenir; seçilenler tek bir toplu puan talebi olarak
 * Admin onayına gider (Puan Yönetimi'ndeki akışla aynı). Onaylanınca işten
 * ayrılmış personele kişiye özel kart bağlantısı SMS'i kendiliğinden gider.
 *
 * Aynı ayın primi iki kez yatmasın diye o dönemde talebe girmiş kartlar
 * "yüklendi / onayda" görünür ve seçilemez; sunucu da ikinci talebi uyarır.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, App as AntdApp, Button, Checkbox, Input, Select, Space, Table, Tag, Tooltip, Typography } from "antd";
import { FileSpreadsheet, RefreshCw, Search, Send } from "lucide-react";
import { api } from "./api";
import { tabloIndir } from "./raporExcel";

const { Text } = Typography;

export const AYLAR = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
];

const para = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? `${n.toLocaleString("tr-TR")} TL` : "—";
};

const son4 = (k?: string | null) => (k ? `•••• ${k.slice(-4)}` : "—");

export const anahtar = (k: any) => `${k.kimlik || k.adSoyad}-${k.subeAdi ?? ""}`;

/** Prim hak edişi Excel'i: tüm personel, TC ve Biçen Kart dahil */
export const primExceli = (kayitlar: any[], yil: number, ay: number, durumAdi?: (k: any) => string) =>
  tabloIndir({
    baslik: "Prim Hak Edişi",
    altBaslik: `${AYLAR[ay - 1]} ${yil} · ${kayitlar.length} personel`,
    sayfaAdi: "Prim",
    dosyaAdi: `prim-hakedis-${yil}-${String(ay).padStart(2, "0")}`,
    genelToplam: true,
    sutunlar: [
      { ad: "Ad Soyad", genislik: 26 },
      { ad: "T.C. Kimlik No", genislik: 15 },
      { ad: "Sicil", genislik: 9 },
      { ad: "Biçen Kart No", genislik: 20 },
      { ad: "Şube", genislik: 22 },
      { ad: "Görev", genislik: 22 },
      { ad: "Puan", tip: "ondalik", toplam: false },
      { ad: "Dilim", genislik: 9 },
      { ad: "Oran", tip: "yuzde", toplam: false },
      { ad: "Ücret", tip: "para", toplam: false },
      { ad: "Hak Ediş", tip: "para" },
      { ad: "Ayrıldı", genislik: 8 },
      { ad: "Çıkış tarihi", tip: "tarih" },
      ...(durumAdi ? [{ ad: "Kart yükleme", genislik: 18 }] : []),
    ],
    satirlar: kayitlar.map((k) => [
      k.adSoyad ?? "",
      k.kimlik ?? "",
      k.sicil ?? "",
      k.kartNo ?? "",
      k.subeAdi ?? "",
      k.gorevAdi ?? "",
      Number(k.puan ?? 0),
      k.aralik ?? "",
      Number(k.yuzde ?? 0),
      k.ucret > 0 ? Number(k.ucret) : null,
      k.tutar ?? null,
      k.ayrildi ? "Evet" : "",
      k.cikisTarihi ?? null,
      ...(durumAdi ? [durumAdi(k)] : []),
    ]),
  });

type Durum = "hazir" | "donemdeayrildi" | "kartyok" | "ucretyok" | "onayda" | "yuklendi";

const DURUM: Record<Durum, { ad: string; renk?: string }> = {
  hazir: { ad: "Hazır", renk: "green" },
  donemdeayrildi: { ad: "Dönemde ayrıldı (yatmaz)", renk: "default" },
  kartyok: { ad: "Kart eşleşmesi yok", renk: "red" },
  ucretyok: { ad: "Ücret yok", renk: "orange" },
  onayda: { ad: "Onayda", renk: "gold" },
  yuklendi: { ad: "Yüklendi", renk: "blue" },
};

export default function PrimYukleme({ baslangicYil, baslangicAy }: { baslangicYil?: number; baslangicAy?: number }) {
  const { message, modal } = AntdApp.useApp();
  const bugun = new Date();

  /* Varsayılan: geçen ay (prim bir önceki ayın değerlendirmesinden) */
  const [yil, setYil] = useState<number>(baslangicYil ?? (bugun.getMonth() === 0 ? bugun.getFullYear() - 1 : bugun.getFullYear()));
  const [ay, setAy] = useState<number>(baslangicAy ?? (bugun.getMonth() === 0 ? 12 : bugun.getMonth()));
  const donem = `${yil}-${String(ay).padStart(2, "0")}`;

  const [veri, setVeri] = useState<any>(null);
  const [durumVeri, setDurumVeri] = useState<any>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [arama, setArama] = useState("");
  const [secili, setSecili] = useState<string[]>([]);
  const [ayrilanLink, setAyrilanLink] = useState(true);
  /* Personele giden bildirim metni (21.10.2026): "Kartınıza … yüklendi (açıklama)".
     "Prim" kelimesi geçmemeli. */
  const [aciklama, setAciklama] = useState("");
  const aciklamaHata = (() => {
    const a = aciklama.trim();
    if (a.length < 3) return "Personelin bildiriminde görünecek açıklamayı yazınız.";
    if (a.toLocaleLowerCase("tr").includes("prim")) return "Açıklamada \"prim\" kelimesi geçmemeli.";
    return null;
  })();
  const [gonderiliyor, setGonderiliyor] = useState(false);

  const getir = useCallback(async () => {
    setYukleniyor(true);
    try {
      const [h, d] = await Promise.all([
        api.al<any>(`/api/Performans/Hakedis?yil=${yil}&ay=${ay}`),
        api.al<any>(`/api/BicenKartPuan/PrimDurumu?donem=${donem}`),
      ]);
      setVeri(h);
      setDurumVeri(d);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setYukleniyor(false);
    }
  }, [yil, ay, donem, message]);

  useEffect(() => {
    getir();
  }, [getir]);

  /* Kart → bu dönemdeki talep durumu */
  const kartDurumu = useMemo(() => {
    const m = new Map<string, { durum: string; talepId: number }>();
    for (const k of durumVeri?.kartlar ?? []) {
      const onceki = m.get(k.kartNo);
      if (!onceki || k.durum === "onaylandi") m.set(String(k.kartNo).trim(), { durum: k.durum, talepId: k.talepId });
    }
    return m;
  }, [durumVeri]);

  const durumBul = useCallback(
    (k: any): Durum => {
      /* Seçilen dönemde işten çıkan personele prim yatırılmıyor (21.10.2026) */
      if (k.cikisTarihi) {
        const c = new Date(k.cikisTarihi);
        if (c.getFullYear() === yil && c.getMonth() + 1 === ay) return "donemdeayrildi";
      }
      if (!k.kartNo) return "kartyok";
      const t = kartDurumu.get(k.kartNo);
      if (t) return t.durum === "onaylandi" ? "yuklendi" : "onayda";
      if (!(k.tutar > 0)) return "ucretyok";
      return "hazir";
    },
    [kartDurumu, yil, ay]
  );

  const kayitlar: any[] = veri?.kayitlar ?? [];

  /* Liste değişince hazır olanlar seçili gelir */
  useEffect(() => {
    setSecili(kayitlar.filter((k) => durumBul(k) === "hazir").map(anahtar));
  }, [veri, durumVeri]);

  const liste = useMemo(() => {
    const q = arama.trim().toLocaleLowerCase("tr");
    if (!q) return kayitlar;
    return kayitlar.filter((k) =>
      `${k.adSoyad} ${k.subeAdi ?? ""} ${k.gorevAdi ?? ""} ${k.sicil ?? ""}`.toLocaleLowerCase("tr").includes(q)
    );
  }, [kayitlar, arama]);

  const sayac = useMemo(() => {
    const s: Record<Durum, number> = { hazir: 0, donemdeayrildi: 0, kartyok: 0, ucretyok: 0, onayda: 0, yuklendi: 0 };
    kayitlar.forEach((k) => s[durumBul(k)]++);
    return s;
  }, [kayitlar, durumBul]);

  const seciliKayitlar = kayitlar.filter((k) => secili.includes(anahtar(k)) && durumBul(k) === "hazir");
  const seciliToplam = seciliKayitlar.reduce((t, k) => t + (k.tutar ?? 0), 0);
  const seciliAyrilan = seciliKayitlar.filter((k) => k.ayrildi).length;

  /* Aynı karta iki satır düşmesin (aynı kişi iki şubede görünürse) */
  const satirlar = () => {
    const m = new Map<string, { puan: number; sicil: string }>();
    seciliKayitlar.forEach((k) =>
      m.set(k.kartNo, { puan: (m.get(k.kartNo)?.puan ?? 0) + Number(k.tutar), sicil: k.sicil ?? "" })
    );
    return Array.from(m, ([kartNo, x]) => ({ kartNo, puan: x.puan, sicil: x.sicil }));
  };

  const gonder = async (tekrar = false) => {
    if (seciliKayitlar.length === 0) return message.warning("Yüklenecek personel seçiniz.");
    if (aciklamaHata) return message.warning(aciklamaHata);
    setGonderiliyor(true);
    try {
      await api.gonder("/api/BicenKartPuan/Talep", {
        tur: "toplu",
        aciklama: aciklama.trim(),
        dosyaAdi: `prim-hakedis-${donem}`,
        kaynak: "prim",
        donem,
        ayrilanLink,
        tekrar,
        satirlar: satirlar(),
      });
      message.success(
        "Prim yüklemesi Admin onayına gönderildi." +
          (ayrilanLink && seciliAyrilan > 0 ? ` Onaylanınca ${seciliAyrilan} ayrılan personele kart bağlantısı gidecek.` : "")
      );
      getir();
    } catch (e: any) {
      if (/zaten var/.test(e.message ?? "") && !tekrar) {
        modal.confirm({
          title: "Bu dönem için talep var",
          content: `${e.message} Seçtiğiniz ${seciliKayitlar.length} kişi o talepte yok; yine de göndermek istiyor musunuz?`,
          okText: "Yine de gönder",
          cancelText: "Vazgeç",
          onOk: () => gonder(true),
        });
      } else message.error(e.message);
    } finally {
      setGonderiliyor(false);
    }
  };

  const onayla = () =>
    modal.confirm({
      title: "Prim Biçen Kart'a yüklensin mi?",
      width: 480,
      content: (
        <div style={{ fontSize: 13.5 }}>
          <p style={{ marginTop: 6 }}>
            <b>{AYLAR[ay - 1]} {yil}</b> primi · <b>{seciliKayitlar.length} kişi</b> · <b>{para(seciliToplam)}</b>
          </p>
          <p style={{ marginBottom: 0 }}>
            Talep Admin onayına gider; onaylanınca puan kartlara yatar ve personele bildirim gider.
            {ayrilanLink && seciliAyrilan > 0 && (
              <> İşten ayrılmış {seciliAyrilan} kişiye SMS ile kart bağlantısı gönderilir.</>
            )}
          </p>
        </div>
      ),
      okText: "Onaya gönder",
      cancelText: "Vazgeç",
      onOk: () => gonder(false),
    });

  const talepler: any[] = durumVeri?.talepler ?? [];

  return (
    <div>
      <Space wrap style={{ marginBottom: 12 }}>
        <Text strong>Dönem (prim ayı)</Text>
        <Select
          style={{ width: 100 }}
          value={yil}
          onChange={setYil}
          options={[0, 1, 2].map((i) => ({ value: bugun.getFullYear() - i, label: String(bugun.getFullYear() - i) }))}
        />
        <Select
          style={{ width: 140 }}
          value={ay}
          onChange={setAy}
          options={AYLAR.map((a, i) => ({ value: i + 1, label: `${i + 1} - ${a}` }))}
        />
        <Input
          allowClear
          prefix={<Search size={14} />}
          placeholder="Ad, şube, sicil"
          style={{ width: 200 }}
          value={arama}
          onChange={(e) => setArama(e.target.value)}
        />
        <Button icon={<RefreshCw size={15} />} loading={yukleniyor} onClick={getir}>
          Yenile
        </Button>
        <Button
          icon={<FileSpreadsheet size={15} />}
          disabled={kayitlar.length === 0}
          onClick={() => primExceli(kayitlar, yil, ay, (k) => DURUM[durumBul(k)].ad)}
        >
          Excel
        </Button>
      </Space>

      {veri?.hata && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={veri.hata} description={veri.ayrinti} />}

      {talepler.length > 0 && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={`${AYLAR[ay - 1]} ${yil} için ${talepler.length} prim talebi var`}
          description={
            <div style={{ fontSize: 12.5 }}>
              {talepler.map((t) => (
                <div key={t.id}>
                  #{t.id} · <Tag style={{ marginInlineEnd: 4 }}>{t.durum}</Tag>
                  {t.kartSayisi} kart · {para(t.toplamPuan)} · {t.talepEdenAd}
                  {t.redSebebi ? ` · red: ${t.redSebebi}` : ""}
                  {t.ayrilanLinkSonuc ? ` · ${t.ayrilanLinkSonuc}` : ""}
                </div>
              ))}
            </div>
          }
        />
      )}

      <Space wrap size={6} style={{ marginBottom: 10 }}>
        {(Object.keys(DURUM) as Durum[]).map((d) => (
          <Tag key={d} color={DURUM[d].renk}>
            {DURUM[d].ad}: {sayac[d]}
          </Tag>
        ))}
      </Space>

      <Table
        size="small"
        rowKey={anahtar}
        loading={yukleniyor}
        dataSource={liste}
        pagination={{ pageSize: 50, showSizeChanger: false }}
        scroll={{ x: 980 }}
        locale={{ emptyText: "Bu dönem için hak ediş bulunmuyor." }}
        rowSelection={{
          selectedRowKeys: secili,
          onChange: (k) => setSecili(k as string[]),
          getCheckboxProps: (k: any) => ({ disabled: durumBul(k) !== "hazir" }),
          preserveSelectedRowKeys: true,
        }}
        columns={[
          {
            title: "Personel",
            dataIndex: "adSoyad",
            width: 250,
            render: (v: string, k: any) => (
              <Space size={4}>
                {v}
                {k.ayrildi && (
                  <Tooltip title="İşten ayrılmış: onaydan sonra kart bağlantısı SMS'i gider">
                    <Tag color="orange">
                      ayrıldı{k.cikisTarihi ? ` · ${new Date(k.cikisTarihi).toLocaleDateString("tr-TR")}` : ""}
                    </Tag>
                  </Tooltip>
                )}
              </Space>
            ),
          },
          { title: "Sicil", dataIndex: "sicil", width: 80, render: (v: string) => v || "—" },
          { title: "Şube", dataIndex: "subeAdi", width: 150, ellipsis: true },
          { title: "Görev", dataIndex: "gorevAdi", width: 150, ellipsis: true },
          { title: "Puan", dataIndex: "puan", width: 70, align: "right" as const },
          { title: "Kart", dataIndex: "kartNo", width: 110, render: (v: string) => son4(v) },
          {
            title: "Hak Ediş",
            dataIndex: "tutar",
            width: 120,
            align: "right" as const,
            sorter: (a: any, b: any) => (a.tutar ?? 0) - (b.tutar ?? 0),
            render: (v: number | null) => (v == null ? <Text type="secondary">—</Text> : <b>{para(v)}</b>),
          },
          {
            title: "Durum",
            width: 150,
            filters: (Object.keys(DURUM) as Durum[]).map((d) => ({ text: DURUM[d].ad, value: d })),
            onFilter: (v: any, k: any) => durumBul(k) === v,
            render: (_: any, k: any) => {
              const d = durumBul(k);
              const t = kartDurumu.get(k.kartNo);
              return (
                <Tag color={DURUM[d].renk}>
                  {DURUM[d].ad}
                  {t ? ` #${t.talepId}` : ""}
                </Tag>
              );
            },
          },
        ]}
      />

      <div
        style={{
          marginTop: 12,
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 12px",
          borderRadius: 8,
          background: "#f6faef",
          border: "1px solid #dcebc4",
        }}
      >
        <Space direction="vertical" size={2}>
          <Text>
            Seçili: <b>{seciliKayitlar.length} kişi</b> · <b>{para(seciliToplam)}</b>
            {seciliAyrilan > 0 && <> · {seciliAyrilan} ayrılan</>}
          </Text>
          <div style={{ marginTop: 6, maxWidth: 560 }}>
            <Text style={{ fontSize: 12.5 }}>
              Bildirim açıklaması <Text type="secondary">(personele: “Kartınıza … TL yüklendi (açıklama)”)</Text>
            </Text>
            <Input
              value={aciklama}
              maxLength={120}
              status={aciklama && aciklamaHata ? "error" : undefined}
              placeholder={`Ör: ${AYLAR[ay - 1]} ayı performans ödülünüz`}
              onChange={(e) => setAciklama(e.target.value)}
            />
            {aciklama && aciklamaHata && <Text type="danger" style={{ fontSize: 12 }}>{aciklamaHata}</Text>}
          </div>
          <Checkbox checked={ayrilanLink} onChange={(e) => setAyrilanLink(e.target.checked)}>
            Onaylanınca işten ayrılan personele kart bağlantısı SMS'i gönder
          </Checkbox>
        </Space>
        <Button
          type="primary"
          icon={<Send size={15} />}
          loading={gonderiliyor}
          disabled={seciliKayitlar.length === 0 || !!aciklamaHata}
          onClick={onayla}
        >
          Biçen Kart'a yükle (onaya gönder)
        </Button>
      </div>
    </div>
  );
}
