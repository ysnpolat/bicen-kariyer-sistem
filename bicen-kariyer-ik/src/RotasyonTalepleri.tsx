/* ===========================================================================
   Personel Talepleri › Rotasyon (07.10.2026)

   Yönetici Biçen360 › Ekibim'den açar: yönetici isteği / personel isteği,
   zorunlu açıklama ve hedef şubeler (kadrosu açık şubeler öneri olarak
   önde). Personel talebi yalnızca görür. Yönetici isteğinde önce bölge
   müdürü (Biçen360 ya da panel), sonra İK onaylar. İK onaylarken hedef
   şubelerden birini seçer; şube değişikliği Mikro'ya işlenince talep
   "Mikro'ya işlendi" olur (elle ya da Mikro değişikliği algılanınca).
   =========================================================================== */

import { PersonelAdi } from "./personelKarti";
import { useEffect, useMemo, useState } from "react";
import { App as AntdApp, Drawer, Input, Radio, Table, Tag, Tooltip } from "antd";
import { ArrowRight, CheckCircle2, RefreshCw, Repeat2, Search, XCircle } from "lucide-react";
import dayjs from "dayjs";

import { api } from "./api";
import { useUzman, uzmanSorgu } from "./uzmanFiltresi";
import "./FazlaMesaiTalepleri.css";

interface Hedef {
  ad: string;
  kod: string;
  acik: number;
}

interface Kayit {
  id: number;
  sicil: string;
  adSoyad: string;
  sube: string | null;
  pozisyon: string | null;
  tur: "yonetici" | "personel";
  turAdi: string;
  aciklama: string;
  hedefler: Hedef[];
  durum: "bolge" | "ik" | "onaylandi" | "reddedildi" | "iptal";
  durumAdi: string;
  talepEden: string | null;
  bolgeKisi: string | null;
  bolgeKarar: string | null;
  bolgeNot: string | null;
  bolgeTarih: string | null;
  ikKisi: string | null;
  ikKarar: string | null;
  ikNot: string | null;
  ikTarih: string | null;
  onaylananSube: string | null;
  mikroIslendi: string | null;
  mikroNot: string | null;
  olusturma: string;
  sirada: boolean;
}

type Gorunum = "sirada" | "surecte" | "mikro" | "sonuc" | "tumu";

const DURUM_SINIF: Record<string, string> = {
  bolge: "fm-r-sari",
  ik: "fm-r-sari",
  onaylandi: "fm-r-yesil",
  reddedildi: "fm-r-kirmizi",
  iptal: "fm-r-gri",
};

const tarih = (t?: string | null) => (t ? dayjs(t).format("DD.MM.YYYY HH:mm") : "");

export default function RotasyonTalepleri({ sayacDegisti }: { sayacDegisti?: (n: number) => void }) {
  const { message, modal } = AntdApp.useApp();
  const uzman = useUzman();

  const [veri, setVeri] = useState<{ kayitlar: Kayit[]; bekleyen: number; ikYetkili: boolean } | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [gorunum, setGorunum] = useState<Gorunum>("sirada");
  const [arama, setArama] = useState("");
  const [detay, setDetay] = useState<Kayit | null>(null);
  const [ilk, setIlk] = useState(true);

  const getir = async () => {
    setYukleniyor(true);
    try {
      const d = await api.al<any>(`/api/Rotasyon/Liste${uzmanSorgu(uzman)}`);
      setVeri(d);
      sayacDegisti?.(d?.bekleyen ?? 0);
      if (ilk) {
        setIlk(false);
        if (!d?.bekleyen) setGorunum("tumu");
      }
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setYukleniyor(false);
    }
  };

  useEffect(() => {
    getir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uzman]);

  const kayitlar = veri?.kayitlar ?? [];

  const sayilar = useMemo(
    () => ({
      sirada: kayitlar.filter((k) => k.sirada).length,
      surecte: kayitlar.filter((k) => k.durum === "bolge" || k.durum === "ik").length,
      mikro: kayitlar.filter((k) => k.durum === "onaylandi" && !k.mikroIslendi).length,
      sonuc: kayitlar.filter((k) => k.durum === "onaylandi" || k.durum === "reddedildi").length,
      tumu: kayitlar.length,
    }),
    [kayitlar]
  );

  const liste = useMemo(() => {
    const q = arama.trim().toLocaleLowerCase("tr");
    return kayitlar.filter((k) => {
      if (gorunum === "sirada" && !k.sirada) return false;
      if (gorunum === "surecte" && !(k.durum === "bolge" || k.durum === "ik")) return false;
      if (gorunum === "mikro" && !(k.durum === "onaylandi" && !k.mikroIslendi)) return false;
      if (gorunum === "sonuc" && !(k.durum === "onaylandi" || k.durum === "reddedildi")) return false;
      if (q) {
        const m = `${k.adSoyad} ${k.sicil} ${k.sube} ${k.pozisyon} ${k.talepEden} ${k.hedefler.map((h) => h.ad).join(" ")}`;
        if (!m.toLocaleLowerCase("tr").includes(q)) return false;
      }
      return true;
    });
  }, [kayitlar, gorunum, arama]);

  return (
    <div className="fm">
      <div className="it-kpiler">
        {[
          { k: "sirada" as Gorunum, et: "Onayımı bekleyen", d: sayilar.sirada, alt: "karar sizde", renk: "sari" },
          { k: "surecte" as Gorunum, et: "Süreçte", d: sayilar.surecte, alt: "bölge müdürü ya da İK onayında", renk: "turuncu" },
          { k: "mikro" as Gorunum, et: "Mikro'ya işlenecek", d: sayilar.mikro, alt: "onaylandı, şube değişmedi", renk: "kirmizi" },
          { k: "sonuc" as Gorunum, et: "Sonuçlanan", d: sayilar.sonuc, alt: "onay ve ret", renk: "yesil" },
          { k: "tumu" as Gorunum, et: "Tümü", d: sayilar.tumu, alt: "geri çekilenler dahil", renk: "turuncu" },
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
          <span className="it-kart-simge fm-simge">
            <Repeat2 size={15} strokeWidth={2} />
          </span>
          <h3>Rotasyon talepleri</h3>
          <span>yönetici Biçen360'tan açar · yönetici isteğinde bölge müdürü, sonra İK onaylar</span>
          <div className="it-sag">
            <Input
              allowClear
              size="small"
              prefix={<Search size={14} />}
              placeholder="Ad, sicil, şube, açan"
              value={arama}
              onChange={(e) => setArama(e.target.value)}
              style={{ width: 210 }}
            />
            <button type="button" className="it-dg kucuk" onClick={getir} disabled={yukleniyor}>
              <RefreshCw size={14} strokeWidth={2} className={yukleniyor ? "it-don" : undefined} /> Yenile
            </button>
          </div>
        </div>

        <div className="it-kart-ic">
          <Table<Kayit>
            rowKey="id"
            size="small"
            loading={yukleniyor}
            dataSource={liste}
            pagination={{ pageSize: 25, hideOnSinglePage: true }}
            onRow={(k) => ({ onClick: () => setDetay(k), style: { cursor: "pointer" } })}
            locale={{ emptyText: gorunum === "sirada" ? "Onayınızı bekleyen rotasyon talebi yok." : "Kayıt yok." }}
            columns={[
              {
                title: "Personel",
                key: "kisi",
                render: (_, k) => (
                  <div className="fm-kisi">
                    <b><PersonelAdi kod={k.sicil}>{k.adSoyad}</PersonelAdi></b>
                    <small>
                      {k.sicil} · {k.pozisyon ?? "—"}
                    </small>
                  </div>
                ),
              },
              {
                title: "Şube değişikliği",
                key: "sube",
                render: (_, k) => (
                  <div className="fm-kisi">
                    <b style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      {k.sube ?? "—"} <ArrowRight size={13} /> {k.onaylananSube ?? k.hedefler.map((h) => h.ad).join(", ")}
                    </b>
                    <small>
                      {k.hedefler.some((h) => h.acik > 0)
                        ? `kadrosu açık: ${k.hedefler.filter((h) => h.acik > 0).map((h) => `${h.ad} (${h.acik})`).join(", ")}`
                        : "hedeflerde açık kadro yoktu"}
                    </small>
                  </div>
                ),
              },
              {
                title: "Tür · açan",
                key: "tur",
                width: 190,
                render: (_, k) => (
                  <div className="fm-kisi">
                    <span>{k.turAdi}</span>
                    <small>
                      {k.talepEden ?? "—"} · {dayjs(k.olusturma).format("DD.MM.YYYY")}
                    </small>
                  </div>
                ),
              },
              {
                title: "Durum",
                key: "durum",
                width: 190,
                render: (_, k) => (
                  <div className="fm-kisi">
                    <span className={`fm-rozet ${DURUM_SINIF[k.durum] ?? ""}`}>{k.durumAdi}</span>
                    {k.durum === "onaylandi" && (
                      <small className={k.mikroIslendi ? "fm-ok" : "fm-hata"}>
                        {k.mikroIslendi ? "Mikro'ya işlendi" : "Mikro'ya işlenmedi"}
                      </small>
                    )}
                    {k.sirada && <small style={{ color: "#92600e", fontWeight: 700 }}>karar sizde</small>}
                  </div>
                ),
              },
            ]}
          />
        </div>
      </div>

      {detay && (
        <RotasyonDetayi
          kayit={detay}
          ikYetkili={!!veri?.ikYetkili}
          kapat={() => setDetay(null)}
          bitti={() => {
            setDetay(null);
            getir();
          }}
          message={message}
          modal={modal}
        />
      )}
    </div>
  );
}

function RotasyonDetayi({
  kayit: k,
  ikYetkili,
  kapat,
  bitti,
  message,
  modal,
}: {
  kayit: Kayit;
  ikYetkili: boolean;
  kapat: () => void;
  bitti: () => void;
  message: any;
  modal: any;
}) {
  const [sube, setSube] = useState<string | undefined>(k.hedefler.length === 1 ? k.hedefler[0].ad : undefined);
  const [not, setNot] = useState("");
  const [isleniyor, setIsleniyor] = useState(false);

  const ikAsamasi = k.durum === "ik";
  const bolgeAsamasi = k.durum === "bolge";

  const karar = async (onay: boolean) => {
    if (!onay && not.trim().length < 3) return message.error("Ret sebebini yazınız.");
    if (onay && ikAsamasi && !sube) return message.error("Personelin gideceği şubeyi seçiniz.");

    setIsleniyor(true);
    try {
      await api.gonder(`/api/Rotasyon/${k.id}/Karar`, { onay, not: not.trim(), sube });
      message.success(onay ? (bolgeAsamasi ? "Onaylandı; talep İK'ya geçti." : "Rotasyon onaylandı.") : "Talep reddedildi.");
      bitti();
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setIsleniyor(false);
    }
  };

  const mikro = () =>
    modal.confirm({
      title: "Şube değişikliği Mikro'ya işlendi mi?",
      content: `${k.adSoyad} · ${k.onaylananSube}. Mikro'da değişiklik algılanınca bu işaret kendiliğinden de konuyor.`,
      okText: "İşlendi",
      cancelText: "Vazgeç",
      onOk: async () => {
        try {
          await api.gonder(`/api/Rotasyon/${k.id}/MikroIslendi`, {});
          message.success("İşaretlendi.");
          bitti();
        } catch (h: any) {
          message.error(h.message);
        }
      },
    });

  const iptal = () =>
    modal.confirm({
      title: "Talep iptal edilsin mi?",
      okText: "İptal et",
      okButtonProps: { danger: true },
      cancelText: "Vazgeç",
      onOk: async () => {
        try {
          await api.gonder(`/api/Rotasyon/${k.id}/Iptal`, {});
          bitti();
        } catch (h: any) {
          message.error(h.message);
        }
      },
    });

  const Adim = ({ ad, kisi, karar: kr, not: n, t, sirada }: { ad: string; kisi?: string | null; karar?: string | null; not?: string | null; t?: string | null; sirada?: boolean }) => (
    <div style={{ display: "flex", gap: 10, padding: "8px 0", borderTop: "1px solid #eef1ea" }}>
      <span style={{ marginTop: 2 }}>
        {kr === "Onaylandı" || kr === "Açıldı" || kr === "İşlendi" ? (
          <CheckCircle2 size={16} color="#5f8c10" />
        ) : kr === "Reddedildi" ? (
          <XCircle size={16} color="#b42318" />
        ) : (
          <span style={{ display: "inline-block", width: 14, height: 14, borderRadius: 7, border: `2px solid ${sirada ? "#d9a21b" : "#c5cbc0"}` }} />
        )}
      </span>
      <div style={{ flex: 1, fontSize: 13 }}>
        <b>{ad}</b>
        <div style={{ color: "#6b7280", fontSize: 12.5 }}>
          {kr ? `${kr} · ${kisi ?? ""} · ${tarih(t)}` : sirada ? "bekleniyor" : "—"}
        </div>
        {n && <div style={{ fontSize: 12.5, marginTop: 2 }}>“{n}”</div>}
      </div>
    </div>
  );

  return (
    <Drawer open onClose={kapat} width="min(560px, 100vw)" title={`${k.adSoyad} · rotasyon talebi`}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <div style={{ color: "#6b7280", fontSize: 12.5 }}>
            {k.sicil} · {k.pozisyon} · {k.turAdi}
          </div>
          <div style={{ fontSize: 16, fontWeight: 800, display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
            {k.sube} <ArrowRight size={15} /> {k.onaylananSube ?? k.hedefler.map((h) => h.ad).join(", ")}
          </div>
          <Tag style={{ marginTop: 8 }} color={k.durum === "onaylandi" ? "green" : k.durum === "reddedildi" ? "red" : k.durum === "iptal" ? "default" : "gold"}>
            {k.durumAdi}
          </Tag>
        </div>

        <div className="ir-not bilgi" style={{ background: "#f6f8f3", borderRadius: 10, padding: "10px 12px", fontSize: 13 }}>
          <b>Açıklama</b> ({k.talepEden}, {tarih(k.olusturma)})
          <div style={{ marginTop: 4 }}>{k.aciklama}</div>
        </div>

        <div>
          <b style={{ fontSize: 13 }}>Hedef şubeler</b>
          {ikAsamasi && ikYetkili ? (
            <Radio.Group value={sube} onChange={(e) => setSube(e.target.value)} style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
              {k.hedefler.map((h) => (
                <Radio key={h.ad} value={h.ad}>
                  {h.ad} {h.acik > 0 ? <Tag color="green">{h.acik} açık kadro</Tag> : <Tag>açık kadro yok</Tag>}
                </Radio>
              ))}
            </Radio.Group>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
              {k.hedefler.map((h) => (
                <Tag key={h.ad} color={k.onaylananSube === h.ad ? "green" : h.acik > 0 ? "blue" : undefined}>
                  {h.ad}
                  {h.acik > 0 ? ` · ${h.acik} açık` : ""}
                </Tag>
              ))}
            </div>
          )}
          <div style={{ color: "#6b7280", fontSize: 12, marginTop: 4 }}>Açık kadro, talep açıldığı andaki norm − mevcut farkıdır.</div>
        </div>

        <div>
          <b style={{ fontSize: 13 }}>Onay akışı</b>
          <Adim ad="Yönetici talebi açtı" kisi={k.talepEden} karar="Açıldı" t={k.olusturma} />
          {k.tur === "yonetici" && (
            <Adim ad="Bölge müdürü" kisi={k.bolgeKisi} karar={k.bolgeKarar} not={k.bolgeNot} t={k.bolgeTarih} sirada={bolgeAsamasi} />
          )}
          <Adim ad="İnsan Kaynakları" kisi={k.ikKisi} karar={k.ikKarar} not={k.ikNot} t={k.ikTarih} sirada={ikAsamasi} />
          {k.durum === "onaylandi" && (
            <Adim ad="Mikro'ya işlendi" kisi={k.mikroNot} karar={k.mikroIslendi ? "İşlendi" : null} t={k.mikroIslendi} sirada={!k.mikroIslendi} />
          )}
        </div>

        {k.sirada && (
          <>
            <Input.TextArea
              rows={3}
              value={not}
              onChange={(e) => setNot(e.target.value)}
              placeholder="Açıklama (reddederken zorunlu)"
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="it-dg" disabled={isleniyor} onClick={() => karar(false)} style={{ color: "#b42318" }}>
                Reddet
              </button>
              <button type="button" className="it-dg birincil" disabled={isleniyor} onClick={() => karar(true)}>
                {bolgeAsamasi ? "Onayla (İK'ya gönder)" : "Rotasyonu onayla"}
              </button>
            </div>
          </>
        )}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {ikYetkili && k.durum === "onaylandi" && !k.mikroIslendi && (
            <Tooltip title="Mikro'da personelin iş grubu değişince kendiliğinden işaretlenir">
              <button type="button" className="it-dg" onClick={mikro}>
                Mikro'ya işlendi olarak işaretle
              </button>
            </Tooltip>
          )}
          {ikYetkili && (k.durum === "bolge" || k.durum === "ik") && (
            <button type="button" className="it-dg" onClick={iptal}>
              Talebi iptal et
            </button>
          )}
        </div>
      </div>
    </Drawer>
  );
}
