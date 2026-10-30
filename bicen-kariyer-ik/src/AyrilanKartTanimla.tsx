/* ===========================================================================
   Biçen Kart › Ayrılan personel › Kart tanımla (06.10.2026)

   Tek çekmecede: kişi → şu anki kartı (varsa kaldır) → yeni kart ara ve
   tanımla → kart geçmişi. Ayrılan personele tanımlama ve kaldırma yalnızca
   Yönetici (Admin) rolünde; sunucu da denetliyor.

   Uçlar:
     GET  /api/BicenKart/Ayrilan/PersonelAra?q=
     GET  /api/BicenKart/Ayrilan/KartDurumu/{sicil}
     GET  /api/BicenKart/Ara?kartNo=
     POST /api/BicenKart/Esle            { personelKodu, kartNo }
     POST /api/BicenKart/EslesmeKaldir   { personelKodu }
   =========================================================================== */

import { useEffect, useRef, useState } from "react";
import { Drawer, Popconfirm, Spin, message } from "antd";
import { CreditCard, History, Search, ShieldAlert, Trash2, UserRound, X } from "lucide-react";

import { api } from "./api";
import "./AyrilanKartTanimla.css";

interface Durum {
  personel: {
    sicil: string;
    adSoyad: string;
    sube: string;
    pozisyon: string | null;
    cikisTarihi: string | null;
    ayrildi: boolean;
    yenidenCalisiyor: boolean;
    telefon: string | null;
    telefonGecerli: boolean;
    tcVar: boolean;
  };
  kart: {
    kartNo: string;
    son4: string;
    posta: boolean | null;
    kartAdi: string | null;
    kartTelefon: string | null;
    mobil: boolean;
    bakiye: number | null;
  } | null;
  posHatasi: string | null;
  gecmis: { tarih: string; kartNo?: string | null; kartSon4: string | null; olay: string; ayrinti: string | null; yapan: string | null }[];
  kartTanimlayabilir: boolean;
}

interface KartSonucu {
  kartNo: string;
  ad: string;
  telefon: string | null;
  mobilKart: boolean;
  sifreVar: boolean;
  kimde: { sicil: string; adSoyad: string; sube: string | null; aktif: boolean } | null;
}

interface KisiSonucu {
  sicil: string;
  adSoyad: string;
  sube: string;
  pozisyon: string | null;
  cikisTarihi: string | null;
  kartSon4: string | null;
  kartNo?: string | null;
}

const no4 = (d?: string | null) => (d ?? "").replace(/(.{4})/g, "$1 ").trim();
const gun = (t?: string | null) => (t ? new Date(t).toLocaleDateString("tr-TR") : "");
const gunSaat = (t?: string | null) =>
  t
    ? new Date(t).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "";
const tl = (d?: number | null) =>
  d === null || d === undefined
    ? "—"
    : d.toLocaleString("tr-TR", { style: "currency", currency: "TRY", minimumFractionDigits: 2 });
const tel = (t?: string | null) => (t ? t.replace(/(\d{3})(\d{3})(\d{2})(\d{2})/, "0$1 $2 $3 $4") : "");
const bas = (ad: string) =>
  (ad || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x[0])
    .join("")
    .toLocaleUpperCase("tr-TR");
const kartAdi = (ad: string) => (ad || "").toLocaleUpperCase("tr-TR").slice(0, 30).trim();

/* ------------------------------------------------------------------ */

export default function AyrilanKartTanimla({
  acik,
  sicil,
  kapat,
  degisti,
}: {
  acik: boolean;
  /** Boşsa önce kişi aranır */
  sicil: string | null;
  kapat: () => void;
  /** Kart tanımlandı / kaldırıldı: listeyi yenile */
  degisti: () => void;
}) {
  const [secili, setSecili] = useState<string | null>(sicil);
  const [durum, setDurum] = useState<Durum | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [hata, setHata] = useState("");

  useEffect(() => {
    if (acik) setSecili(sicil);
  }, [acik, sicil]);

  const getir = async (s: string) => {
    setYukleniyor(true);
    setHata("");

    try {
      setDurum(await api.al<Durum>(`/api/BicenKart/Ayrilan/KartDurumu/${encodeURIComponent(s)}`));
    } catch (h: any) {
      setHata(h?.message ?? "Kart durumu alınamadı.");
      setDurum(null);
    } finally {
      setYukleniyor(false);
    }
  };

  useEffect(() => {
    if (!acik || !secili) {
      setDurum(null);
      return;
    }

    getir(secili);
  }, [acik, secili]);

  const yenile = () => {
    if (secili) getir(secili);
    degisti();
  };

  return (
    <Drawer
      open={acik}
      onClose={kapat}
      width={560}
      title={null}
      closable={false}
      destroyOnClose
      rootClassName="akt-cekmece"
    >
      <div className="akt">
        <div className="akt-ust">
          <div>
            <b>Kart tanımla</b>
            <span>Ayrılan personel · Biçen Kart</span>
          </div>
          <button type="button" className="akt-kapat" onClick={kapat} aria-label="Kapat">
            <X size={18} />
          </button>
        </div>

        {!secili ? (
          <KisiAra sec={setSecili} />
        ) : yukleniyor && !durum ? (
          <div className="akt-bos">
            <Spin />
          </div>
        ) : hata ? (
          <div className="akt-hata">{hata}</div>
        ) : durum ? (
          <Govde durum={durum} yenile={yenile} baskasi={sicil ? null : () => setSecili(null)} />
        ) : null}
      </div>
    </Drawer>
  );
}

/* ------------------------------------------------------------ kişi ara */

function KisiAra({ sec }: { sec: (s: string) => void }) {
  const [q, setQ] = useState("");
  const [liste, setListe] = useState<KisiSonucu[] | null>(null);
  const [araniyor, setAraniyor] = useState(false);
  const sayac = useRef(0);
  const girdi = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => girdi.current?.focus(), 120);
  }, []);

  useEffect(() => {
    const t = q.trim();

    if (t.length < 2) {
      setListe(null);
      return;
    }

    const bu = ++sayac.current;
    const z = setTimeout(async () => {
      setAraniyor(true);
      try {
        const c = await api.al<{ kayitlar: KisiSonucu[] }>(
          `/api/BicenKart/Ayrilan/PersonelAra?q=${encodeURIComponent(t)}`
        );
        if (bu === sayac.current) setListe(c.kayitlar ?? []);
      } catch {
        if (bu === sayac.current) setListe([]);
      } finally {
        if (bu === sayac.current) setAraniyor(false);
      }
    }, 300);

    return () => clearTimeout(z);
  }, [q]);

  return (
    <div className="akt-bolum">
      <div className="akt-adim">
        <span>1</span>
        <b>Personeli bulun</b>
      </div>
      <p className="akt-aciklama">Son iki yılda ayrılan personel arasında ad, sicil ya da TC'nin son dört hanesiyle arayın.</p>

      <label className="akt-girdi">
        <Search size={16} />
        <input ref={girdi} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ad soyad, sicil ya da TC son 4" />
        {araniyor && <Spin size="small" />}
      </label>

      {liste && (
        <div className="akt-liste">
          {liste.length === 0 ? (
            <div className="akt-bos-ic">Bu aramayla ayrılan personel bulunamadı.</div>
          ) : (
            liste.map((k) => (
              <button type="button" key={k.sicil} className="akt-kisiSatir" onClick={() => sec(k.sicil)}>
                <span className="akt-bas">{bas(k.adSoyad)}</span>
                <span className="akt-kisiYazi">
                  <b>{k.adSoyad}</b>
                  <small>
                    {k.sicil} · {k.sube}
                    {k.cikisTarihi ? ` · çıkış ${gun(k.cikisTarihi)}` : ""}
                  </small>
                </span>
                {k.kartSon4 ? (
                  <span className="akt-rozet akt-r-yesil">{k.kartNo ? no4(k.kartNo) : `•••• ${k.kartSon4}`}</span>
                ) : (
                  <span className="akt-rozet akt-r-gri">kart yok</span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ gövde */

function Govde({ durum, yenile, baskasi }: { durum: Durum; yenile: () => void; baskasi: (() => void) | null }) {
  const p = durum.personel;
  const k = durum.kart;
  const yetki = durum.kartTanimlayabilir;
  const [kaldiriliyor, setKaldiriliyor] = useState(false);
  const yeniRef = useRef<HTMLDivElement>(null);

  const kaldir = async () => {
    setKaldiriliyor(true);
    try {
      await api.gonder("/api/BicenKart/EslesmeKaldir", { personelKodu: p.sicil });
      message.success(`${p.adSoyad} kişisinin kartı kaldırıldı; kart boşa çıkarıldı.`);
      yenile();
    } catch (h: any) {
      message.error(h?.message ?? "Kart kaldırılamadı.");
    } finally {
      setKaldiriliyor(false);
    }
  };

  return (
    <>
      {/* ------------------------------------------------ kişi */}
      <div className="akt-kisi">
        <span className="akt-bas akt-bas-buyuk">{bas(p.adSoyad)}</span>
        <div className="akt-kisiYazi">
          <b>{p.adSoyad}</b>
          <small>
            {p.sicil}
            {p.pozisyon ? ` · ${p.pozisyon}` : ""} · {p.sube}
          </small>
          <div className="akt-cipler">
            {p.ayrildi ? (
              <span className="akt-rozet akt-r-turuncu">Ayrıldı{p.cikisTarihi ? ` · ${gun(p.cikisTarihi)}` : ""}</span>
            ) : (
              <span className="akt-rozet akt-r-yesil">Çalışıyor</span>
            )}
            {p.yenidenCalisiyor && <span className="akt-rozet akt-r-mavi">Yeniden işe girmiş</span>}
            {p.telefon ? (
              <span className={`akt-rozet ${p.telefonGecerli ? "akt-r-gri" : "akt-r-sari"}`}>{tel(p.telefon)}</span>
            ) : (
              <span className="akt-rozet akt-r-sari">Telefon yok</span>
            )}
            {!p.tcVar && <span className="akt-rozet akt-r-sari">TC kayıtlı değil</span>}
          </div>
        </div>
        {baskasi && (
          <button type="button" className="akt-dugme akt-ince" onClick={baskasi}>
            <UserRound size={14} /> Başka kişi
          </button>
        )}
      </div>

      {!yetki && (
        <div className="akt-uyari">
          <ShieldAlert size={16} />
          <span>
            İşten ayrılan personele kart tanımlamayı ve kartını kaldırmayı yalnızca <b>Yönetici</b> rolü yapabilir. Bu
            ekranda kart durumunu görebilirsiniz.
          </span>
        </div>
      )}

      {/* ------------------------------------------------ şu anki kart */}
      <div className="akt-bolum">
        <div className="akt-adim">
          <span>
            <CreditCard size={13} />
          </span>
          <b>Şu anki kartı</b>
        </div>

        {!k ? (
          <div className="akt-kartBos">
            <CreditCard size={22} />
            <div>
              <b>Tanımlı kart yok</b>
              <small>{yetki ? "Aşağıdan kart numarasıyla yeni kart tanımlayabilirsiniz." : "Bu personelde eşleşmiş Biçen Kart yok."}</small>
            </div>
          </div>
        ) : (
          <div className="akt-kartSatir">
            <div className={`akt-kart ${k.posta === false ? "akt-kart-hata" : ""}`}>
              <div className="akt-kartUst">
                <span>BİÇEN KART</span>
                <span>{k.mobil ? "mobil" : "fiziki"}</span>
              </div>
              <div className="akt-kartNo">{no4(k.kartNo)}</div>
              <div className="akt-kartAlt">
                <span>{k.kartAdi || "—"}</span>
                <b>{tl(k.bakiye)}</b>
              </div>
            </div>

            <div className="akt-kartBilgi">
              {k.posta === false && <span className="akt-rozet akt-r-kirmizi">Kart MusteriKart'ta yok</span>}
              {durum.posHatasi && <span className="akt-rozet akt-r-sari">Kart veritabanına ulaşılamadı</span>}
              <div>
                <small>Kartın üstündeki ad</small>
                <b>{k.kartAdi || "—"}</b>
              </div>
              <div>
                <small>Karttaki telefon</small>
                <b>{k.kartTelefon ? tel(k.kartTelefon) : "—"}</b>
              </div>
              <div>
                <small>Bakiye</small>
                <b>{tl(k.bakiye)}</b>
              </div>

              {yetki && (
                <div className="akt-kartDugmeler">
                  <button
                    type="button"
                    className="akt-dugme"
                    onClick={() => yeniRef.current?.querySelector("input")?.focus()}
                  >
                    Başka kartla değiştir
                  </button>
                  <Popconfirm
                    title="Kart kaldırılsın mı?"
                    description={
                      <div style={{ maxWidth: 280 }}>
                        Kart personelden alınır ve boşa çıkarılır: adı “BİÇEN KART” olur, telefon ve şifre silinir.
                        Bakiye ({tl(k.bakiye)}) kartta kalır.
                      </div>
                    }
                    okText="Kaldır"
                    cancelText="Vazgeç"
                    okButtonProps={{ danger: true }}
                    onConfirm={kaldir}
                  >
                    <button type="button" className="akt-dugme akt-tehlike" disabled={kaldiriliyor}>
                      <Trash2 size={14} /> {kaldiriliyor ? "Kaldırılıyor…" : "Kartı kaldır"}
                    </button>
                  </Popconfirm>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ------------------------------------------------ yeni kart */}
      {yetki && (
        <div className="akt-bolum" ref={yeniRef}>
          <div className="akt-adim">
            <span>+</span>
            <b>{k ? "Yeni kartla değiştir" : "Yeni kart tanımla"}</b>
          </div>
          <YeniKart durum={durum} bitti={yenile} />
        </div>
      )}

      {/* ------------------------------------------------ geçmiş */}
      <div className="akt-bolum">
        <div className="akt-adim">
          <span>
            <History size={13} />
          </span>
          <b>Kart geçmişi</b>
        </div>

        {durum.gecmis.length === 0 ? (
          <div className="akt-bos-ic">
            Kayıtlı geçmiş yok. Bu ekrandan yapılan tanımlama ve kaldırmalar bundan sonra burada görünür.
          </div>
        ) : (
          <div className="akt-gecmis">
            {durum.gecmis.map((g, i) => (
              <div key={i} className="akt-gSatir">
                <i />
                <div>
                  <b>
                    {g.olay}
                    {g.kartNo || g.kartSon4 ? <span className="akt-no"> {g.kartNo ? no4(g.kartNo) : `•••• ${g.kartSon4}`}</span> : null}
                  </b>
                  <small>
                    {gunSaat(g.tarih)}
                    {g.yapan ? ` · ${g.yapan}` : ""}
                  </small>
                  {g.ayrinti && <small>{g.ayrinti}</small>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------ yeni kart */

function YeniKart({ durum, bitti }: { durum: Durum; bitti: () => void }) {
  const p = durum.personel;
  const [q, setQ] = useState("");
  const [sonuclar, setSonuclar] = useState<KartSonucu[] | null>(null);
  const [araniyor, setAraniyor] = useState(false);
  const [hata, setHata] = useState("");
  const [secili, setSecili] = useState<KartSonucu | null>(null);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const sayac = useRef(0);

  const rakam = q.replace(/\D/g, "");

  useEffect(() => {
    if (rakam.length < 4) {
      setSonuclar(null);
      setHata("");
      return;
    }

    const bu = ++sayac.current;
    const z = setTimeout(async () => {
      setAraniyor(true);
      try {
        const c = await api.al<{ kayitlar: KartSonucu[] }>(`/api/BicenKart/Ara?kartNo=${encodeURIComponent(rakam)}`);
        if (bu === sayac.current) {
          setSonuclar(c.kayitlar ?? []);
          setHata("");
        }
      } catch (h: any) {
        if (bu === sayac.current) setHata(h?.message ?? "Aranamadı.");
      } finally {
        if (bu === sayac.current) setAraniyor(false);
      }
    }, 350);

    return () => clearTimeout(z);
  }, [rakam]);

  const tanimla = async () => {
    if (!secili) return;

    setKaydediliyor(true);
    try {
      const c = await api.gonder<any>("/api/BicenKart/Esle", { personelKodu: p.sicil, kartNo: secili.kartNo });
      message.success(
        `${no4(secili.kartNo)} numaralı kart ${p.adSoyad} kişisine tanımlandı.` +
          (c?.birakilanKart ? ` Önceki kartı (${no4(c.birakilanKart)}) boşa çıkarıldı.` : "")
      );
      setSecili(null);
      setQ("");
      bitti();
    } catch (h: any) {
      message.error(h?.message ?? "Kart tanımlanamadı.");
    } finally {
      setKaydediliyor(false);
    }
  };

  if (secili) {
    const baskasinda = secili.kimde && secili.kimde.sicil?.trim() !== p.sicil;
    const ayni = durum.kart && durum.kart.kartNo === secili.kartNo;

    return (
      <div className="akt-onay">
        <div className="akt-onayKart">
          <CreditCard size={18} />
          <b>{no4(secili.kartNo)}</b>
          <span className="akt-rozet akt-r-gri">{secili.mobilKart ? "mobil" : "fiziki"}</span>
        </div>

        <ul className="akt-degisiklik">
          <li>
            Kartın adı <b>{secili.ad || "—"}</b> → <b>{kartAdi(p.adSoyad)}</b>
          </li>
          <li>
            Karttaki telefon {secili.telefon ? <b>{tel(secili.telefon)}</b> : "boş"} →{" "}
            <b>{p.telefon ? tel(p.telefon) : "boş"}</b>
          </li>
          <li>Kart mobil karta çevrilir.</li>
          {durum.kart && !ayni && (
            <li className="akt-li-uyari">
              Şu anki kartı <b>{no4(durum.kart.kartNo)}</b> boşa çıkarılır (bakiyesi kartta kalır).
            </li>
          )}
          {baskasinda && (
            <li className="akt-li-uyari">
              Bu kart şu an <b>{secili.kimde!.adSoyad}</b> ({secili.kimde!.sicil}
              {secili.kimde!.aktif ? ", çalışıyor" : ", ayrılmış"}) kişisinde; tanımlarsanız ondan alınır.
            </li>
          )}
        </ul>

        {ayni && <div className="akt-bos-ic">Bu kart zaten bu personelde tanımlı.</div>}

        <div className="akt-onayDugmeler">
          <button type="button" className="akt-dugme" onClick={() => setSecili(null)} disabled={kaydediliyor}>
            Geri
          </button>
          <button type="button" className="akt-dugme akt-ana" onClick={tanimla} disabled={kaydediliyor || !!ayni}>
            {kaydediliyor ? "Tanımlanıyor…" : "Kartı tanımla"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <p className="akt-aciklama">
        Kartın arkasındaki numarayı yazın (en az 4 hane). Kart PosbackPromosyon'daki kayıtlarda aranır.
      </p>

      <label className="akt-girdi">
        <CreditCard size={16} />
        <input
          value={q}
          onChange={(e) => setQ(no4(e.target.value.replace(/\D/g, "").slice(0, 20)))}
          placeholder="Kart numarası"
          inputMode="numeric"
        />
        {araniyor && <Spin size="small" />}
      </label>

      {hata && <div className="akt-hata">{hata}</div>}

      {sonuclar && (
        <div className="akt-liste">
          {sonuclar.length === 0 ? (
            <div className="akt-bos-ic">Bu numarayla kart bulunamadı. Numarayı kontrol edin.</div>
          ) : (
            sonuclar.map((s) => {
              const kendi = s.kimde?.sicil?.trim() === p.sicil;

              return (
                <button type="button" key={s.kartNo} className="akt-kartSonuc" onClick={() => setSecili(s)}>
                  <span className="akt-no">{no4(s.kartNo)}</span>
                  <span className="akt-kartSonucAd">{s.ad || "—"}</span>
                  {kendi ? (
                    <span className="akt-rozet akt-r-yesil">bu personelde</span>
                  ) : s.kimde ? (
                    <span className={`akt-rozet ${s.kimde.aktif ? "akt-r-turuncu" : "akt-r-sari"}`}>
                      {s.kimde.adSoyad}
                    </span>
                  ) : (
                    <span className="akt-rozet akt-r-gri">boşta</span>
                  )}
                </button>
              );
            })
          )}
        </div>
      )}
    </>
  );
}
