/**
 * Biçen Kart › Puan Yönetimi
 * ---------------------------------------------------------------------------
 * Tek karta ya da Excel ile toplu puan yükleme, puan transferi ve bakiye
 * silme.
 *
 * Yükleme önce talep oluyor ve Admin onayına düşüyor (sağ üstteki
 * "Bekleyen işler" zili; işe alım ve rotasyon onaylarıyla aynı yer). Onaylanınca
 * PuanHareket'e (Posback'in biçimiyle, işlem tipi 3) yazılıyor, reddedilirse
 * puan yatmıyor. İki durumda da talep edene bildirim gidiyor; onaydan
 * sonra ulas.bicen@bicen.com.tr'ye ayrıntılı e-posta gidiyor. Transfer ve
 * silme onaysız, anında; kimin yaptığı kaydediliyor.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, message } from "antd";
import * as XLSX from "xlsx";
import {
  ArrowDown,
  ArrowRightLeft,
  CircleMinus,
  Download,
  FileSpreadsheet,
  Plus,
  RefreshCw,
  Search,
  Upload,
} from "lucide-react";

import { api } from "./api";
import { PUAN_DEGISTI } from "./PuanOnaylari";

/* -------------------------------------------------------------------------- */

const no4 = (d?: string | null) => (d ?? "").replace(/(.{4})/g, "$1 ").trim();

const sayi = (d?: number | null) =>
  Number(d ?? 0).toLocaleString("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const puanYaz = (d?: number | null) =>
  Number(d ?? 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const tarihSaat = (t?: string | null) =>
  t
    ? new Date(t).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "";

const bas = (ad: string) =>
  (ad ?? "")
    .split(" ")
    .filter(Boolean)
    .map((x) => x[0])
    .slice(0, 2)
    .join("")
    .toLocaleUpperCase("tr-TR");

const rakam = (s: string) => (s ?? "").replace(/\D/g, "");

/** Varsayılan son kullanma: üç yıl sonraki 30 Kasım (Posback'teki örnekle aynı düzen) */
const varsayilanSon = () => `${new Date().getFullYear() + 3}-11-30`;

const puanOku = (s: string) => {
  const t = (s ?? "").toString().trim().replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};

/**
 * Tutar alanı bakiyeyi aşamıyor: 15 bakiyede 20 yazılınca 15'e iniyor.
 * Bakiye eksiye düşmesin diye (Posback'te de düşülecek parti kalmıyor).
 */
const bakiyeyleSinirla = (metin: string, bakiye?: number | null) => {
  const n = puanOku(metin);
  if (bakiye == null || !Number.isFinite(n) || n <= bakiye) return metin;
  message.info(`Bakiye ${puanYaz(bakiye)}; en fazla bu kadar yazılabilir.`, 2);
  return String(Math.max(0, bakiye)).replace(".", ",");
};

interface KartBilgi {
  kartNo: string;
  adSoyad: string | null;
  sicil: string | null;
  sube: string | null;
  bakiye: number;
}

/* -------------------------------------------------------------------------- */

export default function BicenKartPuan() {
  const [ozet, setOzet] = useState<any>(null);
  const [bekleyenler, setBekleyenler] = useState<any[]>([]);
  const [islemler, setIslemler] = useState<any[]>([]);
  const [suzgec, setSuzgec] = useState<"tumu" | "yukleme" | "transfer" | "silme">("tumu");
  const [form, setForm] = useState<"tek" | "toplu" | "transfer" | "sil">("tek");
  const [yukleniyor, setYukleniyor] = useState(false);

  const getir = useCallback(async () => {
    setYukleniyor(true);
    try {
      const [o, t, i] = await Promise.all([
        api.al<any>("/api/BicenKartPuan/Ozet"),
        api.al<any>("/api/BicenKartPuan/Talepler?durum=bekliyor"),
        api.al<any>("/api/BicenKartPuan/Islemler"),
      ]);
      setOzet(o);
      setBekleyenler(t?.talepler ?? []);
      setIslemler(i?.islemler ?? []);
    } catch (h: any) {
      message.error(h?.message ?? "Puan bilgileri alınamadı.");
    } finally {
      setYukleniyor(false);
    }
  }, []);

  /* Zilden karar verilince ya da yeni talep gönderilince liste tazelenir */
  useEffect(() => {
    getir();
    window.addEventListener(PUAN_DEGISTI, getir);
    return () => window.removeEventListener(PUAN_DEGISTI, getir);
  }, [getir]);

  const liste = useMemo(
    () => islemler.filter((x) => suzgec === "tumu" || x.tur === suzgec),
    [islemler, suzgec]
  );

  const admin = !!ozet?.admin;

  return (
    <div className="bkp">
      {/* ------------------------------------------------------------ özet */}
      <div className="bk-ozet">
        <div className="bk-kutu">
          <small>Bu ay yüklenen</small>
          <div className="sayi" style={{ color: "var(--bk-yesilKoyu)" }}>
            {sayi(ozet?.yukleme?.puan)} <span>puan</span>
          </div>
          <div className="alt">
            {ozet?.yukleme?.kart ?? 0} kart · {ozet?.topluYukleme ?? 0} toplu yükleme
          </div>
        </div>
        <div className="bk-kutu">
          <small>Bu ay transfer</small>
          <div className="sayi">
            {sayi(ozet?.transfer?.puan)} <span>puan</span>
          </div>
          <div className="alt">{ozet?.transfer?.adet ?? 0} transfer</div>
        </div>
        <div className="bk-kutu">
          <small>Bu ay silinen</small>
          <div className="sayi" style={{ color: "var(--bk-kirmizi)" }}>
            {sayi(ozet?.silme?.puan)} <span>puan</span>
          </div>
          <div className="alt">{ozet?.silme?.kart ?? 0} kart · sebepleriyle</div>
        </div>
        <div className={`bk-kutu ${ozet?.bekleyen?.adet ? "bkp-vurgu" : ""}`}>
          <small>Onay bekleyen</small>
          <div className="sayi" style={{ color: ozet?.bekleyen?.adet ? "var(--bk-turuncu)" : undefined }}>
            {ozet?.bekleyen?.adet ?? 0} <span>talep</span>
          </div>
          <div className="alt">
            {ozet?.bekleyen?.kart ?? 0} kart · {sayi(ozet?.bekleyen?.puan)} puan
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------ akış */}
      <div className="bkp-akis">
        <div>
          <i>1</i>
          <b>Yükleme talebi</b>
          <small>Tek kart ya da Excel</small>
        </div>
        <span>›</span>
        <div>
          <i>2</i>
          <b>Admin onayı</b>
          <small>Kaç kişi, ne kadar, hangi puan</small>
        </div>
        <span>›</span>
        <div>
          <i>3</i>
          <b>Karta yüklenir</b>
          <small>PuanHareket'e yazılır</small>
        </div>
        <span>›</span>
        <div>
          <i>4</i>
          <b>Bildirim + e-posta</b>
          <small>Talep edene bildirim, onayda ayrıntılı e-posta</small>
        </div>
      </div>

      {/* ---------------------------------------------------- onay bekleyenler */}
      {bekleyenler.length > 0 && (
        <div className="bk-panel bkp-onaylar">
          <div className="bkp-bash">
            <b>
              Onay bekleyen puan yüklemeleri <span className="bkp-say">{bekleyenler.length}</span>
            </b>
            <small>
              {admin
                ? "Onay ve ret sağ üstteki Bekleyen işler zilinden verilir."
                : "Onayı Admin verir; sonuç size bildirim olarak gelir."}
            </small>
          </div>
          {bekleyenler.map((t) => (
            <Talep key={t.id} t={t} />
          ))}
        </div>
      )}

      <div className="bkp-izgara">
        {/* ------------------------------------------------------ işlemler */}
        <div className="bk-panel">
          <div className="bkp-isekme">
            <button className={form === "tek" ? "acik" : ""} onClick={() => setForm("tek")}>
              <Plus size={15} /> Tek karta yükle
            </button>
            <button className={form === "toplu" ? "acik" : ""} onClick={() => setForm("toplu")}>
              <FileSpreadsheet size={15} /> Excel ile toplu yükle
            </button>
            <button className={form === "transfer" ? "acik" : ""} onClick={() => setForm("transfer")}>
              <ArrowRightLeft size={15} /> Puan transferi
            </button>
            <button className={form === "sil" ? "acik" : ""} onClick={() => setForm("sil")}>
              <CircleMinus size={15} /> Bakiye sil
            </button>
          </div>

          {form === "tek" && <TekYukleme bitti={getir} />}
          {form === "toplu" && <TopluYukleme bitti={getir} />}
          {form === "transfer" && <Transfer bitti={getir} />}
          {form === "sil" && <Sil bitti={getir} />}
        </div>

        {/* ------------------------------------------------- son işlemler */}
        <div className="bk-panel">
          <div className="bkp-bash">
            <b>Son işlemler</b>
            <div className="bk-suzgec" style={{ margin: 0 }}>
              {(
                [
                  ["tumu", "Tümü"],
                  ["yukleme", "Yükleme"],
                  ["transfer", "Transfer"],
                  ["silme", "Silme"],
                ] as const
              ).map(([k, a]) => (
                <button key={k} className={`bk-cip ${suzgec === k ? "acik" : ""}`} onClick={() => setSuzgec(k)}>
                  {a}
                </button>
              ))}
              <button className="bk-d kucuk hayalet" onClick={getir} title="Yenile">
                <RefreshCw size={14} className={yukleniyor ? "bk-donen" : undefined} />
              </button>
            </div>
          </div>

          <div className="bkp-tabloKap">
            <table className="bk-tablo bkp-tablo">
              <thead>
                <tr>
                  <th>Tarih</th>
                  <th>İşlem</th>
                  <th>Kart / kişi</th>
                  <th className="bk-sag">Puan</th>
                  <th>Yapan</th>
                </tr>
              </thead>
              <tbody>
                {liste.length === 0 ? (
                  <tr>
                    <td colSpan={5}>
                      <div className="bk-bos">Henüz işlem yok.</div>
                    </td>
                  </tr>
                ) : (
                  liste.map((x) => (
                    <tr key={x.anahtar}>
                      <td style={{ whiteSpace: "nowrap" }}>{tarihSaat(x.tarih)}</td>
                      <td>
                        <IslemRozeti x={x} />
                        <small className="bkp-blok">
                          {x.durum === "reddedildi" && x.redSebebi
                            ? `"${x.redSebebi}"`
                            : x.durum === "onaylandi" && x.kararVerenAd
                            ? `onaylayan: ${x.kararVerenAd}`
                            : x.aciklama}
                        </small>
                      </td>
                      <td>
                        {x.kisi}
                        {x.subeler ? (
                          <small className="bkp-blok" title={x.subeler}>
                            {x.havuz ? "Havuz · " : ""}
                            {x.subeler}
                          </small>
                        ) : null}
                      </td>
                      <td
                        className={`bk-sag ${
                          x.tur === "silme" ? "bkp-eksi" : x.tur === "yukleme" && x.durum === "onaylandi" ? "bkp-arti" : ""
                        }`}
                      >
                        {x.tur === "silme" ? "−" : x.tur === "yukleme" && x.durum === "onaylandi" ? "+" : ""}
                        {sayi(x.puan)}
                      </td>
                      <td>{x.yapan}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function IslemRozeti({ x }: { x: any }) {
  if (x.tur === "transfer") return <span className="bk-rozet bkp-r-mavi">transfer</span>;
  if (x.tur === "silme") return <span className="bk-rozet bk-r-kirmizi">silme</span>;
  if (x.durum === "bekliyor" || x.durum === "isleniyor")
    return <span className="bk-rozet bk-r-sari">onay bekliyor</span>;
  if (x.durum === "reddedildi") return <span className="bk-rozet bk-r-kirmizi">reddedildi</span>;
  return <span className="bk-rozet bk-r-yesil">yüklendi</span>;
}

/* ========================================================================== */
/* Onay bekleyen talep                                                        */
/* ========================================================================== */

function Talep({ t }: { t: any }) {
  const [satirlar, setSatirlar] = useState<any[] | null>(null);
  const [acik, setAcik] = useState(false);

  const listeAc = async () => {
    setAcik(!acik);
    if (satirlar === null) {
      try {
        const c = await api.al<any>(`/api/BicenKartPuan/Talep/${t.id}`);
        setSatirlar(c?.satirlar ?? []);
      } catch (h: any) {
        message.error(h?.message ?? "Liste alınamadı.");
      }
    }
  };

  const tek = t.kartSayisi === 1;

  return (
    <div className="bkp-talep">
      <div className="bkp-tUst">
        <div>
          <b>{t.aciklama}</b>
          <small>
            {tek ? `Tek kart · ${t.ilkKisi ?? ""} · ${no4(t.ilkKart)}` : `Toplu yükleme${t.dosyaAdi ? ` · ${t.dosyaAdi}` : ""}`} ·{" "}
            {t.talepEdenAd ?? t.talepEden} · {tarihSaat(t.olusturma)}
          </small>
          {t.subeler && (
            <small>
              <b>{t.havuz ? "Havuz dağıtımı · " : "Şubeler · "}</b>
              {t.subeler}
            </small>
          )}
          {t.hata && <small style={{ color: "var(--bk-kirmizi)" }}>Son deneme yazılamadı: {t.hata}</small>}
        </div>
        <span className="bk-rozet bk-r-sari">onay bekliyor</span>
      </div>

      <div className="bkp-ucl">
        <div>
          <small>Kişi / kart</small>
          <b>{t.kartSayisi}</b>
        </div>
        <div>
          <small>Toplam puan</small>
          <b>{sayi(t.toplamPuan)}</b>
        </div>
        <div>
          <small>Kişi başı</small>
          <b>{t.enAz === t.enCok ? sayi(t.enAz) : `${sayi(t.enAz)} – ${sayi(t.enCok)}`}</b>
        </div>
        <div>
          <small>Puan türü</small>
          <b>Yükleme</b>
          <em>işlem tipi 3</em>
        </div>
        <div>
          <small>Son kullanma</small>
          <b>{t.sonKullanim ? new Date(t.sonKullanim).toLocaleDateString("tr-TR") : "—"}</b>
        </div>
      </div>

      <button className="bkp-link" onClick={listeAc}>
        {acik ? "▾" : "▸"} {t.kartSayisi} kartın listesini {acik ? "gizle" : "gör"}
      </button>

      {acik && (
        <div className="bkp-tabloKap" style={{ maxHeight: 280 }}>
          <table className="bk-tablo bkp-tablo">
            <thead>
              <tr>
                <th>Personel</th>
                <th>Şube</th>
                <th>Kart no</th>
                <th className="bk-sag">Puan</th>
              </tr>
            </thead>
            <tbody>
              {(satirlar ?? []).map((s, i) => (
                <tr key={i}>
                  <td>{s.adSoyad ?? "—"}</td>
                  <td>{s.sube ?? "—"}</td>
                  <td className="bk-no">{no4(s.kartNo)}</td>
                  <td className="bk-sag">{sayi(s.puan)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

    </div>
  );
}

/* ========================================================================== */
/* Kart seçimi                                                                */
/* ========================================================================== */

function KartSec({
  etiket,
  kart,
  setKart,
}: {
  etiket: string;
  kart: KartBilgi | null;
  setKart: (k: KartBilgi | null) => void;
}) {
  const [no, setNo] = useState(kart?.kartNo ?? "");
  const [araniyor, setAraniyor] = useState(false);
  const [hata, setHata] = useState("");

  const bul = async () => {
    const n = rakam(no);
    if (n.length < 6) {
      setHata("Kart numarasını giriniz.");
      return;
    }
    setAraniyor(true);
    setHata("");
    try {
      setKart(await api.al<KartBilgi>(`/api/BicenKartPuan/Kart?kartNo=${n}`));
    } catch (h: any) {
      setKart(null);
      setHata(h?.message ?? "Kart bulunamadı.");
    } finally {
      setAraniyor(false);
    }
  };

  return (
    <>
      <label className="bkp-etiket">{etiket}</label>
      <div className="bkp-kartgir">
        <input
          value={no}
          placeholder="1992 0552 3096 5265"
          onChange={(e) => {
            setNo(e.target.value);
            if (kart) setKart(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && bul()}
        />
        <button className="bk-d" onClick={bul} disabled={araniyor}>
          <Search size={14} /> Bul
        </button>
      </div>
      {hata && <div className="bkp-hata">{hata}</div>}
      {kart && (
        <div className="bkp-kartbilgi">
          <span className="bk-bas">{bas(kart.adSoyad ?? "?")}</span>
          <div>
            <b>{kart.adSoyad ?? "Sahibi bilinmiyor"}</b>
            <small>
              {no4(kart.kartNo)}
              {kart.sicil ? ` · ${kart.sicil}` : ""}
              {kart.sube ? ` · ${kart.sube}` : ""}
            </small>
          </div>
          <div className="bkp-bak">
            <small>BAKİYE</small>
            <b>{puanYaz(kart.bakiye)}</b>
          </div>
        </div>
      )}
    </>
  );
}

/* ========================================================================== */
/* Tek karta yükleme                                                          */
/* ========================================================================== */

function TekYukleme({ bitti }: { bitti: () => void }) {
  const [kart, setKart] = useState<KartBilgi | null>(null);
  const [puan, setPuan] = useState("");
  const [son, setSon] = useState(varsayilanSon());
  const [aciklama, setAciklama] = useState("");
  const [gonderiliyor, setGonderiliyor] = useState(false);

  const p = puanOku(puan);

  const gonder = async () => {
    if (!kart) return message.warning("Önce kartı bulunuz.");
    if (!(p > 0)) return message.warning("Yüklenecek puanı giriniz.");
    if (aciklama.trim().length < 3) return message.warning("Açıklama giriniz; onayda ve e-postada görünür.");

    setGonderiliyor(true);
    try {
      await api.gonder("/api/BicenKartPuan/Talep", {
        tur: "tek",
        aciklama: aciklama.trim(),
        sonKullanim: son,
        satirlar: [{ kartNo: kart.kartNo, puan: p }],
      });
      message.success("Talep Admin onayına gönderildi. Sonuç size bildirim olarak gelecek.");
      window.dispatchEvent(new Event(PUAN_DEGISTI));
      setKart(null);
      setPuan("");
      setAciklama("");
      bitti();
    } catch (h: any) {
      message.error(h?.message ?? "Gönderilemedi.");
    } finally {
      setGonderiliyor(false);
    }
  };

  return (
    <div className="bkp-form">
      <KartSec etiket="Kart numarası" kart={kart} setKart={setKart} />
      <div className="bkp-iki">
        <div>
          <label className="bkp-etiket">Yüklenecek puan</label>
          <input value={puan} onChange={(e) => setPuan(e.target.value)} inputMode="decimal" />
        </div>
        <div>
          <label className="bkp-etiket">Son kullanma tarihi</label>
          <input type="date" value={son} onChange={(e) => setSon(e.target.value)} />
        </div>
      </div>
      <label className="bkp-etiket">Açıklama</label>
      <input value={aciklama} onChange={(e) => setAciklama(e.target.value)} placeholder="Örnek: Eylül ayı başarı ödülü" />
      {kart && p > 0 && (
        <div className="bkp-sonuc">
          Onaylanınca bakiye <b>{puanYaz(kart.bakiye + p)}</b> olur
        </div>
      )}
      <button className="bk-d birincil bkp-tam" onClick={gonder} disabled={gonderiliyor}>
        Onaya gönder
      </button>
      <p className="bkp-dip">
        Talep Admin onayına düşer; onaylanınca karta yüklenir, reddedilirse puan yatmaz. İki durumda da size bildirim
        gelir.
      </p>
    </div>
  );
}

/* ========================================================================== */
/* Excel ile toplu yükleme                                                    */
/* ========================================================================== */

function TopluYukleme({ bitti }: { bitti: () => void }) {
  const [dosyaAdi, setDosyaAdi] = useState("");
  const [kontrol, setKontrol] = useState<any>(null);
  const [aciklama, setAciklama] = useState("");
  const [son, setSon] = useState(varsayilanSon());
  const [calisiyor, setCalisiyor] = useState(false);
  const girdi = useRef<HTMLInputElement>(null);

  const sablon = () => {
    const sayfa = XLSX.utils.aoa_to_sheet([
      ["KartNo", "Puan"],
      ["1992055230965265", 100],
    ]);
    sayfa["!cols"] = [{ wch: 22 }, { wch: 10 }];
    const kitap = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(kitap, sayfa, "Puan");
    XLSX.writeFile(kitap, "biçen-kart-puan-sablonu.xlsx");
  };

  const oku = async (dosya: File) => {
    setCalisiyor(true);
    setKontrol(null);
    try {
      const veri = await dosya.arrayBuffer();
      const kitap = XLSX.read(veri, { type: "array", raw: true });
      const hucreler = XLSX.utils.sheet_to_json<any[]>(kitap.Sheets[kitap.SheetNames[0]], {
        header: 1,
        raw: true,
        defval: "",
        blankrows: false,
      }) as any[][];

      /* Başlık satırı: KartNo / Kart No / Kart ve Puan sütunları */
      const baslikSira = hucreler.findIndex((r) =>
        r.some((h) => /kart/i.test(String(h))) && r.some((h) => /puan/i.test(String(h)))
      );
      if (baslikSira < 0) throw new Error("Başlık satırında KartNo ve Puan sütunları bulunamadı. Şablonu kullanınız.");

      const b = hucreler[baslikSira].map((h) => String(h).toLocaleLowerCase("tr-TR"));
      const iKart = b.findIndex((h) => h.includes("kart"));
      const iPuan = b.findIndex((h) => h.includes("puan"));

      const satirlar = hucreler
        .slice(baslikSira + 1)
        .map((r) => {
          const k = r[iKart];
          const kartNo = typeof k === "number" ? k.toFixed(0) : rakam(String(k));
          const pv = r[iPuan];
          const puan = typeof pv === "number" ? pv : puanOku(String(pv));
          return { kartNo, puan };
        })
        .filter((x) => x.kartNo || x.puan);

      if (satirlar.length === 0) throw new Error("Dosyada satır yok.");

      setDosyaAdi(dosya.name);
      setKontrol(await api.gonder<any>("/api/BicenKartPuan/Kontrol", { satirlar }));
    } catch (h: any) {
      message.error(h?.message ?? "Dosya okunamadı.");
    } finally {
      setCalisiyor(false);
    }
  };

  const hazirlar = (kontrol?.satirlar ?? []).filter((x: any) => x.durum === "hazir");
  const sorunlu = (kontrol?.satirlar ?? []).filter((x: any) => x.durum !== "hazir");

  const gonder = async () => {
    if (hazirlar.length === 0) return message.warning("Yüklenecek geçerli satır yok.");
    if (aciklama.trim().length < 3) return message.warning("Açıklama giriniz; onayda ve e-postada görünür.");

    setCalisiyor(true);
    try {
      await api.gonder("/api/BicenKartPuan/Talep", {
        tur: "toplu",
        aciklama: aciklama.trim(),
        dosyaAdi,
        sonKullanim: son,
        satirlar: hazirlar.map((x: any) => ({ kartNo: x.kartNo, puan: x.puan })),
      });
      message.success(`${hazirlar.length} kartlık talep Admin onayına gönderildi.`);
      window.dispatchEvent(new Event(PUAN_DEGISTI));
      setKontrol(null);
      setDosyaAdi("");
      setAciklama("");
      bitti();
    } catch (h: any) {
      message.error(h?.message ?? "Gönderilemedi.");
    } finally {
      setCalisiyor(false);
    }
  };

  const durumAdi: Record<string, [string, string]> = {
    hazir: ["hazır", "bk-r-yesil"],
    yok: ["kart yok · atlanır", "bk-r-kirmizi"],
    tekrar: ["tekrar eden kart · atlanır", "bk-r-sari"],
    gecersiz: ["geçersiz numara · atlanır", "bk-r-kirmizi"],
    puan: ["geçersiz puan · atlanır", "bk-r-kirmizi"],
  };

  return (
    <div className="bkp-form">
      <div className="bkp-birak">
        <b>
          <FileSpreadsheet size={16} /> {dosyaAdi || "Excel dosyası seçilmedi"}
        </b>
        <small>Sütunlar: KartNo, Puan. İlk sayfa okunur; başlık satırı gereklidir.</small>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="bk-d kucuk" onClick={sablon}>
            <Download size={14} /> Şablonu indir
          </button>
          <button className="bk-d kucuk birincil" onClick={() => girdi.current?.click()} disabled={calisiyor}>
            <Upload size={14} /> Dosya seç
          </button>
        </div>
        <input
          ref={girdi}
          type="file"
          accept=".xlsx,.xls,.csv"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) oku(f);
            e.target.value = "";
          }}
        />
      </div>

      {kontrol && (
        <>
          <div className="bkp-toplam">
            <span>
              <b>{hazirlar.length}</b> satır hazır
            </span>
            {sorunlu.length > 0 && (
              <span className="bkp-uy">
                <b>{sorunlu.length}</b> satır atlanacak
              </span>
            )}
            <span>
              Toplam <b>{sayi(kontrol.toplam)}</b> puan
            </span>
          </div>

          <div className="bkp-tabloKap" style={{ maxHeight: 260 }}>
            <table className="bk-tablo bkp-tablo">
              <thead>
                <tr>
                  <th>Kart no</th>
                  <th>Kimde</th>
                  <th className="bk-sag">Puan</th>
                  <th>Durum</th>
                </tr>
              </thead>
              <tbody>
                {[...sorunlu, ...hazirlar].map((x: any) => (
                  <tr key={x.sira}>
                    <td className="bk-no">{no4(x.kartNo) || "—"}</td>
                    <td>{x.adSoyad ?? "—"}</td>
                    <td className="bk-sag">{Number.isFinite(x.puan) ? sayi(x.puan) : "—"}</td>
                    <td>
                      <span className={`bk-rozet ${durumAdi[x.durum]?.[1] ?? ""}`}>{durumAdi[x.durum]?.[0] ?? x.durum}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bkp-iki">
            <div>
              <label className="bkp-etiket">Açıklama (onayda görünür)</label>
              <input value={aciklama} onChange={(e) => setAciklama(e.target.value)} placeholder="Örnek: Eylül ayı başarı ödülü" />
            </div>
            <div>
              <label className="bkp-etiket">Son kullanma tarihi</label>
              <input type="date" value={son} onChange={(e) => setSon(e.target.value)} />
            </div>
          </div>

          <button className="bk-d birincil bkp-tam" onClick={gonder} disabled={calisiyor || hazirlar.length === 0}>
            {hazirlar.length} kart · {sayi(kontrol.toplam)} puan onaya gönder
          </button>
        </>
      )}
      <p className="bkp-dip">
        Hatalı satırlar talebe girmez. Admin onaylayınca kartlara yüklenir; reddedilirse puan yatmaz.
      </p>
    </div>
  );
}

/* ========================================================================== */
/* Transfer                                                                   */
/* ========================================================================== */

function Transfer({ bitti }: { bitti: () => void }) {
  const [kaynak, setKaynak] = useState<KartBilgi | null>(null);
  const [hedef, setHedef] = useState<KartBilgi | null>(null);
  const [puan, setPuan] = useState("");
  const [tamami, setTamami] = useState(true);
  const [aciklama, setAciklama] = useState("");
  const [calisiyor, setCalisiyor] = useState(false);

  const tutar = tamami ? kaynak?.bakiye ?? 0 : puanOku(puan);

  /* Tutar kart bulunmadan yazıldıysa kart gelince bakiyeye indiriliyor */
  useEffect(() => {
    if (kaynak && !tamami && puan) setPuan((p) => bakiyeyleSinirla(p, kaynak.bakiye));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kaynak]);

  const yap = () => {
    if (!kaynak || !hedef) return message.warning("İki kartı da bulunuz.");
    if (kaynak.kartNo === hedef.kartNo) return message.warning("Kaynak ve hedef aynı kart olamaz.");
    if (!(tutar > 0)) return message.warning("Aktarılacak puan yok.");
    if (tutar > kaynak.bakiye) return message.warning("Kaynak kartın bakiyesinden fazlası aktarılamaz.");

    Modal.confirm({
      title: `${puanYaz(tutar)} puan aktarılsın mı?`,
      content: `${kaynak.adSoyad ?? no4(kaynak.kartNo)} → ${hedef.adSoyad ?? no4(hedef.kartNo)}. İşlem hemen yapılır.`,
      okText: "Aktar",
      cancelText: "Vazgeç",
      onOk: async () => {
        setCalisiyor(true);
        try {
          await api.gonder("/api/BicenKartPuan/Transfer", {
            kaynak: kaynak.kartNo,
            hedef: hedef.kartNo,
            puan: tutar,
            tamami,
            aciklama: aciklama.trim(),
          });
          message.success("Transfer yapıldı.");
          setKaynak(null);
          setHedef(null);
          setPuan("");
          setAciklama("");
          bitti();
        } catch (h: any) {
          message.error(h?.message ?? "Transfer yapılamadı.");
        } finally {
          setCalisiyor(false);
        }
      },
    });
  };

  return (
    <div className="bkp-form">
      <KartSec etiket="Bakiyesi aktarılacak kart" kart={kaynak} setKart={setKaynak} />
      <div className="bkp-okAsagi">
        <ArrowDown size={20} />
      </div>
      <KartSec etiket="Aktarılacak kart" kart={hedef} setKart={setHedef} />
      <div className="bkp-iki">
        <div>
          <label className="bkp-etiket">Aktarılacak puan</label>
          <input
            value={tamami ? String(kaynak?.bakiye ?? "") : puan}
            disabled={tamami}
            onChange={(e) => setPuan(bakiyeyleSinirla(e.target.value, kaynak?.bakiye))}
            inputMode="decimal"
          />
        </div>
        <div>
          <label className="bkp-etiket">&nbsp;</label>
          <label className="bkp-kutucuk">
            <input type="checkbox" checked={tamami} onChange={(e) => setTamami(e.target.checked)} /> Bakiyenin tamamı
          </label>
        </div>
      </div>
      <label className="bkp-etiket">Açıklama</label>
      <input value={aciklama} onChange={(e) => setAciklama(e.target.value)} placeholder="Örnek: Kart devri" />
      {kaynak && hedef && tutar > 0 && (
        <div className="bkp-sonuc">
          Sonra: {kaynak.adSoyad ?? no4(kaynak.kartNo)} <b>{puanYaz(kaynak.bakiye - tutar)}</b> ·{" "}
          {hedef.adSoyad ?? no4(hedef.kartNo)} <b>{puanYaz(hedef.bakiye + tutar)}</b>
        </div>
      )}
      <button className="bk-d birincil bkp-tam" onClick={yap} disabled={calisiyor}>
        {tutar > 0 ? `${puanYaz(tutar)} puanı aktar` : "Aktar"}
      </button>
    </div>
  );
}

/* ========================================================================== */
/* Bakiye silme                                                               */
/* ========================================================================== */

function Sil({ bitti }: { bitti: () => void }) {
  const [kart, setKart] = useState<KartBilgi | null>(null);
  const [puan, setPuan] = useState("");
  const [tamami, setTamami] = useState(true);
  const [sebep, setSebep] = useState("");
  const [calisiyor, setCalisiyor] = useState(false);

  const tutar = tamami ? kart?.bakiye ?? 0 : puanOku(puan);

  useEffect(() => {
    if (kart && !tamami && puan) setPuan((p) => bakiyeyleSinirla(p, kart.bakiye));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kart]);

  const yap = () => {
    if (!kart) return message.warning("Önce kartı bulunuz.");
    if (!(tutar > 0)) return message.warning("Silinecek puan yok.");
    if (tutar > kart.bakiye) return message.warning("Bakiyeden fazlası silinemez.");
    if (sebep.trim().length < 3) return message.warning("Silme sebebini yazınız.");

    Modal.confirm({
      title: `${puanYaz(tutar)} puan silinsin mi?`,
      content: `${kart.adSoyad ?? no4(kart.kartNo)} · işlem geri alınamaz.`,
      okText: "Sil",
      cancelText: "Vazgeç",
      okButtonProps: { danger: true },
      onOk: async () => {
        setCalisiyor(true);
        try {
          await api.gonder("/api/BicenKartPuan/Sil", { kartNo: kart.kartNo, puan: tutar, tamami, sebep: sebep.trim() });
          message.success("Bakiye silindi.");
          setKart(null);
          setPuan("");
          setSebep("");
          bitti();
        } catch (h: any) {
          message.error(h?.message ?? "Silinemedi.");
        } finally {
          setCalisiyor(false);
        }
      },
    });
  };

  return (
    <div className="bkp-form">
      <KartSec etiket="Kart" kart={kart} setKart={setKart} />
      <div className="bkp-iki">
        <div>
          <label className="bkp-etiket">Silinecek puan</label>
          <input
            value={tamami ? String(kart?.bakiye ?? "") : puan}
            disabled={tamami}
            onChange={(e) => setPuan(bakiyeyleSinirla(e.target.value, kart?.bakiye))}
            inputMode="decimal"
          />
        </div>
        <div>
          <label className="bkp-etiket">&nbsp;</label>
          <label className="bkp-kutucuk">
            <input type="checkbox" checked={tamami} onChange={(e) => setTamami(e.target.checked)} /> Bakiyenin tamamı
          </label>
        </div>
      </div>
      <label className="bkp-etiket">
        Sebep <span style={{ color: "var(--bk-kirmizi)" }}>*</span>
      </label>
      <input value={sebep} onChange={(e) => setSebep(e.target.value)} placeholder="Örnek: Hatalı yükleme düzeltmesi" />
      {kart && tutar > 0 && (
        <div className="bkp-sonuc bkp-kir">
          Silme sonrası bakiye <b>{puanYaz(kart.bakiye - tutar)}</b> · geri alınamaz
        </div>
      )}
      <button className="bk-d tehlikeDolu bkp-tam" onClick={yap} disabled={calisiyor}>
        {tutar > 0 ? `${puanYaz(tutar)} puanı sil` : "Sil"}
      </button>
    </div>
  );
}

/* ========================================================================== */
/* Kart ayrıntısı: panelden yapılan puan işlemleri                             */
/* ========================================================================== */

export function KartPuanIslemleri({ kartNo }: { kartNo: string }) {
  const [veri, setVeri] = useState<any>(null);

  useEffect(() => {
    setVeri(null);
    api
      .al<any>(`/api/BicenKartPuan/KartIslemleri?kartNo=${encodeURIComponent(kartNo)}`)
      .then(setVeri)
      .catch(() => setVeri({ islemler: [], bekleyen: [] }));
  }, [kartNo]);

  if (!veri) return <div style={{ color: "var(--bk-pasif)", fontSize: 13 }}>Yükleniyor…</div>;

  const satirlar: any[] = [
    ...(veri.bekleyen ?? []).map((b: any) => ({ ...b, tur: "bekliyor" })),
    ...(veri.islemler ?? []),
  ];

  if (satirlar.length === 0)
    return <div style={{ color: "var(--bk-pasif)", fontSize: 13 }}>Panelden yapılmış puan işlemi yok.</div>;

  return (
    <div className="bkp-tabloKap">
      <table className="bk-tablo bkp-tablo">
        <thead>
          <tr>
            <th>Tarih</th>
            <th>İşlem</th>
            <th className="bk-sag">Puan</th>
            <th>Yapan / açıklama</th>
          </tr>
        </thead>
        <tbody>
          {satirlar.map((x, i) => (
            <tr key={i}>
              <td style={{ whiteSpace: "nowrap" }}>{tarihSaat(x.tarih)}</td>
              <td>
                {x.tur === "bekliyor" ? (
                  <span className="bk-rozet bk-r-sari">onay bekliyor</span>
                ) : x.tur === "yukleme" ? (
                  <span className="bk-rozet bk-r-yesil">yükleme</span>
                ) : x.tur === "silme" ? (
                  <span className="bk-rozet bk-r-kirmizi">silme</span>
                ) : (
                  <span className="bk-rozet bkp-r-mavi">{x.yon === "geldi" ? "transfer geldi" : "transfer gitti"}</span>
                )}
              </td>
              <td className={`bk-sag ${x.eksi ? "bkp-eksi" : x.tur === "bekliyor" ? "" : "bkp-arti"}`}>
                {x.eksi ? "−" : x.tur === "bekliyor" ? "" : "+"}
                {sayi(x.puan)}
              </td>
              <td>
                {x.yapanAd ?? x.yapan}
                {x.karsiKisi ? ` · ${x.yon === "geldi" ? `${x.karsiKisi}'dan` : `${x.karsiKisi}'a`}` : ""}
                {x.aciklama ? ` · ${x.aciklama}` : ""}
                {x.onaylayan ? ` · onaylayan: ${x.onaylayan}` : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
