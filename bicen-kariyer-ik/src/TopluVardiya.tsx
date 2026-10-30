/**
 * ---------------------------------------------------------------------------
 * Toplu Vardiya
 * ---------------------------------------------------------------------------
 * Seçilen birimlerin (Genel Merkez, Akçaburgaz Depo ya da herhangi bir şube)
 * ve/veya departmanların personeline haftalık bir desen tek seferde
 * uygulanır: örneğin pazartesi–cuma sabahçı, cumartesi ve pazar haftalık
 * izin, bir yıl boyunca.
 *
 * Akış: kimlere → haftalık desen → tarih ve seçenekler → önizleme (takvim
 * ısı haritası, sayılar, kural uyarıları) → uygula. Uygulanan her işlem
 * aşağıdaki listede durur ve geri alınabilir: işlemin eklediği günler
 * silinir, üzerine yazdığı günler eski hâline döner. Sonradan mağaza
 * müdürünün değiştirdiği günlere dokunulmaz.
 *
 * Bildirim gün başına değil kişi başına en fazla bir özet (ya da hiç).
 * Haftada 1 gün izin zorunlu: desende haftalık izin günü yoksa uygulanmaz.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Empty,
  Input,
  Popconfirm,
  Radio,
  Segmented,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import dayjs, { Dayjs } from "dayjs";
import { CalendarRange, Eye, History, Save, Trash2, Undo2, Users, Wand2 } from "lucide-react";
import { api } from "./api";
import { PersonelAdi } from "./personelKarti";

const { Text } = Typography;

const GUNLER = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
const AYLAR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

const RENKLER: Record<string, { zemin: string; yazi: string }> = {
  mavi: { zemin: "#e6f1fb", yazi: "#14507f" },
  mor: { zemin: "#efe9fb", yazi: "#4d3184" },
  sari: { zemin: "#fdf0e2", yazi: "#8a5a12" },
  yesil: { zemin: "#eef7df", yazi: "#3a5709" },
  kirmizi: { zemin: "#fdecec", yazi: "#7a1a1a" },
};

type DesenGun = { tur: "vardiya" | "izin" | "off" | "atla"; sablonId?: number | null };

/** Seçimdeki değer: "s:3" vardiya türü, "izin", "off", "atla" */
const degerYaz = (d: DesenGun) => (d.tur === "vardiya" ? `s:${d.sablonId}` : d.tur);

const degerOku = (v: string): DesenGun =>
  v.startsWith("s:") ? { tur: "vardiya", sablonId: Number(v.slice(2)) } : { tur: v as DesenGun["tur"] };

const bosDesen = (): DesenGun[] => GUNLER.map(() => ({ tur: "atla" }));

const ON_AYAR = [
  { value: "ay", label: "Bu ay" },
  { value: "3", label: "3 ay" },
  { value: "6", label: "6 ay" },
  { value: "12", label: "1 yıl" },
];

const sayi = (n: number) => Number(n ?? 0).toLocaleString("tr-TR");

export default function TopluVardiya() {
  const { message, modal } = AntdApp.useApp();

  const [secenek, setSecenek] = useState<any>(null);
  const [yukleniyor, setYukleniyor] = useState(true);

  /* 1 · kimlere */
  const [birimler, setBirimler] = useState<string[]>([]);
  const [departmanlar, setDepartmanlar] = useState<number[]>([]);
  const [ara, setAra] = useState("");
  const [unvanlar, setUnvanlar] = useState<string[]>([]);
  const [secili, setSecili] = useState<string[]>([]);

  /* 2 · desen */
  const [desen, setDesen] = useState<DesenGun[]>(bosDesen());
  const [desenAd, setDesenAd] = useState("");
  const [yuklenenDesen, setYuklenenDesen] = useState<number | null>(null);

  /* 3 · tarih ve seçenekler */
  const [aralik, setAralik] = useState<[Dayjs, Dayjs]>([
    dayjs().add(1, "day").startOf("day"),
    dayjs().add(1, "day").add(1, "year").subtract(1, "day").startOf("day"),
  ]);
  const [onAyar, setOnAyar] = useState<string>("12");
  const [resmiTatil, setResmiTatil] = useState<"izinli" | "plan">("izinli");
  const [uzerineYaz, setUzerineYaz] = useState(false);
  const [yayinla, setYayinla] = useState(true);
  const [bildirim, setBildirim] = useState<"ozet" | "yok">("ozet");

  /* önizleme / uygulama / geçmiş */
  const [onizleme, setOnizleme] = useState<any>(null);
  const [onizleniyor, setOnizleniyor] = useState(false);
  const [uygulaniyor, setUygulaniyor] = useState(false);
  const [islemler, setIslemler] = useState<any[] | null>(null);
  const [sonuc, setSonuc] = useState<any>(null);

  const getir = useCallback(async () => {
    setYukleniyor(true);

    try {
      setSecenek(await api.al<any>("/api/TopluVardiya/Secenekler"));
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setYukleniyor(false);
    }
  }, [message]);

  const islemleriGetir = useCallback(async () => {
    try {
      const c = await api.al<any>("/api/TopluVardiya/Islemler");
      setIslemler(c.islemler ?? []);
    } catch {
      setIslemler([]);
    }
  }, []);

  useEffect(() => {
    getir();
    islemleriGetir();
  }, [getir, islemleriGetir]);

  const sablonlar: any[] = secenek?.sablonlar ?? [];

  /* İlk açılışta önerilen desen: Pzt–Cum ilk "sabah" türü, Cmt–Paz izin */
  const hazirDesen = useCallback(() => {
    const sabah = sablonlar.find((s) => s.tip === "sabah") ?? sablonlar[0];

    if (!sabah) return;

    setDesen(GUNLER.map((_, i) => (i < 5 ? { tur: "vardiya", sablonId: sabah.id } : { tur: "izin" })));
    setYuklenenDesen(null);
    setDesenAd("Pzt–Cum sabahçı, Cmt–Paz izinli");
  }, [sablonlar]);

  useEffect(() => {
    if (secenek && desen.every((d) => d.tur === "atla")) hazirDesen();
    // yalnızca seçenekler gelince
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secenek]);

  /* Aday personel: seçilen birimler ve departmanların birleşimi */
  const adaylar: any[] = useMemo(() => {
    const p: any[] = secenek?.personeller ?? [];

    if (birimler.length === 0 && departmanlar.length === 0) return [];

    return p.filter(
      (x) =>
        birimler.includes(x.birim) ||
        (x.departmanlar ?? []).some((d: number) => departmanlar.includes(d))
    );
    /* Yalnızca personel listesine bağlı: şablon kaydedilince seçim sıfırlanmasın */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secenek?.personeller, birimler, departmanlar]);

  /* Birim / departman değişince adayların hepsi seçili gelir */
  useEffect(() => {
    setSecili(adaylar.map((x) => x.sicil));
    setOnizleme(null);
  }, [adaylar]);

  const gorunen = useMemo(() => {
    const q = ara.trim().toLocaleLowerCase("tr");

    return adaylar.filter(
      (x) =>
        (unvanlar.length === 0 || unvanlar.includes(x.pozisyon)) &&
        (!q || `${x.adSoyad} ${x.sicil} ${x.pozisyon}`.toLocaleLowerCase("tr").includes(q))
    );
  }, [adaylar, ara, unvanlar]);

  const adayUnvanlari = useMemo(
    () => Array.from(new Set(adaylar.map((x) => x.pozisyon).filter(Boolean))).sort((a, b) => a.localeCompare(b, "tr")),
    [adaylar]
  );

  /* Ön ayar: bugünden (yarından) başlar */
  const onAyarUygula = (v: string) => {
    setOnAyar(v);

    const bas = dayjs().add(1, "day").startOf("day");
    const bit = v === "ay" ? dayjs().endOf("month").startOf("day") : bas.add(Number(v), "month").subtract(1, "day");

    setAralik([bas, bit.isBefore(bas) ? bas : bit]);
    setOnizleme(null);
  };

  const kapsamMetni = () =>
    [
      ...birimler,
      ...departmanlar.map((d) => (secenek?.departmanlar ?? []).find((x: any) => x.id === d)?.ad).filter(Boolean),
    ].join(", ");

  const govde = () => ({
    siciller: secili,
    desen,
    bas: aralik[0].format("YYYY-MM-DD"),
    bit: aralik[1].format("YYYY-MM-DD"),
    resmiTatil,
    uzerineYaz,
    yayinla,
    bildirim: yayinla ? bildirim : "yok",
    desenAd: desenAd.trim() || null,
    kapsam: kapsamMetni(),
  });

  const onizle = async () => {
    if (secili.length === 0) {
      message.warning("Önce personel seçiniz.");
      return;
    }

    setOnizleniyor(true);
    setSonuc(null);

    try {
      setOnizleme(await api.gonder<any>("/api/TopluVardiya/Onizleme", govde()));
    } catch (h: any) {
      message.error(h.message);
      setOnizleme(null);
    } finally {
      setOnizleniyor(false);
    }
  };

  const uygula = async () => {
    setUygulaniyor(true);

    try {
      const c = await api.gonder<any>("/api/TopluVardiya/Uygula", govde());
      setSonuc(c);
      setOnizleme(null);
      message.success(`${sayi(c.eklenen + c.guncellenen)} gün yazıldı.`);
      islemleriGetir();
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setUygulaniyor(false);
    }
  };

  const geriAl = async (id: number) => {
    try {
      const c = await api.gonder<any>(`/api/TopluVardiya/GeriAl/${id}`, {});
      modal.success({ title: `#${id} geri alındı`, content: c.ozet });
      islemleriGetir();
    } catch (h: any) {
      message.error(h.message);
    }
  };

  /* ------------------------------------------------------- şablonlar */
  const desenKaydet = async () => {
    if (desenAd.trim().length < 2) {
      message.warning("Şablona bir ad veriniz.");
      return;
    }

    try {
      const c = await api.gonder<any>("/api/TopluVardiya/Desen", {
        id: yuklenenDesen ?? 0,
        ad: desenAd.trim(),
        gunler: desen,
      });
      setSecenek({ ...secenek, desenler: c.desenler });
      setYuklenenDesen(c.id);
      message.success("Şablon kaydedildi.");
    } catch (h: any) {
      message.error(h.message);
    }
  };

  const desenSil = async (id: number) => {
    try {
      const c = await api.sil<any>(`/api/TopluVardiya/Desen/${id}`);
      setSecenek({ ...secenek, desenler: c.desenler });
      if (yuklenenDesen === id) setYuklenenDesen(null);
    } catch (h: any) {
      message.error(h.message);
    }
  };

  const desenYukle = (id: number) => {
    const d = (secenek?.desenler ?? []).find((x: any) => x.id === id);

    if (!d) return;

    setDesen(GUNLER.map((_, i) => d.gunler?.[i] ?? { tur: "atla" }));
    setDesenAd(d.ad);
    setYuklenenDesen(id);
    setOnizleme(null);
  };

  const gunSecenekleri = [
    ...sablonlar.map((s) => {
      const r = RENKLER[s.renk] ?? RENKLER.mavi;
      return {
        value: `s:${s.id}`,
        label: (
          <span style={{ color: r.yazi, fontWeight: 700 }}>
            <span
              style={{
                display: "inline-block",
                width: 9,
                height: 9,
                borderRadius: 5,
                background: r.yazi,
                marginRight: 6,
              }}
            />
            {s.ad}
          </span>
        ),
      };
    }),
    { value: "izin", label: <span style={{ color: "#3a5709", fontWeight: 700 }}>Haftalık izin</span> },
    { value: "off", label: <span style={{ color: "#9aa3af" }}>Boş (—)</span> },
    { value: "atla", label: <span style={{ color: "#9aa3af", fontStyle: "italic" }}>Dokunma</span> },
  ];

  if (yukleniyor && !secenek) return <Spin />;

  const haftalikIzinYok = !desen.some((d) => d.tur === "izin");

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Alert
        type="info"
        showIcon
        message="Seçtiğiniz birimlerin personeline haftalık deseni tek seferde uygulayın"
        description="Örnek: Genel Merkez için 1 yıl boyunca pazartesi–cuma sabahçı, cumartesi ve pazar haftalık izin. Kayıtlar mağaza müdürlerinin girdiği planla aynı yere yazılır; her işlem aşağıda listelenir ve geri alınabilir."
      />

      {/* ------------------------------------------------ 1 · kimlere */}
      <Card
        size="small"
        title={
          <Space size={8}>
            <Users size={16} strokeWidth={2} />
            1 · Kimlere
          </Space>
        }
        extra={
          <Text type="secondary">
            {sayi(secili.length)} / {sayi(adaylar.length)} kişi seçili
          </Text>
        }
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Birim (iş grubu)
            </Text>
            <Select
              mode="multiple"
              allowClear
              showSearch
              style={{ width: "100%" }}
              placeholder="Genel Merkez, Akçaburgaz Depo ya da şube seçin"
              value={birimler}
              onChange={setBirimler}
              optionFilterProp="ara"
              options={(secenek?.birimler ?? []).map((b: any) => ({
                value: b.ad,
                ara: b.ad,
                label: `${b.ad} (${b.kisi})`,
              }))}
            />
          </div>

          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Departman (isteğe bağlı)
            </Text>
            <Select
              mode="multiple"
              allowClear
              style={{ width: "100%" }}
              placeholder="Genel merkez / depo departmanları"
              value={departmanlar}
              onChange={setDepartmanlar}
              optionFilterProp="ara"
              options={(secenek?.departmanlar ?? []).map((d: any) => ({
                value: d.id,
                ara: d.ad,
                label: `${d.ad}${d.isYeri ? ` · ${d.isYeri}` : ""} (${d.kisi})`,
              }))}
            />
          </div>
        </div>

        {adaylar.length === 0 ? (
          <Empty style={{ margin: "18px 0 6px" }} description="Personel listesi için birim ya da departman seçin." />
        ) : (
          <>
            <Space wrap style={{ margin: "12px 0 8px" }}>
              <Input.Search
                allowClear
                placeholder="Ad, sicil ya da ünvan ara"
                style={{ width: 240 }}
                value={ara}
                onChange={(e) => setAra(e.target.value)}
              />
              <Select
                mode="multiple"
                allowClear
                style={{ minWidth: 240 }}
                placeholder="Ünvan süz"
                value={unvanlar}
                onChange={setUnvanlar}
                options={adayUnvanlari.map((u) => ({ value: u, label: u }))}
                maxTagCount="responsive"
              />
              <Button size="small" onClick={() => setSecili(Array.from(new Set([...secili, ...gorunen.map((x) => x.sicil)])))}>
                Görünenleri seç
              </Button>
              <Button
                size="small"
                onClick={() => setSecili(secili.filter((s) => !gorunen.some((x) => x.sicil === s)))}
              >
                Görünenleri bırak
              </Button>
            </Space>

            <Table
              rowKey="sicil"
              size="small"
              dataSource={gorunen}
              pagination={{ pageSize: 8, size: "small", showSizeChanger: false }}
              rowSelection={{
                selectedRowKeys: secili,
                preserveSelectedRowKeys: true,
                onChange: (k) => {
                  /* Görünmeyen (süzülmüş) seçimler korunur */
                  const gorunenKod = new Set(gorunen.map((x) => x.sicil));
                  setSecili([...secili.filter((s) => !gorunenKod.has(s)), ...(k as string[])]);
                  setOnizleme(null);
                },
              }}
              columns={[
                { title: "Personel", dataIndex: "adSoyad", render: (v: string, k: any) => (<><b><PersonelAdi kod={k.sicil}>{v}</PersonelAdi></b> <Text type="secondary" style={{ fontSize: 11.5 }}>{k.sicil}</Text></>) },
                { title: "Ünvan", dataIndex: "pozisyon" },
                { title: "Birim", dataIndex: "birim" },
              ]}
            />
          </>
        )}
      </Card>

      {/* ------------------------------------------- 2 · haftalık desen */}
      <Card
        size="small"
        title={
          <Space size={8}>
            <Wand2 size={16} strokeWidth={2} />
            2 · Haftalık desen
          </Space>
        }
        extra={
          <Space wrap>
            <Select
              style={{ width: 240 }}
              placeholder="Kayıtlı şablonu yükle"
              value={yuklenenDesen ?? undefined}
              onChange={desenYukle}
              options={(secenek?.desenler ?? []).map((d: any) => ({ value: d.id, label: d.ad }))}
              notFoundContent="Kayıtlı şablon yok"
            />
            {yuklenenDesen && (
              <Popconfirm title="Şablon silinsin mi?" okText="Sil" cancelText="Vazgeç" onConfirm={() => desenSil(yuklenenDesen)}>
                <Button icon={<Trash2 size={14} />} />
              </Popconfirm>
            )}
          </Space>
        }
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(110px, 1fr))", gap: 8, overflowX: "auto" }}>
          {GUNLER.map((g, i) => {
            const d = desen[i];
            const s = d.tur === "vardiya" ? sablonlar.find((x) => x.id === d.sablonId) : null;
            const r = s ? RENKLER[s.renk] ?? RENKLER.mavi : null;

            return (
              <div
                key={g}
                style={{
                  borderRadius: 10,
                  padding: 8,
                  background: r ? r.zemin : d.tur === "izin" ? "#eef7df" : "#f7f8f5",
                  border: d.tur === "atla" ? "1px dashed #d9dcd4" : "1px solid transparent",
                }}
              >
                <div style={{ fontWeight: 800, fontSize: 12.5, marginBottom: 6, color: i >= 5 ? "#8a5a12" : "#374151" }}>{g}</div>
                <Select
                  size="small"
                  style={{ width: "100%" }}
                  value={degerYaz(d)}
                  onChange={(v) => {
                    const yeni = [...desen];
                    yeni[i] = degerOku(String(v));
                    setDesen(yeni);
                    setOnizleme(null);
                  }}
                  options={gunSecenekleri}
                  popupMatchSelectWidth={false}
                />
              </div>
            );
          })}
        </div>

        <Space wrap style={{ marginTop: 12 }}>
          <Button size="small" onClick={hazirDesen}>
            Pzt–Cum sabahçı · Cmt–Paz izin
          </Button>
          <Input
            size="small"
            style={{ width: 260 }}
            placeholder="Şablon adı"
            value={desenAd}
            onChange={(e) => setDesenAd(e.target.value)}
          />
          <Button size="small" icon={<Save size={13} />} onClick={desenKaydet}>
            {yuklenenDesen ? "Şablonu güncelle" : "Şablon olarak kaydet"}
          </Button>
        </Space>

        {haftalikIzinYok && (
          <Alert
            style={{ marginTop: 10 }}
            type="error"
            showIcon
            message="Haftada 1 gün izin yok"
            description="Haftada 1 gün haftalık izin zorunlu. Desende en az bir günü “Haftalık izin” yapın."
          />
        )}
      </Card>

      {/* -------------------------------------- 3 · tarih ve seçenekler */}
      <Card
        size="small"
        title={
          <Space size={8}>
            <CalendarRange size={16} strokeWidth={2} />
            3 · Tarih ve seçenekler
          </Space>
        }
      >
        <Space wrap size={[16, 12]} align="center">
          <DatePicker.RangePicker
            format="DD.MM.YYYY"
            allowClear={false}
            value={aralik}
            onChange={(v) => {
              if (v?.[0] && v?.[1]) {
                setAralik([v[0].startOf("day"), v[1].startOf("day")]);
                setOnAyar("");
                setOnizleme(null);
              }
            }}
          />
          <Segmented value={onAyar} onChange={(v) => onAyarUygula(String(v))} options={ON_AYAR} />
          <Text type="secondary">
            {sayi(aralik[1].diff(aralik[0], "day") + 1)} gün
          </Text>
        </Space>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14, marginTop: 14 }}>
          <div>
            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>Resmi tatiller</div>
            <Radio.Group value={resmiTatil} onChange={(e) => { setResmiTatil(e.target.value); setOnizleme(null); }}>
              <Radio value="izinli">İzinli say</Radio>
              <Radio value="plan">Plana göre</Radio>
            </Radio.Group>
            <div style={{ fontSize: 11.5, color: "#9aa3af", marginTop: 2 }}>
              {(secenek?.tatiller ?? []).filter((t: any) => dayjs(t.tarih).isAfter(aralik[0].subtract(1, "day")) && dayjs(t.tarih).isBefore(aralik[1].add(1, "day"))).length} resmi tatil aralıkta
            </div>
          </div>

          <div>
            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>Mevcut planlar</div>
            <Space>
              <Switch checked={uzerineYaz} onChange={(v) => { setUzerineYaz(v); setOnizleme(null); }} />
              <span>{uzerineYaz ? "Üzerine yaz" : "Planı olan günleri koru"}</span>
            </Space>
          </div>

          <div>
            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>Personele yayınla</div>
            <Space>
              <Switch checked={yayinla} onChange={setYayinla} />
              <span>{yayinla ? "Uygulamada görünsün" : "Taslak kalsın"}</span>
            </Space>
          </div>

          <div>
            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>Bildirim</div>
            <Radio.Group value={yayinla ? bildirim : "yok"} disabled={!yayinla} onChange={(e) => setBildirim(e.target.value)}>
              <Radio value="ozet">Kişi başı tek özet</Radio>
              <Radio value="yok">Gönderme</Radio>
            </Radio.Group>
          </div>
        </div>

        <Space style={{ marginTop: 16 }}>
          <Button type="primary" icon={<Eye size={15} />} loading={onizleniyor} disabled={secili.length === 0} onClick={onizle}>
            Önizle
          </Button>
          {secili.length === 0 && <Text type="secondary">Önce personel seçin.</Text>}
        </Space>
      </Card>

      {/* ---------------------------------------------------- önizleme */}
      {onizleme && (
        <Onizleme
          v={onizleme}
          bas={aralik[0]}
          uygulaniyor={uygulaniyor}
          uygula={uygula}
          uzerineYaz={uzerineYaz}
        />
      )}

      {sonuc && (
        <Alert
          type="success"
          showIcon
          closable
          onClose={() => setSonuc(null)}
          message={`#${sonuc.id} uygulandı: ${sayi(sonuc.kisiSayisi)} kişi, ${sayi(sonuc.eklenen)} gün eklendi, ${sayi(sonuc.guncellenen)} gün güncellendi`}
          description={
            <>
              {sonuc.korunan > 0 && <div>{sayi(sonuc.korunan)} planlı gün korundu.</div>}
              {sonuc.yillikAtlanan > 0 && <div>{sayi(sonuc.yillikAtlanan)} izinli gün atlandı.</div>}
              <div>
                {sonuc.bildirim > 0 ? `${sayi(sonuc.bildirim)} kişiye tek özet bildirim gönderiliyor.` : "Bildirim gönderilmedi."}
              </div>
            </>
          }
        />
      )}

      {/* ------------------------------------------------------ geçmiş */}
      <Card
        size="small"
        title={
          <Space size={8}>
            <History size={16} strokeWidth={2} />
            Son toplu işlemler
          </Space>
        }
      >
        {islemler === null ? (
          <Spin />
        ) : (
          <Table
            rowKey="id"
            size="small"
            dataSource={islemler}
            pagination={false}
            locale={{ emptyText: "Henüz toplu işlem yok." }}
            columns={[
              { title: "#", dataIndex: "id", width: 56 },
              {
                title: "Zaman",
                width: 150,
                render: (_: unknown, k: any) => (
                  <>
                    {dayjs(k.zaman).format("DD.MM.YYYY HH:mm")}
                    <div style={{ fontSize: 11.5, color: "#6b7280" }}>{k.yapan}</div>
                  </>
                ),
              },
              {
                title: "Desen · kapsam",
                render: (_: unknown, k: any) => (
                  <>
                    <b>{k.desenAd}</b>
                    <div style={{ fontSize: 11.5, color: "#6b7280" }}>{k.kapsam}</div>
                  </>
                ),
              },
              {
                title: "Aralık",
                width: 190,
                render: (_: unknown, k: any) => `${dayjs(k.bas).format("DD.MM.YYYY")} – ${dayjs(k.bit).format("DD.MM.YYYY")}`,
              },
              {
                title: "Yazılan",
                width: 190,
                render: (_: unknown, k: any) => (
                  <>
                    {sayi(k.kisiSayisi)} kişi · {sayi(k.eklenen)} yeni
                    {k.guncellenen > 0 ? ` · ${sayi(k.guncellenen)} üzerine` : ""}
                    <div style={{ fontSize: 11.5, color: "#6b7280" }}>
                      {k.yayinla ? "yayınlandı" : "taslak"} · {k.bildirimSayisi > 0 ? `${k.bildirimSayisi} bildirim` : "bildirim yok"}
                    </div>
                  </>
                ),
              },
              {
                title: "",
                width: 170,
                render: (_: unknown, k: any) =>
                  k.geriAlindi ? (
                    <Tooltip title={k.geriOzet}>
                      <Tag>Geri alındı · {dayjs(k.geriAlindi).format("DD.MM HH:mm")}</Tag>
                    </Tooltip>
                  ) : (
                    <Popconfirm
                      title={`#${k.id} geri alınsın mı?`}
                      description="Eklenen günler silinir, üzerine yazılan günler eski hâline döner. Sonradan değiştirilen günlere dokunulmaz."
                      okText="Geri al"
                      cancelText="Vazgeç"
                      onConfirm={() => geriAl(k.id)}
                    >
                      <Button size="small" icon={<Undo2 size={13} />}>
                        Geri al
                      </Button>
                    </Popconfirm>
                  ),
              },
            ]}
          />
        )}
      </Card>
    </Space>
  );
}

/* ========================================================================== */

/** Önizleme: sayılar, kural uyarıları, takvim ısı haritası, kişi tablosu. */
function Onizleme({
  v,
  bas,
  uygulaniyor,
  uygula,
  uzerineYaz,
}: {
  v: any;
  bas: Dayjs;
  uygulaniyor: boolean;
  uygula: () => void;
  uzerineYaz: boolean;
}) {
  const [kisilerAcik, setKisilerAcik] = useState(false);

  /* Aylara bölünmüş takvim */
  const aylar = useMemo(() => {
    const m = new Map<string, any[]>();

    for (const g of v.takvim ?? []) {
      const d = dayjs(g.tarih);
      const k = d.format("YYYY-MM");
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push({ ...g, d });
    }

    return Array.from(m.entries());
  }, [v]);

  const kisi = Math.max(1, Number(v.kisiSayisi ?? 1));

  const hucreRengi = (g: any) => {
    if (g.tatil && g.calisan === 0) return { bg: "#fdecec", fg: "#b42318" };

    const toplam = g.calisan + g.izinli + g.bos + g.korunan + g.yillik;

    if (toplam === 0) return { bg: "#f4f5f2", fg: "#b0b5ad" };

    const oran = g.calisan / kisi;

    if (g.izinli >= g.calisan && g.izinli > 0) return { bg: "#eef1ea", fg: "#6b7280" };

    /* Yeşil yoğunluğu: çalışan oranı */
    const a = 0.25 + 0.75 * oran;
    return { bg: `rgba(124, 181, 24, ${a.toFixed(2)})`, fg: oran > 0.55 ? "#fff" : "#2f4a06" };
  };

  return (
    <Card
      size="small"
      title={
        <Space size={8}>
          <Eye size={16} strokeWidth={2} />
          Önizleme
        </Space>
      }
      style={{ borderColor: v.engel ? "#f5b5b5" : "#c9e19a" }}
    >
      <div style={{ fontSize: 15, marginBottom: 12 }}>
        <b>{sayi(v.kisiSayisi)}</b> kişi × <b>{sayi(v.gunSayisi)}</b> gün = <b>{sayi(v.hucre)}</b> gün-kişi →{" "}
        <b style={{ color: "#3a5709" }}>{sayi(v.yazilacak)}</b> kayıt yazılacak
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8, marginBottom: 12 }}>
        {[
          { ad: "Yeni kayıt", deger: v.eklenecek, renk: "#3a5709" },
          { ad: "Üzerine yazılacak", deger: v.guncellenecek, renk: v.guncellenecek > 0 ? "#b45309" : "#6b7280" },
          { ad: uzerineYaz ? "Korunan" : "Planlı · korunacak", deger: v.korunan, renk: "#14507f" },
          { ad: "Zaten aynı", deger: v.ayni, renk: "#6b7280" },
          { ad: "İzinli · atlanacak", deger: v.yillikAtlanan, renk: "#6b7280" },
          { ad: "Resmi tatil (gün)", deger: v.tatilGunu, renk: "#b42318" },
        ].map((x) => (
          <div key={x.ad} style={{ background: "#f7f8f5", borderRadius: 10, padding: "8px 10px" }}>
            <div style={{ fontSize: 11.5, color: "#6b7280" }}>{x.ad}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: x.renk }}>{sayi(x.deger)}</div>
          </div>
        ))}
      </div>

      {(v.uyarilar ?? []).map((u: string, i: number) => (
        <Alert
          key={`u${i}`}
          style={{ marginBottom: 8 }}
          type={v.engel && i === 0 ? "error" : "warning"}
          showIcon
          message={u}
        />
      ))}

      {(v.bilgiler ?? []).map((u: string, i: number) => (
        <Alert key={`b${i}`} style={{ marginBottom: 8 }} type="info" showIcon message={u} />
      ))}

      {/* ---------------------------------------------- ısı haritası */}
      <div style={{ fontSize: 11, fontWeight: 800, color: "#6b7280", margin: "14px 0 8px" }}>
        TAKVİM · hücre rengi o gün çalışan kişi oranı
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(196px, 1fr))", gap: 12 }}>
        {aylar.map(([k, gunler]) => {
          const ilk = gunler[0].d as Dayjs;
          const bosluk = (ilk.day() + 6) % 7;

          return (
            <div key={k}>
              <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 4 }}>
                {AYLAR[ilk.month()]} {ilk.year()}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 26px)", gap: 2 }}>
                {GUNLER.map((g) => (
                  <div key={g} style={{ fontSize: 9, color: "#9aa3af", textAlign: "center" }}>
                    {g[0]}
                  </div>
                ))}
                {Array.from({ length: bosluk }).map((_, i) => (
                  <div key={`b${i}`} />
                ))}
                {gunler.map((g: any) => {
                  const r = hucreRengi(g);

                  return (
                    <Tooltip
                      key={g.tarih}
                      title={
                        <div style={{ fontSize: 12 }}>
                          <b>{g.d.format("DD MMMM dddd")}</b>
                          {g.tatil && <div>Resmi tatil: {g.tatil}</div>}
                          <div>Çalışan: {g.calisan}</div>
                          <div>Haftalık izin: {g.izinli}</div>
                          {g.bos > 0 && <div>Boş: {g.bos}</div>}
                          {g.uzerine > 0 && <div>Üzerine yazılacak: {g.uzerine}</div>}
                          {g.korunan > 0 && <div>Planı korunacak: {g.korunan}</div>}
                          {g.yillik > 0 && <div>İzinli (atlanır): {g.yillik}</div>}
                        </div>
                      }
                    >
                      <div
                        style={{
                          height: 24,
                          borderRadius: 5,
                          background: r.bg,
                          color: r.fg,
                          fontSize: 10.5,
                          fontWeight: 700,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          position: "relative",
                          outline: g.uzerine > 0 ? "2px solid #f59e0b" : g.korunan > 0 ? "2px solid #93c5fd" : undefined,
                          outlineOffset: -2,
                        }}
                      >
                        {g.d.date()}
                        {g.tatil && (
                          <span style={{ position: "absolute", top: 2, right: 2, width: 5, height: 5, borderRadius: 3, background: "#e8481c" }} />
                        )}
                      </div>
                    </Tooltip>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <Space wrap size={14} style={{ marginTop: 10, fontSize: 11.5, color: "#6b7280" }}>
        <span><Lejant bg="rgba(124,181,24,0.9)" /> çalışan</span>
        <span><Lejant bg="#eef1ea" /> haftalık izin</span>
        <span><Lejant bg="#fdecec" /> resmi tatil</span>
        <span><Lejant bg="#fff" outline="#f59e0b" /> üzerine yazılacak</span>
        <span><Lejant bg="#fff" outline="#93c5fd" /> planı korunacak</span>
      </Space>

      <div style={{ marginTop: 12 }}>
        <Checkbox checked={kisilerAcik} onChange={(e) => setKisilerAcik(e.target.checked)}>
          Kişi kişi göster
        </Checkbox>
      </div>

      {kisilerAcik && (
        <Table
          style={{ marginTop: 8 }}
          rowKey="sicil"
          size="small"
          dataSource={v.kisiler ?? []}
          pagination={{ pageSize: 10, size: "small", showSizeChanger: false }}
          columns={[
            { title: "Personel", render: (_: unknown, k: any) => (<><b><PersonelAdi kod={k.sicil}>{k.adSoyad}</PersonelAdi></b><div style={{ fontSize: 11.5, color: "#6b7280" }}>{k.pozisyon} · {k.birim}</div></>) },
            { title: "Yeni", dataIndex: "eklenecek", width: 80, render: sayi },
            { title: "Üzerine", dataIndex: "guncellenecek", width: 80, render: (n: number) => (n > 0 ? <b style={{ color: "#b45309" }}>{sayi(n)}</b> : 0) },
            { title: "Korunan", dataIndex: "korunan", width: 80, render: sayi },
            { title: "İzinli", dataIndex: "yillik", width: 80, render: sayi },
          ]}
        />
      )}

      <Space style={{ marginTop: 16 }}>
        <Popconfirm
          title="Toplu vardiya uygulansın mı?"
          description={`${sayi(v.yazilacak)} gün yazılacak${v.guncellenecek > 0 ? `, ${sayi(v.guncellenecek)} günün üzerine yazılacak` : ""}. İşlem geri alınabilir.`}
          okText="Uygula"
          cancelText="Vazgeç"
          onConfirm={uygula}
          disabled={v.engel || v.yazilacak === 0}
        >
          <Button type="primary" loading={uygulaniyor} disabled={v.engel || v.yazilacak === 0}>
            Uygula
          </Button>
        </Popconfirm>
        <Text type="secondary">
          {bas.format("DD.MM.YYYY")} başlangıçlı · {v.engel ? "kural ihlali giderilmeden uygulanamaz" : "işlem geri alınabilir"}
        </Text>
      </Space>
    </Card>
  );
}

function Lejant({ bg, outline }: { bg: string; outline?: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 12,
        height: 12,
        borderRadius: 3,
        background: bg,
        border: outline ? `2px solid ${outline}` : "1px solid #e5e7eb",
        verticalAlign: "-2px",
        marginRight: 4,
      }}
    />
  );
}
