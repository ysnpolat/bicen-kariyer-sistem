/**
 * ---------------------------------------------------------------------------
 * Biçen Kart · kişiye özel kart bağlantısı (#/kart/KOD)
 * ---------------------------------------------------------------------------
 * Personele SMS ile gönderilen kişiye özel sayfa: işten ayrılan (uygulamaya
 * artık giremeyen) ya da hâlâ çalışan personel kartını ve bakiyesini buradan
 * görüp kasada kullanıyor. Sayfadaki metinler iki durumda da aynı; "ayrılan"
 * sözü sayfada geçmez.
 *
 *  1. İlk açılış: ilk ad, bakiye ve kartın son dört hanesi. Kart numarası
 *     sunucudan hiç gelmiyor.
 *  2. TC kimlik numarası ile doğrulama (11 hane).
 *  3. Kart şifresi belirleme (4 hane, iki kez). Kasada ödeme onayında bu
 *     şifre soruluyor.
 *  4. Kart: tam numara, Code 128 barkod (ödeme kart şifresiyle),
 *     bakiye, son geçerlilik, son hareketler, kart görselini indirme.
 *
 * Cihaz hatırlanıyor: doğrulamadan sonra sunucunun verdiği belirteç
 * localStorage'da (ve sunucunun yazdığı çerezde) tutuluyor; bağlantı aynı
 * cihazda yeniden açılınca kart doğrudan geliyor. Yeni cihazda yalnızca TC
 * soruluyor, şifre yeniden istenmiyor.
 *
 * Bakiye bittiğinde ya da süre dolduğunda numara ve barkod gösterilmiyor;
 * bunu sunucu denetliyor, sayfa yalnızca gelen durumu çiziyor.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AYARLAR } from "./sabitler";
import { barkodCubuklari, barkodGenislikleri } from "./barkod";

interface Props {
  kod: string;
}

type Durum =
  | "dogrulama"
  | "sifre"
  | "kart"
  | "tamamlandi"
  | "suresiDoldu"
  | "iptal"
  | "kullanilamaz"
  | "kilitli";

interface Hareket {
  tarih: string;
  subeAdi: string | null;
  aciklama: string;
  tutar: number;
}

interface Veri {
  durum: Durum;
  ad?: string;
  bakiye?: number;
  kartSon4?: string;
  sonGecerlilik?: string;
  kalanGun?: number;
  toplamGun?: number;
  kalanDeneme?: number;
  kilitBitis?: string | null;
  yenidenBelirle?: boolean;
  sifreVar?: boolean;
  adSoyad?: string;
  kartNo?: string;
  mobil?: boolean;
  hareketler?: Hareket[];
  tazeDogrulama?: boolean;
}

type Ekran = "yukleniyor" | "dogrulama" | "sifre" | "kart" | "son" | "hata";

/* -------------------------------------------------------------- yardımcılar */

const tl = (d?: number | null) =>
  (d ?? 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₺";

const tarihYaz = (t?: string | null) =>
  t ? new Date(t).toLocaleDateString("tr-TR", { day: "2-digit", month: "long", year: "numeric" }) : "";

const kisaTarih = (t?: string | null) =>
  t
    ? new Date(t).toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit" }) +
      " " +
      new Date(t).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })
    : "";

/** 6034123412342217 → 6034 1234 1234 2217 */
const dortlu = (n?: string | null) => (n ?? "").replace(/(\d{4})(?=\d)/g, "$1 ");

const maskeli = (son4?: string | null) => `•••• •••• •••• ${son4 ?? "••••"}`;

const rakam = (s: string, n: number) => s.replace(/\D/g, "").slice(0, n);

/* Cihaz belirteci: sunucu ayrıca HttpOnly çerez yazıyor; ikisinden biri
   yeterli. Gizli sekmede localStorage açılmayabiliyor. */
const anahtar = (kod: string) => `bicen_kart_cihaz_${kod}`;

const cihazOku = (kod: string) => {
  try {
    return localStorage.getItem(anahtar(kod)) ?? "";
  } catch {
    return "";
  }
};

const cihazYaz = (kod: string, deger: string | null) => {
  try {
    if (deger) localStorage.setItem(anahtar(kod), deger);
    else localStorage.removeItem(anahtar(kod));
  } catch {
    /* depolama kapalı: çerez yeterli */
  }
};

interface Yanit {
  durum: number;
  veri: any;
}

const istek = async (kod: string, yol: string, govde?: unknown): Promise<Yanit> => {
  const cihaz = cihazOku(kod);
  const basliklar: Record<string, string> = { Accept: "application/json" };

  if (cihaz) basliklar["X-Kart-Cihaz"] = cihaz;
  if (govde !== undefined) basliklar["Content-Type"] = "application/json";

  const cevap = await fetch(`${AYARLAR.apiTaban}/api/KartLink/${kod}${yol}`, {
    method: govde === undefined ? "GET" : "POST",
    headers: basliklar,
    body: govde === undefined ? undefined : JSON.stringify(govde),
    cache: "no-store",
    credentials: "same-origin",
  });

  let veri: any = null;

  try {
    veri = await cevap.json();
  } catch {
    veri = null;
  }

  return { durum: cevap.status, veri };
};

/* ------------------------------------------------------------ kart görseli */

const KART_RENK = ["#ff8a3a", "#f15a22", "#bf3a0d"];

const logoAdresi = () => new URL("kart-logo.png", document.baseURI).toString();

const resimYukle = (adres: string) =>
  new Promise<HTMLImageElement | null>((coz) => {
    const r = new Image();
    r.onload = () => coz(r);
    r.onerror = () => coz(null);
    r.src = adres;
  });

const yuvarlakDortgen = (
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  en: number,
  boy: number,
  r: number
) => {
  c.beginPath();
  c.moveTo(x + r, y);
  c.lineTo(x + en - r, y);
  c.quadraticCurveTo(x + en, y, x + en, y + r);
  c.lineTo(x + en, y + boy - r);
  c.quadraticCurveTo(x + en, y + boy, x + en - r, y + boy);
  c.lineTo(x + r, y + boy);
  c.quadraticCurveTo(x, y + boy, x, y + boy - r);
  c.lineTo(x, y + r);
  c.quadraticCurveTo(x, y, x + r, y);
  c.closePath();
};

/**
 * Kart yüzünün PNG'si: ad, numara ve barkod. Tarayıcıda tuvalde
 * çiziliyor; sunucuya kart numarası gidip gelmiyor. Bakiye ve günlük kod
 * görselde yok: ikisi de değişiyor, eski bir görsel yanıltırdı.
 */
const kartGorseli = async (adSoyad: string, kartNo: string): Promise<Blob | null> => {
  const EN = 1200;
  const BOY = 760;
  const tuval = document.createElement("canvas");

  tuval.width = EN;
  tuval.height = BOY;

  const c = tuval.getContext("2d");

  if (!c) return null;

  /* Zemin: mobil uygulamadaki kartla aynı turuncu geçiş ve kavisler */
  const zemin = c.createLinearGradient(0, 0, EN, BOY);
  zemin.addColorStop(0, KART_RENK[0]);
  zemin.addColorStop(0.45, KART_RENK[1]);
  zemin.addColorStop(1, KART_RENK[2]);

  yuvarlakDortgen(c, 0, 0, EN, BOY, 48);
  c.fillStyle = zemin;
  c.fill();
  c.save();
  c.clip();

  c.lineWidth = BOY * 0.14;
  c.strokeStyle = "rgba(255,255,255,0.10)";
  c.beginPath();
  c.moveTo(-EN * 0.1, BOY * 0.66);
  c.bezierCurveTo(EN * 0.28, BOY * 0.34, EN * 0.6, BOY * 1.02, EN * 1.1, BOY * 0.42);
  c.stroke();

  c.fillStyle = "rgba(255,255,255,0.07)";
  c.beginPath();
  c.arc(EN * 0.96, -BOY * 0.08, BOY * 0.42, 0, Math.PI * 2);
  c.fill();

  const parlak = c.createLinearGradient(0, 0, EN * 0.5, BOY * 0.8);
  parlak.addColorStop(0, "rgba(255,255,255,0.24)");
  parlak.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = parlak;
  c.beginPath();
  c.moveTo(0, 0);
  c.lineTo(EN * 0.62, 0);
  c.lineTo(0, BOY * 0.8);
  c.closePath();
  c.fill();
  c.restore();

  /* Logo */
  const logo = await resimYukle(logoAdresi());

  if (logo) {
    const lb = 74;
    c.drawImage(logo, 64, 52, (logo.width / logo.height) * lb, lb);
  } else {
    c.fillStyle = "#fff";
    c.font = "800 64px 'Segoe UI', Roboto, Arial, sans-serif";
    c.fillText("biçen", 64, 112);
  }

  c.fillStyle = "rgba(255,255,255,0.92)";
  c.font = "700 26px 'Segoe UI', Roboto, Arial, sans-serif";
  c.textAlign = "right";
  c.fillText("BİÇEN KART", EN - 64, 90);

  /* Çip */
  const cipX = EN - 64 - 92;
  yuvarlakDortgen(c, cipX, 120, 92, 68, 12);
  const cip = c.createLinearGradient(cipX, 120, cipX + 92, 188);
  cip.addColorStop(0, "#ffe6a6");
  cip.addColorStop(1, "#d9a441");
  c.fillStyle = cip;
  c.fill();
  c.strokeStyle = "rgba(120,80,10,0.35)";
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(cipX, 154);
  c.lineTo(cipX + 92, 154);
  c.moveTo(cipX + 46, 120);
  c.lineTo(cipX + 46, 188);
  c.stroke();

  /* Numara */
  c.textAlign = "left";
  c.fillStyle = "#fff";
  c.shadowColor = "rgba(0,0,0,0.28)";
  c.shadowOffsetY = 3;
  c.shadowBlur = 4;
  c.font = "700 68px Consolas, 'SF Mono', Menlo, 'Courier New', monospace";
  c.fillText(dortlu(kartNo), 64, 290);
  c.shadowColor = "transparent";

  /* Sahibi */
  c.fillStyle = "rgba(255,255,255,0.78)";
  c.font = "700 22px 'Segoe UI', Roboto, Arial, sans-serif";
  c.fillText("KART SAHİBİ", 64, 352);
  c.fillStyle = "#fff";
  c.font = "700 40px 'Segoe UI', Roboto, Arial, sans-serif";
  c.fillText((adSoyad ?? "").toLocaleUpperCase("tr-TR").slice(0, 34), 64, 400);

  /* Barkod şeridi: beyaz zeminde, kasadaki okuyucu için */
  const sx = 48;
  const sy = 452;
  const sEn = EN - 96;
  const sBoy = 260;

  yuvarlakDortgen(c, sx, sy, sEn, sBoy, 24);
  c.fillStyle = "#fff";
  c.fill();

  const moduller = barkodGenislikleri(kartNo).reduce((t, x) => t + x, 0) + 20;
  const modul = Math.max(2, Math.floor((sEn - 40) / moduller));
  const bEn = moduller * modul;
  const bx = sx + Math.round((sEn - bEn) / 2);

  c.fillStyle = "#111";

  for (const cb of barkodCubuklari(kartNo, bEn)) {
    c.fillRect(bx + Math.round(cb.x), sy + 28, Math.round(cb.en), 170);
  }

  c.fillStyle = "#1d2126";
  c.textAlign = "center";
  c.font = "600 30px Consolas, 'SF Mono', Menlo, 'Courier New', monospace";
  c.fillText(dortlu(kartNo), EN / 2, sy + 238);

  return new Promise((coz) => tuval.toBlob((b) => coz(b), "image/png"));
};

/* ------------------------------------------------------------ bileşenler */

function KartYuzu({
  ad,
  numara,
  bakiye,
  acik,
}: {
  ad: string;
  numara: string;
  bakiye?: number;
  acik: boolean;
}) {
  return (
    <div className={`kb-kartYuzu${acik ? " acik" : ""}`}>
      <div className="kb-ky-ust">
        <img className="kb-ky-logo" src="kart-logo.png" alt="Biçen" />
        <div className="kb-ky-sag">
          <span>BİÇEN KART</span>
          <i className="kb-ky-cip" />
        </div>
      </div>

      <div className="kb-ky-no" aria-label={acik ? "Kart numarası" : "Kart numarası gizli"}>
        {numara}
      </div>

      <div className="kb-ky-alt">
        <div style={{ minWidth: 0 }}>
          <small>KART SAHİBİ</small>
          <b>{ad}</b>
        </div>
        {bakiye !== undefined && (
          <div className="kb-ky-bakiye">
            <small>BAKİYE</small>
            <b>{tl(bakiye)}</b>
          </div>
        )}
      </div>
    </div>
  );
}

function Barkod({ deger }: { deger: string }) {
  const kapRef = useRef<HTMLDivElement>(null);
  const [en, setEn] = useState(320);

  useEffect(() => {
    const olc = () => setEn(kapRef.current?.clientWidth ?? 320);
    olc();
    window.addEventListener("resize", olc);
    return () => window.removeEventListener("resize", olc);
  }, []);

  /* Modül tam piksel: kesirli genişlik ekranda bulanık çubuk ve okunmayan
     barkod demek. */
  const moduller = barkodGenislikleri(deger).reduce((t, x) => t + x, 0) + 20;
  const modul = Math.max(1, Math.min(4, Math.floor(en / moduller)));
  const genislik = moduller * modul;
  const cubuklar = barkodCubuklari(deger, genislik);

  return (
    <div ref={kapRef} className="kb-barkodKap">
      <svg
        width={genislik}
        height={96}
        viewBox={`0 0 ${genislik} 96`}
        shapeRendering="crispEdges"
        role="img"
        aria-label={`Barkod ${deger}`}
      >
        <rect width={genislik} height={96} fill="#fff" />
        {cubuklar.map((c, i) => (
          <rect key={i} x={Math.round(c.x)} y={0} width={Math.round(c.en)} height={96} fill="#111" />
        ))}
      </svg>
    </div>
  );
}

function Adimlar({ adim }: { adim: 1 | 2 | 3 }) {
  const adlar = ["Kimlik", "Şifre", "Kart"];

  return (
    <ol className="kb-adimlar" aria-label="Adımlar">
      {adlar.map((a, i) => (
        <li key={a} className={i + 1 < adim ? "bitti" : i + 1 === adim ? "simdi" : ""}>
          <span>{i + 1 < adim ? "✓" : i + 1}</span>
          {a}
        </li>
      ))}
    </ol>
  );
}

function Ust() {
  return (
    <header className="kb-ust">
      <span className="kb-marka">
        <i>b</i>
        Biçen Kart
      </span>
      <span className="kb-guvenli">🔒 Size özel bağlantı</span>
    </header>
  );
}

/* ================================================================ sayfa */

export default function KartBaglantisi({ kod }: Props) {
  const [ekran, setEkran] = useState<Ekran>("yukleniyor");
  const [veri, setVeri] = useState<Veri | null>(null);
  const [hata, setHata] = useState("");
  const [bilgi, setBilgi] = useState("");
  const [mod, setMod] = useState<"ilk" | "degistir">("ilk");

  const [tc, setTc] = useState("");
  const [sifre, setSifre] = useState("");
  const [sifre2, setSifre2] = useState("");
  const [isleniyor, setIsleniyor] = useState(false);
  const [indiriliyor, setIndiriliyor] = useState(false);

  const yukle = useCallback(async () => {
    if (!kod) {
      setEkran("hata");
      setHata("Bağlantı kodu okunamadı. SMS'teki adresi eksiksiz açtığınızdan emin olunuz.");
      return;
    }

    try {
      const { durum, veri: v } = await istek(kod, "");

      if (durum !== 200 || !v?.durum) {
        setEkran("hata");
        setHata(v?.hata ?? "Bağlantı açılamadı.");
        return;
      }

      setVeri(v);
      setHata("");

      if (v.durum === "dogrulama") setEkran("dogrulama");
      else if (v.durum === "sifre") setEkran("sifre");
      else if (v.durum === "kart") setEkran("kart");
      else setEkran("son");
    } catch {
      setEkran("hata");
      setHata("Sunucuya bağlanılamadı. İnternet bağlantınızı kontrol edip sayfayı yenileyiniz.");
    }
  }, [kod]);

  useEffect(() => {
    yukle();
  }, [yukle]);

  /* Ekran değişince başa: mobilde form ortada kalıyordu */
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [ekran]);

  const engelliYanit = (v: any) => {
    if (v?.durum && ["iptal", "kullanilamaz", "suresiDoldu", "kilitli", "tamamlandi"].includes(v.durum)) {
      setVeri(v);
      setEkran("son");
      return true;
    }

    return false;
  };

  /* --------------------------------------------------------- doğrulama */
  const dogrula = async () => {
    setHata("");

    if (tc.length !== 11) {
      setHata("TC kimlik numaranızı 11 hane olarak yazınız.");
      return;
    }

    setIsleniyor(true);

    try {
      const { durum, veri: v } = await istek(kod, "/Dogrula", { tc });

      if (durum === 200 && v?.tamam) {
        if (v.cihaz) cihazYaz(kod, v.cihaz);
        setTc("");

        if (mod === "degistir") {
          setSifre("");
          setSifre2("");
          setEkran("sifre");
        } else {
          await yukle();
        }

        return;
      }

      if (engelliYanit(v)) return;

      if (durum === 423) {
        await yukle();
        return;
      }

      setHata(v?.hata ?? "Doğrulama yapılamadı.");

      if (typeof v?.kalanDeneme === "number" && veri)
        setVeri({ ...veri, kalanDeneme: v.kalanDeneme });
    } catch {
      setHata("Sunucuya bağlanılamadı. Lütfen tekrar deneyiniz.");
    } finally {
      setIsleniyor(false);
    }
  };

  /* ------------------------------------------------------------- şifre */
  const sifreKaydet = async () => {
    setHata("");

    if (sifre.length !== 4) {
      setHata("Şifre 4 haneli olmalıdır.");
      return;
    }

    if (sifre !== sifre2) {
      setHata("Girdiğiniz iki şifre aynı değil.");
      return;
    }

    setIsleniyor(true);

    try {
      const { durum, veri: v } = await istek(kod, "/Sifre", { sifre, sifreTekrar: sifre2 });

      if (durum === 200 && v?.tamam) {
        setSifre("");
        setSifre2("");
        setMod("ilk");
        setBilgi(mod === "degistir" ? "Kart şifreniz değiştirildi." : "Kart şifreniz kaydedildi. Kartınız kullanıma hazır.");
        await yukle();
        return;
      }

      if (engelliYanit(v)) return;

      if (durum === 403 && v?.tcGerekli) {
        setMod("degistir");
        setEkran("dogrulama");
        setHata(v.hata);
        return;
      }

      if (durum === 401) {
        cihazYaz(kod, null);
        await yukle();
        return;
      }

      setHata(v?.hata ?? "Şifre kaydedilemedi.");
    } catch {
      setHata("Sunucuya bağlanılamadı. Lütfen tekrar deneyiniz.");
    } finally {
      setIsleniyor(false);
    }
  };

  /* ------------------------------------------------------------ indirme */
  const indir = async () => {
    if (!veri?.kartNo) return;

    setIndiriliyor(true);

    try {
      const blob = await kartGorseli(veri.adSoyad ?? veri.ad ?? "", veri.kartNo);

      if (!blob) throw new Error();

      const adres = URL.createObjectURL(blob);
      const a = document.createElement("a");

      a.href = adres;
      a.download = `bicen-kart-${veri.kartSon4 ?? "kart"}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();

      setTimeout(() => URL.revokeObjectURL(adres), 4000);

      istek(kod, "/Indirildi", {}).catch(() => undefined);
    } catch {
      setHata("Görsel oluşturulamadı. Ekran görüntüsü alarak da kaydedebilirsiniz.");
    } finally {
      setIndiriliyor(false);
    }
  };

  const sifreDegistir = () => {
    setHata("");
    setBilgi("");
    setMod("degistir");
    setSifre("");
    setSifre2("");
    setEkran(veri?.tazeDogrulama ? "sifre" : "dogrulama");
  };

  const cihazdanCik = async () => {
    try {
      await istek(kod, "/Cikis", {});
    } catch {
      /* yerelde yine silinir */
    }

    cihazYaz(kod, null);
    setBilgi("");
    await yukle();
  };

  const kalanOran = useMemo(() => {
    const k = veri?.kalanGun ?? 0;
    const t = veri?.toplamGun || 30;
    return Math.max(4, Math.min(100, Math.round((k / t) * 100)));
  }, [veri]);

  /* ============================================================ görünüm */

  if (ekran === "yukleniyor")
    return (
      <div className="kb-kap">
        <Ust />
        <div className="kb-govde">
          <div className="kb-kartYuzu kb-iskelet" />
          <div className="kb-panel kb-orta">Yükleniyor…</div>
        </div>
      </div>
    );

  if (ekran === "hata")
    return (
      <div className="kb-kap">
        <Ust />
        <div className="kb-govde">
          <div className="kb-panel kb-orta">
            <div className="kb-simge kb-s-turuncu">!</div>
            <h1 className="kb-baslik">Bağlantı açılamadı</h1>
            <p className="kb-alt">{hata}</p>
            <button className="kb-dugme ikincil" onClick={() => { setEkran("yukleniyor"); yukle(); }}>
              Tekrar dene
            </button>
          </div>
        </div>
      </div>
    );

  if (ekran === "son" && veri) return <SonEkran veri={veri} />;

  if (!veri) return null;

  const ad = veri.ad ?? "";

  /* ------------------------------------------------------ doğrulama */
  if (ekran === "dogrulama")
    return (
      <div className="kb-kap">
        <Ust />
        <div className="kb-govde">
          <div className="kb-selam">
            <h1>Merhaba {ad},</h1>
            <p>
              {mod === "degistir"
                ? "Kart şifrenizi değiştirmek için kimliğinizi yeniden doğrulayın."
                : "Biçen Kart bakiyeniz sizi bekliyor. Kartınızı kullanabilmek için önce kimliğinizi doğrulayın."}
            </p>
          </div>

          <KartYuzu ad={ad} numara={maskeli(veri.kartSon4)} bakiye={veri.bakiye} acik={false} />

          <div className="kb-gecerlilik">
            <span>
              Son kullanım <b>{tarihYaz(veri.sonGecerlilik)}</b>
            </span>
            <span className="kb-kalan">{veri.kalanGun} gün kaldı</span>
          </div>

          <div className="kb-panel">
            {mod === "ilk" && <Adimlar adim={1} />}

            <label className="kb-etiket" htmlFor="kb-tc">
              TC kimlik numaranız
            </label>
            <input
              id="kb-tc"
              className="kb-girdi kb-tc"
              inputMode="numeric"
              autoComplete="off"
              placeholder="___________"
              maxLength={11}
              value={tc}
              onChange={(e) => setTc(rakam(e.target.value, 11))}
              onKeyDown={(e) => e.key === "Enter" && dogrula()}
            />

            {hata && <div className="kb-hata">{hata}</div>}

            {typeof veri.kalanDeneme === "number" && veri.kalanDeneme < 10 && (
              <div className="kb-not kb-not-uyari">
                Kalan deneme hakkı: <b>{veri.kalanDeneme}</b>. Haklar bitince bağlantı kilitlenir.
              </div>
            )}

            <button className="kb-dugme" disabled={isleniyor || tc.length !== 11} onClick={dogrula}>
              {isleniyor ? "Doğrulanıyor…" : "Doğrula"}
            </button>

            {mod === "degistir" && (
              <button className="kb-dugme hayalet" onClick={() => { setMod("ilk"); setHata(""); yukle(); }}>
                Vazgeç
              </button>
            )}

            <p className="kb-kvkk">
              TC kimlik numaranız yalnızca bu kartın size ait olduğunu doğrulamak için kullanılır;
              bu sayfada saklanmaz. Kart numaranız doğrulama ve şifre belirleme sonrasında gösterilir.
            </p>
          </div>

          <Dip />
        </div>
      </div>
    );

  /* ----------------------------------------------------------- şifre */
  if (ekran === "sifre")
    return (
      <div className="kb-kap">
        <Ust />
        <div className="kb-govde">
          <div className="kb-selam">
            <h1>{mod === "degistir" ? "Yeni kart şifresi" : "Kart şifrenizi belirleyin"}</h1>
            <p>Kasada ödeme onayında bu şifre sorulur. Kimseyle paylaşmayın.</p>
          </div>

          <KartYuzu ad={ad} numara={maskeli(veri.kartSon4)} bakiye={veri.bakiye} acik={false} />

          <div className="kb-panel">
            {mod === "ilk" && <Adimlar adim={2} />}

            {veri.yenidenBelirle && mod === "ilk" && (
              <div className="kb-not kb-not-uyari">
                Güvenlik için kart şifreniz sıfırlandı. Kartı kullanmak için yeni bir şifre belirleyin.
              </div>
            )}

            <label className="kb-etiket" htmlFor="kb-s1">
              4 haneli şifre
            </label>
            <input
              id="kb-s1"
              className="kb-girdi kb-pin"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              placeholder="••••"
              maxLength={4}
              value={sifre}
              onChange={(e) => setSifre(rakam(e.target.value, 4))}
            />

            <label className="kb-etiket" htmlFor="kb-s2">
              Şifre (tekrar)
            </label>
            <input
              id="kb-s2"
              className="kb-girdi kb-pin"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              placeholder="••••"
              maxLength={4}
              value={sifre2}
              onChange={(e) => setSifre2(rakam(e.target.value, 4))}
              onKeyDown={(e) => e.key === "Enter" && sifreKaydet()}
            />

            {sifre2.length === 4 && sifre !== sifre2 && !hata && (
              <div className="kb-hata">Şifreler aynı değil.</div>
            )}
            {hata && <div className="kb-hata">{hata}</div>}

            <ul className="kb-kurallar">
              <li>Yalnızca rakam, 4 hane</li>
              <li>Aynı rakamlar (1111) ya da sıralı rakamlar (1234, 4321) kabul edilmez</li>
            </ul>

            <button
              className="kb-dugme"
              disabled={isleniyor || sifre.length !== 4 || sifre !== sifre2}
              onClick={sifreKaydet}
            >
              {isleniyor ? "Kaydediliyor…" : "Şifreyi kaydet"}
            </button>

            {mod === "degistir" && (
              <button className="kb-dugme hayalet" onClick={() => { setMod("ilk"); setHata(""); yukle(); }}>
                Vazgeç
              </button>
            )}
          </div>

          <Dip />
        </div>
      </div>
    );

  /* ------------------------------------------------------------ kart */
  const kartNo = veri.kartNo ?? "";

  return (
    <div className="kb-kap">
      <Ust />
      <div className="kb-govde">
        <div className="kb-selam">
          <h1>Kartınız hazır, {ad}</h1>
          <p>Kasada barkodu okutun; ödeme onayında kart şifrenizi girin.</p>
        </div>

        {bilgi && <div className="kb-basari">✓ {bilgi}</div>}

        <KartYuzu ad={veri.adSoyad ?? ad} numara={dortlu(kartNo)} bakiye={veri.bakiye} acik />

        <div className="kb-panel kb-okut">
          <div className="kb-okut-baslik">Kasada okutun</div>
          <Barkod deger={kartNo} />
          <div className="kb-okut-no">{dortlu(kartNo)}</div>

          <div className="kb-okut-not">Ödemede kasiyer kart şifrenizi sorar.</div>
        </div>

        <div className="kb-ozet">
          <div>
            <small>Bakiye</small>
            <b className="kb-para">{tl(veri.bakiye)}</b>
          </div>
          <div>
            <small>Son kullanım</small>
            <b>{tarihYaz(veri.sonGecerlilik)}</b>
          </div>
          <div className="kb-ozet-tam">
            <div className="kb-ozet-satir">
              <small>Kalan süre</small>
              <b>{veri.kalanGun} gün</b>
            </div>
            <div className="kb-serit">
              <i style={{ width: `${kalanOran}%` }} />
            </div>
          </div>
        </div>

        {hata && <div className="kb-hata">{hata}</div>}

        <div className="kb-dugmeler">
          <button className="kb-dugme" disabled={indiriliyor} onClick={indir}>
            {indiriliyor ? "Hazırlanıyor…" : "⬇  Kart görselini indir"}
          </button>
          <button className="kb-dugme ikincil" onClick={sifreDegistir}>
            Kart şifremi unuttum / değiştir
          </button>
        </div>

        <div className="kb-panel">
          <div className="kb-bolumBaslik">Son hareketler</div>
          {(veri.hareketler ?? []).length === 0 ? (
            <p className="kb-alt" style={{ margin: "6px 0 2px" }}>
              Henüz hareket yok.
            </p>
          ) : (
            <ul className="kb-hareketler">
              {(veri.hareketler ?? []).map((h, i) => (
                <li key={i}>
                  <div>
                    <b>{h.aciklama}</b>
                    <small>
                      {kisaTarih(h.tarih)}
                      {h.subeAdi ? ` · ${h.subeAdi}` : ""}
                    </small>
                  </div>
                  <span className={h.tutar < 0 ? "eksi" : "arti"}>
                    {h.tutar < 0 ? "−" : "+"}
                    {tl(Math.abs(h.tutar))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="kb-uyari-dip">
          Bu sayfa ve kart bilgileriniz size özeldir. Bağlantıyı, kart numaranızı ve şifrenizi kimseyle
          paylaşmayın. Ortak kullanılan bir cihazdaysanız{" "}
          <button className="kb-baglanti" onClick={cihazdanCik}>
            bu cihazdan çıkış yapın
          </button>
          .
        </p>

        <Dip />
      </div>
    </div>
  );
}

function Dip() {
  return <p className="kb-dip">Biçen Market · İnsan Kaynakları</p>;
}

/** Kartın kullanılamadığı durumlar: numara ve barkod yok. */
function SonEkran({ veri }: { veri: Veri }) {
  const ad = veri.ad ?? "";

  const icerik: Record<string, { simge: string; renk: string; baslik: string; metin: string }> = {
    tamamlandi: {
      simge: "✓",
      renk: "kb-s-yesil",
      baslik: "Bakiyeniz kullanılmıştır",
      metin: `${ad ? ad + ", " : ""}Biçen Kart bakiyenizin tamamı kullanıldı; bu bağlantıda gösterilecek bakiye kalmadı. Bizi tercih ettiğiniz için teşekkür ederiz.`,
    },
    suresiDoldu: {
      simge: "⏱",
      renk: "kb-s-gri",
      baslik: "Bağlantının süresi doldu",
      metin: `Bu bağlantının kullanım süresi ${tarihYaz(veri.sonGecerlilik)} tarihinde sona erdi; kart bilgileri artık gösterilemiyor. Sorularınız için İnsan Kaynakları ile görüşebilirsiniz.`,
    },
    iptal: {
      simge: "!",
      renk: "kb-s-turuncu",
      baslik: "Bağlantı iptal edildi",
      metin: "Bu bağlantı İnsan Kaynakları tarafından iptal edildi. Sorularınız için İnsan Kaynakları ile görüşebilirsiniz.",
    },
    kullanilamaz: {
      simge: "!",
      renk: "kb-s-turuncu",
      baslik: "Bu kart artık kullanılamıyor",
      metin: "Kart bu bağlantıdan kullanıma kapatıldı. Sorularınız için İnsan Kaynakları ile görüşebilirsiniz.",
    },
    kilitli: {
      simge: "🔒",
      renk: "kb-s-turuncu",
      baslik: "Bağlantı geçici olarak kilitlendi",
      metin: veri.kilitBitis
        ? `Çok sayıda hatalı deneme yapıldı. ${new Date(veri.kilitBitis).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })} sonrasında yeniden deneyebilirsiniz.`
        : "Çok sayıda hatalı deneme yapıldı ve bağlantı kilitlendi. Açılması için İnsan Kaynakları ile görüşünüz.",
    },
  };

  const i = icerik[veri.durum] ?? icerik.kullanilamaz;

  return (
    <div className="kb-kap">
      <Ust />
      <div className="kb-govde">
        <div className="kb-panel kb-orta">
          <div className={`kb-simge ${i.renk}`}>{i.simge}</div>
          <h1 className="kb-baslik">{i.baslik}</h1>
          <p className="kb-alt">{i.metin}</p>
        </div>
        <Dip />
      </div>
    </div>
  );
}
