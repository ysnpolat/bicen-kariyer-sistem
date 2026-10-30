/* ===========================================================================
   Yönetim › Ayarlar Merkezi (07.10.2026) · "am-"
   ---------------------------------------------------------------------------
   Kodun içinde sabit duran süre ve sınırlar, seçenek listeleri ve avans
   onay akışı. Sunucu: /api/AyarMerkezi. Her kayıt eski → yeni değerle
   değişiklik geçmişine yazılıyor (alttaki "Değişiklik geçmişi").

   Gizli değerler (veritabanı bağlantısı, JWT, SMS parolası, API anahtarı)
   bu ekranda yok; sunucu da göndermiyor.
   =========================================================================== */

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Alert,
  App as AntdApp,
  Button,
  Checkbox,
  Input,
  InputNumber,
  Segmented,
  Select,
  Spin,
  Switch,
  Tag,
  Tooltip,
} from "antd";
import { ArrowDown, ArrowUp, History, Plus, RotateCcw, Save, Trash2, ArrowRight, CheckCircle2, XCircle } from "lucide-react";
import dayjs from "dayjs";

import { api } from "./api";
import "./AyarMerkezi.css";

/* -------------------------------------------------------------- ortak */

function KaydetSeridi({
  acik,
  yukleniyor,
  onKaydet,
  onVazgec,
}: {
  acik: boolean;
  yukleniyor?: boolean;
  onKaydet: () => void;
  onVazgec: () => void;
}) {
  return (
    <div className={"ym-kaydet" + (acik ? " ym-kaydet-acik" : "")} aria-hidden={!acik}>
      <span>Kaydedilmemiş değişiklik var</span>
      <Button size="middle" className="ym-kaydet-vazgec" onClick={onVazgec} disabled={yukleniyor}>
        Vazgeç
      </Button>
      <Button type="primary" size="middle" loading={yukleniyor} icon={<Save size={15} strokeWidth={2} />} onClick={onKaydet}>
        Kaydet
      </Button>
    </div>
  );
}

interface GecmisSatiri {
  bolum: string;
  islem: string;
  kim: string;
  tarih: string;
}

/** Bölümün değişiklik geçmişi (eski → yeni) */
export function DegisiklikGecmisi({ bolum, yenile }: { bolum: string; yenile?: number }) {
  const [liste, setListe] = useState<GecmisSatiri[] | null>(null);
  const [hepsi, setHepsi] = useState(false);

  useEffect(() => {
    api
      .al<GecmisSatiri[]>(`/api/AyarMerkezi/Gecmis?bolum=${encodeURIComponent(bolum)}&adet=100`)
      .then(setListe)
      .catch(() => setListe([]));
  }, [bolum, yenile]);

  const gorunen = (liste ?? []).slice(0, hepsi ? 100 : 6);

  return (
    <div className="am-gecmis">
      <div className="am-gecmis-bas">
        <History size={14} strokeWidth={2} /> Değişiklik geçmişi
      </div>
      {!liste ? (
        <Spin size="small" />
      ) : liste.length === 0 ? (
        <div className="am-soluk">Henüz değişiklik yok. Bundan sonra yapılan her değişiklik kim, ne zaman ve eski → yeni değeriyle burada görünür.</div>
      ) : (
        <>
          {gorunen.map((x, i) => (
            <div key={i} className="am-gecmis-satir">
              <time>{dayjs(x.tarih).format("DD.MM.YYYY HH:mm")}</time>
              <b>{x.kim || "—"}</b>
              <span>{x.islem}</span>
            </div>
          ))}
          {liste.length > 6 && (
            <Button type="link" size="small" onClick={() => setHepsi((h) => !h)} style={{ paddingLeft: 0 }}>
              {hepsi ? "Daha az göster" : `Tümünü göster (${liste.length})`}
            </Button>
          )}
        </>
      )}
    </div>
  );
}

/* ================================================================ Süreler */

interface ParametreTanimi {
  anahtar: string;
  grup: string;
  ad: string;
  aciklama: string;
  tip: "sayi" | "evethayir" | "saat" | "saatler" | "sicil" | "surum" | "metin";
  birim: string | null;
  min: number | null;
  max: number | null;
  varsayilan: string;
  deger: string;
  kaynak: "kayit" | "yapilandirma" | "varsayilan";
  etki: string | null;
  kisi: string | null;
}

interface ParametreVerisi {
  yazabilir: boolean;
  gruplar: { kod: string; ad: string; aciklama: string }[];
  parametreler: ParametreTanimi[];
}

const goster = (p: ParametreTanimi, d: string) =>
  p.tip === "evethayir" ? (d === "true" ? "açık" : "kapalı") : p.birim ? `${d} ${p.birim}` : d;

export function SurelerSinirlar({ onKirli }: { onKirli?: (k: boolean) => void }) {
  const { message } = AntdApp.useApp();
  const [veri, setVeri] = useState<ParametreVerisi | null>(null);
  const [taslak, setTaslak] = useState<Record<string, string>>({});
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const [yenile, setYenile] = useState(0);
  const [hata, setHata] = useState<string | null>(null);

  const getir = () =>
    api
      .al<ParametreVerisi>("/api/AyarMerkezi/Parametreler")
      .then((v) => {
        setVeri(v);
        setTaslak({});
        setHata(null);
      })
      .catch((h: any) => setHata(h.message));

  useEffect(() => {
    getir();
  }, []);

  const degisen = Object.keys(taslak).filter((k) => {
    const p = veri?.parametreler.find((x) => x.anahtar === k);
    return p && taslak[k] !== p.deger;
  });

  useEffect(() => {
    onKirli?.(degisen.length > 0);
  }, [degisen.length]);

  const kaydet = async () => {
    if (!veri) return;
    setKaydediliyor(true);
    try {
      const degerler: Record<string, string> = {};
      degisen.forEach((k) => (degerler[k] = taslak[k]));
      const c = await api.gonder<{ degisen: number }>("/api/AyarMerkezi/Parametreler", { degerler });
      message.success(c.degisen ? `${c.degisen} ayar kaydedildi; en geç bir dakika içinde geçerli olur.` : "Değişiklik yok.");
      await getir();
      setYenile((x) => x + 1);
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setKaydediliyor(false);
    }
  };

  if (hata) return <Alert type="error" showIcon message="Ayarlar okunamadı" description={hata} />;
  if (!veri) return <Spin />;

  const yaz = veri.yazabilir;

  /* Bileşen değil işlev: her çizimde yeniden bağlanıp odak kaybetmesin */
  const alan = (p: ParametreTanimi) => {
    const d = taslak[p.anahtar] ?? p.deger;
    const ata = (v: string) => setTaslak((t) => ({ ...t, [p.anahtar]: v }));

    if (p.tip === "evethayir")
      return <Switch checked={d === "true"} disabled={!yaz} onChange={(v) => ata(v ? "true" : "false")} />;

    if (p.tip === "saatler")
      return (
        <Select
          mode="tags"
          disabled={!yaz}
          style={{ minWidth: 220 }}
          value={d.split(",").filter(Boolean)}
          tokenSeparators={[",", " "]}
          onChange={(v: string[]) => ata(v.join(","))}
          placeholder="08:40"
        />
      );

    if (p.tip === "saat")
      return <Input disabled={!yaz} style={{ width: 100 }} value={d} placeholder="14:00" maxLength={5} onChange={(e) => ata(e.target.value.trim())} />;

    if (p.tip === "surum")
      return <Input disabled={!yaz} style={{ width: 100 }} value={d} placeholder="1.6" maxLength={11} onChange={(e) => ata(e.target.value.trim())} />;

    if (p.tip === "sicil")
      return <Input disabled={!yaz} style={{ width: 140 }} value={d} onChange={(e) => ata(e.target.value.trim())} />;

    /* Serbest metin (23.10.2026: devamsızlık bildirimi metni) */
    if (p.tip === "metin")
      return <Input.TextArea disabled={!yaz} style={{ width: 420, maxWidth: "100%" }} autoSize={{ minRows: 2, maxRows: 6 }} value={d} maxLength={600} onChange={(e) => ata(e.target.value)} />;

    return (
      <InputNumber
        disabled={!yaz}
        min={p.min ?? undefined}
        max={p.max ?? undefined}
        value={Number(d)}
        onChange={(v) => v !== null && v !== undefined && ata(String(Math.round(Number(v))))}
        addonAfter={p.birim ?? undefined}
        style={{ width: 160 }}
      />
    );
  };

  return (
    <div className="am">
      {!yaz && <Alert type="info" showIcon message="Bu ayarları görebilirsiniz; değiştirmek için Admin, GMY ya da İK yöneticisi yetkisi gerekir." />}

      {veri.gruplar.map((g) => {
        const ps = veri.parametreler.filter((p) => p.grup === g.kod);
        if (ps.length === 0) return null;
        return (
          <section key={g.kod} className="am-kart">
            <div className="am-kart-bas">
              <h3>{g.ad}</h3>
              <span>{g.aciklama}</span>
            </div>
            {ps.map((p) => {
              const d = taslak[p.anahtar] ?? p.deger;
              const farkli = d !== p.varsayilan;
              const kirli = taslak[p.anahtar] !== undefined && taslak[p.anahtar] !== p.deger;
              return (
                <div key={p.anahtar} className={"am-satir" + (kirli ? " am-kirli" : "")}>
                  <div className="am-satir-metin">
                    <b>
                      {p.ad}
                      {p.kaynak === "kayit" && !kirli && <Tag color="green" className="am-etiket">değiştirildi</Tag>}
                      {kirli && <Tag color="orange" className="am-etiket">kaydedilmedi</Tag>}
                    </b>
                    <small>{p.aciklama}</small>
                    <small className="am-soluk">
                      Varsayılan: {goster(p, p.varsayilan)}
                      {p.etki ? ` · Etkilediği yer: ${p.etki}` : ""}
                      {p.tip === "sicil" && p.kisi && taslak[p.anahtar] === undefined ? ` · ${p.kisi}` : ""}
                    </small>
                  </div>
                  <div className="am-satir-deger">
                    {alan(p)}
                    {yaz && farkli && (
                      <Tooltip title={`Varsayılana dön (${goster(p, p.varsayilan)})`}>
                        <Button size="small" type="text" icon={<RotateCcw size={14} />} onClick={() => setTaslak((t) => ({ ...t, [p.anahtar]: p.varsayilan }))} />
                      </Tooltip>
                    )}
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}

      <DegisiklikGecmisi bolum="sureler" yenile={yenile} />

      <KaydetSeridi acik={degisen.length > 0} yukleniyor={kaydediliyor} onKaydet={kaydet} onVazgec={() => setTaslak({})} />
    </div>
  );
}

/* ================================================================ Listeler */

interface ListeOge {
  ad: string;
  aciklamaZorunlu: boolean;
  acik: boolean;
  belgeGerekli?: boolean;
}

interface ListeTanimi {
  kod: string;
  ad: string;
  aciklama: string;
  digerVar: boolean;
  belgeSutunu?: boolean;
  ogeler: ListeOge[];
  varsayilan: string[];
  varsayilanBelgeli?: string[];
}

export function SecenekListeleri({ onKirli }: { onKirli?: (k: boolean) => void }) {
  const { message, modal } = AntdApp.useApp();
  const [veri, setVeri] = useState<{ yazabilir: boolean; listeler: ListeTanimi[] } | null>(null);
  const [secili, setSecili] = useState<string>("avansNedenleri");
  const [taslak, setTaslak] = useState<ListeOge[] | null>(null);
  /* "Diğer" açık mı (14.10.2026): taslakta ayrı tutuluyor */
  const [digerTaslak, setDigerTaslak] = useState<boolean | null>(null);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const [yenile, setYenile] = useState(0);

  const getir = () =>
    api
      .al<{ yazabilir: boolean; listeler: ListeTanimi[] }>("/api/AyarMerkezi/Listeler")
      .then((v) => {
        setVeri(v);
        setTaslak(null);
        setDigerTaslak(null);
      })
      .catch((h: any) => message.error(h.message));

  useEffect(() => {
    getir();
  }, []);

  useEffect(() => {
    onKirli?.(taslak !== null || digerTaslak !== null);
  }, [taslak !== null || digerTaslak !== null]);

  if (!veri) return <Spin />;

  const liste = veri.listeler.find((x) => x.kod === secili) ?? veri.listeler[0];
  const ogeler = taslak ?? liste.ogeler.filter((x) => x.ad !== "Diğer");
  const diger = liste.ogeler.find((x) => x.ad === "Diğer");
  const digerAcik = digerTaslak ?? diger?.acik ?? true;
  const kirli = taslak !== null || digerTaslak !== null;
  const yaz = veri.yazabilir;

  const degistir = (f: (l: ListeOge[]) => ListeOge[]) => setTaslak(f(ogeler.map((x) => ({ ...x }))));

  const sec = (k: string) => {
    if (taslak || digerTaslak !== null) {
      modal.confirm({
        title: "Kaydedilmemiş değişiklik var",
        content: "Bu listedeki değişiklikler kaybolacak.",
        okText: "Listeyi değiştir",
        cancelText: "Kal",
        onOk: () => {
          setTaslak(null);
          setDigerTaslak(null);
          setSecili(k);
        },
      });
      return;
    }
    setSecili(k);
  };

  const kaydet = async () => {
    if (!kirli) return;
    const l = taslak ?? ogeler;
    if (l.some((x) => !x.ad.trim())) return message.warning("Boş satırları siliniz ya da doldurunuz.");
    setKaydediliyor(true);
    try {
      await api.gonder("/api/AyarMerkezi/Listeler", {
        kod: liste.kod,
        ogeler: liste.digerVar ? [...l, { ad: "Diğer", aciklamaZorunlu: true, acik: digerAcik }] : l,
      });
      message.success(`${liste.ad} kaydedildi; en geç bir dakika içinde formlarda görünür.`);
      await getir();
      setYenile((x) => x + 1);
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setKaydediliyor(false);
    }
  };

  return (
    <div className="am">
      <div className="am-liste-sec">
        {veri.listeler.map((l) => (
          <button type="button" key={l.kod} className={l.kod === liste.kod ? "am-aktif" : undefined} onClick={() => sec(l.kod)}>
            <b>{l.ad}</b>
            <small>{l.ogeler.filter((x) => x.acik).length} seçenek</small>
          </button>
        ))}
      </div>

      <section className="am-kart">
        <div className="am-kart-bas">
          <h3>{liste.ad}</h3>
          <span>{liste.aciklama}</span>
        </div>

        <div className={"am-liste-bas" + (liste.belgeSutunu ? " am-belgeli" : "")}>
          <span>Seçenek</span>
          <span>Açıklama zorunlu</span>
          {liste.belgeSutunu && <span>Belge istenir</span>}
          <span>Açık</span>
          <span />
        </div>

        {ogeler.map((x, i) => (
          <div key={i} className={"am-liste-satir" + (x.acik ? "" : " am-kapali") + (liste.belgeSutunu ? " am-belgeli" : "")}>
            <Input
              value={x.ad}
              disabled={!yaz}
              maxLength={60}
              onChange={(e) => degistir((l) => ((l[i].ad = e.target.value), l))}
            />
            <Checkbox
              checked={x.aciklamaZorunlu}
              disabled={!yaz}
              onChange={(e) => degistir((l) => ((l[i].aciklamaZorunlu = e.target.checked), l))}
            />
            {liste.belgeSutunu && (
              <Checkbox
                checked={!!x.belgeGerekli}
                disabled={!yaz}
                onChange={(e) => degistir((l) => ((l[i].belgeGerekli = e.target.checked), l))}
              />
            )}
            <Switch size="small" checked={x.acik} disabled={!yaz} onChange={(v) => degistir((l) => ((l[i].acik = v), l))} />
            <span className="am-liste-arac">
              <Button size="small" type="text" disabled={!yaz || i === 0} icon={<ArrowUp size={14} />}
                onClick={() => degistir((l) => ([l[i - 1], l[i]] = [l[i], l[i - 1]]) && l)} />
              <Button size="small" type="text" disabled={!yaz || i === ogeler.length - 1} icon={<ArrowDown size={14} />}
                onClick={() => degistir((l) => ([l[i + 1], l[i]] = [l[i], l[i + 1]]) && l)} />
              <Button size="small" type="text" danger disabled={!yaz} icon={<Trash2 size={14} />}
                onClick={() => degistir((l) => l.filter((_, j) => j !== i))} />
            </span>
          </div>
        ))}

        {liste.digerVar && diger && (
          <div className={"am-liste-satir am-sabit" + (digerAcik ? "" : " am-kapali") + (liste.belgeSutunu ? " am-belgeli" : "")}>
            <Input value="Diğer" disabled />
            <Checkbox checked disabled />
            {liste.belgeSutunu && <Checkbox checked={!!diger.belgeGerekli} disabled />}
            <Switch size="small" checked={digerAcik} disabled={!yaz} onChange={(v) => setDigerTaslak(v)} />
            <span className="am-soluk">{digerAcik ? "açıklama her zaman zorunlu" : "kapalı · yeni taleplerde çıkmaz"}</span>
          </div>
        )}

        {yaz && (
          <div className="am-dugmeler">
            <Button icon={<Plus size={14} />} onClick={() => degistir((l) => [...l, { ad: "", aciklamaZorunlu: false, acik: true }])}>
              Seçenek ekle
            </Button>
            <Button
              type="text"
              icon={<RotateCcw size={14} />}
              onClick={() =>
                setTaslak(
                  liste.varsayilan.map((ad) => ({
                    ad,
                    aciklamaZorunlu: false,
                    acik: true,
                    belgeGerekli: (liste.varsayilanBelgeli ?? []).includes(ad),
                  }))
                )
              }
            >
              Varsayılan listeye dön
            </Button>
          </div>
        )}

        <div className="am-soluk">
          Kapatılan seçenek yeni taleplerde çıkmaz; eski kayıtlarda yazılı kalır. Silmek yerine kapatmak geçmiş raporları korur.
        </div>
      </section>

      <DegisiklikGecmisi bolum="listeler" yenile={yenile} />

      <KaydetSeridi
        acik={kirli}
        yukleniyor={kaydediliyor}
        onKaydet={kaydet}
        onVazgec={() => {
          setTaslak(null);
          setDigerTaslak(null);
        }}
      />
    </div>
  );
}

/* ================================================================ Avans akışı */

interface AkisAdimi {
  ad: string;
  roller: string[];
  siciller: string[];
  onaylarsa: "bitir" | "sonraki";
  reddederse: "bitir" | "sonraki";
}

interface AkisVerisi {
  yazabilir: boolean;
  akis: { adimlar: AkisAdimi[]; araKarardaBildir: boolean };
  varsayilan: { adimlar: AkisAdimi[]; araKarardaBildir: boolean };
  roller: { kod: string; ad: string }[];
  gmy: { sicil: string; adSoyad: string | null };
  bekleyen: { asama: number; adet: number }[];
}

/** Akışın olası sonuçları: her yol için "İK reddetti → GMY onayladı = onaylanır" */
function Senaryolar({ adimlar }: { adimlar: AkisAdimi[] }) {
  type Yol = { kararlar: { ad: string; onay: boolean }[]; sonuc: boolean };
  const yollar: Yol[] = [];

  const yuru = (i: number, onceki: { ad: string; onay: boolean }[]) => {
    const a = adimlar[i];
    if (!a) return;
    const son = i === adimlar.length - 1;
    for (const onay of [true, false]) {
      const k = [...onceki, { ad: a.ad, onay }];
      const devam = !son && (onay ? a.onaylarsa : a.reddederse) === "sonraki";
      if (devam) yuru(i + 1, k);
      else yollar.push({ kararlar: k, sonuc: onay });
    }
  };
  yuru(0, []);

  return (
    <div className="am-senaryo">
      {yollar.map((y, i) => (
        <div key={i} className="am-senaryo-satir">
          {y.kararlar.map((k, j) => (
            <span key={j} className="am-senaryo-adim">
              {j > 0 && <ArrowRight size={13} className="am-soluk" />}
              <span className={k.onay ? "am-ok" : "am-red"}>
                {k.ad} {k.onay ? "onayladı" : "reddetti"}
              </span>
            </span>
          ))}
          <span className="am-senaryo-sonuc">
            = {y.sonuc ? <><CheckCircle2 size={14} /> onaylanır</> : <><XCircle size={14} /> reddedilir</>}
          </span>
        </div>
      ))}
    </div>
  );
}

export function AvansOnayAkisi({ onKirli }: { onKirli?: (k: boolean) => void }) {
  const { message } = AntdApp.useApp();
  const [veri, setVeri] = useState<AkisVerisi | null>(null);
  const [taslak, setTaslak] = useState<AkisVerisi["akis"] | null>(null);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const [yenile, setYenile] = useState(0);

  const getir = () =>
    api
      .al<AkisVerisi>("/api/AyarMerkezi/AvansAkisi")
      .then((v) => {
        setVeri(v);
        setTaslak(null);
      })
      .catch((h: any) => message.error(h.message));

  useEffect(() => {
    getir();
  }, []);

  useEffect(() => {
    onKirli?.(taslak !== null);
  }, [taslak !== null]);

  const rolAdi = useMemo(() => Object.fromEntries((veri?.roller ?? []).map((r) => [r.kod, r.ad])), [veri]);

  if (!veri) return <Spin />;

  const akis = taslak ?? veri.akis;
  const yaz = veri.yazabilir;
  const gmyEtiket = `GMY sicili (${veri.gmy.adSoyad ?? "?"} · ${veri.gmy.sicil})`;

  const degistir = (f: (a: AkisVerisi["akis"]) => void) => {
    const kopya = JSON.parse(JSON.stringify(akis));
    f(kopya);
    /* Son adımın kararı her zaman kesin */
    const s = kopya.adimlar[kopya.adimlar.length - 1];
    if (s) {
      s.onaylarsa = "bitir";
      s.reddederse = "bitir";
    }
    setTaslak(kopya);
  };

  const kaydet = async () => {
    if (!taslak) return;
    setKaydediliyor(true);
    try {
      const c = await api.gonder<{ tasinan: number }>("/api/AyarMerkezi/AvansAkisi", taslak);
      message.success(
        c.tasinan ? `Akış kaydedildi; kaldırılan adımda bekleyen ${c.tasinan} talep son adıma alındı.` : "Avans onay akışı kaydedildi."
      );
      await getir();
      setYenile((x) => x + 1);
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setKaydediliyor(false);
    }
  };

  const bekleyen = (i: number) => veri.bekleyen.find((x) => x.asama === i)?.adet ?? 0;

  return (
    <div className="am">
      <Alert
        type="info"
        showIcon
        message="Avans talebi adım adım ilerler"
        description="Her adımda karar verecek rolleri ve kişileri seçin. Adım onaylarsa ya da reddederse talebin sonuçlanacağını ya da bir sonraki adıma gideceğini belirleyin. Son adımın kararı her zaman kesindir. Panelde karar veren rol Avans Talepleri ekranında, Biçen360'ta karar veren kişi Onaylar ekranında talebi görür."
      />

      <div className="am-akis">
        <div className="am-akis-bas">
          <span className="am-akis-dugum am-baslangic">Personel talep eder</span>
        </div>
        {akis.adimlar.map((a, i) => {
          const son = i === akis.adimlar.length - 1;
          return (
            <section key={i} className="am-kart am-adim">
              <div className="am-adim-bas">
                <span className="am-adim-no">{i + 1}</span>
                <Input
                  value={a.ad}
                  disabled={!yaz}
                  maxLength={60}
                  onChange={(e) => degistir((x) => (x.adimlar[i].ad = e.target.value))}
                  style={{ maxWidth: 280, fontWeight: 600 }}
                />
                {bekleyen(i) > 0 && <Tag color="gold">{bekleyen(i)} talep bu adımda bekliyor</Tag>}
                <span className="am-bosluk" />
                {yaz && (
                  <>
                    <Button size="small" type="text" disabled={i === 0} icon={<ArrowUp size={14} />}
                      onClick={() => degistir((x) => ([x.adimlar[i - 1], x.adimlar[i]] = [x.adimlar[i], x.adimlar[i - 1]]))} />
                    <Button size="small" type="text" disabled={son} icon={<ArrowDown size={14} />}
                      onClick={() => degistir((x) => ([x.adimlar[i + 1], x.adimlar[i]] = [x.adimlar[i], x.adimlar[i + 1]]))} />
                    <Button size="small" type="text" danger disabled={akis.adimlar.length === 1} icon={<Trash2 size={14} />}
                      onClick={() => degistir((x) => x.adimlar.splice(i, 1))} />
                  </>
                )}
              </div>

              <div className="am-adim-izgara">
                <label>
                  <span>Panelde karar verenler (rol)</span>
                  <Select
                    mode="multiple"
                    disabled={!yaz}
                    value={a.roller}
                    options={veri.roller.map((r) => ({ value: r.kod, label: r.ad }))}
                    onChange={(v) => degistir((x) => (x.adimlar[i].roller = v))}
                    placeholder="Rol seçiniz"
                  />
                </label>
                <label>
                  <span>Biçen360'tan karar verenler (sicil)</span>
                  <Select
                    mode="tags"
                    disabled={!yaz}
                    value={a.siciller}
                    options={[{ value: "gmy", label: gmyEtiket }]}
                    onChange={(v) => degistir((x) => (x.adimlar[i].siciller = v))}
                    placeholder="Sicil yazınız"
                    tagRender={(t) => (
                      <Tag closable={yaz} onClose={t.onClose} style={{ marginInlineEnd: 4 }}>
                        {t.value === "gmy" ? gmyEtiket : `sicil ${t.value}`}
                      </Tag>
                    )}
                  />
                </label>
              </div>

              {son ? (
                <div className="am-soluk">Son adım: bu adımın onayı da reddi de kesindir.</div>
              ) : (
                <div className="am-adim-izgara">
                  <label>
                    <span>Onaylarsa</span>
                    <Segmented
                      disabled={!yaz}
                      value={a.onaylarsa}
                      options={[
                        { value: "bitir", label: "Talep onaylanır" },
                        { value: "sonraki", label: `${akis.adimlar[i + 1]?.ad ?? "Sonraki adım"} onayına gider` },
                      ]}
                      onChange={(v) => degistir((x) => (x.adimlar[i].onaylarsa = v as any))}
                    />
                  </label>
                  <label>
                    <span>Reddederse</span>
                    <Segmented
                      disabled={!yaz}
                      value={a.reddederse}
                      options={[
                        { value: "bitir", label: "Talep reddedilir" },
                        { value: "sonraki", label: `${akis.adimlar[i + 1]?.ad ?? "Sonraki adım"} onayına gider` },
                      ]}
                      onChange={(v) => degistir((x) => (x.adimlar[i].reddederse = v as any))}
                    />
                  </label>
                </div>
              )}
              <div className="am-soluk">
                Karar verebilenler: {[...a.roller.map((r) => rolAdi[r] ?? r), ...a.siciller.map((s) => (s === "gmy" ? gmyEtiket : `sicil ${s}`))].join(", ") || "—"} · Admin her adımda karar verebilir.
              </div>
            </section>
          );
        })}

        {yaz && akis.adimlar.length < 5 && (
          <Button
            icon={<Plus size={14} />}
            onClick={() =>
              degistir((x) => {
                const onceki = x.adimlar[x.adimlar.length - 1];
                if (onceki) onceki.reddederse = "sonraki";
                x.adimlar.push({ ad: `${x.adimlar.length + 1}. adım`, roller: [], siciller: [], onaylarsa: "bitir", reddederse: "bitir" });
              })
            }
          >
            Adım ekle
          </Button>
        )}
      </div>

      <section className="am-kart">
        <div className="am-kart-bas">
          <h3>Bu akışla olası sonuçlar</h3>
          <span>Kaydetmeden önce kontrol ediniz</span>
        </div>
        <Senaryolar adimlar={akis.adimlar} />
      </section>

      <section className="am-kart">
        <div className="am-satir">
          <div className="am-satir-metin">
            <b>Ara kararda personele bildirim</b>
            <small>
              Açıksa talep sonraki adıma geçince personele "talebiniz değerlendirmede" bildirimi gider. Kapalıyken personel ara reddi görmez; uygulamada
              talebi "… onayında" olarak görür.
            </small>
          </div>
          <div className="am-satir-deger">
            <Switch checked={akis.araKarardaBildir} disabled={!yaz} onChange={(v) => degistir((x) => (x.araKarardaBildir = v))} />
          </div>
        </div>
        {yaz && (
          <Button type="text" icon={<RotateCcw size={14} />} onClick={() => setTaslak(JSON.parse(JSON.stringify(veri.varsayilan)))}>
            Varsayılan akışa dön (İK reddederse GMY'ye gider)
          </Button>
        )}
      </section>

      <DegisiklikGecmisi bolum="avansakis" yenile={yenile} />

      <KaydetSeridi acik={taslak !== null} yukleniyor={kaydediliyor} onKaydet={kaydet} onVazgec={() => setTaslak(null)} />
    </div>
  );
}

/* ================================================================ Diğer akışlar */

/** Diğer onay akışlarının özeti; ayarı olanlarda ilgili bölüme geçiş */
export function OnayAkislariOzeti({ git }: { git: (k: string) => void }) {
  const [bolge, setBolge] = useState<boolean | null>(null);
  const [sure, setSure] = useState<number | null>(null);

  useEffect(() => {
    api
      .al<ParametreVerisi>("/api/AyarMerkezi/Parametreler")
      .then((v) => {
        setBolge(v.parametreler.find((p) => p.anahtar === "izin.bolgeAsamasi")?.deger === "true");
        setSure(Number(v.parametreler.find((p) => p.anahtar === "izin.otomatikOnaySaat")?.deger ?? 0));
      })
      .catch(() => undefined);
  }, []);

  const Akis = ({ baslik, adimlar, not, dugmeler }: { baslik: string; adimlar: string[]; not?: string; dugmeler?: [string, string][] }) => (
    <section className="am-kart">
      <div className="am-kart-bas">
        <h3>{baslik}</h3>
      </div>
      <div className="am-senaryo-satir">
        {adimlar.map((a, i) => (
          <span key={i} className="am-senaryo-adim">
            {i > 0 && <ArrowRight size={13} className="am-soluk" />}
            <span className="am-akis-dugum">{a}</span>
          </span>
        ))}
      </div>
      {not && <div className="am-soluk">{not}</div>}
      {dugmeler && (
        <div className="am-dugmeler">
          {dugmeler.map(([ad, k]) => (
            <Button key={k} size="small" onClick={() => git(k)}>
              {ad}
            </Button>
          ))}
        </div>
      )}
    </section>
  );

  return (
    <div className="am">
      <Akis
        baslik="Avans talepleri"
        adimlar={["Personel (Biçen360)", "Mağaza müdürü / birim yöneticisi", "Bölge müdürü (şubede)", "İnsan Kaynakları", "Genel müdür yardımcısı", "Onaylandı"]}
        not="Sıra pozisyona göre Avans onay tablosundan (İK'nın Excel'i). Kişiler Biçen360'ta İzin Onayları ekranından onaylar; bir kişi reddederse talep reddedilir."
        dugmeler={[["Avans onay tablosu", "avansakis"], ["Avans kuralları", "avanskurallari"]]}
      />
      <Akis
        baslik="İzin talepleri"
        adimlar={["Personel", "Mağaza müdürü / birim yöneticisi", "Bölge müdürü (şubede)", "İnsan Kaynakları", "Onaylandı"]}
        not={`23.10.2026'dan itibaren sıra Avans onay tablosundan, İnsan Kaynakları'nda biter (GMY adımı izinde yok). Fazla mesai ve rotasyon da aynı sırayla ilerler. Raporlu izinde form yok: onaylayanlar raporu görüp onaylar. Diğer türlerde şube personelinin birim yöneticisi, şube mailine gelen formun imzalı hâli Biçen360'tan yüklenmeden onaylayamaz.${
          sure ? ` Onay sırasındaki kişi ${sure} saat içinde karar vermezse otomatik onaylanır.` : " Otomatik onay kapalı."
        }`}
        dugmeler={[["Avans onay tablosu", "avansakis"], ["Bölgeler", "bolgeler"], ["Süreler ve sınırlar", "sureler"], ["İzin kuralları", "izinkurallari"]]}
      />
      <Akis
        baslik="Fazla mesai"
        adimlar={["Birim yöneticisi girer", "Form şubede imzalanır", "Sıradaki onay (Avans onay tablosu)", "İK evrakı yükleyip onaylar"]}
        not="İK evrak yüklenmeden onaylayamaz. Kayıt sınırları Süreler ve sınırlar › Fazla mesai'de."
        dugmeler={[["Süreler ve sınırlar", "sureler"]]}
      />
      <Akis
        baslik="İşe alım, rotasyon ve norm kadro"
        adimlar={["İK onaya gönderir", "Genel müdür yardımcısı (panel ya da Biçen360)", "Sonuç"]}
        not="Biçen360'ta patron görünümündeki kişiler Onaylar ekranından karar verebilir."
        dugmeler={[["Patron görünümü", "patron"]]}
      />
    </div>
  );
}

/** Yönetim içinde açılan pencere bileşenleri için basit çerçeve */
export function PencereAcici({ baslik, aciklama, dugme, children }: { baslik: string; aciklama: string; dugme: string; children: (kapat: () => void) => ReactNode }) {
  const [acik, setAcik] = useState(false);
  return (
    <div className="am">
      <section className="am-kart">
        <div className="am-satir">
          <div className="am-satir-metin">
            <b>{baslik}</b>
            <small>{aciklama}</small>
          </div>
          <div className="am-satir-deger">
            <Button type="primary" onClick={() => setAcik(true)}>
              {dugme}
            </Button>
          </div>
        </div>
      </section>
      {acik && children(() => setAcik(false))}
    </div>
  );
}


/** Ayarı başka sayfada duran bölümler için geçiş kartı */
export function GecisKarti({ baslik, aciklama, dugme, onGit }: { baslik: string; aciklama: string; dugme: string; onGit: () => void }) {
  return (
    <div className="am">
      <section className="am-kart">
        <div className="am-satir">
          <div className="am-satir-metin">
            <b>{baslik}</b>
            <small>{aciklama}</small>
          </div>
          <div className="am-satir-deger">
            <Button type="primary" icon={<ArrowRight size={14} />} onClick={onGit}>
              {dugme}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

/* ================================================================ Mikro kullanıcıları */

interface MikroKullanici {
  no: string;
  mikroAdi: string | null;
  elle: string | null;
  gorunen: string;
  gunlukte: boolean;
}

/**
 * Mikro'da personel kartını değiştiren kullanıcı numara olarak geliyor
 * ("Yapan: 130"). Ad Mikro'nun KULLANICILAR tablosundan bulunuyor;
 * bulunamayan ya da yanlış görünen numaraya burada ad yazılır.
 */
export function MikroKullaniciAdlari({ onKirli }: { onKirli?: (k: boolean) => void }) {
  const { message } = AntdApp.useApp();
  const [veri, setVeri] = useState<{ yazabilir: boolean; kaynak: string | null; hata: string | null; kullanicilar: MikroKullanici[] } | null>(null);
  const [taslak, setTaslak] = useState<Record<string, string> | null>(null);
  const [yeniNo, setYeniNo] = useState("");
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const [yenile, setYenile] = useState(0);
  const [ara, setAra] = useState("");

  const getir = () =>
    api
      .al<any>("/api/AyarMerkezi/MikroKullanicilar")
      .then((v) => {
        setVeri(v);
        setTaslak(null);
      })
      .catch((h: any) => message.error(h.message));

  useEffect(() => {
    getir();
  }, []);

  useEffect(() => {
    onKirli?.(taslak !== null);
  }, [taslak !== null]);

  if (!veri) return <Spin />;

  const elle: Record<string, string> =
    taslak ?? Object.fromEntries(veri.kullanicilar.filter((x) => x.elle).map((x) => [x.no, x.elle as string]));

  const numaralar = Array.from(new Set([...veri.kullanicilar.map((x) => x.no), ...Object.keys(elle)])).sort(
    (a, b) => Number(a) - Number(b)
  );
  const q = ara.trim().toLocaleLowerCase("tr");
  const bul = (no: string) => veri.kullanicilar.find((x) => x.no === no);
  const gorunenler = numaralar.filter((no) => {
    if (!q) return true;
    const x = bul(no);
    return `${no} ${x?.mikroAdi ?? ""} ${elle[no] ?? ""}`.toLocaleLowerCase("tr").includes(q);
  });

  const kaydet = async () => {
    if (!taslak) return;
    setKaydediliyor(true);
    try {
      await api.gonder("/api/AyarMerkezi/MikroKullanicilar", taslak);
      message.success("Kaydedildi; eski kayıtlardaki numaralar da ada çevrildi.");
      await getir();
      setYenile((x) => x + 1);
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setKaydediliyor(false);
    }
  };

  return (
    <div className="am">
      {veri.kaynak ? (
        <Alert type="success" showIcon message={`Adlar Mikro'dan okunuyor: ${veri.kaynak}`} description="Yanlış ya da boş görünen numaraya aşağıdan ad yazabilirsiniz; yazdığınız ad önce gelir." />
      ) : (
        <Alert
          type="warning"
          showIcon
          message="Mikro kullanıcı tablosu okunamadı"
          description={`${veri.hata ?? ""} Değişiklik günlüğünde geçen numaralara aşağıdan ad yazınız.`}
        />
      )}

      <section className="am-kart">
        <div className="am-kart-bas">
          <h3>Kullanıcılar</h3>
          <span>"Günlükte" işaretliler personel değişikliklerinde geçen numaralar</span>
        </div>
        <Input placeholder="Numara ya da ad ara" value={ara} onChange={(e) => setAra(e.target.value)} allowClear style={{ maxWidth: 280 }} />
        {gorunenler.length === 0 ? (
          <div className="am-soluk">Kayıt yok.</div>
        ) : (
          gorunenler.map((no) => {
            const x = bul(no);
            return (
              <div key={no} className="am-satir">
                <div className="am-satir-metin">
                  <b>
                    {no}
                    {x?.gunlukte && <Tag color="blue" className="am-etiket">günlükte</Tag>}
                  </b>
                  <small>Mikro'daki ad: {x?.mikroAdi ?? "bulunamadı"}</small>
                </div>
                <div className="am-satir-deger">
                  <Input
                    disabled={!veri.yazabilir}
                    style={{ width: 240 }}
                    placeholder={x?.mikroAdi ?? "Ad soyad yazınız"}
                    value={elle[no] ?? ""}
                    maxLength={80}
                    onChange={(e) => setTaslak({ ...elle, [no]: e.target.value })}
                  />
                </div>
              </div>
            );
          })
        )}
        {veri.yazabilir && (
          <div className="am-dugmeler">
            <Input
              style={{ width: 140 }}
              placeholder="Numara (ör. 130)"
              value={yeniNo}
              onChange={(e) => setYeniNo(e.target.value.replace(/\D/g, ""))}
            />
            <Button
              icon={<Plus size={14} />}
              disabled={!yeniNo || numaralar.includes(yeniNo)}
              onClick={() => {
                setTaslak({ ...elle, [yeniNo]: "" });
                setYeniNo("");
              }}
            >
              Numara ekle
            </Button>
          </div>
        )}
      </section>

      <DegisiklikGecmisi bolum="mikrokullanici" yenile={yenile} />

      <KaydetSeridi acik={taslak !== null} yukleniyor={kaydediliyor} onKaydet={kaydet} onVazgec={() => setTaslak(null)} />
    </div>
  );
}
