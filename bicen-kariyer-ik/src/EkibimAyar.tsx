/**
 * ---------------------------------------------------------------------------
 * Ekibim görünürlüğü (09.10.2026)
 * ---------------------------------------------------------------------------
 * Kişi kişi: Biçen360'taki Ekibim ekranında kimleri görsün (otomatik
 * listeye kişi / şube ekle, listeden gizle ya da yalnızca seçtiklerin),
 * eklenenlerin ayrıntısını açabilsin mi, puantaj çizelgesini ve vardiya
 * planını görsün mü.
 *
 * İzin ve avans onay akışları ile onay tablosu değişmez; "işlem" açıksa
 * eklenenlere fazla mesai girer, rotasyon talebi açar. Eklenen kişinin vardiya planı bu kişiye geçmez.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, App as AntdApp, Button, Drawer, Empty, Input, Modal, Popconfirm, Select, Spin, Switch, Table, Tag } from "antd";
import { CalendarRange, ClipboardList, Eye, EyeOff, Plus, Search, Timer, UserPlus, Users } from "lucide-react";
import dayjs from "dayjs";

import { api } from "./api";

interface Kisi {
  sicil: string;
  ad: string;
  pozisyon: string | null;
  sube: string | null;
}

interface Kural {
  sicil: string;
  ekKisiler: string[];
  ekSubeler: string[];
  gizlenenler: string[];
  yalnizSecilenler: boolean;
  ayrinti: boolean;
  puantaj: boolean;
  vardiyaPlani: boolean;
  /** Eklenenlere fazla mesai girer, rotasyon talebi açar (eski kayıtta yok = açık) */
  islem?: boolean;
  guncelleyen?: string | null;
  guncelleme?: string | null;
}

interface Liste {
  kurallar: { kural: Kural; kisi: Kisi; eklenen: number }[];
  subeler: { ad: string; kisi: number }[];
}

interface Onizleme {
  kisi: Kisi;
  bolge: boolean;
  kural: Kural | null;
  varsayilan: (Kisi & { ayrinti: boolean })[];
  puantajKisi: number;
  vardiyaKisi: number;
  ekKisiler: Kisi[];
}

const bosKural = (sicil: string): Kural => ({
  sicil,
  ekKisiler: [],
  ekSubeler: [],
  gizlenenler: [],
  yalnizSecilenler: false,
  ayrinti: true,
  puantaj: true,
  vardiyaPlani: true,
  islem: true,
});

/* -------------------------------------------------- kişi arama kutusu */

function KisiArama({ onSec, yer = "Personel ara (ad, sicil, şube)", genislik = 340, odak = false }: { onSec: (k: Kisi) => void; yer?: string; genislik?: number | string; odak?: boolean }) {
  const [secenek, setSecenek] = useState<Kisi[]>([]);
  const [yukleniyor, setYukleniyor] = useState(false);

  return (
    <Select
      showSearch
      autoFocus={odak}
      defaultOpen={odak}
      value={null}
      style={{ width: genislik, maxWidth: "100%" }}
      placeholder={yer}
      filterOption={false}
      notFoundContent={yukleniyor ? <Spin size="small" /> : null}
      suffixIcon={<Search size={14} />}
      onSearch={async (q) => {
        if (q.trim().length < 2) return setSecenek([]);
        setYukleniyor(true);
        try {
          setSecenek(await api.al<Kisi[]>(`/api/EkibimKural/KisiAra?q=${encodeURIComponent(q)}`));
        } catch {
          setSecenek([]);
        } finally {
          setYukleniyor(false);
        }
      }}
      onChange={(v) => {
        const k = secenek.find((x) => x.sicil === v);
        if (k) onSec(k);
      }}
      options={secenek.map((k) => ({ value: k.sicil, label: [k.ad, k.pozisyon, k.sube].filter(Boolean).join(" · ") }))}
    />
  );
}

/* --------------------------------------------------------- düzenleyici */

function Duzenleyici({ sicil, subeler, kapat, kaydedildi }: { sicil: string; subeler: Liste["subeler"]; kapat: () => void; kaydedildi: () => void }) {
  const { message } = AntdApp.useApp();
  const [o, setO] = useState<Onizleme | null>(null);
  const [k, setK] = useState<Kural>(bosKural(sicil));
  const [ekler, setEkler] = useState<Kisi[]>([]);
  const [ara, setAra] = useState("");
  const [kaydediliyor, setKaydediliyor] = useState(false);

  useEffect(() => {
    api
      .al<Onizleme>(`/api/EkibimKural/${encodeURIComponent(sicil)}`)
      .then((v) => {
        setO(v);
        setK(v.kural ? { ...bosKural(sicil), ...v.kural } : bosKural(v.kisi.sicil));
        setEkler(v.ekKisiler ?? []);
      })
      .catch((h: any) => message.error(h.message));
  }, [sicil, message]);

  const gizli = useMemo(() => new Set(k.gizlenenler), [k.gizlenenler]);

  const varsayilan = useMemo(() => {
    const q = ara.trim().toLocaleLowerCase("tr");
    return (o?.varsayilan ?? []).filter((x) => !q || `${x.ad} ${x.sicil} ${x.sube ?? ""} ${x.pozisyon ?? ""}`.toLocaleLowerCase("tr").includes(q));
  }, [o, ara]);

  /* Görünecek kişi sayısı (şube eklemesi yaklaşık: şubenin aktif personeli) */
  const tahmin = useMemo(() => {
    if (!o) return 0;
    const set = new Set<string>();
    if (!k.yalnizSecilenler) o.varsayilan.forEach((x) => set.add(x.sicil));
    ekler.forEach((x) => set.add(x.sicil));
    let sube = 0;
    k.ekSubeler.forEach((s) => {
      sube += subeler.find((x) => x.ad === s)?.kisi ?? 0;
    });
    k.gizlenenler.forEach((g) => set.delete(g));
    return set.size + sube;
  }, [o, k, ekler, subeler]);

  const kaydet = async () => {
    setKaydediliyor(true);
    try {
      await api.gonder("/api/EkibimKural", { ...k, sicil: o?.kisi.sicil ?? sicil, ekKisiler: ekler.map((x) => x.sicil) });
      message.success("Kaydedildi. Biçen360'ta bir sonraki açılışta geçerli.");
      kaydedildi();
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setKaydediliyor(false);
    }
  };

  const anahtar = (ad: string, alt: string, deger: boolean, degis: (v: boolean) => void, ikon: React.ReactNode) => (
    <label className="eb-anahtar">
      <span className="eb-ikon">{ikon}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <b>{ad}</b>
        <small>{alt}</small>
      </span>
      <Switch checked={deger} onChange={degis} />
    </label>
  );

  return (
    <Drawer
      open
      width="min(900px, 100vw)"
      title={o ? `Ekibim · ${o.kisi.ad}` : "Ekibim"}
      onClose={kapat}
      destroyOnHidden
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <span style={{ marginRight: "auto", color: "#6b7280", fontSize: 13, alignSelf: "center" }}>
            Ekibim'de yaklaşık <b>{tahmin}</b> kişi görünecek
          </span>
          <Button onClick={kapat}>Vazgeç</Button>
          <Button type="primary" loading={kaydediliyor} disabled={!o} onClick={kaydet}>
            Kaydet
          </Button>
        </div>
      }
    >
      {!o ? (
        <Spin style={{ display: "block", margin: "40px auto" }} />
      ) : (
        <div className="eb-duzen">
          <div className="eb-kisi">
            <b>{o.kisi.ad}</b>
            <span>{[o.kisi.sicil, o.kisi.pozisyon, o.kisi.sube].filter(Boolean).join(" · ")}</span>
            <span>
              Otomatik: Ekibim'de {o.varsayilan.length} kişi{o.bolge ? " (bölge)" : ""} · puantajda {o.puantajKisi} · vardiya planında {o.vardiyaKisi}
            </span>
          </div>

          <div className="eb-anahtarlar">
            {anahtar(
              "Yalnızca seçtiklerimi görsün",
              "Otomatik liste (onay tablosu, departman, bölge) kullanılmaz; yalnızca aşağıda eklenen kişi ve şubeler görünür.",
              k.yalnizSecilenler,
              (v) => setK({ ...k, yalnizSecilenler: v }),
              <Users size={16} />
            )}
            {anahtar(
              "Eklenenlerin ayrıntısını açabilsin",
              "İzin bakiyesi, planlı izinler ve puantaj takvimi. Kapalıysa eklenenleri yalnızca listede görür.",
              k.ayrinti,
              (v) => setK({ ...k, ayrinti: v }),
              <Eye size={16} />
            )}
            {anahtar(
              "Puantaj çizelgesini görsün",
              "Kapalıysa Puantaj Çizelgesi'nde yalnızca kendi giriş-çıkışını görür. Açıksa eklenen kişiler de çizelgede.",
              k.puantaj,
              (v) => setK({ ...k, puantaj: v }),
              <ClipboardList size={16} />
            )}
            {anahtar(
              "Vardiya planında ekibini görsün",
              "Kapalıysa Vardiya Planı'nda yalnızca kendi planını görür, ekibin planını yapamaz. Eklenen kişilerin planı bu kişiye geçmez.",
              k.vardiyaPlani,
              (v) => setK({ ...k, vardiyaPlani: v }),
              <CalendarRange size={16} />
            )}
            {anahtar(
              "Eklenenlere işlem yapabilsin",
              "Eklenen kişilere fazla mesai girer ve rotasyon talebi açar (giren 1. onay sayılır; üst yönetici ve İK aşaması kişinin kendi akışından). İzin onayı değişmez.",
              k.islem !== false,
              (v) => setK({ ...k, islem: v }),
              <Timer size={16} />
            )}
          </div>

          <section>
            <h4>Eklenen kişiler</h4>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <KisiArama
                yer="Kişi ekle"
                genislik={300}
                onSec={(x) => setEkler((l) => (l.some((y) => y.sicil === x.sicil) || x.sicil === o.kisi.sicil ? l : [...l, x]))}
              />
              {ekler.map((x) => (
                <Tag key={x.sicil} closable onClose={() => setEkler((l) => l.filter((y) => y.sicil !== x.sicil))} style={{ padding: "3px 8px" }}>
                  {x.ad}
                  {x.sube ? <span style={{ color: "#8a929b" }}> · {x.sube}</span> : null}
                </Tag>
              ))}
            </div>
          </section>

          <section>
            <h4>Eklenen şubeler</h4>
            <Select
              mode="multiple"
              allowClear
              style={{ width: "100%" }}
              placeholder="Şubenin bütün personeli Ekibim'de görünür"
              value={k.ekSubeler}
              onChange={(v) => setK({ ...k, ekSubeler: v })}
              optionFilterProp="label"
              options={subeler.map((s) => ({ value: s.ad, label: `${s.ad} · ${s.kisi} kişi` }))}
            />
          </section>

          <section className={k.yalnizSecilenler ? "eb-soluk" : undefined}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <h4 style={{ margin: 0 }}>Otomatik liste</h4>
              <span style={{ color: "#8a929b", fontSize: 12.5 }}>
                {k.yalnizSecilenler ? "Kullanılmıyor (yalnızca seçtikleri)" : `${o.varsayilan.length} kişi · ${k.gizlenenler.length} gizli`}
              </span>
              <Input
                allowClear
                prefix={<Search size={14} />}
                placeholder="Listede ara"
                value={ara}
                onChange={(e) => setAra(e.target.value)}
                style={{ width: 220, marginLeft: "auto" }}
              />
            </div>
            <Table
              size="small"
              rowKey="sicil"
              dataSource={varsayilan}
              pagination={varsayilan.length > 15 ? { pageSize: 15, size: "small", showSizeChanger: false } : false}
              locale={{ emptyText: "Otomatik listede kimse yok (yönetici değil ya da onay tablosunda tanımsız)." }}
              scroll={{ x: 560 }}
              columns={[
                {
                  title: "Personel",
                  render: (_, x) => (
                    <span className={gizli.has(x.sicil) ? "eb-cizik" : undefined}>
                      <b>{x.ad}</b>
                      <div style={{ fontSize: 12, color: "#8a929b" }}>{[x.sicil, x.pozisyon].filter(Boolean).join(" · ")}</div>
                    </span>
                  ),
                },
                { title: "Şube", dataIndex: "sube", width: 170 },
                {
                  title: "Ayrıntı",
                  width: 90,
                  render: (_, x) => (x.ayrinti ? <Tag color="green">Açık</Tag> : <Tag>Yalnız liste</Tag>),
                },
                {
                  title: "",
                  width: 110,
                  render: (_, x) => (
                    <Button
                      size="small"
                      disabled={k.yalnizSecilenler}
                      icon={gizli.has(x.sicil) ? <Eye size={13} /> : <EyeOff size={13} />}
                      onClick={() =>
                        setK({
                          ...k,
                          gizlenenler: gizli.has(x.sicil) ? k.gizlenenler.filter((y) => y !== x.sicil) : [...k.gizlenenler, x.sicil],
                        })
                      }
                    >
                      {gizli.has(x.sicil) ? "Göster" : "Gizle"}
                    </Button>
                  ),
                },
              ]}
            />
          </section>
        </div>
      )}
    </Drawer>
  );
}

/* --------------------------------------------------------------- sayfa */

export default function EkibimAyar() {
  const { message } = AntdApp.useApp();
  const [v, setV] = useState<Liste | null>(null);
  const [acik, setAcik] = useState<string | null>(null);
  /* "Kişi ekle" kartı (16.10.2026): önceden sayfadaki ilk arama kutusuna odaklanıyordu (Ayarlar'ın genel araması), görünür bir şey olmuyordu */
  const [ekleAcik, setEkleAcik] = useState(false);

  const getir = useCallback(async () => {
    try {
      setV(await api.al<Liste>("/api/EkibimKural"));
    } catch (h: any) {
      message.error(h.message);
    }
  }, [message]);

  useEffect(() => {
    getir();
  }, [getir]);

  if (!v) return <Spin style={{ display: "block", margin: "60px auto" }} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <style>{CSS}</style>

      <Alert
        type="info"
        showIcon
        message="Yalnızca Biçen360'taki görünüm değişir"
        description="Burada seçilen kişi; Ekibim ekranında kimleri göreceği, eklenenlerin ayrıntısını açıp açamayacağı, Puantaj Çizelgesi ve Vardiya Planı'nı görüp göremeyeceği, eklenenlere fazla mesai / rotasyon talebi girip giremeyeceği için ayarlanır. İzin ve avans onay akışları ile onay tablosu değişmez."
      />

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <KisiArama onSec={(k) => setAcik(k.sicil)} yer="Ayarlanacak kişiyi ara (ad, sicil, şube)" />
        <span style={{ color: "#8a929b", fontSize: 13 }}>
          <UserPlus size={14} style={{ verticalAlign: -2 }} /> Kişiyi seçince Ekibim'i açılır
        </span>
      </div>

      {v.kurallar.length === 0 ? (
        <Empty description="Henüz özel ayar yok. Herkes otomatik Ekibim'ini görüyor." />
      ) : (
        <div className="eb-izgara">
          {v.kurallar.map(({ kural: k, kisi, eklenen }) => (
            <div key={k.sicil} className="eb-kart" role="button" tabIndex={0} onClick={() => setAcik(k.sicil)} onKeyDown={(e) => e.key === "Enter" && setAcik(k.sicil)}>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b>{kisi.ad}</b>
                  <div className="eb-alt">{[kisi.sicil, kisi.pozisyon, kisi.sube].filter(Boolean).join(" · ")}</div>
                </div>
                <Popconfirm
                  title="Özel ayar kaldırılsın mı?"
                  description="Kişi otomatik Ekibim'ine döner."
                  okText="Kaldır"
                  cancelText="Vazgeç"
                  onConfirm={async (e) => {
                    e?.stopPropagation();
                    await api.sil(`/api/EkibimKural/${encodeURIComponent(k.sicil)}`);
                    getir();
                  }}
                  onCancel={(e) => e?.stopPropagation()}
                >
                  <Button size="small" type="text" danger onClick={(e) => e.stopPropagation()}>
                    Kaldır
                  </Button>
                </Popconfirm>
              </div>
              <div className="eb-etiketler">
                {k.yalnizSecilenler && <Tag color="purple">Yalnızca seçtikleri</Tag>}
                {eklenen > 0 && <Tag color="green">+{eklenen} kişi</Tag>}
                {k.ekSubeler.length > 0 && <Tag color="green">+{k.ekSubeler.length} şube</Tag>}
                {k.gizlenenler.length > 0 && <Tag color="orange">{k.gizlenenler.length} gizli</Tag>}
                {!k.ayrinti && <Tag>Ayrıntı kapalı</Tag>}
                <Tag color={k.puantaj ? "blue" : "default"}>{k.puantaj ? "Puantaj görür" : "Puantaj kapalı"}</Tag>
                <Tag color={k.vardiyaPlani ? "blue" : "default"}>{k.vardiyaPlani ? "Vardiya planı görür" : "Vardiya planı kapalı"}</Tag>
                {eklenen > 0 && k.islem !== false && <Tag color="cyan">FM · rotasyon girer</Tag>}
              </div>
              {k.guncelleme && (
                <div className="eb-alt">
                  {k.guncelleyen} · {dayjs(k.guncelleme).format("DD.MM.YYYY HH:mm")}
                </div>
              )}
            </div>
          ))}
          <button type="button" className="eb-kart eb-ekle" onClick={() => setEkleAcik(true)}>
            <Plus size={18} /> Kişi ekle
          </button>
        </div>
      )}

      <Modal open={ekleAcik} title="Kişi ekle" footer={null} onCancel={() => setEkleAcik(false)} destroyOnHidden>
        <p style={{ color: "#6b7280", marginTop: 0 }}>Ekibim görünürlüğünü ayarlayacağınız kişiyi arayın (en az 2 harf).</p>
        <KisiArama
          odak
          genislik="100%"
          yer="Ad, sicil ya da şube"
          onSec={(k) => {
            setEkleAcik(false);
            setAcik(k.sicil);
          }}
        />
      </Modal>

      {acik && (
        <Duzenleyici
          sicil={acik}
          subeler={v.subeler}
          kapat={() => setAcik(null)}
          kaydedildi={() => {
            setAcik(null);
            getir();
          }}
        />
      )}
    </div>
  );
}

const CSS = `
.eb-izgara{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}
.eb-kart{background:#fff;border:1px solid #e6e9e3;border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:8px;cursor:pointer;text-align:left;font:inherit}
.eb-kart:hover{border-color:#b9d48c}
.eb-kart:focus-visible{outline:2px solid #7cb518;outline-offset:2px}
.eb-ekle{align-items:center;justify-content:center;flex-direction:row;color:#5f8c10;font-weight:700;border-style:dashed;min-height:90px}
.eb-alt{font-size:12px;color:#8a929b}
.eb-etiketler{display:flex;flex-wrap:wrap;gap:4px}
.eb-etiketler .ant-tag{margin:0}
.eb-duzen{display:flex;flex-direction:column;gap:18px}
.eb-duzen h4{margin:0 0 8px;font-size:13.5px}
.eb-kisi{display:flex;flex-direction:column;gap:2px;padding:12px 14px;background:#f6f8f3;border-radius:12px}
.eb-kisi b{font-size:16px}
.eb-kisi span{font-size:12.5px;color:#6b7280}
.eb-anahtarlar{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:8px}
.eb-anahtar{display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border:1px solid #e6e9e3;border-radius:12px;cursor:pointer}
.eb-anahtar b{display:block;font-size:13.5px}
.eb-anahtar small{display:block;color:#8a929b;font-size:12px;line-height:1.4}
.eb-ikon{width:30px;height:30px;border-radius:9px;background:#f2f9e8;color:#5f8c10;display:grid;place-items:center;flex:none}
.eb-soluk{opacity:.55}
.eb-cizik{text-decoration:line-through;color:#9aa1a9}
`;
