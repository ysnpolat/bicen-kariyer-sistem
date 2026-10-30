/**
 * ---------------------------------------------------------------------------
 * Avans Onay Tablosu (08.10.2026)
 * ---------------------------------------------------------------------------
 * Avans talebinin onay sırası: iş yeri + pozisyon → 1.–5. onay. İK'nın
 * "AVANS TALEP ONAY SÜRECİ" Excel'iyle aynı sütunlar; ilk açılışta ondan
 * dolduruldu. Excel'e aktarılıp düzenlenip geri yüklenebiliyor.
 *
 * Onay bir pozisyon (mağaza müdürü kendi mağazasının, bölge müdürü şubeyi
 * kapsayan, merkez pozisyonlarında o pozisyondaki kişi), belirli bir kişi
 * (pozisyon + sicil) ya da İnsan Kaynakları olabilir. Kişiler Biçen360'ta
 * İzin Onayları ekranından onaylıyor; İK panelden.
 *
 * Değişiklik yeni taleplere uygulanır; bekleyen talep açıldığı andaki
 * sırayla ilerler.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  App as AntdApp,
  AutoComplete,
  Button,
  Card,
  Input,
  Modal,
  Popconfirm,
  Segmented,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  Upload,
} from "antd";
import { ArrowDown, ArrowRight, ArrowUp, Download, Plus, Trash2, Upload as UploadIcon } from "lucide-react";
import * as XLSX from "xlsx";

import { api } from "./api";
import { DegisiklikGecmisi } from "./AyarMerkezi";

type Adim = { onay: string; sicil?: string | null };
type Kural = { id: number; isYeri: string; pozisyon: string; adimlar: Adim[] };
type Ayar = { ikReddederse: "sonraki" | "bitir"; araKarardaBildir: boolean };

interface Veri {
  yazabilir: boolean;
  kurallar: Kural[];
  pozisyonlar: { pozisyon: string; kisi: number }[];
  eksikler: { pozisyon: string; kisi: number; isYerleri: string[] }[];
  isYerleri: string[];
  kisiAdlari: Record<string, string | null>;
  ayar: Ayar;
  gmy: { sicil: string; adSoyad: string | null };
  varsayilanSube: Adim[];
  varsayilanDiger: Adim[];
  bekleyen: number;
}

const IK = "İK";
const SUTUN = 5;

const ikMi = (o?: string | null) => {
  const a = (o ?? "").trim().toLocaleUpperCase("tr");
  return a === "İK" || a === "IK" || a.startsWith("İNSAN KAYNAK") || a.startsWith("INSAN KAYNAK");
};

/** Excel hücresi: "İnsan Kaynakları", "MAĞAZA MÜDÜRÜ", "GENEL MÜDÜR YARDIMCISI sicil 10664" */
const hucreYaz = (a?: Adim) => (!a ? "" : ikMi(a.onay) ? "İnsan Kaynakları" : a.sicil ? `${a.onay} sicil ${a.sicil}` : a.onay);

const hucreOku = (h: unknown): Adim | null => {
  const s = String(h ?? "").replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (ikMi(s)) return { onay: IK };
  const m = s.match(/^(.*?)\s+sicil\s*:?\s*([0-9A-Za-z]+)$/i);
  if (m) {
    let ad = m[1].trim();
    if (/^(G\.?M\.?Y\.?|GENEL MÜDÜR YRD\.?)$/i.test(ad)) ad = "GENEL MÜDÜR YARDIMCISI";
    return { onay: ad, sicil: m[2] };
  }
  return { onay: s };
};

function AdimEtiketi({ a, adlar, gmy }: { a?: Adim; adlar: Record<string, string | null>; gmy: Veri["gmy"] }) {
  if (!a) return <span style={{ color: "#c4c8ce" }}>—</span>;
  if (ikMi(a.onay)) return <Tag color="blue">İnsan Kaynakları</Tag>;
  const sicil = a.sicil === "gmy" ? gmy.sicil : a.sicil;
  const ad = a.sicil === "gmy" ? gmy.adSoyad : sicil ? adlar[sicil] : null;
  return (
    <Space size={2} direction="vertical">
      <Tag color={sicil ? "purple" : "green"} style={{ marginInlineEnd: 0, whiteSpace: "normal" }}>
        {a.onay}
      </Tag>
      {sicil && (
        <span style={{ fontSize: 11.5, color: "#6b7280" }}>
          sicil {sicil}
          {ad ? ` · ${ad}` : ""}
        </span>
      )}
    </Space>
  );
}

export default function AvansOnayTablosu() {
  const { message, modal } = AntdApp.useApp();

  const [veri, setVeri] = useState<Veri | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [ara, setAra] = useState("");
  const [yer, setYer] = useState("hepsi");
  const [duzenlenen, setDuzenlenen] = useState<Partial<Kural> | null>(null);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const [deneSicil, setDeneSicil] = useState("");
  const [deneSonuc, setDeneSonuc] = useState<any>(null);
  const [yenile, setYenile] = useState(0);

  const getir = useCallback(async () => {
    setYukleniyor(true);
    try {
      setVeri(await api.al<Veri>("/api/AvansOnayKural"));
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setYukleniyor(false);
    }
  }, [message]);

  useEffect(() => {
    getir();
  }, [getir]);

  const kurallar = veri?.kurallar ?? [];
  const isYerleri = veri?.isYerleri ?? ["ŞUBE"];
  const yaz = !!veri?.yazabilir;
  const q = ara.trim().toLocaleLowerCase("tr");

  const gorunen = useMemo(
    () =>
      kurallar.filter(
        (k) =>
          (yer === "hepsi" || k.isYeri === yer) &&
          (!q || `${k.pozisyon} ${k.adimlar.map((a) => `${a.onay} ${a.sicil ?? ""}`).join(" ")}`.toLocaleLowerCase("tr").includes(q))
      ),
    [kurallar, yer, q]
  );

  const pozSecenek = (veri?.pozisyonlar ?? []).map((p) => ({ value: p.pozisyon, label: `${p.pozisyon} · ${p.kisi} kişi` }));
  const onaySecenek = [
    { value: "İnsan Kaynakları", label: "İnsan Kaynakları · panelden" },
    { value: "MAĞAZA MÜDÜRÜ", label: "MAĞAZA MÜDÜRÜ · kendi mağazasının" },
    { value: "BÖLGE MÜDÜRÜ", label: "BÖLGE MÜDÜRÜ · şubeyi kapsayan" },
    { value: "GENEL MÜDÜR YARDIMCISI", label: "GENEL MÜDÜR YARDIMCISI · sicil yazınız" },
    ...pozSecenek,
  ];
  const aramaFiltre = (g: string, o: any) => String(o?.value ?? "").toLocaleLowerCase("tr").includes(g.toLocaleLowerCase("tr"));

  /* ------------------------------------------------------------ kaydet */

  const kaydet = async () => {
    if (!duzenlenen) return;
    setKaydediliyor(true);
    try {
      await api.gonder("/api/AvansOnayKural", {
        id: duzenlenen.id ?? 0,
        isYeri: duzenlenen.isYeri,
        pozisyon: duzenlenen.pozisyon,
        adimlar: (duzenlenen.adimlar ?? []).filter((a) => a.onay?.trim()).map((a) => (ikMi(a.onay) ? { onay: IK } : a)),
      });
      message.success("Satır kaydedildi. Yeni avans talepleri bu sırayla onaya gider.");
      setDuzenlenen(null);
      setYenile((x) => x + 1);
      getir();
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setKaydediliyor(false);
    }
  };

  const ayarKaydet = async (a: Ayar) => {
    try {
      await api.gonder("/api/AvansOnayKural/Ayar", a);
      message.success("Kaydedildi.");
      setYenile((x) => x + 1);
      getir();
    } catch (h: any) {
      message.error(h.message);
    }
  };

  const dene = async () => {
    if (!deneSicil.trim()) return;
    try {
      setDeneSonuc(await api.al<any>(`/api/AvansOnayKural/Dene?sicil=${encodeURIComponent(deneSicil.trim())}`));
    } catch (h: any) {
      setDeneSonuc(null);
      message.error(h.message);
    }
  };

  /* -------------------------------------------------------------- excel */

  const disaAktar = () => {
    const satirlar = [
      ["İş yeri", "Pozisyon (talep eden)", ...Array.from({ length: SUTUN }, (_, i) => `${i + 1}. onay`)],
      ...kurallar.map((k) => [k.isYeri, k.pozisyon, ...Array.from({ length: SUTUN }, (_, i) => hucreYaz(k.adimlar[i]))]),
    ];
    const sayfa = XLSX.utils.aoa_to_sheet(satirlar);
    sayfa["!cols"] = [{ wch: 18 }, { wch: 32 }, ...Array.from({ length: SUTUN }, () => ({ wch: 34 }))];
    const kitap = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(kitap, sayfa, "Avans onay süreci");
    XLSX.writeFile(kitap, `avans-onay-sureci-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const iceAktar = async (dosya: File) => {
    try {
      const kitap = XLSX.read(await dosya.arrayBuffer(), { type: "array" });
      const hucreler = XLSX.utils.sheet_to_json<any[]>(kitap.Sheets[kitap.SheetNames[0]], { header: 1, defval: "" });

      /* Başlık satırı: "İş yeri" yazan satır; yoksa ilk satır başlık sayılıyor */
      const bas = Math.max(0, hucreler.findIndex((r) => String(r?.[0] ?? "").toLocaleLowerCase("tr").includes("iş yeri")));
      const yeni = hucreler
        .slice(bas + 1)
        .map((r) => ({
          isYeri: String(r?.[0] ?? "").replace(/\s+/g, " ").trim(),
          pozisyon: String(r?.[1] ?? "").replace(/\s+/g, " ").trim(),
          adimlar: (r ?? []).slice(2, 2 + SUTUN).map(hucreOku).filter(Boolean) as Adim[],
        }))
        .filter((x) => x.isYeri || x.pozisyon);

      if (yeni.length === 0) {
        message.error("Dosyada satır bulunamadı. Sütunlar: İş yeri · Pozisyon · 1. onay … 5. onay");
        return;
      }

      const eksik = yeni.filter((x) => !x.isYeri || !x.pozisyon || x.adimlar.length === 0);
      if (eksik.length > 0) {
        message.error(`${eksik.length} satırda iş yeri, pozisyon ya da onay boş (ör. ${eksik[0].pozisyon || eksik[0].isYeri}).`);
        return;
      }

      modal.confirm({
        title: `${yeni.length} satır yüklensin mi?`,
        content: `Mevcut tablo (${kurallar.length} satır) dosyadakiyle değiştirilecek. Bekleyen avans talepleri açıldıkları sırayla ilerlemeye devam eder.`,
        okText: "Yükle",
        cancelText: "Vazgeç",
        onOk: async () => {
          try {
            const c = await api.gonder<{ sayi: number }>("/api/AvansOnayKural/Toplu", { kurallar: yeni });
            message.success(`${c.sayi} satır yüklendi.`);
            setYenile((x) => x + 1);
            getir();
          } catch (h: any) {
            message.error(h.message);
          }
        },
      });
    } catch {
      message.error("Dosya okunamadı. Excel (.xlsx) dosyası seçiniz.");
    }
  };

  /* --------------------------------------------------------- düzenleme */

  const adimDegistir = (f: (l: Adim[]) => void) =>
    setDuzenlenen((d) => {
      const l = [...(d?.adimlar ?? [])].map((x) => ({ ...x }));
      f(l);
      return { ...d, adimlar: l };
    });

  const yeniSatir = (isYeri: string, pozisyon: string) =>
    setDuzenlenen({
      isYeri,
      pozisyon,
      adimlar: (isYeri === "ŞUBE" ? veri?.varsayilanSube : veri?.varsayilanDiger)?.map((a) => ({
        onay: a.onay,
        sicil: a.sicil === "gmy" ? veri?.gmy.sicil : a.sicil,
      })) ?? [{ onay: IK }],
    });

  const enCokAdim = Math.max(4, ...kurallar.map((k) => k.adimlar.length));

  if (!veri) return <Card loading />;

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Alert
        type="info"
        showIcon
        message="Avans talebi bu tablodaki sırayla onaya gider"
        description={
          <>
            Talep edenin iş yeri ve pozisyonuna göre onaylar sırayla alınır. Mağaza müdürü kendi mağazasının, bölge müdürü şubeyi kapsayan
            (Bölgeler), merkez pozisyonlarında o pozisyondaki kişi onaylar; aynı ünvanda birden çok kişi varsa sicil yazılır. Kişiler Biçen360'ta{" "}
            <b>İzin Onayları</b> ekranından onaylar (uygulama güncellemesi gerekmez), İnsan Kaynakları Personel Talepleri › Avans'tan. Bir kişi
            reddederse talep reddedilir. Onaylayacak kimse bulunamayan ya da önceki adımla aynı kişinin onayladığı adım atlanır. Tabloda olmayan
            pozisyonlar: şubede Mağaza Müdürü → Bölge Müdürü → İK → GMY, diğerlerinde İK → GMY.
            {veri.bekleyen > 0 && ` Şu an bekleyen ${veri.bekleyen} talep açıldığı andaki sırayla ilerler.`}
            <br />
            İzin talepleri 27.10.2026'dan beri kendi tablosuyla gider: Yönetim › İzin onay süreci.
          </>
        }
      />

      <Card size="small" title="Ayarlar">
        <Space direction="vertical" style={{ width: "100%" }}>
          <Space wrap>
            <Typography.Text strong>İnsan Kaynakları reddederse:</Typography.Text>
            <Segmented
              disabled={!yaz}
              value={veri.ayar.ikReddederse}
              onChange={(v) => ayarKaydet({ ...veri.ayar, ikReddederse: v as Ayar["ikReddederse"] })}
              options={[
                { value: "sonraki", label: "Sonraki onaya gider (son karar GMY'de)" },
                { value: "bitir", label: "Talep reddedilir" },
              ]}
            />
          </Space>
          <Space wrap>
            <Switch disabled={!yaz} checked={veri.ayar.araKarardaBildir} onChange={(v) => ayarKaydet({ ...veri.ayar, araKarardaBildir: v })} />
            <Typography.Text>Talep bir sonraki onaya geçince personele "talebiniz değerlendirmede" bildirimi gönder</Typography.Text>
          </Space>
        </Space>
      </Card>

      {veri.eksikler.length > 0 && (
        <Alert
          type="warning"
          showIcon
          message={`${veri.eksikler.length} pozisyon tabloda yok — bu personelin talebi varsayılan sırayla gider`}
          description={
            <Space size={[6, 6]} wrap style={{ marginTop: 6 }}>
              {veri.eksikler.slice(0, 40).map((e) => (
                <Tag
                  key={e.pozisyon}
                  style={{ cursor: yaz ? "pointer" : undefined }}
                  onClick={() =>
                    yaz && yeniSatir(e.isYerleri?.length === 1 && isYerleri.includes(e.isYerleri[0]) ? e.isYerleri[0] : "ŞUBE", e.pozisyon)
                  }
                >
                  ＋ {e.pozisyon} · {e.kisi}
                </Tag>
              ))}
            </Space>
          }
        />
      )}

      <Card size="small">
        <Space wrap style={{ width: "100%", justifyContent: "space-between" }}>
          <Space wrap>
            <Input.Search allowClear placeholder="Pozisyon ya da onaylayan ara" style={{ width: 240 }} value={ara} onChange={(e) => setAra(e.target.value)} />
            <Segmented
              value={yer}
              onChange={(v) => setYer(String(v))}
              options={[{ value: "hepsi", label: `Tümü (${kurallar.length})` }].concat(
                isYerleri.map((y) => ({ value: y, label: `${y} (${kurallar.filter((k) => k.isYeri === y).length})` }))
              )}
            />
          </Space>
          <Space wrap>
            <Input placeholder="Sicil ile dene" style={{ width: 140 }} value={deneSicil} onChange={(e) => setDeneSicil(e.target.value)} onPressEnter={dene} />
            <Button onClick={dene}>Kime gider?</Button>
            <Button icon={<Download size={14} />} onClick={disaAktar}>
              Excel'e aktar
            </Button>
            {yaz && (
              <Upload
                accept=".xlsx,.xls"
                showUploadList={false}
                beforeUpload={(f) => {
                  iceAktar(f as File);
                  return false;
                }}
              >
                <Button icon={<UploadIcon size={14} />}>Excel'den yükle</Button>
              </Upload>
            )}
            {yaz && (
              <Button type="primary" icon={<Plus size={14} />} onClick={() => yeniSatir("ŞUBE", "")}>
                Satır ekle
              </Button>
            )}
          </Space>
        </Space>

        {deneSonuc && (
          <Alert
            style={{ marginTop: 12 }}
            type="success"
            showIcon
            closable
            onClose={() => setDeneSonuc(null)}
            message={
              <>
                <b>{deneSonuc.personel.adSoyad}</b> · {deneSonuc.personel.pozisyon} · {deneSonuc.personel.isYeri}
                <span style={{ color: "#6b7280" }}> · satır: {deneSonuc.kural === "varsayılan" ? "tabloda yok, varsayılan sıra" : deneSonuc.kural}</span>
              </>
            }
            description={
              <Space direction="vertical" size={2}>
                {deneSonuc.adimlar.map((a: any) => (
                  <div key={a.sira} style={{ opacity: a.karar === "atlandi" ? 0.55 : 1 }}>
                    <b>{a.sira}.</b> {a.ad}
                    {a.tur === "ik"
                      ? " — panelden"
                      : a.kisiler?.length
                      ? ` — ${a.kisiler.join(", ")} (Biçen360)`
                      : " — kimse bulunamadı"}
                    {a.karar === "atlandi" && ` · atlanır (${a.not})`}
                  </div>
                ))}
              </Space>
            }
          />
        )}
      </Card>

      <Table<Kural>
        rowKey="id"
        size="small"
        loading={yukleniyor}
        dataSource={gorunen}
        pagination={{ pageSize: 50, showSizeChanger: false, hideOnSinglePage: true }}
        scroll={{ x: 900 }}
        columns={[
          { title: "İş yeri", dataIndex: "isYeri", width: 150, render: (d: string) => <Tag>{d}</Tag> },
          { title: "Pozisyon (talep eden)", dataIndex: "pozisyon", width: 200, render: (d: string) => <b>{d}</b> },
          ...Array.from({ length: enCokAdim }, (_, i) => ({
            title: `${i + 1}. onay`,
            key: `o${i}`,
            render: (_: unknown, k: Kural) => <AdimEtiketi a={k.adimlar[i]} adlar={veri.kisiAdlari} gmy={veri.gmy} />,
          })),
          ...(yaz
            ? [
                {
                  title: "",
                  key: "islem",
                  width: 120,
                  fixed: "right" as const,
                  render: (_: unknown, k: Kural) => (
                    <Space>
                      <Button size="small" onClick={() => setDuzenlenen(JSON.parse(JSON.stringify(k)))}>
                        Düzenle
                      </Button>
                      <Popconfirm
                        title="Satır silinsin mi?"
                        description="Bu pozisyonun talebi varsayılan sırayla gider."
                        okText="Sil"
                        cancelText="Vazgeç"
                        onConfirm={async () => {
                          await api.sil(`/api/AvansOnayKural/${k.id}`);
                          setYenile((x) => x + 1);
                          getir();
                        }}
                      >
                        <Button size="small" danger icon={<Trash2 size={13} />} />
                      </Popconfirm>
                    </Space>
                  ),
                },
              ]
            : []),
        ]}
      />

      <DegisiklikGecmisi bolum="avansakis" yenile={yenile} />

      <Modal
        open={!!duzenlenen}
        width={640}
        title={duzenlenen?.id ? "Satırı düzenle" : "Yeni satır"}
        okText="Kaydet"
        cancelText="Vazgeç"
        confirmLoading={kaydediliyor}
        onCancel={() => setDuzenlenen(null)}
        onOk={kaydet}
        okButtonProps={{
          disabled: !duzenlenen?.isYeri?.trim() || !duzenlenen?.pozisyon?.trim() || !(duzenlenen?.adimlar ?? []).some((a) => a.onay?.trim()),
        }}
      >
        <Space direction="vertical" style={{ width: "100%" }} size="middle">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 10 }}>
            <div>
              <Typography.Text strong>İş yeri</Typography.Text>
              <AutoComplete
                style={{ width: "100%" }}
                value={duzenlenen?.isYeri}
                onChange={(v) => setDuzenlenen({ ...duzenlenen, isYeri: v })}
                options={isYerleri.map((y) => ({ value: y }))}
                placeholder="ŞUBE, Z.MERKEZ BURO…"
              />
            </div>
            <div>
              <Typography.Text strong>Pozisyon (talep eden)</Typography.Text>
              <AutoComplete
                style={{ width: "100%" }}
                value={duzenlenen?.pozisyon}
                onChange={(v) => setDuzenlenen({ ...duzenlenen, pozisyon: v })}
                options={pozSecenek}
                filterOption={aramaFiltre}
              />
            </div>
          </div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            ŞUBE bütün mağazalar için geçerli; diğer iş yerleri personel kartındaki adla birebir.
          </Typography.Text>

          <div>
            <Typography.Text strong>Onay sırası</Typography.Text>
            <Space direction="vertical" style={{ width: "100%", marginTop: 6 }}>
              {(duzenlenen?.adimlar ?? []).map((a, i, l) => (
                <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span style={{ width: 56, fontSize: 12.5, color: "#6b7280" }}>{i + 1}. onay</span>
                  <AutoComplete
                    style={{ flex: 1 }}
                    value={ikMi(a.onay) ? "İnsan Kaynakları" : a.onay}
                    onChange={(v) => adimDegistir((x) => (x[i].onay = v))}
                    options={onaySecenek}
                    filterOption={aramaFiltre}
                    placeholder="Pozisyon ya da İnsan Kaynakları"
                  />
                  <Input
                    style={{ width: 120 }}
                    placeholder="Sicil (isteğe bağlı)"
                    disabled={ikMi(a.onay)}
                    value={ikMi(a.onay) ? "" : a.sicil ?? ""}
                    onChange={(e) => adimDegistir((x) => (x[i].sicil = e.target.value || null))}
                  />
                  <Button size="small" type="text" disabled={i === 0} icon={<ArrowUp size={14} />} onClick={() => adimDegistir((x) => ([x[i - 1], x[i]] = [x[i], x[i - 1]]))} />
                  <Button size="small" type="text" disabled={i === l.length - 1} icon={<ArrowDown size={14} />} onClick={() => adimDegistir((x) => ([x[i + 1], x[i]] = [x[i], x[i + 1]]))} />
                  <Button size="small" type="text" danger icon={<Trash2 size={14} />} onClick={() => adimDegistir((x) => x.splice(i, 1))} />
                </div>
              ))}
              {(duzenlenen?.adimlar ?? []).length < SUTUN && (
                <Button size="small" icon={<Plus size={13} />} onClick={() => adimDegistir((x) => x.push({ onay: "" }))}>
                  Onay ekle
                </Button>
              )}
            </Space>
          </div>

          {(duzenlenen?.adimlar ?? []).some((a) => a.onay?.trim()) && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center", fontSize: 12.5 }}>
              <span style={{ color: "#6b7280" }}>Personel</span>
              {(duzenlenen?.adimlar ?? [])
                .filter((a) => a.onay?.trim())
                .map((a, i) => (
                  <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <ArrowRight size={12} color="#9ca3af" />
                    <Tag style={{ marginInlineEnd: 0 }} color={ikMi(a.onay) ? "blue" : a.sicil ? "purple" : "green"}>
                      {ikMi(a.onay) ? "İnsan Kaynakları" : a.onay}
                      {a.sicil && !ikMi(a.onay) ? ` (${a.sicil})` : ""}
                    </Tag>
                  </span>
                ))}
              <ArrowRight size={12} color="#9ca3af" />
              <span style={{ color: "#3f6108", fontWeight: 600 }}>Onaylandı</span>
            </div>
          )}
        </Space>
      </Modal>
    </Space>
  );
}
