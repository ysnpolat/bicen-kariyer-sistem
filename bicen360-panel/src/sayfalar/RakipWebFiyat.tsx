/**
 * ---------------------------------------------------------------------------
 * Rakip Web Fiyatları ve Eşleştirme (09.10.2026)
 * ---------------------------------------------------------------------------
 * "rakip-web-fiyat" aracının Excel'i buraya yükleniyor. Web'deki ürün adı
 * bizim stok adımızdan farklı olduğu için her web ürünü bir kez stok
 * kartına eşleştiriliyor; sonraki yüklemelerde aynı ürün kendiliğinden
 * eşleşip Rakip Fiyat analizine (kaynak: web) düşüyor.
 *
 * Eşleştirme ekranı hızlı çalışmak için: soldan ürün seçilir, sağda en çok
 * benzeyen stok kartları çıkar; 1–5 tuşu öneriyi seçer, Y "bizde yok",
 * ↑/↓ ürünler arasında gezer.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Drawer, Popconfirm, Spin, message } from "antd";
import { Check, ExternalLink, Link2, Search, Upload, X } from "lucide-react";
import dayjs from "dayjs";

import { api } from "../api";
import { N0, N1, N2, RM } from "../RmGrafik";
import { Kart, Tablo, type Kopya, type Sutun } from "./RaporMerkezi";

interface Site {
  anahtar: string;
  site: string;
  bekleyen: number;
  eslesen: number;
  son: string;
}

interface Bekleyen {
  siteAnahtar: string;
  adAnahtar: string;
  site: string;
  ad: string;
  fiyat: number;
  eskiFiyat: number | null;
  link: string | null;
  okunma: string;
  adet: number;
  /* 12.10.2026: en iyi aday ve puanı (%) */
  adayKod?: string | null;
  adayAd?: string | null;
  adayPuan?: number | null;
  ikinciPuan?: number | null;
  adayHatasi?: string | null;
}

interface Stok {
  stokKodu: string;
  ad: string;
  fiyat: number | null;
  barkod: string | null;
  puan: number;
}

interface Eslesme {
  id: number;
  siteAnahtar: string;
  site: string | null;
  webAd: string;
  stokKodu: string | null;
  urunAdi: string | null;
  yok: boolean;
  eslestiren: string | null;
  olusturma: string;
  adet: number;
  sonWebFiyat: number | null;
  bizimFiyat: number | null;
  /* 12.10.2026: otomatik (benzerlikle) eşleşme ve puanı */
  adAnahtar?: string;
  otomatik?: boolean;
  puan?: number | null;
  sonWebEskiFiyat?: number | null;
  link?: string | null;
  okunma?: string | null;
}

interface Yukleme {
  id: number;
  dosyaAdi: string;
  yukleyen: string;
  satir: number;
  olusturma: string;
  eslesen: number;
  siteSayisi: number;
}

const tl = (v: number | null | undefined) => (v == null ? "—" : "₺" + N2.format(v));
const anahtar = (b: Bekleyen) => `${b.siteAnahtar}|${b.adAnahtar}`;

const FarkYazisi = ({ bizim, rakip }: { bizim: number | null; rakip: number | null }) => {
  if (bizim == null || rakip == null || !rakip) return <span className="rm-hap">—</span>;
  const y = ((bizim - rakip) / rakip) * 100;
  return (
    <span className={`rm-hap ${y > 0.05 ? "bad" : y < -0.05 ? "good" : "info"}`} title="bizim − rakip">
      {Math.abs(y) < 0.05 ? "eşit" : `${y > 0 ? "+" : "−"}%${N1.format(Math.abs(y))}`}
    </span>
  );
};

export default function RakipWebFiyat({ degisti }: { degisti?: () => void }) {
  const [gorunum, setGorunum] = useState<"bekleyen" | "eslesen" | "yukleme">("bekleyen");
  const [siteler, setSiteler] = useState<Site[]>([]);
  const [site, setSite] = useState<string>("");
  const [ara, setAra] = useState("");
  const [bekleyenler, setBekleyenler] = useState<Bekleyen[]>([]);
  const [eslesmeler, setEslesmeler] = useState<Eslesme[]>([]);
  const [yuklemeler, setYuklemeler] = useState<Yukleme[]>([]);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [yukleme, setYukleme] = useState(false);
  const [secili, setSecili] = useState<string | null>(null);
  /* Eşleşenler süzgeci ve düzeltilen eşleşme (12.10.2026) */
  const [tur, setTur] = useState<"" | "otomatik" | "elle" | "yok">("");
  const [duzelt, setDuzelt] = useState<Eslesme | null>(null);
  /* Arka plandaki otomatik eşleştirme (12.10.2026): istek beklemiyor,
     ilerleme 2 saniyede bir soruluyor */
  const [oto, setOto] = useState<{
    calisiyor: boolean; toplam: number; bakilan: number; eslesen: number; kayit: number; hata: string | null;
    esik?: number; adaysiz?: number; esikAlti?: number; enYuksekAlti?: number; belirsiz?: number; hataSayisi?: number; ilkHata?: string | null;
  } | null>(null);
  const [esik, setEsik] = useState(95);
  const [siralama, setSiralama] = useState<"ad" | "puan">("puan");
  const otoZaman = useRef<number | null>(null);
  const otoCalisiyor = !!oto?.calisiyor;
  const dosyaRef = useRef<HTMLInputElement>(null);
  const kopya: Kopya = useRef({});

  const sitelerGetir = useCallback(() => api.getir<Site[]>("RakipWeb/Siteler").then(setSiteler).catch(() => undefined), []);

  const getir = useCallback(async () => {
    setYukleniyor(true);
    try {
      const q = new URLSearchParams();
      if (site) q.set("site", site);
      if (ara.trim()) q.set("ara", ara.trim());
      if (gorunum === "bekleyen") {
        const l = await api.getir<Bekleyen[]>(`RakipWeb/Bekleyenler?${q}`);
        setBekleyenler(l);
        setSecili((s) => (s && l.some((x) => anahtar(x) === s) ? s : l[0] ? anahtar(l[0]) : null));
      } else if (gorunum === "eslesen") {
        if (tur) q.set("tur", tur);
        setEslesmeler(await api.getir<Eslesme[]>(`RakipWeb/Eslesmeler?${q}`));
      } else {
        setYuklemeler(await api.getir<Yukleme[]>("RakipWeb/Yuklemeler"));
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Okunamadı.");
    } finally {
      setYukleniyor(false);
    }
  }, [gorunum, site, ara, tur]);

  useEffect(() => {
    sitelerGetir();
  }, [sitelerGetir]);

  useEffect(() => {
    const t = setTimeout(getir, ara ? 300 : 0);
    return () => clearTimeout(t);
  }, [getir, ara]);

  const yukle = async (dosya: File) => {
    setYukleme(true);
    try {
      const form = new FormData();
      form.append("dosya", dosya);
      const c = await api.dosyaGonder<{ mesaj: string; arkaPlan?: boolean }>("RakipWeb/Yukle", form);
      message.success(c.mesaj, 6);
      if (c.arkaPlan) otoIzle();
      setGorunum("bekleyen");
      await Promise.all([sitelerGetir(), getir()]);
      degisti?.();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Yüklenemedi.");
    } finally {
      setYukleme(false);
      if (dosyaRef.current) dosyaRef.current.value = "";
    }
  };

  /* Eşleştirince listeden düşer, sıradaki seçilir */
  const eslestir = async (b: Bekleyen, stok: Stok | null) => {
    try {
      await api.gonder("RakipWeb/Eslestir", {
        siteAnahtar: b.siteAnahtar,
        adAnahtar: b.adAnahtar,
        stokKodu: stok?.stokKodu,
        yok: !stok,
      });
      message.success(stok ? `Eşleşti: ${stok.ad}` : "Bizde yok olarak işaretlendi; bir daha sorulmayacak.", 2);
      setBekleyenler((l) => {
        const i = l.findIndex((x) => anahtar(x) === anahtar(b));
        const yeni = l.filter((x) => anahtar(x) !== anahtar(b));
        setSecili(yeni[Math.min(i, yeni.length - 1)] ? anahtar(yeni[Math.min(i, yeni.length - 1)]) : null);
        return yeni;
      });
      sitelerGetir();
      degisti?.();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Eşleştirilemedi.");
    }
  };

  const otoIzle = useCallback(() => {
    if (otoZaman.current) return;
    const sor = async () => {
      try {
        const d = await api.getir<typeof oto & object>("RakipWeb/OtoEslestir/Durum");
        setOto(d);
        if (!d?.calisiyor) {
          if (otoZaman.current) window.clearInterval(otoZaman.current);
          otoZaman.current = null;
          if (d?.hata) message.error(`Otomatik eşleştirme yarıda kaldı: ${d.hata}`, 8);
          else if (d && d.toplam > 0) {
            /* Neden eşleşmediğinin dökümü */
            const parca = [
              d.esikAlti ? `${N0.format(d.esikAlti)} eşik altında (en yüksek %${N1.format(d.enYuksekAlti ?? 0)})` : "",
              d.belirsiz ? `${N0.format(d.belirsiz)} belirsiz (iki aday çok yakın)` : "",
              d.adaysiz ? `${N0.format(d.adaysiz)} adaysız (benzer stok adı yok)` : "",
              d.hataSayisi ? `${N0.format(d.hataSayisi)} hata: ${d.ilkHata ?? ""}` : "",
            ].filter(Boolean);
            const metin = `${N0.format(d.bakilan)} ürüne bakıldı; ${N0.format(d.eslesen)} tanesi %${N0.format(d.esik ?? 95)} ve üstü benzerlikle eşleşti.${parca.length ? " " + parca.join(" · ") + "." : ""}`;
            if (d.hataSayisi) message.error(metin, 12);
            else message.success(metin, 10);
          }
          await Promise.all([sitelerGetir(), getir()]);
          if (d?.eslesen) degisti?.();
        }
      } catch {
        /* geçici hata: sonraki turda yeniden sorulur */
      }
    };
    otoZaman.current = window.setInterval(sor, 2000);
    sor();
  }, [sitelerGetir, getir, degisti]);

  /* Sayfa açıldığında sürmekte olan bir eşleştirme varsa izlemeye başla */
  useEffect(() => {
    api
      .getir<{ calisiyor: boolean }>("RakipWeb/OtoEslestir/Durum")
      .then((d) => d?.calisiyor && otoIzle())
      .catch(() => undefined);
    return () => {
      if (otoZaman.current) window.clearInterval(otoZaman.current);
      otoZaman.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* %95 ve üstü benzerlikle otomatik eşleştirme (bekleyenlerin hepsine) */
  const otoEslestir = async () => {
    try {
      const c = await api.gonder<{ basladi: boolean }>(`RakipWeb/OtoEslestir?esik=${esik}`, {});
      if (!c?.basladi) message.info("Otomatik eşleştirme zaten sürüyor.");
      otoIzle();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Otomatik eşleştirme başlatılamadı.");
    }
  };

  /* Yanlış eşleşmeyi başka bir ürünle değiştirir (eski kayıtlar silinir,
     otomatik eşleşmenin kartı bir daha otomatik bağlanmaz) */
  const duzeltKaydet = async (e: Eslesme, stok: Stok | null) => {
    try {
      await api.gonder("RakipWeb/Eslestir", {
        siteAnahtar: e.siteAnahtar,
        adAnahtar: e.adAnahtar,
        stokKodu: stok?.stokKodu,
        yok: !stok,
      });
      message.success(stok ? `Eşleşme değişti: ${stok.ad}` : "Bizde yok olarak işaretlendi.", 2);
      setDuzelt(null);
      await getir();
      sitelerGetir();
      degisti?.();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Değiştirilemedi.");
    }
  };

  const eslesmeSil = async (e: Eslesme) => {
    try {
      await api.sil(`RakipWeb/Eslesme/${e.id}`);
      setEslesmeler((l) => l.filter((x) => x.id !== e.id));
      sitelerGetir();
      degisti?.();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Kaldırılamadı.");
    }
  };

  /* Yanlış okunmuş dosyayı geri almak için: eşleştirmeler kalır */
  const yuklemeSil = async (y: Yukleme) => {
    try {
      const c = await api.sil<{ rakipKaydi: number }>(`RakipWeb/Yukleme/${y.id}`);
      message.success(`Yükleme silindi; ${N0.format(c?.rakipKaydi ?? 0)} rakip fiyat kaydı kaldırıldı.`);
      setYuklemeler((l) => l.filter((x) => x.id !== y.id));
      sitelerGetir();
      degisti?.();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Silinemedi.");
    }
  };

  /* Tek tıkla en iyi adayı onayla */
  const adayiOnayla = (b: Bekleyen) =>
    b.adayKod &&
    eslestir(b, { stokKodu: b.adayKod, ad: b.adayAd ?? b.adayKod, fiyat: null, barkod: null, puan: (b.adayPuan ?? 0) / 100 });

  const siraliBekleyenler = useMemo(
    () =>
      siralama === "puan"
        ? [...bekleyenler].sort((a, b) => (b.adayPuan ?? -1) - (a.adayPuan ?? -1))
        : bekleyenler,
    [bekleyenler, siralama]
  );

  /* Puan dağılımı: eşiği seçmeye yardım eder */
  const dagilim = useMemo(() => {
    const d = { p95: 0, p90: 0, p85: 0, p80: 0, alt: 0, yok: 0 };
    for (const b of bekleyenler) {
      const p = b.adayPuan;
      if (p == null) d.yok++;
      else if (p >= 95) d.p95++;
      else if (p >= 90) d.p90++;
      else if (p >= 85) d.p85++;
      else if (p >= 80) d.p80++;
      else d.alt++;
    }
    return d;
  }, [bekleyenler]);
  const adayHatasi = bekleyenler.find((b) => b.adayHatasi)?.adayHatasi ?? null;

  const toplamBekleyen = siteler.reduce((t, s) => t + s.bekleyen, 0);
  const toplamEslesen = siteler.reduce((t, s) => t + s.eslesen, 0);
  const seciliUrun = bekleyenler.find((x) => anahtar(x) === secili) ?? null;

  const eslesmeSutun: Sutun<Eslesme>[] = [
    { k: "site", l: "Site", soluk: true, sv: (x) => x.site ?? "", f: (x) => x.site ?? x.siteAnahtar },
    { k: "webAd", l: "Web'deki ürün", f: (x) => <b>{x.webAd}</b> },
    {
      k: "urunAdi",
      l: "Bizim ürün",
      sv: (x) => x.urunAdi ?? "",
      f: (x) =>
        x.yok ? (
          <span className="rm-hap warn">bizde yok</span>
        ) : (
          <div>
            <div>{x.urunAdi}</div>
            <small style={{ color: RM.muted }}>{x.stokKodu}</small>
          </div>
        ),
      tx: (x) => (x.yok ? "bizde yok" : `${x.urunAdi} (${x.stokKodu})`),
    },
    { k: "sonWebFiyat", l: "Web fiyatı", num: true, sv: (x) => x.sonWebFiyat ?? 0, f: (x) => tl(x.sonWebFiyat) },
    { k: "bizimFiyat", l: "Bizim fiyat", num: true, sv: (x) => x.bizimFiyat ?? 0, f: (x) => tl(x.bizimFiyat) },
    {
      k: "fark",
      l: "Fark",
      num: true,
      sv: (x) => (x.bizimFiyat != null && x.sonWebFiyat ? (x.bizimFiyat - x.sonWebFiyat) / x.sonWebFiyat : -999),
      f: (x) => (x.yok ? "" : <FarkYazisi bizim={x.bizimFiyat} rakip={x.sonWebFiyat} />),
      tx: () => "",
    },
    { k: "adet", l: "Okunma", num: true },
    {
      k: "nasil",
      l: "Nasıl",
      sv: (x) => (x.otomatik ? `otomatik ${x.puan ?? ""}` : x.yok ? "bizde yok" : "elle"),
      f: (x) =>
        x.otomatik ? (
          <span className="rm-hap info" title="Ad benzerliğiyle otomatik eşleşti; yanlışsa Değiştir">
            otomatik{x.puan != null ? ` %${N1.format(x.puan)}` : ""}
          </span>
        ) : x.yok ? (
          <span className="rm-hap">—</span>
        ) : (
          <span className="rm-hap good">elle</span>
        ),
    },
    {
      k: "eslestiren",
      l: "Eşleştiren",
      soluk: true,
      sv: (x) => x.olusturma,
      f: (x) => (
        <span>
          {x.eslestiren ?? "—"}
          <div style={{ fontSize: 11 }}>{dayjs(x.olusturma).format("DD.MM.YY HH:mm")}</div>
        </span>
      ),
      tx: (x) => x.eslestiren ?? "",
    },
    {
      k: "islem",
      l: "",
      suzgecYok: true,
      f: (x) => (
        <span onClick={(e) => e.stopPropagation()} style={{ display: "inline-flex", gap: 6 }}>
          {x.adAnahtar && (
            <button className="rm-dugme yuvarlak" onClick={() => setDuzelt(x)}>
              Değiştir
            </button>
          )}
          <Popconfirm
            title="Eşleşme kaldırılsın mı?"
            description="Bu eşleşmeden oluşan rakip fiyat kayıtları da silinir; ürün yeniden eşleştirme bekler."
            okText="Kaldır"
            cancelText="Vazgeç"
            onConfirm={() => eslesmeSil(x)}
          >
            <button className="rm-dugme yuvarlak">
              <X size={12} /> Kaldır
            </button>
          </Popconfirm>
        </span>
      ),
      tx: () => "",
    },
  ];

  const yuklemeSutun: Sutun<Yukleme>[] = [
    { k: "olusturma", l: "Tarih", soluk: true, f: (x) => dayjs(x.olusturma).format("DD.MM.YYYY HH:mm") },
    { k: "dosyaAdi", l: "Dosya", f: (x) => <b>{x.dosyaAdi}</b> },
    { k: "siteSayisi", l: "Site", num: true },
    { k: "satir", l: "Ürün", num: true, f: (x) => N0.format(x.satir) },
    {
      k: "eslesen",
      l: "Eşleşen",
      num: true,
      f: (x) => (
        <span>
          {N0.format(x.eslesen)} <small style={{ color: RM.muted }}>%{N0.format(x.satir ? (x.eslesen / x.satir) * 100 : 0)}</small>
        </span>
      ),
    },
    { k: "yukleyen", l: "Yükleyen", soluk: true },
    {
      k: "islem",
      l: "",
      f: (x) => (
        <span onClick={(e) => e.stopPropagation()}>
          <Popconfirm
            title="Yükleme silinsin mi?"
            description="Bu dosyadaki web fiyatları ve rapordaki karşılıkları silinir. Eşleştirmeler kalır; düzeltilmiş dosyayı yüklediğinizde kendiliğinden eşleşir."
            okText="Sil"
            cancelText="Vazgeç"
            onConfirm={() => yuklemeSil(x)}
          >
            <button className="rm-dugme yuvarlak">
              <X size={12} /> Sil
            </button>
          </Popconfirm>
        </span>
      ),
      tx: () => "",
    },
  ];

  return (
    <>
      <div className="rm-suzgec">
        <div className="rm-alan">
          <label>Araç Excel'i</label>
          <button className="rm-dugme" style={{ height: 34, background: RM.brand, color: "#fff", borderColor: RM.brand }} disabled={yukleme} onClick={() => dosyaRef.current?.click()}>
            {yukleme ? <Spin size="small" /> : <Upload size={14} />} Excel yükle
          </button>
          <input
            ref={dosyaRef}
            type="file"
            accept=".xlsx"
            hidden
            onChange={(e) => e.target.files?.[0] && yukle(e.target.files[0])}
          />
        </div>
        <div className="rm-alan">
          <label htmlFor="rwEsik">Eşik</label>
          <select id="rwEsik" value={esik} onChange={(e) => setEsik(Number(e.target.value))} disabled={otoCalisiyor} style={{ width: 92 }}>
            {[95, 90, 85, 80].map((x) => (
              <option key={x} value={x}>
                %{x}
              </option>
            ))}
          </select>
        </div>
        <div className="rm-alan">
          <label>Otomatik</label>
          <button
            className="rm-dugme"
            style={{ height: 34 }}
            disabled={otoCalisiyor}
            onClick={otoEslestir}
            title="Bekleyen ürünleri ad benzerliğiyle eşleştirir: %95 ve üstü, net tek aday varsa"
          >
            {otoCalisiyor ? <Spin size="small" /> : <Check size={14} />}{" "}
            {otoCalisiyor
              ? oto && oto.toplam > 0
                ? `Eşleştiriliyor ${N0.format(oto.bakilan)} / ${N0.format(oto.toplam)} · ${N0.format(oto.eslesen)} eşleşti`
                : "Stok listesi hazırlanıyor…"
              : `%${esik} ve üstünü eşleştir`}
          </button>
        </div>
        <div className="rm-alan">
          <label htmlFor="rwSite">Site</label>
          <select id="rwSite" value={site} onChange={(e) => setSite(e.target.value)}>
            <option value="">Bütün siteler</option>
            {siteler.map((s) => (
              <option key={s.anahtar} value={s.anahtar}>
                {s.site} · {s.bekleyen} bekleyen
              </option>
            ))}
          </select>
        </div>
        <div className="rm-alan">
          <label htmlFor="rwAra">Ara</label>
          <input id="rwAra" type="search" placeholder="Ürün adı, stok kodu" value={ara} onChange={(e) => setAra(e.target.value)} />
        </div>
        <div className="rm-alan">
          <label>Görünüm</label>
          <span className="rm-dilim">
            {(
              [
                ["bekleyen", `Eşleşme bekleyen (${N0.format(toplamBekleyen)})`],
                ["eslesen", `Eşleşenler (${N0.format(toplamEslesen)})`],
                ["yukleme", "Yüklemeler"],
              ] as const
            ).map(([k, l]) => (
              <button key={k} aria-pressed={gorunum === k} onClick={() => setGorunum(k)}>
                {l}
              </button>
            ))}
          </span>
        </div>
      </div>

      {siteler.length === 0 && !yukleniyor ? (
        <div className="rm-kart c12" style={{ padding: 28, textAlign: "center" }}>
          <h3 style={{ justifyContent: "center" }}>
            <span>Henüz web fiyatı yüklenmedi</span>
          </h3>
          <div className="rm-ipucu-metin" style={{ maxWidth: 560, margin: "0 auto" }}>
            rakip-web-fiyat aracını çalıştırın, oluşan <code>sonuclar\rakip-web-fiyat-…xlsx</code> dosyasını
            "Excel yükle" ile buraya yükleyin. Her web ürününü bir kez bizim ürünümüzle eşleştirdiğinizde
            sonraki yüklemelerde kendiliğinden eşleşir ve Analiz sekmesine düşer.
          </div>
        </div>
      ) : gorunum === "bekleyen" ? (
        <div className="rm-izgara">
          <Kart
            sinif="c5"
            baslik={`Web ürünleri (${N0.format(bekleyenler.length)})`}
            ipucu="↑/↓ ile gezin"
          >
            {yukleniyor && bekleyenler.length === 0 ? (
              <div className="rm-bekle">
                <Spin size="small" />
              </div>
            ) : bekleyenler.length === 0 ? (
              <div className="rm-bos" style={{ height: 200 }}>
                Eşleşme bekleyen ürün yok.
              </div>
            ) : (
              <>
                {adayHatasi && (
                  <div style={{ fontSize: 12.5, color: RM.bad, background: "rgba(198,40,40,.07)", padding: "8px 10px", borderRadius: 8, marginBottom: 8 }}>
                    Adaylar okunamadı: {adayHatasi}
                  </div>
                )}
                <div className="rw-dagilim">
                  <span className="rm-hap good">%95+ · {dagilim.p95}</span>
                  <span className="rm-hap info">%90–95 · {dagilim.p90}</span>
                  <span className="rm-hap warn">%85–90 · {dagilim.p85}</span>
                  <span className="rm-hap warn">%80–85 · {dagilim.p80}</span>
                  <span className="rm-hap">%80 altı · {dagilim.alt}</span>
                  <span className="rm-hap">aday yok · {dagilim.yok}</span>
                  <span className="rm-dilim" style={{ marginLeft: "auto" }}>
                    <button aria-pressed={siralama === "puan"} onClick={() => setSiralama("puan")}>Puana göre</button>
                    <button aria-pressed={siralama === "ad"} onClick={() => setSiralama("ad")}>Ada göre</button>
                  </span>
                </div>
                <div className="rw-liste">
                  {siraliBekleyenler.map((b) => {
                    const p = b.adayPuan;
                    const sinif = p == null ? "" : p >= 95 ? "good" : p >= 90 ? "info" : p >= 80 ? "warn" : "";
                    return (
                      <div key={anahtar(b)} className={`rw-satir${anahtar(b) === secili ? " secili" : ""}`}>
                        <button className="rw-sec" onClick={() => setSecili(anahtar(b))}>
                          <span className="rw-ad">{b.ad}</span>
                          <span className="rw-alt">
                            {b.site}
                            {b.adet > 1 ? ` · ${b.adet} okunma` : ""} · <b style={{ color: RM.fg }}>{tl(b.fiyat)}</b>
                          </span>
                          <span className="rw-aday">
                            {b.adayAd ? (
                              <>
                                <span className={`rm-hap ${sinif}`}>%{N1.format(p ?? 0)}</span>
                                <span className="rw-aday-ad">{b.adayAd}</span>
                                {b.ikinciPuan != null && p != null && p - b.ikinciPuan < 3 ? (
                                  <span className="rm-hap" title="İkinci aday çok yakın">yakın aday %{N1.format(b.ikinciPuan)}</span>
                                ) : null}
                              </>
                            ) : (
                              <span style={{ color: RM.muted }}>benzer stok adı bulunamadı</span>
                            )}
                          </span>
                        </button>
                        {b.adayKod ? (
                          <button className="rm-dugme yuvarlak rw-onay" title={`Onayla: ${b.adayAd}`} onClick={() => adayiOnayla(b)}>
                            <Check size={12} /> Onayla
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </Kart>

          <Kart sinif="c7" baslik="Bizim ürünümüzle eşleştir" ipucu="1–5 öneriyi seçer, Y: bizde yok">
            {seciliUrun ? (
              <EslestirmePaneli
                key={secili}
                urun={seciliUrun}
                eslestir={(s) => eslestir(seciliUrun, s)}
                gez={(yon) => {
                  const i = siraliBekleyenler.findIndex((x) => anahtar(x) === secili);
                  const y = siraliBekleyenler[i + yon];
                  if (y) setSecili(anahtar(y));
                }}
              />
            ) : (
              <div className="rm-bos" style={{ height: 200 }}>
                Soldan bir ürün seçin.
              </div>
            )}
          </Kart>
        </div>
      ) : gorunum === "eslesen" ? (
        <div className="rm-izgara">
          <Kart
            sinif="c12"
            baslik="Eşleşmeler"
            ipucu="sonraki yüklemelerde bu ürünler kendiliğinden eşleşir"
            araclar={
              <span className="rm-dilim">
                {(
                  [
                    ["", "Tümü"],
                    ["otomatik", "Otomatik"],
                    ["elle", "Elle"],
                    ["yok", "Bizde yok"],
                  ] as const
                ).map(([k, l]) => (
                  <button key={k} aria-pressed={tur === k} onClick={() => setTur(k)}>
                    {l}
                  </button>
                ))}
              </span>
            }
          >
            {yukleniyor && eslesmeler.length === 0 ? (
              <div className="rm-bekle">
                <Spin size="small" />
              </div>
            ) : (
              <Tablo<Eslesme> id="eslesme" kopya={kopya} sutunlar={eslesmeSutun} satirlar={eslesmeler} limit={50} suzgec />
            )}
          </Kart>
        </div>
      ) : (
        <div className="rm-izgara">
          <Kart sinif="c12" baslik="Yüklemeler">
            <Tablo<Yukleme> id="yukleme" kopya={kopya} sutunlar={yuklemeSutun} satirlar={yuklemeler} limit={50} />
          </Kart>
        </div>
      )}

      <Drawer
        open={!!duzelt}
        onClose={() => setDuzelt(null)}
        width={720}
        title={duzelt ? `Eşleşmeyi değiştir · ${duzelt.webAd}` : ""}
        destroyOnClose
      >
        {duzelt && (
          <div className="rm" style={{ gap: 12 }}>
            <div style={{ fontSize: 13, color: RM.muted }}>
              Şu an:{" "}
              <b style={{ color: RM.fg }}>{duzelt.yok ? "bizde yok" : `${duzelt.urunAdi} (${duzelt.stokKodu})`}</b>
              {duzelt.otomatik && duzelt.puan != null ? ` · otomatik %${N1.format(duzelt.puan)}` : ""}
            </div>
            <EslestirmePaneli
              urun={{
                siteAnahtar: duzelt.siteAnahtar,
                adAnahtar: duzelt.adAnahtar ?? "",
                site: duzelt.site ?? duzelt.siteAnahtar,
                ad: duzelt.webAd,
                fiyat: duzelt.sonWebFiyat ?? 0,
                eskiFiyat: duzelt.sonWebEskiFiyat ?? null,
                link: duzelt.link ?? null,
                okunma: duzelt.okunma ?? duzelt.olusturma,
                adet: duzelt.adet,
              }}
              eslestir={(s) => duzeltKaydet(duzelt, s)}
              gez={() => undefined}
            />
          </div>
        )}
      </Drawer>

      <style>{`
        .rw-liste { display: flex; flex-direction: column; max-height: 620px; overflow-y: auto; margin: 0 -4px; }
        .rw-satir { display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 10px; align-items: center;
          padding: 8px 10px; border-radius: 8px; border-bottom: 1px solid var(--rm-line); }
        .rw-sec { all: unset; cursor: pointer; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
        .rw-sec:focus-visible { outline: 2px solid var(--rm-brand); border-radius: 6px; }
        .rw-aday { display: flex; gap: 6px; align-items: center; font-size: 12px; min-width: 0; margin-top: 2px; }
        .rw-aday-ad { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
        .rw-onay { white-space: nowrap; }
        .rw-dagilim { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 8px; }
        .rw-satir:hover { background: var(--rm-surface-2); }
        .rw-satir.secili { background: var(--rm-good-bg); box-shadow: inset 3px 0 0 var(--rm-brand); }
        .rw-ad { font-weight: 600; font-size: 13.5px; min-width: 0; }
        .rw-alt { grid-column: 1; font-size: 12px; color: var(--rm-muted); }
        .rw-panel { display: flex; flex-direction: column; gap: 12px; }
        .rw-urun { padding: 12px 14px; border-radius: 10px; background: var(--rm-surface-2); }
        .rw-urun b { font-size: 15px; }
        .rw-oneri { display: grid; grid-template-columns: 22px 1fr auto auto auto; gap: 10px; align-items: center;
          padding: 8px 10px; border: 1px solid var(--rm-line); border-radius: 9px; }
        .rw-oneri:hover { border-color: var(--rm-brand); }
        .rw-no { width: 22px; height: 22px; border-radius: 6px; display: grid; place-items: center; font-size: 12px;
          font-weight: 700; background: var(--rm-surface-2); color: var(--rm-muted); }
        .rw-puan { width: 54px; height: 6px; border-radius: 3px; background: var(--rm-line); overflow: hidden; }
        .rw-puan i { display: block; height: 100%; background: var(--rm-brand); }
        .rw-ara { display: flex; gap: 8px; align-items: center; }
        .rw-ara input { flex: 1; height: 34px; border: 1px solid var(--rm-line); border-radius: 8px; padding: 0 10px; }
        @media (max-width: 760px) { .rw-oneri { grid-template-columns: 22px 1fr auto; } .rw-oneri .rw-gizle { display: none; } }
      `}</style>
    </>
  );
}

/* ========================================================================== */

function EslestirmePaneli({
  urun,
  eslestir,
  gez,
}: {
  urun: Bekleyen;
  eslestir: (s: Stok | null) => void;
  gez: (yon: number) => void;
}) {
  const [oneriler, setOneriler] = useState<Stok[] | null>(null);
  const [aranan, setAranan] = useState("");
  const [sonuclar, setSonuclar] = useState<Stok[] | null>(null);
  const [araniyor, setAraniyor] = useState(false);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  /* Arama hatası ekranda yazıyor; eskiden yutuluyor ve "0 sonuç" görünüyordu */
  const [aramaHatasi, setAramaHatasi] = useState<string | null>(null);

  useEffect(() => {
    let iptal = false;
    setAramaHatasi(null);
    api
      .getir<Stok[]>(`RakipWeb/Oneri?ad=${encodeURIComponent(urun.ad)}`)
      .then((l) => !iptal && setOneriler(l ?? []))
      .catch((h) => {
        if (iptal) return;
        setOneriler([]);
        setAramaHatasi(h instanceof Error ? h.message : "Öneriler alınamadı.");
      });
    return () => {
      iptal = true;
    };
  }, [urun.ad]);

  const stokAra = async () => {
    if (aranan.trim().length < 2) return;
    setAraniyor(true);
    setAramaHatasi(null);
    try {
      setSonuclar((await api.getir<Stok[]>(`RakipWeb/StokAra?q=${encodeURIComponent(aranan.trim())}`)) ?? []);
    } catch (h) {
      setSonuclar([]);
      setAramaHatasi(h instanceof Error ? h.message : "Arama yapılamadı.");
    } finally {
      setAraniyor(false);
    }
  };

  const sec = async (s: Stok | null) => {
    if (kaydediliyor) return;
    setKaydediliyor(true);
    await eslestir(s);
    setKaydediliyor(false);
  };

  const gosterilen = useMemo(() => (sonuclar ?? oneriler ?? []).slice(0, sonuclar ? 40 : 8), [sonuclar, oneriler]);

  /* Klavye: 1–5 öneri, Y bizde yok, ↑/↓ gezin (arama kutusunda değilken) */
  useEffect(() => {
    const tus = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "SELECT") return;
      if (/^[1-9]$/.test(e.key)) {
        const s = gosterilen[Number(e.key) - 1];
        if (s) {
          e.preventDefault();
          sec(s);
        }
      } else if (e.key === "y" || e.key === "Y") {
        e.preventDefault();
        sec(null);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        gez(1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        gez(-1);
      }
    };
    window.addEventListener("keydown", tus);
    return () => window.removeEventListener("keydown", tus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gosterilen, kaydediliyor]);

  return (
    <div className="rw-panel">
      <div className="rw-urun">
        <div style={{ fontSize: 12, color: RM.muted }}>{urun.site} · web'deki ad</div>
        <b>{urun.ad}</b>
        <div style={{ display: "flex", gap: 14, marginTop: 4, flexWrap: "wrap", alignItems: "center" }}>
          <span>
            Fiyat <b>{tl(urun.fiyat)}</b>
            {urun.eskiFiyat ? <s style={{ color: RM.muted, marginLeft: 6 }}>{tl(urun.eskiFiyat)}</s> : null}
          </span>
          <span style={{ color: RM.muted, fontSize: 12 }}>{dayjs(urun.okunma).format("DD.MM.YYYY HH:mm")}</span>
          {urun.link && (
            <a href={urun.link} target="_blank" rel="noreferrer" style={{ fontSize: 12, display: "inline-flex", gap: 4, alignItems: "center" }}>
              <ExternalLink size={12} /> Sitede aç
            </a>
          )}
        </div>
      </div>

      <div className="rw-ara">
        <Search size={15} color={RM.muted} />
        <input
          placeholder="Önerilerde yoksa ara: ürün adı, stok kodu ya da barkod · Enter"
          value={aranan}
          onChange={(e) => {
            setAranan(e.target.value);
            if (!e.target.value) setSonuclar(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && stokAra()}
        />
        {araniyor && <Spin size="small" />}
      </div>

      <div style={{ fontSize: 12, fontWeight: 600, color: RM.muted, textTransform: "uppercase", letterSpacing: ".05em" }}>
        {sonuclar ? `Arama sonuçları (${sonuclar.length})` : "En çok benzeyen ürünlerimiz"}
      </div>

      {aramaHatasi && (
        <div style={{ fontSize: 12.5, color: RM.bad, background: "rgba(198,40,40,.07)", padding: "8px 10px", borderRadius: 8 }}>
          {aramaHatasi}
        </div>
      )}

      {oneriler === null && !sonuclar ? (
        <div className="rm-bekle">
          <Spin size="small" /> &nbsp;Mikro'da benzer ürünler aranıyor…
        </div>
      ) : gosterilen.length === 0 ? (
        <div className="rm-bos" style={{ height: 90 }}>
          {sonuclar ? "Aramaya uyan stok kartı yok." : "Benzer ürün bulunamadı; yukarıdan arayın."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {gosterilen.map((s, i) => (
            <div key={s.stokKodu} className="rw-oneri">
              <span className="rw-no">{i < 9 ? i + 1 : ""}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{s.ad}</div>
                <small style={{ color: RM.muted }}>
                  {s.stokKodu}
                  {s.barkod ? ` · ${s.barkod}` : ""}
                </small>
              </div>
              <span className="rw-gizle" style={{ textAlign: "right" }}>
                <b>{tl(s.fiyat)}</b>
                <div>
                  <FarkYazisi bizim={s.fiyat} rakip={urun.fiyat} />
                </div>
              </span>
              {!sonuclar ? (
                <span className="rw-puan rw-gizle" title={`Benzerlik %${N0.format(s.puan * 100)}`}>
                  <i style={{ width: `${s.puan * 100}%` }} />
                </span>
              ) : (
                <span className="rw-gizle" />
              )}
              <button className="rm-dugme yuvarlak" disabled={kaydediliyor} onClick={() => sec(s)}>
                <Link2 size={12} /> Eşleştir
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
        <span className="rm-ipucu-metin">Eşleştirme bu sitedeki aynı ürün için bundan sonra kendiliğinden yapılır.</span>
        <button className="rm-dugme" disabled={kaydediliyor} onClick={() => sec(null)}>
          <Check size={13} /> Bizde yok (Y)
        </button>
      </div>
    </div>
  );
}
