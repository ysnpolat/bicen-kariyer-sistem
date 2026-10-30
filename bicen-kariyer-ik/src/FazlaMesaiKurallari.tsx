/**
 * ---------------------------------------------------------------------------
 * Yönetim › Fazla mesai akışı (14.10.2026)
 * ---------------------------------------------------------------------------
 * Hangi iş yerinde, hangi pozisyondaki personele, kim fazla mesai girerse
 * onayın kimlere gideceği ve formun hangi adrese gideceği. Son onay her
 * zaman İnsan Kaynakları. Örnek:
 *   Genel merkez · girer GMY            → doğrudan İK
 *   Genel merkez · girer herkes         → GMY → İK
 *
 * Kurallar yukarıdan aşağı denenir, ilk tutan uygulanır. Hiçbiri tutmazsa
 * eski akış: organizasyon şemasındaki üst yönetici → İK, form birimin izin
 * formu adresine. Birim yöneticisinin imzalı form aşaması her durumda aynı.
 * Değişiklik yeni kayıtlara uygulanır.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  App as AntdApp,
  AutoComplete,
  Button,
  Input,
  Modal,
  Popconfirm,
  Radio,
  Segmented,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from "antd";
import { ArrowDown, ArrowRight, ArrowUp, Mail, Pencil, Plus, Search, Trash2 } from "lucide-react";

import { api } from "./api";

type Adim = { onay: string; sicil?: string | null };

interface Kural {
  id: number;
  sira: number;
  ad: string | null;
  isYeri: string;
  pozisyon: string;
  giren: string;
  girenSicil: string | null;
  adimlar: Adim[];
  epostaMod: "varsayilan" | "giren" | "adres";
  eposta: string | null;
  aktif: boolean;
}

interface Veri {
  yazabilir: boolean;
  kurallar: Kural[];
  pozisyonlar: { pozisyon: string; kisi: number }[];
  isYerleri: string[];
  kisiAdlari: Record<string, string | null>;
  sema: string;
}

interface Kisi {
  sicil: string;
  ad: string;
  pozisyon?: string | null;
  sube?: string | null;
}

const HEPSI = "*";
const hepsiMi = (s?: string | null) => !s || s.trim() === HEPSI;

function KisiSec({ deger, sec, yer }: { deger?: string | null; sec: (k: Kisi | null) => void; yer: string }) {
  const [secenek, setSecenek] = useState<Kisi[]>([]);
  return (
    <Select
      showSearch
      allowClear
      value={deger || null}
      style={{ width: "100%" }}
      placeholder={yer}
      filterOption={false}
      suffixIcon={<Search size={14} />}
      onSearch={async (q) => {
        if (q.trim().length < 2) return;
        try {
          setSecenek(await api.al<Kisi[]>(`/api/EkibimKural/KisiAra?q=${encodeURIComponent(q)}`));
        } catch {
          setSecenek([]);
        }
      }}
      onChange={(s) => sec(secenek.find((k) => k.sicil === s) ?? null)}
      options={[
        ...(deger && !secenek.some((k) => k.sicil === deger) ? [{ value: deger, label: `sicil ${deger}` }] : []),
        ...secenek.map((k) => ({ value: k.sicil, label: [k.ad, k.pozisyon, k.sube].filter(Boolean).join(" · ") })),
      ]}
    />
  );
}

function AdimEtiketi({ a, v }: { a: Adim; v: Veri }) {
  if (a.onay === v.sema) return <Tag color="geekblue">Şemadaki üst yönetici</Tag>;
  const ad = a.sicil ? v.kisiAdlari[a.sicil] : null;
  return (
    <Tag color={a.sicil ? "purple" : "green"} style={{ whiteSpace: "normal", marginInlineEnd: 0 }}>
      {a.sicil ? `${ad ?? a.onay} · ${a.sicil}` : a.onay}
    </Tag>
  );
}

function Akis({ k, v }: { k: Kural; v: Veri }) {
  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
      {k.adimlar.map((a, i) => (
        <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <AdimEtiketi a={a} v={v} />
          <ArrowRight size={13} color="#9aa1a9" />
        </span>
      ))}
      <Tag color="blue" style={{ marginInlineEnd: 0 }}>
        İnsan Kaynakları
      </Tag>
    </span>
  );
}

export default function FazlaMesaiKurallari() {
  const { message } = AntdApp.useApp();

  const [veri, setVeri] = useState<Veri | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [duzenlenen, setDuzenlenen] = useState<Partial<Kural> | null>(null);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const [denePersonel, setDenePersonel] = useState<Kisi | null>(null);
  const [deneGiren, setDeneGiren] = useState<Kisi | null>(null);
  const [deneSonuc, setDeneSonuc] = useState<any>(null);

  const getir = useCallback(async () => {
    setYukleniyor(true);
    try {
      setVeri(await api.al<Veri>("/api/FazlaMesaiKural"));
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setYukleniyor(false);
    }
  }, [message]);

  useEffect(() => {
    getir();
  }, [getir]);

  const kaydet = async () => {
    if (!duzenlenen) return;
    const d = duzenlenen;
    if ((d.adimlar ?? []).some((a) => !a.onay?.trim())) {
      message.warning("Boş onay adımı var; doldurun ya da silin.");
      return;
    }
    setKaydediliyor(true);
    try {
      await api.gonder("/api/FazlaMesaiKural", {
        id: d.id ?? 0,
        ad: d.ad ?? "",
        isYeri: d.isYeri ?? HEPSI,
        pozisyon: d.pozisyon ?? HEPSI,
        giren: d.girenSicil != null ? HEPSI : d.giren || HEPSI,
        girenSicil: d.girenSicil ?? null,
        adimlar: d.adimlar ?? [],
        epostaMod: d.epostaMod ?? "varsayilan",
        eposta: d.eposta ?? "",
        aktif: d.aktif ?? true,
      });
      message.success("Kural kaydedildi. Yeni fazla mesai kayıtlarına uygulanır.");
      setDuzenlenen(null);
      getir();
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setKaydediliyor(false);
    }
  };

  const sil = async (k: Kural) => {
    try {
      await api.sil(`/api/FazlaMesaiKural/${k.id}`);
      getir();
    } catch (h: any) {
      message.error(h.message);
    }
  };

  const tasi = async (i: number, yon: -1 | 1) => {
    if (!veri) return;
    const l = [...veri.kurallar];
    const j = i + yon;
    if (j < 0 || j >= l.length) return;
    [l[i], l[j]] = [l[j], l[i]];
    setVeri({ ...veri, kurallar: l });
    try {
      await api.gonder("/api/FazlaMesaiKural/Sira", { siralama: l.map((x) => x.id) });
    } catch (h: any) {
      message.error(h.message);
      getir();
    }
  };

  const [uygulaniyor, setUygulaniyor] = useState(false);

  /* Kural sonradan yazıldıysa açık kayıtlara da uygula (14.10.2026) */
  const bekleyenlereUygula = async () => {
    setUygulaniyor(true);
    try {
      const c = await api.gonder<{ mesaj: string }>("/api/FazlaMesai/AkisYenileToplu", {});
      message.success(c.mesaj, 6);
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setUygulaniyor(false);
    }
  };

  const dene = async () => {
    if (!denePersonel || !deneGiren) return;
    try {
      setDeneSonuc(
        await api.al<any>(
          `/api/FazlaMesaiKural/Dene?personel=${encodeURIComponent(denePersonel.sicil)}&giren=${encodeURIComponent(deneGiren.sicil)}`
        )
      );
    } catch (h: any) {
      setDeneSonuc(null);
      message.error(h.message);
    }
  };

  if (!veri) return yukleniyor ? <Typography.Text type="secondary">Yükleniyor…</Typography.Text> : null;

  const pozSecenek = veri.pozisyonlar.map((p) => ({ value: p.pozisyon, label: `${p.pozisyon} · ${p.kisi}` }));
  const yerSecenek = veri.isYerleri.map((y) => ({ value: y, label: y }));

  const d = duzenlenen;
  const girenTur: "herkes" | "pozisyon" | "kisi" = d?.girenSicil != null ? "kisi" : hepsiMi(d?.giren) ? "herkes" : "pozisyon";
  const degis = (p: Partial<Kural>) => setDuzenlenen((o) => ({ ...(o ?? {}), ...p }));
  const adimDegis = (i: number, p: Partial<Adim>) =>
    degis({ adimlar: (d?.adimlar ?? []).map((a, j) => (j === i ? { ...a, ...p } : a)) });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Alert
        type="info"
        showIcon
        message="Kurallar yukarıdan aşağı denenir, ilk tutan uygulanır."
        description={
          <>
            Hiçbir kural tutmazsa bugünkü akış sürer: organizasyon şemasındaki üst yönetici → İnsan Kaynakları, form birimin
            izin formu adresine. Birim yöneticisinin (girenin) imzalı formu yükleyip onaylaması her durumda ilk adımdır. Son
            onay her zaman İnsan Kaynakları. Değişiklik yeni kayıtlara uygulanır; açık kayıtlara uygulamak için "Açık kayıtlara
            uygula"yı kullanın (ya da Personel Talepleri › Fazla mesai'de kaydı açıp "Güncel kurala göre yenile").
          </>
        }
      />

      <Space wrap>
        <Button
          type="primary"
          icon={<Plus size={15} />}
          disabled={!veri.yazabilir}
          onClick={() =>
            setDuzenlenen({ isYeri: HEPSI, pozisyon: HEPSI, giren: HEPSI, adimlar: [], epostaMod: "varsayilan", aktif: true })
          }
        >
          Yeni kural
        </Button>
        <Popconfirm
          title="Açık kayıtlara güncel kural uygulansın mı?"
          description={
            <span style={{ display: "block", maxWidth: 340 }}>
              Birim yöneticisi ve üst yönetici onayındaki fazla mesailerin onay sırası güncel kurala göre yeniden hesaplanır.
              Form alıcısı değişen kayıtlarda form yeni alıcıya yeniden gönderilir.
            </span>
          }
          okText="Uygula"
          cancelText="Vazgeç"
          onConfirm={bekleyenlereUygula}
          disabled={!veri.yazabilir}
        >
          <Button loading={uygulaniyor} disabled={!veri.yazabilir}>
            Açık kayıtlara uygula
          </Button>
        </Popconfirm>
        {!veri.yazabilir && <Typography.Text type="secondary">Değiştirme yetkisi Admin, GMY ve İK yöneticisinde.</Typography.Text>}
      </Space>

      <Table<Kural>
        rowKey="id"
        size="small"
        loading={yukleniyor}
        dataSource={veri.kurallar}
        pagination={false}
        scroll={{ x: 900 }}
        locale={{ emptyText: "Kural yok: bütün fazla mesailer bugünkü akışla gidiyor." }}
        columns={[
          {
            title: "Sıra",
            width: 70,
            render: (_: unknown, _k: Kural, i: number) => (
              <Space size={0}>
                <Button type="text" size="small" icon={<ArrowUp size={14} />} disabled={!veri.yazabilir || i === 0} onClick={() => tasi(i, -1)} />
                <Button
                  type="text"
                  size="small"
                  icon={<ArrowDown size={14} />}
                  disabled={!veri.yazabilir || i === veri.kurallar.length - 1}
                  onClick={() => tasi(i, 1)}
                />
              </Space>
            ),
          },
          {
            title: "Kapsam",
            render: (_: unknown, k: Kural) => (
              <div>
                {k.ad && <b style={{ display: "block", fontWeight: 600 }}>{k.ad}</b>}
                <span style={{ fontSize: 12.5 }}>
                  {hepsiMi(k.isYeri) ? "Tüm iş yerleri" : k.isYeri} · {hepsiMi(k.pozisyon) ? "tüm pozisyonlar" : k.pozisyon}
                </span>
                {!k.aktif && <Tag style={{ marginLeft: 6 }}>Pasif</Tag>}
              </div>
            ),
          },
          {
            title: "Giren",
            width: 190,
            render: (_: unknown, k: Kural) =>
              k.girenSicil ? (
                <Tag color="purple">{veri.kisiAdlari[k.girenSicil] ?? "Kişi"} · {k.girenSicil}</Tag>
              ) : hepsiMi(k.giren) ? (
                <Typography.Text type="secondary">Herkes</Typography.Text>
              ) : (
                <Tag color="green">{k.giren}</Tag>
              ),
          },
          { title: "Onay sırası", render: (_: unknown, k: Kural) => <Akis k={k} v={veri} /> },
          {
            title: "Form maili",
            width: 190,
            render: (_: unknown, k: Kural) =>
              k.epostaMod === "adres" ? (
                <span style={{ fontSize: 12.5, wordBreak: "break-all" }}>{k.eposta}</span>
              ) : k.epostaMod === "giren" ? (
                "Girenin e-postası"
              ) : (
                <Typography.Text type="secondary">Varsayılan</Typography.Text>
              ),
          },
          {
            title: "",
            width: 80,
            render: (_: unknown, k: Kural) =>
              veri.yazabilir && (
                <Space size={2}>
                  <Button type="text" size="small" icon={<Pencil size={14} />} onClick={() => setDuzenlenen(k)} />
                  <Popconfirm title="Kural silinsin mi?" okText="Sil" cancelText="Vazgeç" onConfirm={() => sil(k)}>
                    <Button type="text" size="small" danger icon={<Trash2 size={14} />} />
                  </Popconfirm>
                </Space>
              ),
          },
        ]}
      />

      {/* ---------------------------------------------------------- dene */}
      <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        <b>Dene: bu kişiye bu kişi fazla mesai girerse</b>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8 }}>
          <KisiSec deger={denePersonel?.sicil} sec={setDenePersonel} yer="Fazla mesai yapan personel" />
          <KisiSec deger={deneGiren?.sicil} sec={setDeneGiren} yer="Giren (ör. GMY, birim yöneticisi)" />
          <Button onClick={dene} disabled={!denePersonel || !deneGiren}>
            Dene
          </Button>
        </div>
        {deneSonuc &&
          (deneSonuc.eskiAkis ? (
            <Alert
              type="warning"
              showIcon
              message="Hiçbir kural tutmuyor: bugünkü akış (şemadaki üst yönetici → İK, form birimin adresine)."
              description={`${deneSonuc.personel.ad} · ${deneSonuc.personel.isYeri} · ${deneSonuc.personel.pozisyon ?? ""} — giren ${deneSonuc.giren.ad} · ${deneSonuc.giren.pozisyon ?? ""}`}
            />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span>
                Tutan kural: <b>{deneSonuc.kural.kural}</b>
              </span>
              <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                <Tag color="gold">Giren · imzalı form</Tag>
                <ArrowRight size={13} />
                {deneSonuc.kural.adimlar.map((a: any, i: number) => (
                  <span key={i} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                    <Tag color={a.atlandi ? "default" : "green"} style={{ textDecoration: a.atlandi ? "line-through" : undefined }}>
                      {a.ad}
                      {a.kisiler?.length ? ` · ${a.kisiler.slice(0, 2).join(", ")}` : ""}
                    </Tag>
                    {a.atlandi && <small style={{ color: "#8a8f98" }}>{a.not}</small>}
                    <ArrowRight size={13} />
                  </span>
                ))}
                <Tag color="blue">İnsan Kaynakları</Tag>
              </span>
              <span style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13 }}>
                <Mail size={14} />
                {deneSonuc.kural.eposta?.length ? deneSonuc.kural.eposta.join(", ") : "Varsayılan alıcı (birimin izin formu adresi)"}
              </span>
            </div>
          ))}
      </div>

      {/* --------------------------------------------------------- düzenle */}
      <Modal
        open={!!d}
        onCancel={() => setDuzenlenen(null)}
        onOk={kaydet}
        okText="Kaydet"
        cancelText="Vazgeç"
        confirmLoading={kaydediliyor}
        title={d?.id ? "Kuralı düzenle" : "Yeni kural"}
        width="min(720px, 100vw)"
        destroyOnHidden
      >
        {d && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <label>
              <b>Kural adı</b> <small style={{ color: "#8a8f98" }}>(isteğe bağlı)</small>
              <Input value={d.ad ?? ""} maxLength={150} placeholder="Örn. Genel merkez · GMY girerse" onChange={(e) => degis({ ad: e.target.value })} />
            </label>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
              <label>
                <b>İş yeri / birim</b>
                <AutoComplete
                  style={{ width: "100%" }}
                  value={hepsiMi(d.isYeri) ? "" : d.isYeri}
                  options={yerSecenek}
                  placeholder="Boş: tüm iş yerleri"
                  filterOption={(g, o) => String(o?.value ?? "").toLocaleLowerCase("tr").includes(g.toLocaleLowerCase("tr"))}
                  onChange={(x) => degis({ isYeri: x || HEPSI })}
                />
              </label>
              <label>
                <b>Fazla mesai yapan personelin pozisyonu</b>
                <AutoComplete
                  style={{ width: "100%" }}
                  value={hepsiMi(d.pozisyon) ? "" : d.pozisyon}
                  options={pozSecenek}
                  placeholder="Boş: tüm pozisyonlar"
                  filterOption={(g, o) => String(o?.value ?? "").toLocaleLowerCase("tr").includes(g.toLocaleLowerCase("tr"))}
                  onChange={(x) => degis({ pozisyon: x || HEPSI })}
                />
              </label>
            </div>

            <div>
              <b>Fazla mesaiyi giren</b>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
                <Segmented
                  value={girenTur}
                  options={[
                    { value: "herkes", label: "Herkes" },
                    { value: "pozisyon", label: "Pozisyon" },
                    { value: "kisi", label: "Belirli kişi" },
                  ]}
                  onChange={(x) =>
                    degis(
                      x === "herkes"
                        ? { giren: HEPSI, girenSicil: null }
                        : x === "pozisyon"
                        ? { giren: hepsiMi(d.giren) ? "" : d.giren, girenSicil: null }
                        : { giren: HEPSI, girenSicil: d.girenSicil ?? "" }
                    )
                  }
                />
                {girenTur === "pozisyon" && (
                  <AutoComplete
                    style={{ width: "100%" }}
                    value={hepsiMi(d.giren) ? "" : d.giren}
                    options={pozSecenek}
                    placeholder="Örn. GENEL MÜDÜR YARDIMCISI"
                    filterOption={(g, o) => String(o?.value ?? "").toLocaleLowerCase("tr").includes(g.toLocaleLowerCase("tr"))}
                    onChange={(x) => degis({ giren: x || "" })}
                  />
                )}
                {girenTur === "kisi" && (
                  <KisiSec deger={d.girenSicil} sec={(k) => degis({ girenSicil: k?.sicil ?? "" })} yer="Kişiyi ara (ad, sicil)" />
                )}
              </div>
            </div>

            <div>
              <b>Onay sırası</b>
              <small style={{ display: "block", color: "#8a8f98" }}>
                Giren imzalı formu yükleyip onayladıktan sonra sırayla. Hiç adım eklemezseniz doğrudan İK'ya düşer. Onaylayan
                zaten giren ya da önceki adımda onaylamışsa adım atlanır.
              </small>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                {(d.adimlar ?? []).map((a, i) => {
                  const tur = a.onay === veri.sema ? "sema" : a.sicil != null ? "kisi" : "pozisyon";
                  return (
                    <div key={i} style={{ display: "grid", gridTemplateColumns: "26px 150px minmax(0,1fr) auto", gap: 6, alignItems: "center" }}>
                      <span style={{ color: "#8a8f98", fontVariantNumeric: "tabular-nums" }}>{i + 1}.</span>
                      <Select
                        value={tur}
                        options={[
                          { value: "pozisyon", label: "Pozisyon" },
                          { value: "kisi", label: "Belirli kişi" },
                          { value: "sema", label: "Şemadaki üst yön." },
                        ]}
                        onChange={(x) =>
                          adimDegis(i, x === "sema" ? { onay: veri.sema, sicil: null } : x === "kisi" ? { onay: "", sicil: "" } : { onay: "", sicil: null })
                        }
                      />
                      {tur === "pozisyon" ? (
                        <AutoComplete
                          value={a.onay}
                          options={pozSecenek}
                          placeholder="Örn. GENEL MÜDÜR YARDIMCISI, BÖLGE MÜDÜRÜ"
                          filterOption={(g, o) => String(o?.value ?? "").toLocaleLowerCase("tr").includes(g.toLocaleLowerCase("tr"))}
                          onChange={(x) => adimDegis(i, { onay: x })}
                        />
                      ) : tur === "kisi" ? (
                        <KisiSec
                          deger={a.sicil}
                          sec={(k) => adimDegis(i, { onay: k?.pozisyon || "KİŞİ", sicil: k?.sicil ?? "" })}
                          yer="Kişiyi ara (ad, sicil)"
                        />
                      ) : (
                        <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
                          Personelin organizasyon şemasındaki üst yöneticisi (bugünkü akıştaki aşama)
                        </Typography.Text>
                      )}
                      <Space size={0}>
                        <Button
                          type="text"
                          size="small"
                          icon={<ArrowUp size={14} />}
                          disabled={i === 0}
                          onClick={() => {
                            const l = [...(d.adimlar ?? [])];
                            [l[i - 1], l[i]] = [l[i], l[i - 1]];
                            degis({ adimlar: l });
                          }}
                        />
                        <Button
                          type="text"
                          size="small"
                          danger
                          icon={<Trash2 size={14} />}
                          onClick={() => degis({ adimlar: (d.adimlar ?? []).filter((_, j) => j !== i) })}
                        />
                      </Space>
                    </div>
                  );
                })}
                {(d.adimlar?.length ?? 0) < 4 && (
                  <Button type="dashed" icon={<Plus size={14} />} style={{ alignSelf: "flex-start" }} onClick={() => degis({ adimlar: [...(d.adimlar ?? []), { onay: "", sicil: null }] })}>
                    Onay ekle
                  </Button>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 26, color: "#8a8f98" }}>Son</span>
                  <Tag color="blue">İnsan Kaynakları</Tag>
                </div>
              </div>
            </div>

            <div>
              <b>Fazla mesai formu (İK-FM-01) nereye gitsin</b>
              <Radio.Group
                style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}
                value={d.epostaMod ?? "varsayilan"}
                onChange={(e) => degis({ epostaMod: e.target.value })}
              >
                <Radio value="varsayilan">Varsayılan: birimin izin formu adresi (şubede şube maili, genel merkezde İK)</Radio>
                <Radio value="giren">Fazla mesaiyi girenin e-postası (Personel e-postaları'nda yazılı olmalı)</Radio>
                <Radio value="adres">Şu adres(ler)</Radio>
              </Radio.Group>
              {d.epostaMod === "adres" && (
                <Input
                  style={{ marginTop: 6 }}
                  value={d.eposta ?? ""}
                  placeholder="ornek@bicen.com.tr; ikinci@bicen.com.tr"
                  onChange={(e) => degis({ eposta: e.target.value })}
                />
              )}
            </div>

            <Space>
              <Switch checked={d.aktif ?? true} onChange={(x) => degis({ aktif: x })} />
              {d.aktif ?? true ? "Aktif" : "Pasif (uygulanmaz)"}
            </Space>
          </div>
        )}
      </Modal>
    </div>
  );
}
