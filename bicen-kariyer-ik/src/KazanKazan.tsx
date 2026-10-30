/**
 * ---------------------------------------------------------------------------
 * Kazan-Kazan (20.10.2026)
 * ---------------------------------------------------------------------------
 * Çalışanların ödül sistemi. İki bölüm:
 *   - Yeni ürün önerileri: Biçen360'tan gelen öneriler; değerlendirme
 *     (denemeye al / uygun değil), 3 ay deneme, 4. ay ölçümü ve ödül
 *     (ilk 100 tam, 101–500 yarım, 501–1000 çeyrek, 1001–2000 gram altın).
 *   - Mağaza havuzu: kampanya ürünlerinden şubelere biriken tutar
 *     (MagazaHavuz.tsx, değişmeden).
 * Stil MagazaHavuz.css ("mh-") ve aşağıdaki "kk-" sınıfları.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  App as AntdApp,
  Button,
  DatePicker,
  Drawer,
  Image,
  Input,
  Popconfirm,
  Space,
  Spin,
  Timeline,
  Tooltip,
} from "antd";
import dayjs, { Dayjs } from "dayjs";
import {
  Calculator,
  CheckCircle2,
  Clock3,
  Download,
  Lightbulb,
  RefreshCw,
  Search,
  Squirrel,
  Trophy,
  XCircle,
} from "lucide-react";

import { api, API_TABAN, oturumOku } from "./api";
import { tabloIndir } from "./raporExcel";
import MagazaHavuz from "./MagazaHavuz";
import "./MagazaHavuz.css";
import "./KazanKazan.css";

interface Oneri {
  id: number;
  sicil: string;
  adSoyad: string;
  sube: string | null;
  pozisyon: string | null;
  urunAdi: string;
  barkod: string;
  neden: string;
  gorselVar: boolean;
  durum: string;
  asama: string;
  asamaNotu: string | null;
  kararNotu: string | null;
  kararVeren: string | null;
  kararTarihi: string | null;
  stokKodu: string | null;
  satisBaslangic: string | null;
  olcumBas: string | null;
  olcumBit: string | null;
  olcumMiktar: number | null;
  siralama: number | null;
  urunSayisi: number | null;
  odul: string | null;
  olusturma: string;
  olcumHazir: boolean;
  teslimTarihi: string | null;
  teslimEden: string | null;
}

const tarih = (v: string | null | undefined) => (v ? dayjs(v).format("DD.MM.YYYY") : "—");
const sayi = (v: number | null | undefined) => (v ?? 0).toLocaleString("tr-TR", { maximumFractionDigits: 0 });
const hataMetni = (e: any, yedek: string) => e?.message || e?.hata || yedek;

const DURUM: Record<string, { ad: string; renk: string; zemin: string }> = {
  degerlendiriliyor: { ad: "Değerlendirilecek", renk: "#2e6aa8", zemin: "#e9f0f8" },
  onaylandi: { ad: "Onaylandı · ürün açılıyor", renk: "#0f766e", zemin: "#e6f6f3" },
  denemede: { ad: "Denemede", renk: "#3f6507", zemin: "#eef6e1" },
  olcumde: { ad: "4. ay ölçülüyor", renk: "#a33410", zemin: "#fff0ea" },
  odullendi: { ad: "Ödül kazandı", renk: "#8a6500", zemin: "#fff6dc" },
  odulYok: { ad: "Ödül çıkmadı", renk: "#6b7280", zemin: "#f1f3ef" },
  uygunDegil: { ad: "Uygun değil", renk: "#c62828", zemin: "#fdecec" },
};

const teslimEdebilir = () => ["Admin", "GenelMudurYardimcisi"].includes(oturumOku()?.rol ?? "");

const VARSAYILAN_KADEME = [
  { sinir: 100, odul: "Tam Altın" },
  { sinir: 500, odul: "Yarım Altın" },
  { sinir: 1000, odul: "Çeyrek Altın" },
  { sinir: 2000, odul: "Gram Altın" },
];

const gorselAdresi = (id: number) =>
  `${API_TABAN}/api/KazanKazan/Gorsel/${id}?t=${encodeURIComponent(oturumOku()?.token ?? "")}`;

/* ========================================================================== */

export default function KazanKazan({ sekme: ilk = "oneri" }: { sekme?: "oneri" | "havuz" }) {
  const [sekme, setSekme] = useState<"oneri" | "havuz">(ilk);

  return (
    <div className="mh" style={{ gap: 14 }}>
      <div className="kk-ust">
        <div className="kk-ust-baslik">
          <span className="kk-ust-ikon">
            <Trophy size={20} />
          </span>
          <div>
            <h2>Kazan-Kazan</h2>
            <span>Çalışanların fikirleriyle kazandığı ödül sistemi</span>
          </div>
        </div>
        <div className="mh-sekmeler">
          <button type="button" className={sekme === "oneri" ? "mh-aktif" : undefined} onClick={() => setSekme("oneri")}>
            <Lightbulb size={15} /> Yeni ürün önerileri
          </button>
          <button type="button" className={sekme === "havuz" ? "mh-aktif" : undefined} onClick={() => setSekme("havuz")}>
            <Squirrel size={15} /> Mağaza havuzu
          </button>
        </div>
      </div>

      {sekme === "oneri" ? <Oneriler /> : <MagazaHavuz />}
    </div>
  );
}

/* ========================================================================== */
/* Yeni ürün önerileri                                                        */
/* ========================================================================== */

function Oneriler() {
  const { message } = AntdApp.useApp();
  const [liste, setListe] = useState<Oneri[]>([]);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [suzgec, setSuzgec] = useState<string>("");
  const [arama, setArama] = useState("");
  const [acik, setAcik] = useState<number | null>(null);
  const [kademeler, setKademeler] = useState(VARSAYILAN_KADEME);

  useEffect(() => {
    api
      .al<{ sinir: number; odul: string }[]>("/api/KazanKazan/OdulKademeleri")
      .then((k) => k?.length && setKademeler(k))
      .catch(() => undefined);
  }, []);

  const getir = useCallback(() => {
    setYukleniyor(true);
    api
      .al<Oneri[]>("/api/KazanKazan/Liste")
      .then(setListe)
      .catch((e) => message.error(hataMetni(e, "Öneriler alınamadı")))
      .finally(() => setYukleniyor(false));
  }, [message]);

  useEffect(() => {
    getir();
  }, [getir]);

  const say = (f: (o: Oneri) => boolean) => liste.filter(f).length;
  const cipler: [string, string, (o: Oneri) => boolean][] = [
    ["", "Tümü", () => true],
    ["degerlendiriliyor", "Değerlendirilecek", (o) => o.durum === "degerlendiriliyor"],
    ["onaylandi", "Onaylandı", (o) => o.durum === "onaylandi"],
    ["denemede", "Denemede", (o) => o.asama === "denemede"],
    ["olcumde", "4. ay", (o) => o.asama === "olcumde"],
    ["odullendi", "Ödül kazanan", (o) => o.durum === "odullendi"],
    ["teslimBekleyen", "Teslim bekleyen", (o) => o.durum === "odullendi" && !o.teslimTarihi],
    ["kapali", "Sonuçlanan", (o) => o.durum === "uygunDegil" || o.durum === "odulYok"],
  ];

  const satirlar = useMemo(() => {
    const f = cipler.find((c) => c[0] === suzgec)?.[2] ?? (() => true);
    const q = arama.trim().toLocaleLowerCase("tr");
    return liste.filter(
      (o) =>
        f(o) &&
        (!q || [o.urunAdi, o.barkod, o.adSoyad, o.sube, o.sicil].some((x) => (x ?? "").toLocaleLowerCase("tr").includes(q)))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liste, suzgec, arama]);

  const excel = () =>
    tabloIndir({
      baslik: "Kazan-Kazan · Yeni ürün önerileri",
      altBaslik: dayjs().format("DD.MM.YYYY"),
      sayfaAdi: "Öneriler",
      dosyaAdi: "kazan-kazan-oneriler",
      sutunlar: [
        { ad: "Tarih", tip: "tarih" },
        { ad: "Öneren", genislik: 24 },
        { ad: "Sicil", genislik: 9 },
        { ad: "Şube", genislik: 20 },
        { ad: "Ürün", genislik: 32 },
        { ad: "Barkod", genislik: 15 },
        { ad: "Neden", genislik: 50 },
        { ad: "Durum", genislik: 18 },
        { ad: "Satışa Giriş", tip: "tarih" },
        { ad: "4. Ay", genislik: 24 },
        { ad: "4. Ay Satış", tip: "sayi", toplam: false },
        { ad: "Sıra", tip: "sayi", toplam: false },
        { ad: "Ödül", genislik: 14 },
        { ad: "Teslim", tip: "tarih" },
      ],
      satirlar: satirlar.map((o) => [
        dayjs(o.olusturma).toDate(),
        o.adSoyad,
        o.sicil,
        o.sube ?? "",
        o.urunAdi,
        o.barkod,
        o.neden,
        DURUM[o.asama]?.ad ?? o.durum,
        o.satisBaslangic ? dayjs(o.satisBaslangic).toDate() : null,
        o.olcumBas ? `${tarih(o.olcumBas)} – ${tarih(o.olcumBit)}` : "",
        o.olcumMiktar,
        o.siralama,
        o.odul ?? "",
        o.teslimTarihi ? dayjs(o.teslimTarihi).toDate() : null,
      ]),
    });

  return (
    <>
      <section className="kk-hero">
        <div className="kk-hero-sol">
          <span className="kk-hero-ust">YENİ ÜRÜN PROJESİ</span>
          <b>Marketlerimizde olmayan ürünü öner, altın kazan</b>
          <span>3 ay deneme · 4. ayın satış sıralamasına göre ödül</span>
        </div>
        <div className="kk-oduller">
          {kademeler.map((k, i) => (
            <div key={k.sinir}>
              <Trophy size={14} />
              <b>{k.odul}</b>
              <span>{i === 0 ? `İlk ${k.sinir}` : `${kademeler[i - 1].sinir + 1}–${k.sinir}`}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="kk-kpi">
        {[
          ["Değerlendirilecek", say((o) => o.durum === "degerlendiriliyor"), "#2e6aa8", "degerlendiriliyor"],
          ["Denemede", say((o) => o.asama === "denemede"), "#3f6507", "denemede"],
          ["4. ay / ölçüm", say((o) => o.asama === "olcumde"), "#a33410", "olcumde"],
          ["Ödül kazanan", say((o) => o.durum === "odullendi"), "#8a6500", "odullendi"],
        ].map(([ad, n, renk, k]) => (
          <button key={k as string} type="button" onClick={() => setSuzgec(k as string)}>
            <span>{ad}</span>
            <b style={{ color: renk as string }}>{n as number}</b>
          </button>
        ))}
      </div>

      <div className="mh-arac">
        <Input
          allowClear
          prefix={<Search size={15} color="#9AA3AF" />}
          placeholder="Ürün, barkod, öneren, şube"
          style={{ width: 260 }}
          value={arama}
          onChange={(e) => setArama(e.target.value)}
        />
        <div className="mh-cipler">
          {cipler.map(([k, ad, f]) => (
            <button key={k} type="button" className={`mh-cip${suzgec === k ? " mh-aktif" : ""}`} onClick={() => setSuzgec(k)}>
              {ad} <b>{say(f)}</b>
            </button>
          ))}
        </div>
        <div className="mh-arac-sag">
          <Tooltip title="Yenile">
            <Button icon={<RefreshCw size={15} />} onClick={getir} />
          </Tooltip>
          <Button icon={<Download size={15} />} onClick={excel} disabled={satirlar.length === 0}>
            Excel
          </Button>
        </div>
      </div>

      {yukleniyor && liste.length === 0 ? (
        <div style={{ textAlign: "center", padding: 60 }}>
          <Spin />
        </div>
      ) : satirlar.length === 0 ? (
        <div className="mh-bos">
          <div className="mh-bos-ikon" style={{ background: "#fff6dc", color: "#8a6500" }}>
            <Lightbulb size={30} />
          </div>
          <b>{liste.length === 0 ? "Henüz öneri yok" : "Bu süzgeçte öneri yok"}</b>
          <p>Çalışanlar Biçen360 › Diğer › Kazan-Kazan'dan ürün önerdiğinde burada listelenir.</p>
        </div>
      ) : (
        <div className="kk-izgara">
          {satirlar.map((o) => {
            const d = DURUM[o.asama] ?? DURUM.degerlendiriliyor;
            return (
              <div key={o.id} className="kk-kart" onClick={() => setAcik(o.id)}>
                <div className="kk-gorsel">
                  {o.gorselVar ? (
                    <img src={gorselAdresi(o.id)} alt="" loading="lazy" />
                  ) : (
                    <Lightbulb size={28} color="#c8930a" />
                  )}
                  <span className="kk-durum" style={{ color: d.renk, background: d.zemin }}>
                    {o.odul ?? d.ad}
                  </span>
                </div>
                <div className="kk-kart-govde">
                  <div className="kk-urun" title={o.urunAdi}>
                    {o.urunAdi}
                  </div>
                  <div className="kk-barkod">{o.barkod}</div>
                  <div className="kk-neden">{o.neden}</div>
                  <div className="kk-oneren">
                    <span>
                      <b>{o.adSoyad}</b>
                      {o.sube ?? ""}
                    </span>
                    <small>{tarih(o.olusturma)}</small>
                  </div>
                  {o.asamaNotu && (
                    <div className="kk-asama" style={{ color: d.renk }}>
                      <Clock3 size={12} /> {o.asamaNotu}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <OneriAyrintisi id={acik} oneri={liste.find((o) => o.id === acik) ?? null} kapat={() => setAcik(null)} degisti={getir} />
    </>
  );
}

/* -------------------------------------------------------------------------- */

function OneriAyrintisi({
  id,
  oneri: o,
  kapat,
  degisti,
}: {
  id: number | null;
  oneri: Oneri | null;
  kapat: () => void;
  degisti: () => void;
}) {
  const { message } = AntdApp.useApp();
  const [gecmis, setGecmis] = useState<any[]>([]);
  const [islem, setIslem] = useState("");
  const [bas, setBas] = useState<Dayjs | null>(null);
  const [stok, setStok] = useState("");
  const [not, setNot] = useState("");

  useEffect(() => {
    setGecmis([]);
    setBas(dayjs().add(7, "day").startOf("day"));
    setStok(o?.stokKodu ?? "");
    setNot("");
    if (!id) return;
    api
      .al<any[]>(`/api/KazanKazan/Hareketler/${id}`)
      .then(setGecmis)
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const karar = async (durum: string) => {
    setIslem(durum);
    try {
      await api.gonder(`/api/KazanKazan/Karar/${id}`, {
        durum,
        not: not.trim() || undefined,
        stokKodu: stok.trim() || undefined,
        satisBaslangic: durum === "denemede" ? bas?.format("YYYY-MM-DD") : undefined,
      });
      message.success(durum === "denemede" ? "Denemeye alındı" : durum === "onaylandi" ? "Onaylandı; personele bildirildi" : durum === "uygunDegil" ? "Uygun değil olarak işaretlendi" : "Kaydedildi");
      degisti();
      kapat();
    } catch (e: any) {
      message.error(hataMetni(e, "Kaydedilemedi"));
    } finally {
      setIslem("");
    }
  };

  const olc = async () => {
    setIslem("olc");
    try {
      const s = await api.gonder<any>(`/api/KazanKazan/Olc/${id}`);
      message.success(s.odul ? `Sıra ${s.sira}: ${s.odul}` : `Sıra ${s.sira}: ödül çıkmadı`);
      degisti();
      kapat();
    } catch (e: any) {
      message.error(hataMetni(e, "Ölçülemedi"));
    } finally {
      setIslem("");
    }
  };

  const teslim = async (geriAl: boolean) => {
    setIslem("teslim");
    try {
      await api.gonder(`/api/KazanKazan/Teslim/${id}`, { geriAl });
      message.success(geriAl ? "Teslim kaydı geri alındı" : "Teslim edildi olarak işaretlendi");
      degisti();
      kapat();
    } catch (e: any) {
      message.error(hataMetni(e, "Kaydedilemedi"));
    } finally {
      setIslem("");
    }
  };

  const d = o ? DURUM[o.asama] ?? DURUM.degerlendiriliyor : null;

  return (
    <Drawer
      open={id != null}
      onClose={kapat}
      width={760}
      rootClassName="mh-cekmece"
      title={
        o && (
          <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="mh-kampanya-ikon" style={{ width: 38, height: 38, borderRadius: 11, background: "#fff6dc", color: "#8a6500" }}>
              <Lightbulb size={19} />
            </span>
            <span style={{ minWidth: 0 }}>
              <div style={{ fontSize: 17, fontWeight: 800 }}>{o.urunAdi}</div>
              <div style={{ fontSize: 12, color: "#7b8577", fontWeight: 500 }}>
                Öneri #{o.id} · {tarih(o.olusturma)}
              </div>
            </span>
          </span>
        )
      }
      extra={d && <span className="kk-durum" style={{ position: "static", color: d.renk, background: d.zemin }}>{o?.odul ?? d.ad}</span>}
    >
      {!o ? (
        <Spin />
      ) : (
        <>
          <div className="kk-detay">
            <div className="kk-detay-gorsel">
              {o.gorselVar ? <Image src={gorselAdresi(o.id)} alt="" /> : <Lightbulb size={40} color="#c8930a" />}
            </div>
            <div className="kk-detay-bilgi">
              <div>
                <span>Barkod</span>
                <b style={{ fontFamily: "Consolas, monospace" }}>{o.barkod}</b>
              </div>
              <div>
                <span>Öneren</span>
                <b>{o.adSoyad}</b>
                <small>
                  {o.sicil} · {o.pozisyon ?? ""}
                </small>
              </div>
              <div>
                <span>Şube</span>
                <b>{o.sube ?? "—"}</b>
              </div>
              {o.stokKodu && (
                <div>
                  <span>Mikro stok kodu</span>
                  <b>{o.stokKodu}</b>
                </div>
              )}
            </div>
          </div>

          <div className="mh-bolum">
            <div className="mh-bolum-bas">Neden raflarımızda bulunmalı?</div>
            <div style={{ padding: "12px 16px", whiteSpace: "pre-wrap", lineHeight: 1.55 }}>{o.neden}</div>
          </div>

          {/* --------------------------------------------- değerlendirme */}
          {(o.durum === "degerlendiriliyor" || o.durum === "onaylandi") && (
            <div className="mh-bolum">
              <div className="mh-bolum-bas">{o.durum === "onaylandi" ? "Onaylandı · ürün açılınca denemeye alın" : "Değerlendirme"}</div>
              <div style={{ padding: 16, display: "grid", gap: 12 }}>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 12 }}>
                  <div>
                    <div className="kk-etiket">Satışa giriş tarihi</div>
                    <DatePicker value={bas} onChange={setBas} format="DD.MM.YYYY" style={{ width: "100%" }} allowClear={false} />
                    {bas && (
                      <div className="kk-ipucu">
                        Deneme {bas.format("DD.MM.YYYY")} – {bas.add(3, "month").subtract(1, "day").format("DD.MM.YYYY")} ·
                        4. ay {bas.add(3, "month").format("DD.MM.YYYY")} – {bas.add(4, "month").subtract(1, "day").format("DD.MM.YYYY")}
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="kk-etiket">Mikro stok kodu (açıldıysa)</div>
                    <Input value={stok} onChange={(e) => setStok(e.target.value)} placeholder="Boşsa ölçümde barkoddan bulunur" />
                  </div>
                </div>
                <div>
                  <div className="kk-etiket">Not (uygun değilse sebebi; personel görür)</div>
                  <Input.TextArea rows={2} maxLength={500} value={not} onChange={(e) => setNot(e.target.value)} />
                </div>
                <Space wrap>
                  <Popconfirm
                    title="Ürün denemeye alınsın mı? 3 ay normal fiyatla satılır."
                    okText="Denemeye al"
                    cancelText="Vazgeç"
                    onConfirm={() => karar("denemede")}
                  >
                    <Button type="primary" icon={<CheckCircle2 size={15} />} loading={islem === "denemede"} disabled={!bas}>
                      Denemeye al
                    </Button>
                  </Popconfirm>
                  {o.durum === "degerlendiriliyor" && (
                    <Tooltip title="Personel 'Onaylandı, ürün açılıyor' görür; satış tarihi sonra girilir">
                      <Button icon={<CheckCircle2 size={15} />} loading={islem === "onaylandi"} onClick={() => karar("onaylandi")}>
                        Onayla (ürün açılıyor)
                      </Button>
                    </Tooltip>
                  )}
                  <Button danger icon={<XCircle size={15} />} loading={islem === "uygunDegil"} onClick={() => karar("uygunDegil")}>
                    Uygun değil
                  </Button>
                  {o.durum === "onaylandi" && (
                    <Button loading={islem === "degerlendiriliyor"} onClick={() => karar("degerlendiriliyor")}>
                      Değerlendirmeye geri al
                    </Button>
                  )}
                </Space>
              </div>
            </div>
          )}

          {/* --------------------------------------------- deneme / ölçüm */}
          {o.durum === "denemede" && (
            <div className="mh-bolum">
              <div className="mh-bolum-bas">Deneme süreci</div>
              <div style={{ padding: 16, display: "grid", gap: 12 }}>
                <div className="kk-surec">
                  <div className={dayjs().isAfter(dayjs(o.satisBaslangic)) ? "kk-gecti" : ""}>
                    <span>Satışa giriş</span>
                    <b>{tarih(o.satisBaslangic)}</b>
                  </div>
                  <div className={dayjs().isAfter(dayjs(o.olcumBas)) ? "kk-gecti" : ""}>
                    <span>4. ay başlıyor</span>
                    <b>{tarih(o.olcumBas)}</b>
                  </div>
                  <div className={o.olcumHazir ? "kk-gecti" : ""}>
                    <span>4. ay bitiyor</span>
                    <b>{tarih(o.olcumBit)}</b>
                  </div>
                </div>
                <Space wrap>
                  <Tooltip title={o.olcumHazir ? "" : `Ölçüm ${tarih(o.olcumBit)} sonrası yapılabilir`}>
                    <Popconfirm
                      title="4. ayın satış sıralaması Mikro'dan hesaplansın mı? Sonuç kesinleşir."
                      okText="Hesapla"
                      cancelText="Vazgeç"
                      onConfirm={olc}
                      disabled={!o.olcumHazir}
                    >
                      <Button type="primary" icon={<Calculator size={15} />} loading={islem === "olc"} disabled={!o.olcumHazir}>
                        4. ay sıralamasını hesapla
                      </Button>
                    </Popconfirm>
                  </Tooltip>
                  <Button loading={islem === "degerlendiriliyor"} onClick={() => karar("degerlendiriliyor")}>
                    Değerlendirmeye geri al
                  </Button>
                </Space>
              </div>
            </div>
          )}

          {(o.durum === "odullendi" || o.durum === "odulYok") && (
            <Alert
              type={o.odul ? "success" : "info"}
              showIcon
              icon={<Trophy size={18} />}
              style={{ borderRadius: 14, marginBottom: 14 }}
              message={o.odul ? `${o.odul} kazandı` : "Ödül çıkmadı"}
              description={`4. ay (${tarih(o.olcumBas)} – ${tarih(o.olcumBit)}) satış: ${sayi(o.olcumMiktar)} · sıra ${o.siralama} / ${sayi(o.urunSayisi)} ürün`}
            />
          )}

          {o.durum === "odullendi" && (
            <div className="mh-bolum">
              <div className="mh-bolum-bas">Ödül teslimi</div>
              <div style={{ padding: 16, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                {o.teslimTarihi ? (
                  <span>
                    <CheckCircle2 size={15} color="#3f6507" style={{ verticalAlign: -2 }} /> <b>{tarih(o.teslimTarihi)}</b> tarihinde teslim
                    edildi · {o.teslimEden}
                  </span>
                ) : (
                  <span style={{ color: "#7b8577" }}>{o.odul} henüz teslim edilmedi.</span>
                )}
                {teslimEdebilir() &&
                  (o.teslimTarihi ? (
                    <Popconfirm title="Teslim kaydı geri alınsın mı?" okText="Geri al" cancelText="Vazgeç" onConfirm={() => teslim(true)}>
                      <Button loading={islem === "teslim"}>Teslimi geri al</Button>
                    </Popconfirm>
                  ) : (
                    <Popconfirm
                      title={`${o.odul} ${o.adSoyad} adlı personele teslim edildi mi? Personele bildirim gider.`}
                      okText="Teslim edildi"
                      cancelText="Vazgeç"
                      onConfirm={() => teslim(false)}
                    >
                      <Button type="primary" icon={<Trophy size={15} />} loading={islem === "teslim"}>
                        Teslim edildi
                      </Button>
                    </Popconfirm>
                  ))}
              </div>
            </div>
          )}

          {o.durum === "uygunDegil" && (
            <Alert type="error" showIcon style={{ borderRadius: 14, marginBottom: 14 }} message="Uygun bulunmadı" description={o.kararNotu} />
          )}

          <div className="mh-bolum" style={{ marginBottom: 0 }}>
            <div className="mh-bolum-bas">Geçmiş</div>
            <div style={{ padding: "16px 16px 0" }}>
              <Timeline
                items={gecmis.map((h) => ({
                  color: h.yeni === "uygunDegil" ? "red" : h.yeni === "odullendi" ? "gold" : "green",
                  children: (
                    <div>
                      <b>{DURUM[h.yeni]?.ad ?? h.yeni}</b>{" "}
                      <span style={{ color: "#7b8577", fontSize: 12 }}>
                        {dayjs(h.zaman).format("DD.MM.YYYY HH:mm")} · {h.yapan}
                      </span>
                      {h.aciklama && <div style={{ fontSize: 13 }}>{h.aciklama}</div>}
                    </div>
                  ),
                }))}
              />
            </div>
          </div>
        </>
      )}
    </Drawer>
  );
}
