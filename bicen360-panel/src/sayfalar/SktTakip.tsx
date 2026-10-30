/**
 * ---------------------------------------------------------------------------
 * SKT Takip (23.10.2026)
 * ---------------------------------------------------------------------------
 * Mağazalardan Biçen360 ile girilen son kullanma tarihleri: aylık kategori
 * planı, şube ilerlemesi, kritik ürünler, ürün ve kategori analizi.
 *
 * Veri tarih aralığına göre bir kez çekiliyor (/api/Skt/Veri, parti başına
 * satır); şube, ana grup, kategori, durum, ürün ve kaynak süzgeçleri
 * tarayıcıda. Böylece sekmeler arasında geçiş anında.
 *
 * Kalan gün: geçmiş (< 0), kritik 0–7, yaklaşıyor 8–30, uygun > 30.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Checkbox, Drawer, Input, Modal, Select, Spin, message } from "antd";
import { Bell, Copy, Download, Plus, RefreshCw, Trash2, Upload, X } from "lucide-react";
import dayjs from "dayjs";
import "dayjs/locale/tr";

import { api } from "../api";
import { CubukGrafik, HalkaGrafik, N0, RM, saydam } from "../RmGrafik";
import { Bekle, Kart, Kpiler, Tablo, type Kopya, type Sutun } from "./RaporMerkezi";
import "./RaporMerkezi.css";

/* ========================================================================== */

type Durum = "gec" | "kri" | "yak" | "uyg" | "yok";

interface Kayit {
  kontrolId: number;
  partiId: number | null;
  planId: number | null;
  kaynak: "plan" | "serbest";
  sube: string;
  stokKod: string;
  barkod: string | null;
  ad: string | null;
  grup: string | null;
  kat: string | null;
  tur: "skt" | "yok";
  not: string | null;
  kisi: string | null;
  tarih: string;
  skt: string | null;
  adet: number | null;
  kalan: number | null;
  durum: Durum;
  aksiyon: string | null;
  aksiyonYapan: string | null;
}

interface Plan {
  id: number;
  ay: string;
  sube: string;
  kategori: string;
  aciklama: string | null;
  sonGun: string | null;
  urun: number;
  yapilan: number;
  katilan: number;
  son: string | null;
}

const DURUM_AD: Record<Durum, string> = { gec: "Geçmiş", kri: "0–7 gün", yak: "8–30 gün", uyg: "Uygun", yok: "Ürün yok" };
const DURUM_SINIF: Record<Durum, string> = { gec: "bad", kri: "warn", yak: "info", uyg: "good", yok: "" };
const DURUM_RENK: Record<Durum, string> = { gec: RM.bad, kri: "#E3A33B", yak: "#E8C547", uyg: RM.brand, yok: "#B7BDB0" };
const SORUNLU: Durum[] = ["gec", "kri", "yak"];
const AKSIYONLAR = ["İndirime alındı", "Başka şubeye transfer", "Tedarikçiye iade", "İmha / fire", "Raftan kaldırıldı"];

const iso = (d: dayjs.Dayjs) => d.format("YYYY-MM-DD");
const tarih = (s: string | null | undefined) => (s ? dayjs(s).format("DD.MM.YYYY") : "—");
const kalanMetin = (k: number | null) => (k == null ? "—" : k < 0 ? `${-k} gün geçti` : k === 0 ? "bugün" : `${k} gün`);
const Hap = ({ d, m }: { d: Durum; m?: string }) => <span className={`rm-hap ${DURUM_SINIF[d]}`}>{m ?? DURUM_AD[d]}</span>;
const kucuk = (s: string) => (s ?? "").toLocaleLowerCase("tr");

type Donem = "bugun" | "7" | "ay" | "gecen" | "90" | "ozel";
const aralik = (d: Donem): [string, string] => {
  const b = dayjs();
  if (d === "bugun") return [iso(b), iso(b)];
  if (d === "7") return [iso(b.subtract(6, "day")), iso(b)];
  if (d === "gecen") return [iso(b.subtract(1, "month").startOf("month")), iso(b.subtract(1, "month").endOf("month"))];
  if (d === "90") return [iso(b.subtract(89, "day")), iso(b)];
  return [iso(b.startOf("month")), iso(b)];
};

type Sekme = "durum" | "kritik" | "urun" | "kategori" | "plan" | "kayit";

/* ========================================================================== */

export default function SktTakip() {
  const [sekme, setSekme] = useState<Sekme>("durum");
  const [donem, setDonem] = useState<Donem>("ay");
  const [[bas, bit], setAralik] = useState<[string, string]>(aralik("ay"));
  const [kayitlar, setKayitlar] = useState<Kayit[] | null>(null);
  const [planlar, setPlanlar] = useState<Plan[]>([]);
  const [ay, setAy] = useState(dayjs().format("YYYY-MM"));
  const [aylar, setAylar] = useState<string[]>([]);
  /* 26.10.2026: otomatik plan ayarı (sunucudan) */
  const [otomatik, setOtomatik] = useState<{ acik: boolean; gun: number } | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [secenek, setSecenek] = useState<{ subeler: string[]; gruplar: string[] }>({ subeler: [], gruplar: [] });

  const [sube, setSube] = useState("");
  const [grup, setGrup] = useState("");
  const [kat, setKat] = useState("");
  const [durum, setDurum] = useState<"" | "sorunlu" | Durum>("");
  const [kaynak, setKaynak] = useState<"" | "plan" | "serbest">("");
  const [ara, setAra] = useState("");

  const [subeDetay, setSubeDetay] = useState<string | null>(null);
  const [urunDetay, setUrunDetay] = useState<string | null>(null);
  const kopya: Kopya = useRef({});

  const getir = useCallback(async () => {
    setYukleniyor(true);
    try {
      const [v, p] = await Promise.all([
        api.getir<{ kayitlar: Kayit[] }>(`Skt/Veri?bas=${bas}&bit=${bit}`),
        api.getir<{ planlar: Plan[]; aylar: string[]; otomatik?: { acik: boolean; gun: number } }>(`Skt/Planlar?ay=${ay}`),
      ]);
      setKayitlar(v?.kayitlar ?? []);
      setPlanlar(p?.planlar ?? []);
      setAylar(p?.aylar ?? []);
      setOtomatik(p?.otomatik ?? null);
      setHata(null);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Veri alınamadı.");
    } finally {
      setYukleniyor(false);
    }
  }, [bas, bit, ay]);

  useEffect(() => {
    getir();
  }, [getir]);

  useEffect(() => {
    api.getir<{ subeler: string[]; gruplar: string[] }>("Skt/Secenekler").then((s) => s && setSecenek(s)).catch(() => undefined);
  }, []);

  /* ------------------------------------------------------------ süzme */
  const suzulmus = useMemo(() => {
    const q = kucuk(ara.trim());
    return (kayitlar ?? []).filter(
      (k) =>
        (!sube || k.sube === sube) &&
        (!grup || k.grup === grup) &&
        (!kat || k.kat === kat) &&
        (!kaynak || k.kaynak === kaynak) &&
        (!durum || (durum === "sorunlu" ? SORUNLU.includes(k.durum) : k.durum === durum)) &&
        (!q || kucuk(k.ad ?? "").includes(q) || (k.barkod ?? "").includes(q) || k.stokKod.includes(q))
    );
  }, [kayitlar, sube, grup, kat, kaynak, durum, ara]);

  const benzersiz = (a: (string | null)[]) => [...new Set(a.filter(Boolean) as string[])].sort((x, y) => x.localeCompare(y, "tr"));
  const subeler = useMemo(() => benzersiz([...(kayitlar ?? []).map((k) => k.sube), ...planlar.map((p) => p.sube)]), [kayitlar, planlar]);
  const gruplar = useMemo(() => benzersiz((kayitlar ?? []).map((k) => k.grup)), [kayitlar]);
  const katlar = useMemo(() => benzersiz((kayitlar ?? []).filter((k) => !grup || k.grup === grup).map((k) => k.kat)), [kayitlar, grup]);

  const urunSay = (a: Kayit[]) => new Set(a.map((k) => `${k.sube}|${k.stokKod}`)).size;
  const adet = (a: Kayit[]) => a.reduce((t, k) => t + (k.adet ?? 0), 0);

  const planSecili = planlar.filter((p) => !sube || p.sube === sube);
  const hedef = planSecili.reduce((t, p) => t + p.urun, 0);
  const yapilan = planSecili.reduce((t, p) => t + Math.min(p.yapilan, p.urun), 0);

  const kpi = [
    { l: "Kontrol edilen ürün", v: N0.format(urunSay(suzulmus)), k: `${N0.format(suzulmus.length)} kayıt · ${new Set(suzulmus.map((x) => x.sube)).size} şube` },
    { l: "SKT geçmiş", v: <span style={{ color: RM.bad }}>{N0.format(adet(suzulmus.filter((k) => k.durum === "gec")))} adet</span>, k: `${urunSay(suzulmus.filter((k) => k.durum === "gec"))} ürün` },
    { l: "0–7 gün kalan", v: <span style={{ color: "#B9800A" }}>{N0.format(adet(suzulmus.filter((k) => k.durum === "kri")))} adet</span>, k: `${urunSay(suzulmus.filter((k) => k.durum === "kri"))} ürün · hemen aksiyon` },
    { l: "8–30 gün kalan", v: <span style={{ color: RM.info }}>{N0.format(adet(suzulmus.filter((k) => k.durum === "yak")))} adet</span>, k: `${urunSay(suzulmus.filter((k) => k.durum === "yak"))} ürün · indirim/transfer` },
    { l: `${dayjs(ay + "-01").locale("tr").format("MMMM")} planı`, v: hedef ? `%${N0.format((100 * yapilan) / hedef)}` : "—", k: `${N0.format(yapilan)}/${N0.format(hedef)} ürün · ${planSecili.length} şube` },
  ];

  /* ----------------------------------------------------------- dışa aktar */
  const disaAktar = () => {
    const bas2 = ["Kontrol tarihi", "Şube", "Barkod", "Stok kodu", "Ürün", "Ana grup", "Kategori", "Kaynak", "Tür", "SKT", "Kalan gün", "Durum", "Adet", "Aksiyon", "Giren", "Not"];
    const satir = suzulmus.map((k) => [
      tarih(k.tarih), k.sube, k.barkod ?? "", k.stokKod, k.ad ?? "", k.grup ?? "", k.kat ?? "", k.kaynak === "plan" ? "Plan" : "Serbest",
      k.tur === "yok" ? "Ürün yok" : "SKT", k.skt ? tarih(k.skt) : "", k.kalan ?? "", DURUM_AD[k.durum], k.adet ?? "", k.aksiyon ?? "", k.kisi ?? "", k.not ?? "",
    ]);
    const metin = (h: unknown) => (typeof h === "number" ? String(h).replace(".", ",") : String(h));
    const csv = "﻿" + [bas2, ...satir].map((s) => s.map((h) => `"${metin(h).replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `skt-${bas}_${bit}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const kopyala = (id: string) => {
    const k = kopya.current[id]?.();
    if (!k) return;
    navigator.clipboard?.writeText(k.tsv).then(
      () => message.success(`${N0.format(k.adet)} satır kopyalandı; Excel'e yapıştırabilirsiniz.`),
      () => message.error("Kopyalanamadı.")
    );
  };
  const KopyaDugme = ({ id }: { id: string }) => (
    <button className="rm-dugme yuvarlak" onClick={() => kopyala(id)} title="Tabloyu kopyala (Excel'e yapıştırılır)">
      <Copy size={12} /> Kopyala
    </button>
  );

  const aksiyonYaz = async (k: Kayit, a: string) => {
    if (!k.partiId) return;
    try {
      await api.gonder("Skt/Aksiyon", { partiId: k.partiId, aksiyon: a || null });
      setKayitlar((o) => (o ?? []).map((x) => (x.partiId === k.partiId ? { ...x, aksiyon: a || null } : x)));
      message.success(a ? `${k.ad} · ${k.sube}: ${a}` : "Aksiyon kaldırıldı");
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Kaydedilemedi.");
    }
  };

  const temizle = () => {
    setSube("");
    setGrup("");
    setKat("");
    setDurum("");
    setKaynak("");
    setAra("");
  };

  const cipler: [string, string, () => void][] = [
    ...(sube ? [["s", `Şube: ${sube}`, () => setSube("")] as [string, string, () => void]] : []),
    ...(grup ? [["g", `Ana grup: ${grup}`, () => (setGrup(""), setKat(""))] as [string, string, () => void]] : []),
    ...(kat ? [["k", `Kategori: ${kat}`, () => setKat("")] as [string, string, () => void]] : []),
    ...(durum ? [["d", `Durum: ${durum === "sorunlu" ? "Sorunlu" : DURUM_AD[durum]}`, () => setDurum("")] as [string, string, () => void]] : []),
    ...(kaynak ? [["y", `Kaynak: ${kaynak === "plan" ? "Plan" : "Serbest"}`, () => setKaynak("")] as [string, string, () => void]] : []),
    ...(ara ? [["a", `Ürün: ${ara}`, () => setAra("")] as [string, string, () => void]] : []),
  ];

  /* ============================================================ sekmeler */

  const durumSekmesi = () => {
    const satirlar = planSecili.map((p) => {
      const kf = suzulmus.filter((k) => k.sube === p.sube);
      return {
        ...p,
        oran: p.urun ? Math.min(1, p.yapilan / p.urun) : 0,
        gec: adet(kf.filter((k) => k.durum === "gec")),
        kri: adet(kf.filter((k) => k.durum === "kri")),
        yak: adet(kf.filter((k) => k.durum === "yak")),
        yok: kf.filter((k) => k.durum === "yok").length,
      };
    });
    type S = (typeof satirlar)[number];
    const sut: Sutun<S>[] = [
      { k: "sube", l: "Şube", f: (r) => <b>{r.sube}</b> },
      { k: "kategori", l: `${dayjs(ay + "-01").locale("tr").format("MMMM")} kategorisi`, f: (r) => <span style={{ fontSize: 12.5 }}>{r.kategori}</span> },
      {
        k: "oran",
        l: "İlerleme",
        num: true,
        f: (r) => (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 150 }}>
            <span className="rm-cubuk-hucre" style={{ flex: 1, height: 8, background: "#eef0ea", borderRadius: 6, overflow: "hidden", display: "block", position: "relative" }}>
              <i style={{ width: `${r.oran * 100}%`, background: r.oran >= 1 ? RM.good : r.oran < 0.3 ? RM.bad : r.oran < 0.7 ? "#E3A33B" : RM.brand, display: "block", height: "100%", opacity: 1 }} />
            </span>
            <span style={{ fontSize: 12, width: 64 }}>
              {r.yapilan}/{r.urun}
            </span>
          </span>
        ),
        tx: (r) => `${r.yapilan}/${r.urun}`,
      },
      { k: "gec", l: "Geçmiş", num: true, f: (r) => (r.gec ? <Hap d="gec" m={N0.format(r.gec)} /> : "–") },
      { k: "kri", l: "0–7 gün", num: true, f: (r) => (r.kri ? <Hap d="kri" m={N0.format(r.kri)} /> : "–") },
      { k: "yak", l: "8–30 gün", num: true, f: (r) => (r.yak ? <Hap d="yak" m={N0.format(r.yak)} /> : "–") },
      { k: "yok", l: "Ürün yok", num: true, f: (r) => r.yok || "–" },
      { k: "katilan", l: "Katılan", num: true },
      { k: "son", l: "Son kontrol", sv: (r) => r.son ?? "", f: (r) => (r.son ? tarih(r.son) : <span className="rm-hap bad">Başlamadı</span>), tx: (r) => (r.son ? tarih(r.son) : "Başlamadı") },
    ];
    return (
      <Kart sinif="c12" baslik="Şube durumu" ipucu={`${dayjs(ay + "-01").locale("tr").format("MMMM YYYY")} planı · adetler seçili tarih aralığından · satıra tıklayınca ayrıntı`} araclar={<KopyaDugme id="durum" />}>
        {planSecili.length === 0 ? (
          <div className="rm-bos" style={{ padding: 30 }}>
            Bu ay için plan yok. "Aylık plan" sekmesinden Excel'i içe aktarabilir ya da önceki ayı kaydırabilirsiniz.
          </div>
        ) : (
          <Tablo id="durum" sutunlar={sut} satirlar={satirlar} varsayilan="oran" yon={1} kopya={kopya} tikla={(r) => setSubeDetay(r.sube)} />
        )}
      </Kart>
    );
  };

  const kritikSekmesi = () => {
    const s = suzulmus.filter((k) => SORUNLU.includes(k.durum));
    const sut: Sutun<Kayit>[] = [
      { k: "kalan", l: "Kalan", num: true, sv: (r) => r.kalan ?? 9999, f: (r) => <Hap d={r.durum} m={kalanMetin(r.kalan)} />, tx: (r) => r.kalan ?? "" },
      { k: "ad", l: "Ürün", f: (r) => <span><b>{r.ad}</b><br /><small style={{ color: RM.muted }}>{r.barkod}</small></span>, tx: (r) => r.ad ?? "" },
      { k: "sube", l: "Şube" },
      { k: "kat", l: "Kategori", f: (r) => <span style={{ fontSize: 12 }}>{r.grup} › {r.kat}</span>, tx: (r) => `${r.grup} › ${r.kat}` },
      { k: "skt", l: "SKT", sv: (r) => r.skt ?? "", f: (r) => tarih(r.skt), tx: (r) => tarih(r.skt) },
      { k: "adet", l: "Adet", num: true },
      { k: "tarih", l: "Kontrol", sv: (r) => r.tarih, f: (r) => <span>{tarih(r.tarih)}<br /><small style={{ color: RM.muted }}>{r.kisi}</small></span>, tx: (r) => tarih(r.tarih) },
      {
        k: "aksiyon",
        l: "Aksiyon",
        suzgecYok: false,
        sv: (r) => r.aksiyon ?? "",
        f: (r) => (
          <select
            value={r.aksiyon ?? ""}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => aksiyonYaz(r, e.target.value)}
            style={{ border: `1px solid ${RM.line}`, borderRadius: 6, padding: "3px 6px", fontSize: 12, background: r.aksiyon ? saydam(RM.brand, 0.12) : "#fff" }}
          >
            <option value="">Seçiniz</option>
            {AKSIYONLAR.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        ),
        tx: (r) => r.aksiyon ?? "",
      },
    ];
    return (
      <Kart sinif="c12" baslik="Kritik ürünler" ipucu="geçmiş ve 30 gün içinde dolacak partiler · en acil üstte · aksiyon kaydedilir" araclar={<KopyaDugme id="kritik" />}>
        <Tablo id="kritik" suzgec sutunlar={sut} satirlar={s} varsayilan="kalan" yon={1} kopya={kopya} tikla={(r) => setUrunDetay(r.stokKod)} />
      </Kart>
    );
  };

  const urunSekmesi = () => {
    const m = new Map<string, { stokKod: string; barkod: string | null; ad: string | null; kat: string | null; kontrol: Set<string>; sorunlu: Set<string>; gec: number; kri: number; yak: number; enYakin: number | null }>();
    suzulmus.forEach((k) => {
      const u = m.get(k.stokKod) ?? { stokKod: k.stokKod, barkod: k.barkod, ad: k.ad, kat: k.kat, kontrol: new Set(), sorunlu: new Set(), gec: 0, kri: 0, yak: 0, enYakin: null };
      u.kontrol.add(k.sube);
      if (SORUNLU.includes(k.durum)) {
        u.sorunlu.add(k.sube);
        (u as any)[k.durum] += k.adet ?? 0;
        if (k.kalan != null && (u.enYakin == null || k.kalan < u.enYakin)) u.enYakin = k.kalan;
      }
      m.set(k.stokKod, u);
    });
    const satirlar = [...m.values()]
      .filter((u) => u.sorunlu.size > 0)
      .map((u) => ({ ...u, kontrolS: u.kontrol.size, sorunluS: u.sorunlu.size, toplam: u.gec + u.kri + u.yak, oran: u.sorunlu.size / Math.max(1, u.kontrol.size) }));
    type S = (typeof satirlar)[number];
    const durumOf = (k: number | null): Durum => (k == null ? "uyg" : k < 0 ? "gec" : k <= 7 ? "kri" : k <= 30 ? "yak" : "uyg");
    const sut: Sutun<S>[] = [
      { k: "ad", l: "Ürün", f: (r) => <span><b>{r.ad}</b><br /><small style={{ color: RM.muted }}>{r.barkod} · {r.kat}</small></span>, tx: (r) => r.ad ?? "" },
      { k: "sorunluS", l: "Sorunlu şube", num: true, f: (r) => `${r.sorunluS} / ${r.kontrolS}` },
      { k: "gec", l: "Geçmiş", num: true, f: (r) => (r.gec ? <Hap d="gec" m={N0.format(r.gec)} /> : "–") },
      { k: "kri", l: "0–7", num: true, f: (r) => (r.kri ? <Hap d="kri" m={N0.format(r.kri)} /> : "–") },
      { k: "yak", l: "8–30", num: true, f: (r) => (r.yak ? <Hap d="yak" m={N0.format(r.yak)} /> : "–") },
      { k: "enYakin", l: "En yakın", num: true, sv: (r) => r.enYakin ?? 9999, f: (r) => <Hap d={durumOf(r.enYakin)} m={kalanMetin(r.enYakin)} /> },
      { k: "toplam", l: "Toplam adet", num: true, f: (r) => <b>{N0.format(r.toplam)}</b> },
    ];
    return (
      <Kart sinif="c12" baslik="Ürün analizi" ipucu="birden çok şubede yakın SKT'li ürün sevkiyat/tedarik kaynaklı olabilir · satıra tıklayınca şube dağılımı" araclar={<KopyaDugme id="urun" />}>
        <Tablo id="urun" suzgec sutunlar={sut} satirlar={satirlar} varsayilan="toplam" kopya={kopya} tikla={(r) => setUrunDetay(r.stokKod)} />
      </Kart>
    );
  };

  const kategoriSekmesi = () => {
    const alan: "grup" | "kat" = grup ? "kat" : "grup";
    const adlar = benzersiz(suzulmus.map((k) => k[alan]));
    const kovalar: Durum[] = ["gec", "kri", "yak", "uyg", "yok"];
    const veri = adlar
      .map((a) => {
        const kf = suzulmus.filter((k) => k[alan] === a);
        const o: Record<string, number> = {};
        kovalar.forEach((d) => (o[d] = kf.filter((k) => k.durum === d).length));
        const sorun = o.gec + o.kri + o.yak;
        return { ad: a, toplam: kf.length, ...o, sorun, oran: kf.length ? sorun / kf.length : 0, adet: adet(kf.filter((k) => SORUNLU.includes(k.durum))) } as any;
      })
      .sort((x, y) => y.oran - x.oran);
    const ilk = veri.slice(0, 15);
    const tumDurum = kovalar.map((d) => ({ ad: DURUM_AD[d], deger: suzulmus.filter((k) => k.durum === d).length, renk: DURUM_RENK[d] }));
    const sut: Sutun<any>[] = [
      { k: "ad", l: alan === "grup" ? "Ana grup" : "Kategori", f: (r) => <b>{r.ad}</b> },
      ...kovalar.map((d) => ({ k: d, l: DURUM_AD[d], num: true, f: (r: any) => (r[d] ? <span style={{ display: "inline-block", minWidth: 34, padding: "1px 6px", borderRadius: 5, background: saydam(DURUM_RENK[d], Math.min(0.85, 0.15 + r[d] / 20)), color: r[d] > 12 ? "#fff" : RM.fg, fontWeight: 600 }}>{r[d]}</span> : "–") })),
      { k: "oran", l: "Sorun %", num: true, f: (r) => <b>%{N0.format(r.oran * 100)}</b>, tx: (r) => N0.format(r.oran * 100) },
      { k: "adet", l: "Sorunlu adet", num: true },
    ];
    return (
      <div className="rm-izgara">
        <Kart sinif="c8" baslik={alan === "grup" ? "Ana gruplarda sorun oranı" : "Kategorilerde sorun oranı"} ipucu="geçmiş + 30 gün içinde dolacak kayıtların oranı · ilk 15">
          <CubukGrafik
            yatay
            yukseklik={Math.max(220, ilk.length * 26 + 40)}
            etiketler={ilk.map((v) => v.ad)}
            seriler={[{ ad: "Sorun oranı", veri: ilk.map((v) => Math.round(v.oran * 1000) / 10), renk: ilk.map((v) => (v.oran > 0.3 ? RM.bad : v.oran > 0.15 ? "#E3A33B" : RM.brand)) }]}
            bicim={(v) => `%${N0.format(v)}`}
            tikla={(i) => (alan === "grup" ? setGrup(ilk[i].ad) : setKat(ilk[i].ad))}
          />
        </Kart>
        <Kart sinif="c4" baslik="Durum dağılımı" ipucu="kayıt sayısı">
          <HalkaGrafik dilimler={tumDurum} bicim={(v) => N0.format(v)} />
        </Kart>
        <Kart sinif="c12" baslik={`${alan === "grup" ? "Ana grup" : "Kategori"} × durum`} ipucu={grup ? "" : "ana gruba tıklayınca kategorilere iner"} araclar={<KopyaDugme id="kategori" />}>
          <Tablo id="kategori" sutunlar={sut} satirlar={veri} varsayilan="oran" kopya={kopya} tikla={(r) => (alan === "grup" ? setGrup(r.ad) : setKat(r.ad))} />
        </Kart>
      </div>
    );
  };

  const kayitSekmesi = () => {
    const sut: Sutun<Kayit>[] = [
      { k: "tarih", l: "Kontrol", sv: (r) => r.tarih, f: (r) => tarih(r.tarih), tx: (r) => tarih(r.tarih) },
      { k: "sube", l: "Şube" },
      { k: "ad", l: "Ürün", f: (r) => <span>{r.ad}<br /><small style={{ color: RM.muted }}>{r.barkod}</small></span>, tx: (r) => r.ad ?? "" },
      { k: "kat", l: "Kategori", soluk: true },
      { k: "skt", l: "SKT", sv: (r) => r.skt ?? "", f: (r) => tarih(r.skt), tx: (r) => tarih(r.skt) },
      { k: "kalan", l: "Kalan", num: true, sv: (r) => r.kalan ?? 9999, f: (r) => <Hap d={r.durum} m={r.kalan == null ? DURUM_AD[r.durum] : kalanMetin(r.kalan)} />, tx: (r) => r.kalan ?? DURUM_AD[r.durum] },
      { k: "adet", l: "Adet", num: true, f: (r) => r.adet ?? "–" },
      { k: "kisi", l: "Giren", soluk: true },
      { k: "kaynak", l: "Kaynak", f: (r) => (r.kaynak === "serbest" ? <span className="rm-hap info">Serbest</span> : "Plan"), tx: (r) => r.kaynak },
      { k: "not", l: "Not", soluk: true, f: (r) => r.not ?? "" },
    ];
    return (
      <Kart sinif="c12" baslik="Tüm kayıtlar" ipucu={`${N0.format(suzulmus.length)} satır · parti başına`} araclar={<KopyaDugme id="kayit" />}>
        <Tablo id="kayit" suzgec sutunlar={sut} satirlar={suzulmus} varsayilan="tarih" limit={300} kopya={kopya} />
      </Kart>
    );
  };

  /* ============================================================== çizim */

  return (
    <div className="rm">
      <div className="rm-ust">
        <div>
          <h1>SKT Takip</h1>
          <div className="rm-alt">
            Mağazalardan girilen son kullanma tarihleri · {tarih(bas)} – {tarih(bit)}
          </div>
        </div>
        <div className="rm-sag">
          <button className="rm-dugme yuvarlak" onClick={getir} title="Yenile">
            <RefreshCw size={13} className={yukleniyor ? "rm-don" : undefined} /> Yenile
          </button>
          <button className="rm-dugme" onClick={disaAktar} disabled={!suzulmus.length}>
            <Download size={13} /> Excel'e aktar
          </button>
        </div>
      </div>

      <nav className="rm-sekmeler" role="tablist">
        {(
          [
            ["durum", "Şube durumu"],
            ["kritik", "Kritik ürünler"],
            ["urun", "Ürün analizi"],
            ["kategori", "Kategori analizi"],
            ["plan", "Aylık plan"],
            ["kayit", "Tüm kayıtlar"],
          ] as const
        ).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={sekme === k} onClick={() => setSekme(k)}>
            {l}
          </button>
        ))}
      </nav>

      {sekme === "plan" ? (
        <PlanSekmesi ay={ay} setAy={setAy} aylar={aylar} planlar={planlar} yenile={getir} secenek={secenek} otomatik={otomatik} />
      ) : (
        <>
          <div className="rm-suzgec">
            <div className="rm-alan">
              <label>Dönem</label>
              <select
                value={donem}
                onChange={(e) => {
                  const d = e.target.value as Donem;
                  setDonem(d);
                  if (d !== "ozel") setAralik(aralik(d));
                }}
              >
                <option value="bugun">Bugün</option>
                <option value="7">Son 7 gün</option>
                <option value="ay">Bu ay</option>
                <option value="gecen">Geçen ay</option>
                <option value="90">Son 90 gün</option>
                <option value="ozel">Özel aralık…</option>
              </select>
            </div>
            <div className="rm-alan">
              <label>Başlangıç</label>
              <input type="date" value={bas} max={bit} onChange={(e) => e.target.value && (setDonem("ozel"), setAralik([e.target.value, bit]))} />
            </div>
            <div className="rm-alan">
              <label>Bitiş</label>
              <input type="date" value={bit} min={bas} onChange={(e) => e.target.value && (setDonem("ozel"), setAralik([bas, e.target.value]))} />
            </div>
            <div className="rm-alan">
              <label>Plan ayı</label>
              <select value={ay} onChange={(e) => setAy(e.target.value)}>
                {[...new Set([dayjs().format("YYYY-MM"), ...aylar])].sort().reverse().map((a) => (
                  <option key={a} value={a}>
                    {dayjs(a + "-01").locale("tr").format("MMMM YYYY")}
                  </option>
                ))}
              </select>
            </div>
            <div className="rm-alan">
              <label>Şube</label>
              <select value={sube} onChange={(e) => setSube(e.target.value)}>
                <option value="">Tüm şubeler</option>
                {subeler.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </div>
            <div className="rm-alan">
              <label>Ana grup</label>
              <select value={grup} onChange={(e) => (setGrup(e.target.value), setKat(""))}>
                <option value="">Tüm ana gruplar</option>
                {gruplar.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </div>
            <div className="rm-alan">
              <label>Kategori</label>
              <select value={kat} onChange={(e) => setKat(e.target.value)}>
                <option value="">Tüm kategoriler</option>
                {katlar.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </div>
            <div className="rm-alan">
              <label>Durum</label>
              <select value={durum} onChange={(e) => setDurum(e.target.value as any)}>
                <option value="">Hepsi</option>
                <option value="sorunlu">Sorunlu (geçmiş + 30 gün)</option>
                {(Object.keys(DURUM_AD) as Durum[]).map((d) => (
                  <option key={d} value={d}>
                    {DURUM_AD[d]}
                  </option>
                ))}
              </select>
            </div>
            <div className="rm-alan">
              <label>Kaynak</label>
              <span className="rm-dilim">
                {(
                  [
                    ["", "Tümü"],
                    ["plan", "Plan"],
                    ["serbest", "Serbest"],
                  ] as const
                ).map(([k, l]) => (
                  <button key={l} aria-pressed={kaynak === k} onClick={() => setKaynak(k)}>
                    {l}
                  </button>
                ))}
              </span>
            </div>
            <div className="rm-alan">
              <label>Ürün</label>
              <input type="search" placeholder="Ad, barkod, stok kodu" value={ara} onChange={(e) => setAra(e.target.value)} />
            </div>
            <button className="rm-dugme" onClick={temizle} style={{ height: 34 }}>
              Filtreleri temizle
            </button>
          </div>

          <div className="rm-cipler">
            {cipler.length ? (
              cipler.map(([k, l, kaldir]) => (
                <span key={k} className="rm-cip">
                  {l}
                  <button aria-label="Kaldır" onClick={kaldir}>
                    <X size={12} />
                  </button>
                </span>
              ))
            ) : (
              <span className="rm-ipucu-metin">Satırlara tıklayarak şube ve ürün ayrıntısını açabilir, grafiklere tıklayarak süzebilirsiniz.</span>
            )}
          </div>

          {!kayitlar ? (
            <Bekle hata={hata} metin="SKT kayıtları okunuyor…" />
          ) : (
            <>
              <Kpiler liste={kpi} yukleniyor={yukleniyor} />
              {sekme === "durum" && durumSekmesi()}
              {sekme === "kritik" && kritikSekmesi()}
              {sekme === "urun" && urunSekmesi()}
              {sekme === "kategori" && kategoriSekmesi()}
              {sekme === "kayit" && kayitSekmesi()}
            </>
          )}
        </>
      )}

      {/* ---------------------------------------------------- şube ayrıntısı */}
      <Drawer open={!!subeDetay} onClose={() => setSubeDetay(null)} width="min(560px, 100vw)" title={subeDetay ?? ""} destroyOnClose>
        {subeDetay && <SubeAyrinti sube={subeDetay} kayitlar={suzulmus.filter((k) => k.sube === subeDetay)} plan={planlar.find((p) => p.sube === subeDetay)} />}
      </Drawer>

      {/* ---------------------------------------------------- ürün ayrıntısı */}
      <Drawer open={!!urunDetay} onClose={() => setUrunDetay(null)} width="min(620px, 100vw)" title={suzulmus.find((k) => k.stokKod === urunDetay)?.ad ?? ""} destroyOnClose>
        {urunDetay && <UrunAyrinti kayitlar={(kayitlar ?? []).filter((k) => k.stokKod === urunDetay)} />}
      </Drawer>
    </div>
  );
}

/* ========================================================================== */

function SubeAyrinti({ kayitlar, plan }: { sube: string; kayitlar: Kayit[]; plan?: Plan }) {
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const sorunlu = kayitlar.filter((k) => SORUNLU.includes(k.durum)).sort((a, b) => (a.kalan ?? 0) - (b.kalan ?? 0));
  const hatirlat = async () => {
    if (!plan) return;
    setGonderiliyor(true);
    try {
      const c = await api.gonder<{ gonderilen: number; uyari?: string }>("Skt/Hatirlat", { planId: plan.id });
      c?.uyari ? message.warning(c.uyari) : message.success(`${c?.gonderilen ?? 0} kişiye hatırlatma gönderildi.`);
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Gönderilemedi.");
    } finally {
      setGonderiliyor(false);
    }
  };
  return (
    <div style={{ display: "grid", gap: 14 }}>
      {plan && (
        <div className="rm-kart" style={{ gap: 6 }}>
          <span style={{ fontSize: 12, color: RM.muted }}>{dayjs(plan.ay + "-01").locale("tr").format("MMMM YYYY")} kategorisi</span>
          <b>{plan.kategori}</b>
          {plan.aciklama && <span style={{ fontSize: 12, color: RM.muted }}>{plan.aciklama}</span>}
          <span style={{ fontSize: 12.5 }}>
            {plan.yapilan}/{plan.urun} ürün kontrol edildi · {plan.katilan} kişi
          </span>
          <button className="rm-dugme" style={{ alignSelf: "flex-start" }} onClick={hatirlat} disabled={gonderiliyor}>
            <Bell size={13} /> Hatırlat (bildirim)
          </button>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
        {(["gec", "kri", "yak"] as Durum[]).map((d) => (
          <div key={d} className="rm-kart" style={{ alignItems: "center", gap: 2, padding: 10 }}>
            <b style={{ fontSize: 20, color: DURUM_RENK[d] === "#E8C547" ? RM.info : DURUM_RENK[d] }}>{N0.format(kayitlar.filter((k) => k.durum === d).reduce((t, k) => t + (k.adet ?? 0), 0))}</b>
            <span style={{ fontSize: 11.5, color: RM.muted }}>{DURUM_AD[d]} · adet</span>
          </div>
        ))}
      </div>
      <b>Sorunlu ürünler</b>
      {sorunlu.length === 0 ? (
        <span style={{ color: RM.muted }}>Yok</span>
      ) : (
        sorunlu.map((k) => (
          <div key={`${k.kontrolId}-${k.partiId}`} className="rm-kart" style={{ flexDirection: "row", alignItems: "center", padding: "10px 12px" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <b style={{ fontSize: 13 }}>{k.ad}</b>
              <div style={{ fontSize: 12, color: RM.muted }}>
                SKT {tarih(k.skt)} · {k.adet} adet · {k.kisi}
                {k.aksiyon ? ` · ${k.aksiyon}` : ""}
              </div>
            </div>
            <Hap d={k.durum} m={kalanMetin(k.kalan)} />
          </div>
        ))
      )}
    </div>
  );
}

function UrunAyrinti({ kayitlar }: { kayitlar: Kayit[] }) {
  const u = kayitlar[0];
  if (!u) return null;
  const sirali = [...kayitlar].sort((a, b) => (a.kalan ?? 9999) - (b.kalan ?? 9999));
  const uygunSubeler = [...new Set(kayitlar.filter((k) => k.durum === "uyg").map((k) => k.sube))];
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <span style={{ fontSize: 12, color: RM.muted }}>
        {u.barkod} · {u.stokKod} · {u.grup} › {u.kat}
      </span>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: "left", color: RM.muted, fontSize: 11.5 }}>
            <th style={{ padding: 6 }}>Şube</th>
            <th>SKT</th>
            <th>Kalan</th>
            <th style={{ textAlign: "right" }}>Adet</th>
            <th>Kontrol</th>
          </tr>
        </thead>
        <tbody>
          {sirali.map((k) => (
            <tr key={`${k.kontrolId}-${k.partiId}`} style={{ borderTop: `1px solid ${RM.line}` }}>
              <td style={{ padding: 6 }}>{k.sube}</td>
              <td>{tarih(k.skt)}</td>
              <td>
                <Hap d={k.durum} m={k.kalan == null ? DURUM_AD[k.durum] : kalanMetin(k.kalan)} />
              </td>
              <td style={{ textAlign: "right" }}>{k.adet ?? "–"}</td>
              <td>{tarih(k.tarih)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {uygunSubeler.length > 0 && sirali.some((k) => SORUNLU.includes(k.durum)) && (
        <div className="rm-not" style={{ background: saydam(RM.brand, 0.1), padding: 10, borderRadius: 8, fontSize: 12.5 }}>
          Öneri: yakın SKT'li stoku indirime alın ya da uygun SKT'li olduğu şubelerle ({uygunSubeler.slice(0, 4).join(", ")}) dengeleyin.
        </div>
      )}
    </div>
  );
}

/* ========================================================================== */
/* Aylık plan                                                                 */
/* ========================================================================== */

function PlanSekmesi({
  ay,
  setAy,
  aylar,
  planlar,
  yenile,
  secenek,
  otomatik,
}: {
  ay: string;
  setAy: (a: string) => void;
  aylar: string[];
  planlar: Plan[];
  yenile: () => void;
  secenek: { subeler: string[]; gruplar: string[] };
  otomatik?: { acik: boolean; gun: number } | null;
}) {
  const [iceAktar, setIceAktar] = useState(false);
  const [duzen, setDuzen] = useState<Partial<Plan> | null>(null);
  const [urunPlan, setUrunPlan] = useState<Plan | null>(null);
  const [rotasyon, setRotasyon] = useState<{ aylar: string[]; planlar: { id: number; ay: string; sube: string; kategori: string }[] } | null>(null);
  const kopya: Kopya = useRef({});

  const rotasyonGetir = useCallback(() => {
    api
      .getir<any>(`Skt/Rotasyon?bas=${dayjs(ay + "-01").subtract(1, "month").format("YYYY-MM")}&ayAdet=4`)
      .then(setRotasyon)
      .catch(() => setRotasyon(null));
  }, [ay]);
  useEffect(() => {
    rotasyonGetir();
  }, [rotasyonGetir, planlar]);

  const sonrakiAy = dayjs(ay + "-01").add(1, "month").format("YYYY-MM");

  /* 26.10.2026: ayın planını Mikro stok ana gruplarından kur (otomatikle aynı kural) */
  const anaGruplardan = async (uzerine = false) => {
    try {
      const c = await api.gonder<{ olusturulan: number; urun: number }>("Skt/Plan/AnaGruplardan", { ay, uzerine });
      message.success(`${dayjs(ay + "-01").locale("tr").format("MMMM")} planı ana gruplardan kuruldu: ${c?.olusturulan} şube, ${c?.urun} ürün.`);
      yenile();
    } catch (h) {
      const m = h instanceof Error ? h.message : "";
      if (m.includes("zaten") && !uzerine)
        Modal.confirm({ title: m, content: "Mevcut plan silinip ana gruplardan yeniden kurulsun mu? Girilmiş kontroller silinmez.", okText: "Üzerine yaz", cancelText: "Vazgeç", onOk: () => anaGruplardan(true) });
      else message.error(m || "Oluşturulamadı.");
    }
  };

  const kaydir = async (uzerine = false) => {
    try {
      const c = await api.gonder<{ olusturulan: number }>("Skt/Plan/Kaydir", { kaynakAy: ay, hedefAy: sonrakiAy, adim: 1, uzerine });
      message.success(`${dayjs(sonrakiAy + "-01").locale("tr").format("MMMM")} planı oluşturuldu: ${c?.olusturulan} şube. Her kategori bir sonraki şubeye geçti.`);
      setAy(sonrakiAy);
      yenile();
    } catch (h) {
      const m = h instanceof Error ? h.message : "";
      if (m.includes("zaten") && !uzerine)
        Modal.confirm({ title: m, content: "Mevcut plan silinip yeniden oluşturulsun mu? Girilmiş kontroller silinmez.", okText: "Üzerine yaz", cancelText: "Vazgeç", onOk: () => kaydir(true) });
      else message.error(m || "Oluşturulamadı.");
    }
  };

  const sil = (p: Plan) =>
    Modal.confirm({
      title: `${p.sube} · ${p.kategori} planı silinsin mi?`,
      content: "Girilmiş SKT kayıtları silinmez.",
      okText: "Sil",
      okButtonProps: { danger: true },
      cancelText: "Vazgeç",
      onOk: async () => {
        await api.sil(`Skt/Plan/${p.id}`);
        yenile();
      },
    });

  const sut: Sutun<Plan>[] = [
    { k: "sube", l: "Şube", f: (r) => <b>{r.sube}</b> },
    { k: "kategori", l: "Kategori", f: (r) => <span>{r.kategori}{r.aciklama && <><br /><small style={{ color: RM.muted }}>{r.aciklama}</small></>}</span> },
    { k: "urun", l: "Ürün", num: true },
    { k: "yapilan", l: "Kontrol", num: true, f: (r) => `${r.yapilan}/${r.urun}` },
    { k: "katilan", l: "Katılan", num: true },
    { k: "son", l: "Son kontrol", sv: (r) => r.son ?? "", f: (r) => tarih(r.son) },
    {
      k: "islem",
      l: "",
      suzgecYok: true,
      f: (r) => (
        <span style={{ display: "inline-flex", gap: 6 }} onClick={(e) => e.stopPropagation()}>
          <button className="rm-dugme yuvarlak" onClick={() => setUrunPlan(r)}>Ürünler</button>
          <button className="rm-dugme yuvarlak" onClick={() => setDuzen(r)}>Düzenle</button>
          <button className="rm-dugme yuvarlak" onClick={() => sil(r)} title="Sil"><Trash2 size={12} /></button>
        </span>
      ),
      tx: () => "",
    },
  ];

  const rotasyonTablosu = () => {
    if (!rotasyon || rotasyon.planlar.length === 0) return null;
    const katlar = [...new Set(rotasyon.planlar.map((p) => p.kategori))].sort((a, b) => a.localeCompare(b, "tr"));
    return (
      <Kart sinif="c12" baslik="Kategori rotasyonu" ipucu="hangi kategori hangi ay hangi şubede · aynı şubeye üst üste aynı kategori kırmızı">
        <div className="rm-tablo-kap" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ textAlign: "left", color: RM.muted }}>
                <th style={{ padding: 6 }}>Kategori</th>
                {rotasyon.aylar.map((a) => (
                  <th key={a} style={{ padding: 6, color: a === ay ? RM.brandInk : undefined }}>
                    {dayjs(a + "-01").locale("tr").format("MMMM YYYY")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {katlar.map((k) => (
                <tr key={k} style={{ borderTop: `1px solid ${RM.line}` }}>
                  <td style={{ padding: 6, fontWeight: 600 }}>{k}</td>
                  {rotasyon.aylar.map((a, i) => {
                    const s = rotasyon.planlar.filter((p) => p.ay === a && p.kategori === k).map((p) => p.sube);
                    const onceki = i > 0 ? rotasyon.planlar.filter((p) => p.ay === rotasyon.aylar[i - 1] && p.kategori === k).map((p) => p.sube) : [];
                    const tekrar = s.some((x) => onceki.includes(x));
                    return (
                      <td key={a} style={{ padding: 6, color: tekrar ? RM.bad : undefined, background: a === ay ? saydam(RM.brand, 0.07) : undefined }}>
                        {s.join(", ") || <span style={{ color: RM.line }}>—</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Kart>
    );
  };

  return (
    <div className="rm-izgara">
      <Kart
        sinif="c12"
        baslik={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            Aylık plan
            <select value={ay} onChange={(e) => setAy(e.target.value)} style={{ border: `1px solid ${RM.line}`, borderRadius: 7, padding: "4px 8px" }}>
              {[...new Set([dayjs().format("YYYY-MM"), dayjs().add(1, "month").format("YYYY-MM"), ...aylar, ay])].sort().reverse().map((a) => (
                <option key={a} value={a}>
                  {dayjs(a + "-01").locale("tr").format("MMMM YYYY")}
                </option>
              ))}
            </select>
          </span>
        }
        ipucu={`${planlar.length} şube${otomatik?.acik ? ` · sonraki ayın planı her ayın ${otomatik.gun}. günü Mikro ana gruplarından otomatik kurulur (her şube her ay bir sonraki gruba geçer)` : ""}`}
        araclar={
          <>
            <button className="rm-dugme" onClick={() => setIceAktar(true)}>
              <Upload size={13} /> Excel'den içe aktar
            </button>
            <button className="rm-dugme" onClick={() => setDuzen({ ay })}>
              <Plus size={13} /> Yeni plan
            </button>
            <button className="rm-dugme" onClick={() => anaGruplardan()} title="Mikro stok ana gruplarını (hariç tutulanlar dışında) şubelere dağıtır; her ay her şube bir sonraki gruba geçer">
              Ana gruplardan kur
            </button>
            <button className="rm-dugme" onClick={() => kaydir()} disabled={!planlar.length} title="Her kategori listede bir sonraki şubeye geçer">
              {dayjs(sonrakiAy + "-01").locale("tr").format("MMMM")} planını oluştur ›
            </button>
            <KopyaDugmeBasit kopya={kopya} id="plan" />
          </>
        }
      >
        {planlar.length === 0 ? (
          <div className="rm-bos" style={{ padding: 30 }}>
            {dayjs(ay + "-01").locale("tr").format("MMMM YYYY")} için plan yok. Excel'den (KATEGORİ-SKT PLAN ve şube ürün listesi) içe aktarın ya da önceki ayda "{dayjs(ay + "-01").locale("tr").format("MMMM")} planını oluştur" deyin.
          </div>
        ) : (
          <Tablo id="plan" suzgec sutunlar={sut} satirlar={planlar} varsayilan="sube" yon={1} kopya={kopya} tikla={(r) => setUrunPlan(r)} />
        )}
      </Kart>

      {rotasyonTablosu()}

      {iceAktar && <IceAktar ay={ay} kapat={() => setIceAktar(false)} bitti={(a) => (setIceAktar(false), setAy(a), yenile())} />}
      {duzen && <PlanFormu plan={duzen} subeler={secenek.subeler} kapat={() => setDuzen(null)} bitti={() => (setDuzen(null), yenile())} />}
      {urunPlan && <PlanUrunleri plan={urunPlan} gruplar={secenek.gruplar} kapat={() => (setUrunPlan(null), yenile())} />}
    </div>
  );
}

function KopyaDugmeBasit({ kopya, id }: { kopya: Kopya; id: string }) {
  return (
    <button
      className="rm-dugme yuvarlak"
      onClick={() => {
        const k = kopya.current[id]?.();
        if (k) navigator.clipboard?.writeText(k.tsv).then(() => message.success(`${k.adet} satır kopyalandı.`));
      }}
    >
      <Copy size={12} /> Kopyala
    </button>
  );
}

function IceAktar({ ay: ilkAy, kapat, bitti }: { ay: string; kapat: () => void; bitti: (ay: string) => void }) {
  const [ay, setAy] = useState(ilkAy);
  const [dosyalar, setDosyalar] = useState<File[]>([]);
  const [isleniyor, setIsleniyor] = useState(false);

  const gonder = async (uzerine = false) => {
    if (!dosyalar.length) return message.warning("Excel dosyası seçiniz.");
    setIsleniyor(true);
    try {
      const f = new FormData();
      f.append("ay", ay);
      f.append("uzerine", String(uzerine));
      dosyalar.forEach((d) => f.append("dosyalar", d));
      const c = await api.dosyaGonder<{ plan: number; urun: number; uyarilar: string[] }>("Skt/Plan/IceAktar", f);
      Modal.success({
        title: `${c.plan} şube planı, ${N0.format(c.urun)} ürün aktarıldı`,
        content: c.uyarilar?.length ? (
          <ul style={{ paddingLeft: 18, maxHeight: 260, overflow: "auto", fontSize: 12.5 }}>
            {c.uyarilar.map((u, i) => (
              <li key={i}>{u}</li>
            ))}
          </ul>
        ) : undefined,
        width: 560,
      });
      bitti(ay);
    } catch (h) {
      const m = h instanceof Error ? h.message : "";
      if (m.includes("zaten") && !uzerine)
        Modal.confirm({ title: m, content: "Mevcut plan silinip dosyadaki plan yazılsın mı? Girilmiş kontroller silinmez.", okText: "Üzerine yaz", cancelText: "Vazgeç", onOk: () => gonder(true) });
      else message.error(m || "Aktarılamadı.");
    } finally {
      setIsleniyor(false);
    }
  };

  return (
    <Modal open title="Excel'den plan aktar" onCancel={kapat} onOk={() => gonder()} okText="Aktar" cancelText="Vazgeç" confirmLoading={isleniyor} width={560}>
      <div style={{ display: "grid", gap: 12 }}>
        <label style={{ display: "grid", gap: 4, fontSize: 12.5 }}>
          Plan ayı
          <input type="month" value={ay} onChange={(e) => setAy(e.target.value)} style={{ border: `1px solid ${RM.line}`, borderRadius: 7, padding: 6 }} />
        </label>
        <input type="file" accept=".xlsx" multiple onChange={(e) => setDosyalar(Array.from(e.target.files ?? []))} />
        <div style={{ fontSize: 12.5, color: RM.muted, lineHeight: 1.6 }}>
          İki biçim tanınır, birlikte de verilebilir:
          <br />• <b>Kategori planı:</b> KATEGORİ · AÇIKLAMA · ŞUBELER
          <br />• <b>Şube ürün listesi:</b> Stok kodu · Barkod · Stok ismi · Ana Grup · Kategori · Mağaza
          <br />Dosyada birden çok ürün listesi sayfası varsa ayın adını taşıyan sayfa (ör. "Ekim") kullanılır.
        </div>
      </div>
    </Modal>
  );
}

function PlanFormu({ plan, subeler, kapat, bitti }: { plan: Partial<Plan>; subeler: string[]; kapat: () => void; bitti: () => void }) {
  const [v, setV] = useState<Partial<Plan>>(plan);
  const [isleniyor, setIsleniyor] = useState(false);
  const kaydet = async () => {
    setIsleniyor(true);
    try {
      await api.gonder("Skt/Plan", { id: v.id, ay: v.ay, sube: v.sube, kategori: v.kategori, aciklama: v.aciklama, sonGun: v.sonGun || null });
      message.success("Kaydedildi");
      bitti();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Kaydedilemedi.");
    } finally {
      setIsleniyor(false);
    }
  };
  return (
    <Modal open title={v.id ? "Planı düzenle" : "Yeni plan"} onCancel={kapat} onOk={kaydet} okText="Kaydet" cancelText="Vazgeç" confirmLoading={isleniyor}>
      <div style={{ display: "grid", gap: 10 }}>
        <label style={{ display: "grid", gap: 4, fontSize: 12.5 }}>
          Ay
          <input type="month" value={v.ay ?? ""} onChange={(e) => setV({ ...v, ay: e.target.value })} style={{ border: `1px solid ${RM.line}`, borderRadius: 7, padding: 6 }} />
        </label>
        <label style={{ display: "grid", gap: 4, fontSize: 12.5 }}>
          Şube
          <Select showSearch value={v.sube} onChange={(s) => setV({ ...v, sube: s })} options={subeler.map((s) => ({ value: s, label: s }))} placeholder="Şube seçiniz" />
        </label>
        <label style={{ display: "grid", gap: 4, fontSize: 12.5 }}>
          Kategori adı
          <Input value={v.kategori} onChange={(e) => setV({ ...v, kategori: e.target.value })} placeholder="ör. BİSKÜVİ-ÇİKOLATA-ŞEKERLEME" />
        </label>
        <label style={{ display: "grid", gap: 4, fontSize: 12.5 }}>
          Açıklama
          <Input value={v.aciklama ?? ""} onChange={(e) => setV({ ...v, aciklama: e.target.value })} placeholder="ör. Çikolata + baton çikolata + barlar" />
        </label>
        <label style={{ display: "grid", gap: 4, fontSize: 12.5 }}>
          Son gün (boşsa ay sonu)
          <input type="date" value={v.sonGun ? dayjs(v.sonGun).format("YYYY-MM-DD") : ""} onChange={(e) => setV({ ...v, sonGun: e.target.value })} style={{ border: `1px solid ${RM.line}`, borderRadius: 7, padding: 6 }} />
        </label>
      </div>
    </Modal>
  );
}

interface PlanUrun {
  stokKod: string;
  barkod: string | null;
  ad: string | null;
  grup: string | null;
  kat: string | null;
  kontrol: number;
}

function PlanUrunleri({ plan, gruplar, kapat }: { plan: Plan; gruplar: string[]; kapat: () => void }) {
  const [liste, setListe] = useState<PlanUrun[] | null>(null);
  const [ara, setAra] = useState("");
  const [barkodlar, setBarkodlar] = useState("");
  const [grup, setGrup] = useState<string | undefined>();
  const [katSecenek, setKatSecenek] = useState<string[]>([]);
  const [katlar, setKatlar] = useState<string[]>([]);
  const [temizle, setTemizle] = useState(false);
  const [isleniyor, setIsleniyor] = useState(false);

  const getir = useCallback(() => {
    api.getir<PlanUrun[]>(`Skt/Plan/${plan.id}/Urunler`).then((l) => setListe(l ?? [])).catch(() => setListe([]));
  }, [plan.id]);
  useEffect(() => getir(), [getir]);
  useEffect(() => {
    setKatlar([]);
    if (grup) api.getir<string[]>(`Skt/Kategoriler?grup=${encodeURIComponent(grup)}`).then((k) => setKatSecenek(k ?? [])).catch(() => setKatSecenek([]));
  }, [grup]);

  const ekle = async () => {
    const l = barkodlar.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
    if (!l.length) return;
    setIsleniyor(true);
    try {
      const c = await api.gonder<{ bulunamayan: string[] }>(`Skt/Plan/${plan.id}/Urunler`, { ekle: l });
      c?.bulunamayan?.length ? message.warning(`Bulunamayan: ${c.bulunamayan.join(", ")}`) : message.success("Eklendi");
      setBarkodlar("");
      getir();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Eklenemedi.");
    } finally {
      setIsleniyor(false);
    }
  };

  const doldur = async () => {
    if (!grup) return message.warning("Ana grup seçiniz.");
    setIsleniyor(true);
    try {
      const c = await api.gonder<{ eklenen: number }>(`Skt/Plan/${plan.id}/Doldur`, { anaGrup: grup, kategoriler: katlar, temizle });
      message.success(`${N0.format(c?.eklenen ?? 0)} ürün Mikro'dan eklendi.`);
      getir();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Doldurulamadı.");
    } finally {
      setIsleniyor(false);
    }
  };

  const cikar = async (u: PlanUrun) => {
    await api.gonder(`Skt/Plan/${plan.id}/Urunler`, { cikar: [u.stokKod] });
    getir();
  };

  const q = kucuk(ara.trim());
  const gorunen = (liste ?? []).filter((u) => !q || kucuk(u.ad ?? "").includes(q) || (u.barkod ?? "").includes(q) || kucuk(u.kat ?? "").includes(q));

  return (
    <Drawer open onClose={kapat} width="min(720px, 100vw)" title={`${plan.sube} · ${plan.kategori}`}>
      <div style={{ display: "grid", gap: 14 }}>
        <div className="rm-kart" style={{ gap: 8 }}>
          <b style={{ fontSize: 13 }}>Mikro'dan doldur</b>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Select showSearch allowClear placeholder="Ana grup" value={grup} onChange={setGrup} options={gruplar.map((g) => ({ value: g, label: g }))} style={{ minWidth: 220, flex: 1 }} />
            <Select mode="multiple" allowClear placeholder="Kategoriler (boşsa hepsi)" value={katlar} onChange={setKatlar} options={katSecenek.map((g) => ({ value: g, label: g }))} style={{ minWidth: 220, flex: 2 }} maxTagCount="responsive" />
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Checkbox checked={temizle} onChange={(e) => setTemizle(e.target.checked)}>
              Mevcut listeyi temizle
            </Checkbox>
            <button className="rm-dugme" onClick={doldur} disabled={isleniyor || !grup} style={{ marginLeft: "auto" }}>
              Doldur
            </button>
          </div>
        </div>
        <div className="rm-kart" style={{ gap: 8 }}>
          <b style={{ fontSize: 13 }}>Barkodla ekle</b>
          <Input.TextArea value={barkodlar} onChange={(e) => setBarkodlar(e.target.value)} placeholder="Barkodları alt alta ya da virgülle yazın" autoSize={{ minRows: 2, maxRows: 5 }} />
          <button className="rm-dugme" onClick={ekle} disabled={isleniyor || !barkodlar.trim()} style={{ alignSelf: "flex-end" }}>
            <Plus size={13} /> Ekle
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <b>{liste ? `${N0.format(liste.length)} ürün` : ""}</b>
          <Input allowClear placeholder="Listede ara" value={ara} onChange={(e) => setAra(e.target.value)} style={{ maxWidth: 260, marginLeft: "auto" }} />
        </div>
        {!liste ? (
          <Spin />
        ) : (
          <div style={{ display: "grid", gap: 4 }}>
            {gorunen.slice(0, 500).map((u) => (
              <div key={u.stokKod} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderBottom: `1px solid ${RM.line}` }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{u.ad}</div>
                  <div style={{ fontSize: 11.5, color: RM.muted }}>
                    {u.barkod} · {u.grup} › {u.kat}
                  </div>
                </div>
                {u.kontrol > 0 && <span className="rm-hap good">kontrol edildi</span>}
                <button className="rm-dugme yuvarlak" title="Listeden çıkar" onClick={() => cikar(u)}>
                  <X size={12} />
                </button>
              </div>
            ))}
            {gorunen.length > 500 && <span style={{ color: RM.muted, fontSize: 12 }}>İlk 500 gösteriliyor; aramayla daraltın.</span>}
          </div>
        )}
      </div>
    </Drawer>
  );
}
