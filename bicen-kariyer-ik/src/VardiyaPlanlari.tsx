/**
 * ---------------------------------------------------------------------------
 * Vardiya Planları
 * ---------------------------------------------------------------------------
 * Haftalık planların şube şube durumu: kime gönderildi, kimin planı
 * gönderildikten sonra değişti, kim hiç planlanmadı. Vardiya türleri
 * (Sabahçı, Akşamcı, Aracı…) buradan tanımlanıyor; türlerde saat yok,
 * çünkü her mağazanın açılış kapanış saati farklı.
 *
 * Personel planı onaylamıyor: plan bildirim olarak düşüyor. "Akşamcı
 * çalışan ertesi gün sabahçı olamaz" kuralı yöneticiye uyarı olarak
 * gösteriliyor, kayıt engellenmiyor. Haftada 1 gün izin zorunlu.
 *
 * 06.10.2026: İK da plan yapabiliyor. Yönetici, GMY, İK yöneticisi ve İK
 * hücreye tıklayıp sağdaki panelden vardiya türü, haftalık izin ya da boş
 * seçiyor; geçen haftayı uygulayıp planı gönderebiliyor. Kurallar mobil
 * Vardiya Planı ekranıyla aynı (sunucuda ortak). Değişiklik hücrede hemen
 * görünüyor, yalnızca o satır sunucudan yenileniyor. Onaylı tam gün
 * izinli günler (yıllık, raporlu…) kilitli.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Drawer,
  Empty,
  Input,
  Modal,
  Segmented,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Typography,
} from "antd";
import dayjs, { Dayjs } from "dayjs";
import { api, oturumOku } from "./api";
import "./VardiyaPlanlari.css";
import { PersonelAdi } from "./personelKarti";

const GUNLER = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
const GUN_ADLARI = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"];

/** Vardiya türü renkleri (tür tanımındaki "renk" alanı). Personel kartı da kullanıyor. */
export const RENKLER: Record<string, { zemin: string; yazi: string }> = {
  mavi: { zemin: "#e6f1fb", yazi: "#14507f" },
  mor: { zemin: "#efe9fb", yazi: "#4d3184" },
  sari: { zemin: "#fdf0e2", yazi: "#8a5a12" },
  yesil: { zemin: "#eef7df", yazi: "#3a5709" },
  kirmizi: { zemin: "#fdecec", yazi: "#7a1a1a" },
};

const DURUM: Record<string, { ad: string; renk: string }> = {
  taslak: { ad: "Planlanmadı", renk: "default" },
  gonderildi: { ad: "Gönderildi", renk: "green" },
  degisti: { ad: "Değişti · yeniden gönderilmeli", renk: "gold" },
  /* Eski kayıtlar */
  bekliyor: { ad: "Gönderildi", renk: "green" },
  onay: { ad: "Gönderildi", renk: "green" },
  red: { ad: "Değişti", renk: "gold" },
};

export const TIP_ADI: Record<string, string> = {
  sabah: "sabahçı",
  aksam: "akşamcı",
  araci: "aracı",
  diger: "",
};

const TIP_SECENEKLERI = [
  { value: "sabah", label: "Sabahçı" },
  { value: "araci", label: "Aracı" },
  { value: "aksam", label: "Akşamcı" },
  { value: "diger", label: "Diğer" },
];

/**
 * Haftanın pazartesisi. Yerel ayara bağlı değil: önceki hâli
 * startOf("week") + 1 gün idi; panel Türkçe yerel ayarla (hafta pazartesi
 * başlıyor) açıldığından salıyı veriyordu ve sütun tarihleri bir gün
 * kayıyordu (sunucu haftayı yine pazartesiye çektiği için veri doğruydu).
 */
export const haftaBasi = (d: Dayjs) => d.startOf("day").subtract((d.day() + 6) % 7, "day");

/** Eski durum adları güncel adlara: bekliyor/onay → gönderildi, red → değişti */
const durumAdi = (d?: string) =>
  d === "bekliyor" || d === "onay" ? "gonderildi" : d === "red" ? "degisti" : d || "taslak";

/** Satırda planlanmış (vardiya ya da haftalık izin) gün var mı */
const planVar = (k: any) => (k?.gunler ?? []).some((d: any) => d.tur === "vardiya" || d.tur === "izin");

/** İşe giriş öncesi ya da çıkış sonrası gün (sunucu "yillik" türüyle kilitli gönderir) */
const istihdamDisi = (d: any) => d?.tur === "yillik" && (d.izinKisa === "Başlamadı" || d.izinKisa === "Ayrıldı");

/** Onaylı tam gün izin: vardiya atanamaz */
const kilitli = (d: any) => d?.tur === "yillik";

/** Hücrenin renkleri: sistemdeki izin, vardiya türü, haftalık izin, boş */
const hucreRengi = (d: any) => {
  const yillik = d.tur === "yillik";
  const rapor = yillik && String(d.izinKisa ?? "").toLocaleLowerCase("tr").startsWith("rapor");
  const r = d.tur === "vardiya" && d.renk ? RENKLER[d.renk] ?? RENKLER.mavi : null;

  /* İşe giriş öncesi / çıkış sonrası (09.10.2026): gri */
  if (istihdamDisi(d)) return { zemin: "#f1f2f4", yazi: "#8a929b" };

  return {
    zemin: rapor ? "#fdecec" : yillik ? "#eef7df" : r ? r.zemin : d.tur === "izin" ? "#f4f6f1" : "transparent",
    yazi: rapor ? "#b42318" : yillik ? "#3a5709" : r ? r.yazi : d.tur === "izin" ? "#4b5563" : "#9aa3af",
  };
};

type Secim = { sicil: string; i: number };

export default function VardiyaPlanlari() {
  const { message, modal } = AntdApp.useApp();

  const [hafta, setHafta] = useState<Dayjs>(haftaBasi(dayjs()));
  const [veri, setVeri] = useState<any>(null);
  const [sube, setSube] = useState<string | null>(null);
  const [suzgec, setSuzgec] = useState("hepsi");
  const [yukleniyor, setYukleniyor] = useState(true);
  const [ayarAcik, setAyarAcik] = useState(false);
  const [gecmis, setGecmis] = useState<any>(null);

  /* Planlama */
  const [sablonlar, setSablonlar] = useState<any[]>([]);
  const [secili, setSecili] = useState<Secim | null>(null);
  const [haftaya, setHaftaya] = useState(false);
  const [bekleyen, setBekleyen] = useState<Record<string, number>>({});
  const [sonUyari, setSonUyari] = useState<{ sicil: string; uyarilar: string[] } | null>(null);
  const [toplu, setToplu] = useState<string | null>(null);

  /* Aynı satıra art arda tıklanınca yalnızca son isteğin yanıtı yazılıyor */
  const istekSirasi = useRef<Record<string, number>>({});

  /* Yetkiyi sunucu söylüyor (özel rolde temel role bakıyor); Rol
     Yetkileri'nden salt okunur yapılmış hesapta düzenleme kapalı. */
  const oturum = oturumOku();
  const duzenleyebilir = veri?.duzenleyebilir === true && oturum?.yetki?.saltOkunur !== true;

  const getir = useCallback(async () => {
    setYukleniyor(true);

    try {
      const sorgu = `hafta=${hafta.format("YYYY-MM-DD")}${sube ? `&sube=${encodeURIComponent(sube)}` : ""}`;
      setVeri(await api.al<any>(`/api/VardiyaPlan/Panel?${sorgu}`));
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setYukleniyor(false);
    }
  }, [hafta, sube, message]);

  const sablonlariGetir = useCallback(async () => {
    try {
      const c = await api.al<any>("/api/VardiyaPlan/Sablonlar");
      setSablonlar((c?.sablonlar ?? []).filter((s: any) => s.aktif));
    } catch {
      setSablonlar([]);
    }
  }, []);

  useEffect(() => {
    getir();
  }, [getir]);

  useEffect(() => {
    sablonlariGetir();
  }, [sablonlariGetir]);

  /* Hafta ya da şube değişince seçim kalkıyor */
  useEffect(() => {
    setSecili(null);
    setSonUyari(null);
  }, [hafta, sube]);

  const kartlar = veri?.kartlar ?? [];
  const tumSatirlar: any[] = veri?.satirlar ?? [];
  const satirlar = tumSatirlar.filter((x: any) => suzgec === "hepsi" || durumAdi(x.durum) === suzgec);

  const seciliSatir = secili ? tumSatirlar.find((x) => x.sicil === secili.sicil) : null;
  const seciliGun = seciliSatir && secili ? seciliSatir.gunler[secili.i] : null;

  /* Gönderilecek plan: taslak ya da değişmiş, en az bir günü planlanmış */
  const gonderilecek = tumSatirlar.filter((x) => durumAdi(x.durum) !== "gonderildi" && planVar(x));

  const gecmisAc = async (k: any) => {
    setGecmis({ kisi: k, kayitlar: null });

    try {
      const c = await api.al<any>(
        `/api/VardiyaPlan/Gecmis?sicil=${encodeURIComponent(k.sicil)}&hafta=${hafta.format("YYYY-MM-DD")}`
      );
      setGecmis({ kisi: k, kayitlar: c.kayitlar ?? [] });
    } catch {
      setGecmis({ kisi: k, kayitlar: [] });
    }
  };

  /* ------------------------------------------------------------ yardımcılar */

  /** Bir satırı yerinde değiştirir; satırın durumu değiştiyse şube kartını da günceller. */
  const satirYaz = (sicil: string, yeni: any) => {
    setVeri((v: any) => {
      if (!v) return v;

      const eski = (v.satirlar ?? []).find((x: any) => x.sicil === sicil);
      const satirlar = (v.satirlar ?? []).map((x: any) => (x.sicil === sicil ? yeni : x));

      const a = durumAdi(eski?.durum);
      const b = durumAdi(yeni?.durum);

      if (!eski || a === b || !sube) return { ...v, satirlar };

      /* Kart sayıları: gönderildi · değişti · planlanmadı */
      const alan: Record<string, string[]> = {
        gonderildi: ["gonderildi", "onay"],
        degisti: ["degisti", "red"],
        taslak: ["planlanmadi"],
      };

      const kartlar = (v.kartlar ?? []).map((k: any) => {
        if (k.sube !== sube) return k;

        const n = { ...k };

        (alan[a] ?? []).forEach((f) => (n[f] = Math.max(0, Number(n[f] ?? 0) - 1)));
        (alan[b] ?? []).forEach((f) => (n[f] = Number(n[f] ?? 0) + 1));

        n.oran = n.toplam > 0 ? Math.round((100 * n.gonderildi) / n.toplam) : 0;

        return n;
      });

      return { ...v, satirlar, kartlar };
    });
  };

  /** Hücre seçimi: kilitli gün atlanıyor */
  const sonrakiGun = (k: any, i: number) => {
    for (let j = i + 1; j < 7; j++) if (!kilitli(k.gunler[j])) return j;
    return i;
  };

  /* ------------------------------------------------------------ atama */

  const ata = async (tur: "vardiya" | "izin" | "off", sablonId: number | null) => {
    if (!secili || !seciliSatir || !seciliGun || kilitli(seciliGun)) return;

    const sicil = seciliSatir.sicil;
    const i = secili.i;
    const tumHafta = haftaya && tur === "vardiya";
    const s = sablonlar.find((x) => x.id === sablonId);
    const onceki = seciliSatir;

    /* Hemen göster: sunucu yanıtı gelince satır yeniden yazılıyor */
    const yeniGun = (d: any) => ({
      ...d,
      tur,
      sablonId: s?.id ?? null,
      ad: s?.ad ?? (tur === "izin" ? "Haftalık izin" : "Boş"),
      renk: s?.renk ?? null,
      tip: s?.tip ?? null,
      celiski: !!d.okutmaVar && tur !== "vardiya",
    });

    const gunler = onceki.gunler.map((d: any, j: number) =>
      j === i || (tumHafta && !kilitli(d) && d.tur !== "izin") ? yeniGun(d) : d
    );

    const tahmin =
      durumAdi(onceki.durum) === "gonderildi" ? { ...onceki, gunler, durum: "degisti" } : { ...onceki, gunler };

    satirYaz(sicil, tahmin);
    setBekleyen((b) => ({ ...b, [sicil]: (b[sicil] ?? 0) + 1 }));

    if (!tumHafta) setSecili({ sicil, i: sonrakiGun(onceki, i) });

    const sira = (istekSirasi.current[sicil] ?? 0) + 1;
    istekSirasi.current[sicil] = sira;

    try {
      const c = await api.gonder<any>("/api/VardiyaPlan/PanelAta", {
        sicil,
        gun: dayjs(onceki.gunler[i].tarih).format("YYYY-MM-DD"),
        sablonId,
        tur,
        haftaya: tumHafta,
      });

      if (istekSirasi.current[sicil] === sira && c?.kisi) satirYaz(sicil, c.kisi);

      const uyarilar: string[] = c?.uyarilar ?? [];
      setSonUyari(uyarilar.length > 0 ? { sicil, uyarilar } : null);
    } catch (h: any) {
      if (istekSirasi.current[sicil] === sira) satirYaz(sicil, onceki);
      message.error(h.message);
    } finally {
      setBekleyen((b) => ({ ...b, [sicil]: Math.max(0, (b[sicil] ?? 1) - 1) }));
    }
  };

  /* ------------------------------------------------------------ toplu */

  const gecenHafta = () => {
    if (!sube) return;

    modal.confirm({
      title: "Geçen haftayı uygula",
      content: `${sube} şubesinde geçen haftanın planı ${hafta.format("DD MMM")} haftasına kopyalanacak. Bu haftada aynı günlere yapılmış atamaların üzerine yazılır; onaylı izinli günler atlanır.`,
      okText: "Uygula",
      cancelText: "Vazgeç",
      onOk: async () => {
        setToplu("gecen");

        try {
          const c = await api.gonder<any>("/api/VardiyaPlan/PanelGecenHafta", {
            hafta: hafta.format("YYYY-MM-DD"),
            sube,
          });

          if (!c?.kisi) message.info("Geçen hafta bu şubede kopyalanacak plan yok.");
          else message.success(`${c.kisi} kişinin ${c.gun} günü kopyalandı.`);

          if ((c?.uyarilar ?? []).length > 0)
            modal.warning({
              title: "Dinlenme uyarıları",
              content: (c.uyarilar as string[]).map((u, i) => <div key={i}>{u}</div>),
            });

          await getir();
        } catch (h: any) {
          message.error(h.message);
        } finally {
          setToplu(null);
        }
      },
    });
  };

  const gonder = (siciller?: string[]) => {
    if (!sube) return;

    const kisiler = siciller
      ? tumSatirlar.filter((x) => siciller.includes(x.sicil))
      : gonderilecek;

    if (kisiler.length === 0) {
      message.info("Gönderilecek plan yok.");
      return;
    }

    modal.confirm({
      title: siciller ? "Planı gönder" : `Planı gönder (${kisiler.length} kişi)`,
      content: siciller
        ? `${kisiler[0]?.adSoyad} kişisinin ${hafta.format("DD MMM")} haftası planı gönderilecek; personele bildirim düşer.`
        : `${sube} şubesinde taslak ya da değişmiş planı olan ${kisiler.length} kişiye ${hafta.format("DD MMM")} haftasının planı gönderilecek; her birine bildirim düşer. Haftalık izin günü verilmemiş personel atlanır.`,
      okText: "Gönder",
      cancelText: "Vazgeç",
      onOk: async () => {
        setToplu("gonder");

        try {
          const c = await api.gonder<any>("/api/VardiyaPlan/PanelGonder", {
            hafta: hafta.format("YYYY-MM-DD"),
            sube,
            siciller: siciller ?? null,
          });

          message.success(`${c?.gonderilen ?? 0} kişiye gönderildi.`);

          if ((c?.eksikIzin ?? []).length > 0)
            modal.warning({
              title: "Haftalık izin günü verilmeyenler gönderilmedi",
              content: `Haftada 1 gün izin zorunlu: ${(c.eksikIzin as string[]).join(", ")}`,
            });

          await getir();
        } catch (h: any) {
          message.error(h.message);
        } finally {
          setToplu(null);
        }
      },
    });
  };

  /* ------------------------------------------------------------ hücre */

  const hucre = (k: any, i: number) => {
    const d = k.gunler[i];
    const { zemin, yazi } = hucreRengi(d);
    const yillik = d.tur === "yillik";

    /* Sistemdeki izin: tür, saat, onay durumu */
    const izinYazi = d.izinTuru
      ? `${d.izinTuru}${d.izinAyrinti ? ` ${d.izinAyrinti}` : ""}${d.izinBekliyor ? " · talep onay bekliyor" : ""}`
      : null;

    const baslik = d.devamsiz
      ? "Birim yöneticisi bu güne devamsızlık girdi"
      : d.okutmadi
      ? "Vardiya günü, okutma yok (devamsızlık girilmedi)"
      : d.celiski
      ? "Bu gün izinli/boş görünüyor ama vardiya okutması var"
      : [d.ad, !yillik ? izinYazi : null, yillik && duzenleyebilir ? (istihdamDisi(d) ? `${d.izinTuru} (${d.izinAyrinti}): planlanmaz, haftalık izin şartı yok` : "Onaylı izin: vardiya atanamaz") : null]
          .filter(Boolean)
          .join("\n");

    const secildi = secili?.sicil === k.sicil && secili?.i === i;

    const ic = (
      <>
        {yillik ? d.izinKisa ?? "İzinli" : d.tur === "off" ? "—" : d.tur === "izin" ? "İzin" : d.ad}

        {/* Saatlik / yarım gün izin ya da onay bekleyen talep */}
        {!yillik && d.izinTuru && (
          <div className="vp-hucre-alt" style={{ color: d.izinBekliyor ? "#8a6100" : "#14507f" }}>
            {d.izinBekliyor ? "talep" : d.izinKisa}
            {d.izinAyrinti && !d.izinBekliyor ? ` ${d.izinAyrinti}` : ""}
          </div>
        )}

        {/* 23.10.2026: devamsızlık girildi / geçmiş vardiya gününde okutma yok */}
        {d.devamsiz && <div className="vp-hucre-alt vp-devamsiz">Devamsız</div>}
        {!d.devamsiz && d.okutmadi && <div className="vp-hucre-alt vp-okutmadi">Okutmadı</div>}

        {/* İzinli/boş günde okutma varsa turuncu nokta */}
        {d.celiski && <span className="vp-nokta" />}
        {yillik && duzenleyebilir && <span className="vp-kilit">🔒</span>}
      </>
    );

    const sinif = `vp-hucre${d.tur === "off" ? " vp-bos" : ""}${secildi ? " vp-secili" : ""}${
      bekleyen[k.sicil] ? " vp-bekliyor" : ""
    }`;

    if (!duzenleyebilir)
      return (
        <div className={sinif} title={baslik} style={{ background: zemin, color: yazi }}>
          {ic}
        </div>
      );

    return (
      <button
        type="button"
        className={sinif}
        title={baslik}
        disabled={yillik}
        aria-pressed={secildi}
        aria-label={`${k.adSoyad} · ${GUN_ADLARI[i]} · ${yillik ? d.izinTuru ?? "İzinli" : d.ad}`}
        style={{ background: zemin, color: yazi }}
        onClick={() => setSecili(secildi ? null : { sicil: k.sicil, i })}
      >
        {ic}
      </button>
    );
  };

  /* ------------------------------------------------------------ durum */

  const durumHucresi = (k: any) => {
    const d = durumAdi(k.durum);

    let hap: JSX.Element;

    if (!duzenleyebilir) hap = <Tag color={DURUM[k.durum]?.renk}>{DURUM[k.durum]?.ad ?? k.durum}</Tag>;
    else if (d === "gonderildi") hap = <span className="vp-hap vp-hap-gonderildi">Gönderildi</span>;
    else if (d === "degisti")
      hap = (
        <button
          type="button"
          className="vp-hap vp-hap-degisti"
          title="Yalnızca bu kişinin planını yeniden gönder"
          onClick={() => gonder([k.sicil])}
        >
          Değişti · gönder
        </button>
      );
    else if (planVar(k)) hap = <span className="vp-hap vp-hap-taslak">Taslak</span>;
    else hap = <span className="vp-hap vp-hap-plansiz">Planlanmadı</span>;

    return (
      <>
        {hap}
        {k.surum > 1 && <div className="vp-satir-not vp-soluk">{k.surum}. sürüm</div>}
        {!k.haftalikIzinVar && planVar(k) && <div className="vp-satir-not vp-sari">haftalık izin yok</div>}
        {(k.uyarilar?.length ?? 0) > 0 && (
          <div className="vp-satir-not vp-turuncu" title={k.uyarilar.join("\n")}>
            {k.uyarilar.length} dinlenme uyarısı
          </div>
        )}
        {k.ozelDurum?.durum === "bekliyor" && <div className="vp-satir-not vp-sari">özel durum bekliyor</div>}
        {k.celiskiliGun > 0 && (
          <div className="vp-satir-not vp-turuncu">{k.celiskiliGun} günde izinliyken okutma</div>
        )}
        {k.devamsizGun > 0 && <div className="vp-satir-not vp-kirmizi">{k.devamsizGun} gün devamsız</div>}
      </>
    );
  };

  const tablo = (
    <Table
      rowKey="sicil"
      size="small"
      loading={yukleniyor}
      dataSource={satirlar}
      pagination={false}
      scroll={{ x: 920 }}
      columns={[
        {
          title: "Personel",
          fixed: "left" as const,
          width: 200,
          render: (_: unknown, k: any) => (
            <>
              <b><PersonelAdi kod={k.sicil}>{k.adSoyad}</PersonelAdi></b>
              <div style={{ fontSize: 11.5, color: "#6b7280" }}>{k.pozisyon}</div>
            </>
          ),
        },
        ...GUNLER.map((g, i) => ({
          title: (
            <span title={hafta.add(i, "day").format("DD MMMM dddd")}>
              {g}{" "}
              <span style={{ fontWeight: 500, color: "#9aa3af" }}>{hafta.add(i, "day").format("DD")}</span>
            </span>
          ),
          width: 78,
          onCell: () => ({ style: { padding: "5px 4px" } }),
          render: (_: unknown, k: any) => hucre(k, i),
        })),
        {
          title: "Durum",
          width: 150,
          render: (_: unknown, k: any) => durumHucresi(k),
        },
        {
          title: "",
          width: 86,
          render: (_: unknown, k: any) => (
            <Button size="small" onClick={() => gecmisAc(k)}>
              Ayrıntı
            </Button>
          ),
        },
      ]}
    />
  );

  return (
    <Space className="vp" direction="vertical" size="middle" style={{ width: "100%" }}>
      <Card size="small">
        <Space wrap style={{ width: "100%", justifyContent: "space-between" }}>
          <Space wrap>
            <Button onClick={() => setHafta(hafta.add(-7, "day"))}>‹</Button>
            <DatePicker
              picker="week"
              value={hafta}
              allowClear={false}
              onChange={(d) => d && setHafta(haftaBasi(d))}
              format={() => `${hafta.format("DD MMM")} – ${hafta.add(6, "day").format("DD MMM YYYY")}`}
            />
            <Button onClick={() => setHafta(hafta.add(7, "day"))}>›</Button>
            <Button onClick={() => setHafta(haftaBasi(dayjs()))}>Bu hafta</Button>
          </Space>

          <Button onClick={() => setAyarAcik(true)}>Vardiya türleri</Button>
        </Space>
      </Card>

      {yukleniyor && !veri ? (
        <Spin />
      ) : (
        <>
          {/* --------------------------------------------- şube kartları */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 10 }}>
            {kartlar.map((k: any) => {
              const oran = Number(k.oran);
              const r = oran >= 90 ? "#5f8c10" : oran >= 70 ? "#d48806" : "#cf1322";

              return (
                <Card
                  key={k.sube}
                  size="small"
                  hoverable
                  onClick={() => setSube(k.sube)}
                  style={{ borderColor: sube === k.sube ? "#7cb518" : undefined }}
                >
                  <Space style={{ width: "100%", justifyContent: "space-between" }} align="start">
                    <div>
                      <Typography.Text strong>{k.sube}</Typography.Text>
                      <div style={{ fontSize: 11.5, color: "#6b7280" }}>{k.toplam} kişi</div>
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: r }}>%{oran}</div>
                  </Space>

                  <div style={{ height: 6, borderRadius: 3, background: "#eef0ea", marginTop: 8, overflow: "hidden" }}>
                    <div style={{ width: `${oran}%`, height: 6, background: r }} />
                  </div>

                  <div style={{ fontSize: 11.5, color: "#6b7280", marginTop: 6 }}>
                    {k.gonderildi ?? k.onay} gönderildi · {k.degisti ?? k.red} değişti · {k.planlanmadi} planlanmadı
                  </div>
                </Card>
              );
            })}
          </div>

          {/* --------------------------------------------------- tablo */}
          {!sube ? (
            <Card size="small">
              <Empty description="Personel listesi için bir şube seçin." />
            </Card>
          ) : (
            <>
              <Space wrap style={{ width: "100%", justifyContent: "space-between" }}>
                <Typography.Text strong style={{ fontSize: 15 }}>
                  {sube} · {hafta.format("DD MMM")} – {hafta.add(6, "day").format("DD MMM")}
                </Typography.Text>

                <div className="vp-arac">
                  <Segmented
                    value={suzgec}
                    onChange={(v) => setSuzgec(String(v))}
                    options={[
                      { value: "hepsi", label: `Tümü (${tumSatirlar.length})` },
                      { value: "degisti", label: "Değişenler" },
                      { value: "gonderildi", label: "Gönderilenler" },
                      { value: "taslak", label: "Planlanmayanlar" },
                    ]}
                  />

                  {duzenleyebilir && (
                    <>
                      <Button loading={toplu === "gecen"} disabled={!!toplu} onClick={gecenHafta}>
                        Geçen haftayı uygula
                      </Button>
                      <Button
                        type="primary"
                        loading={toplu === "gonder"}
                        disabled={!!toplu || gonderilecek.length === 0}
                        onClick={() => gonder()}
                      >
                        Planı gönder ({gonderilecek.length} kişi)
                      </Button>
                    </>
                  )}
                </div>
              </Space>

              {duzenleyebilir ? (
                <div className="vp-duzen">
                  <div style={{ minWidth: 0 }}>{tablo}</div>

                  <GunSecici
                    satir={seciliSatir}
                    i={secili?.i ?? 0}
                    gun={seciliGun}
                    tarih={seciliGun ? dayjs(seciliGun.tarih) : null}
                    sablonlar={sablonlar}
                    haftaya={haftaya}
                    setHaftaya={setHaftaya}
                    mesgul={!!toplu}
                    uyarilar={sonUyari && sonUyari.sicil === seciliSatir?.sicil ? sonUyari.uyarilar : []}
                    sec={ata}
                    kapat={() => setSecili(null)}
                  />
                </div>
              ) : (
                tablo
              )}

              <Lejant sablonlar={sablonlar} duzenleyebilir={duzenleyebilir} />
            </>
          )}
        </>
      )}

      {/* ------------------------------------------------------ ayrıntı */}
      <Drawer
        open={!!gecmis}
        width={460}
        onClose={() => setGecmis(null)}
        title={gecmis?.kisi ? <PersonelAdi kod={gecmis.kisi.sicil}>{gecmis.kisi.adSoyad}</PersonelAdi> : undefined}
      >
        {gecmis?.kisi && (
          <>
            <Typography.Text type="secondary">
              {gecmis.kisi.pozisyon} · {gecmis.kisi.sube}
            </Typography.Text>

            {(gecmis.kisi.uyarilar?.length ?? 0) > 0 && (
              <Alert
                style={{ marginTop: 12 }}
                type="warning"
                showIcon
                message="Dinlenme uyarısı"
                description={gecmis.kisi.uyarilar.map((u: string, i: number) => (
                  <div key={i}>{u}</div>
                ))}
              />
            )}

            {gecmis.kisi.ozelDurum && (
              <Alert
                style={{ marginTop: 12 }}
                type={
                  gecmis.kisi.ozelDurum.durum === "bekliyor"
                    ? "info"
                    : gecmis.kisi.ozelDurum.durum === "kabul"
                    ? "success"
                    : "error"
                }
                showIcon
                message={
                  gecmis.kisi.ozelDurum.durum === "bekliyor"
                    ? "Haftalık izin için özel durum bildirdi · yönetici yanıtı bekleniyor"
                    : gecmis.kisi.ozelDurum.durum === "kabul"
                    ? "Özel durum kabul edildi"
                    : "Özel durum reddedildi"
                }
                description={
                  <>
                    {dayjs(gecmis.kisi.ozelDurum.izinGun).format("DD MMM dddd")} izin günü
                    {gecmis.kisi.ozelDurum.talepGun
                      ? ` → ${dayjs(gecmis.kisi.ozelDurum.talepGun).format("DD MMM dddd")}`
                      : ""}
                    <div style={{ marginTop: 4 }}>“{gecmis.kisi.ozelDurum.aciklama}”</div>
                    {gecmis.kisi.ozelDurum.kararVeren && (
                      <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
                        {gecmis.kisi.ozelDurum.kararVeren}
                        {gecmis.kisi.ozelDurum.kararNotu ? ` — ${gecmis.kisi.ozelDurum.kararNotu}` : ""}
                      </div>
                    )}
                  </>
                }
              />
            )}

            <div style={{ fontSize: 11, fontWeight: 800, color: "#6b7280", margin: "18px 0 8px" }}>
              HAFTALIK PLAN
            </div>

            {gecmis.kisi.gunler.map((g: any, i: number) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: 10,
                  padding: "8px 0",
                  borderBottom: "1px solid #f0f1ee",
                }}
              >
                <div style={{ width: 80, fontSize: 12.5, fontWeight: 700, color: "#6b7280" }}>
                  {GUNLER[i]} {dayjs(g.tarih).format("DD MMM")}
                </div>
                <div style={{ flex: 1, fontWeight: 700 }}>{g.ad}</div>
                <div style={{ color: "#6b7280" }}>
                  {g.tur === "vardiya" ? TIP_ADI[g.tip as string] ?? "" : g.tur === "izin" ? "haftalık izin" : "—"}
                </div>
              </div>
            ))}

            <div style={{ fontSize: 11, fontWeight: 800, color: "#6b7280", margin: "18px 0 8px" }}>
              SÜREÇ
            </div>

            {gecmis.kayitlar === null ? (
              <Spin />
            ) : gecmis.kayitlar.length === 0 ? (
              <Typography.Text type="secondary">Plan henüz gönderilmedi.</Typography.Text>
            ) : (
              gecmis.kayitlar.map((k: any, i: number) => (
                <div key={i} style={{ padding: "8px 0", borderBottom: "1px solid #f0f1ee" }}>
                  <b style={{ fontSize: 13.5 }}>{k.olay}</b>
                  <div style={{ fontSize: 12, color: "#6b7280" }}>
                    {k.yapan ? `${k.yapan} · ` : ""}
                    {dayjs(k.olusturma).format("DD MMM HH:mm")}
                  </div>
                  {k.aciklama && <div style={{ fontSize: 12.5, marginTop: 3 }}>“{k.aciklama}”</div>}
                </div>
              ))
            )}
          </>
        )}
      </Drawer>

      {ayarAcik && (
        <VardiyaAyarlari
          kapat={() => setAyarAcik(false)}
          degisti={() => {
            getir();
            sablonlariGetir();
          }}
        />
      )}
    </Space>
  );
}

/* ========================================================================== */

/**
 * Sağdaki seçim paneli: seçili günün vardiyası. Seçimden sonra sıradaki
 * güne geçiliyor; böylece bir kişinin haftası art arda tıklanarak
 * kurulabiliyor.
 */
function GunSecici({
  satir,
  i,
  gun,
  tarih,
  sablonlar,
  haftaya,
  setHaftaya,
  mesgul,
  uyarilar,
  sec,
  kapat,
}: {
  satir: any;
  i: number;
  gun: any;
  tarih: Dayjs | null;
  sablonlar: any[];
  haftaya: boolean;
  setHaftaya: (v: boolean) => void;
  mesgul: boolean;
  uyarilar: string[];
  sec: (tur: "vardiya" | "izin" | "off", sablonId: number | null) => void;
  kapat: () => void;
}) {
  if (!satir || !gun || !tarih)
    return (
      <div className="vp-secici">
        <div className="vp-secici-bas">
          <small>SEÇİLİ GÜN</small>
        </div>
        <div className="vp-secici-bos">
          Plan yapmak için tablodan bir güne tıklayın. Seçtiğiniz vardiya hemen kaydedilir ve sıradaki
          güne geçilir; haftayı bitirince <b>Planı gönder</b> ile personele bildirim gider.
        </div>
      </div>
    );

  return (
    <div className="vp-secici" aria-live="polite">
      <div className="vp-secici-bas" style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <small>SEÇİLİ GÜN</small>
          <b><PersonelAdi kod={satir.sicil}>{satir.adSoyad}</PersonelAdi></b>
          <span>
            {GUN_ADLARI[i]} · {tarih.format("DD MMMM")}
          </span>
        </div>
        <Button size="small" type="text" onClick={kapat} aria-label="Seçimi kapat">
          ✕
        </Button>
      </div>

      <div className="vp-mevcut">
        Şu an: <b>{gun.tur === "off" ? "Boş" : gun.tur === "izin" ? "Haftalık izin" : gun.ad}</b>
        {gun.tur === "vardiya" && gun.tip && TIP_ADI[gun.tip] ? ` · ${TIP_ADI[gun.tip]}` : ""}
      </div>

      {gun.izinTuru && (
        <div className={`vp-bilgi ${gun.izinBekliyor ? "vp-bilgi-sari" : "vp-bilgi-mavi"}`}>
          {gun.izinTuru}
          {gun.izinAyrinti ? ` ${gun.izinAyrinti}` : ""}
          {gun.izinBekliyor ? " · talep onay bekliyor" : " · vardiya atanabilir"}
        </div>
      )}

      {gun.celiski && (
        <div className="vp-bilgi vp-bilgi-turuncu">Bu gün izinli/boş görünüyor ama vardiya okutması var.</div>
      )}

      <div>
        <div className="vp-baslik">VARDİYA TÜRÜ</div>
        <div className="vp-secenekler">
          {sablonlar.map((s) => {
            const r = RENKLER[s.renk] ?? RENKLER.mavi;
            const aktif = gun.tur === "vardiya" && gun.sablonId === s.id;

            return (
              <button
                key={s.id}
                type="button"
                className={`vp-secenek${aktif ? " vp-aktif" : ""}`}
                style={{ background: r.zemin, color: r.yazi }}
                disabled={mesgul}
                onClick={() => sec("vardiya", s.id)}
              >
                <b>{s.ad}</b>
                <small>{TIP_ADI[s.tip] || "vardiya"}</small>
              </button>
            );
          })}

          <button
            type="button"
            className={`vp-secenek vp-secenek-izin${gun.tur === "izin" ? " vp-aktif" : ""}`}
            disabled={mesgul}
            onClick={() => sec("izin", null)}
          >
            <b>Haftalık izin</b>
            <small>haftada 1 gün zorunlu</small>
          </button>

          <button
            type="button"
            className={`vp-secenek vp-secenek-bos${gun.tur === "off" ? " vp-aktif" : ""}`}
            disabled={mesgul}
            onClick={() => sec("off", null)}
          >
            <b>Boş</b>
            <small>planı temizle</small>
          </button>
        </div>
      </div>

      <label className="vp-haftaya">
        <Checkbox checked={haftaya} onChange={(e) => setHaftaya(e.target.checked)} />
        <span>
          Haftanın çalışma günlerine uygula
          <br />
          <small style={{ color: "#9aa3af" }}>Seçilen vardiya; haftalık izin ve izinli günler korunur.</small>
        </span>
      </label>

      {uyarilar.length > 0 && (
        <div className="vp-bilgi vp-bilgi-turuncu">
          {uyarilar.map((u, j) => (
            <div key={j}>{u}</div>
          ))}
        </div>
      )}

      <div className="vp-ipucu">
        Seçim hemen kaydedilir. Gönderilmiş plan değişirse satır <b>Değişti</b> olur; personel yeniden
        gönderilince güncellemeyi görür.
      </div>
    </div>
  );
}

/** Renk açıklaması */
function Lejant({ sablonlar, duzenleyebilir }: { sablonlar: any[]; duzenleyebilir: boolean }) {
  return (
    <div className="vp-lejant">
      {sablonlar.map((s) => {
        const r = RENKLER[s.renk] ?? RENKLER.mavi;
        return (
          <span key={s.id}>
            <i style={{ background: r.zemin, boxShadow: `inset 0 0 0 1px ${r.yazi}33` }} />
            {s.ad}
          </span>
        );
      })}
      <span>
        <i style={{ background: "#f4f6f1", boxShadow: "inset 0 0 0 1px #d5dacd" }} />
        Haftalık izin
      </span>
      <span>
        <i style={{ background: "#eef7df" }} />
        Yıllık / sistemdeki izin{duzenleyebilir ? " (kilitli)" : ""}
      </span>
      <span>
        <i style={{ background: "#fdecec" }} />
        Raporlu
      </span>
      <span>
        <i style={{ border: "1px dashed #c9cfc1" }} />
        Boş
      </span>
      <span>
        <i style={{ width: 8, height: 8, borderRadius: 4, background: "#e8481c" }} />
        İzinliyken okutma
      </span>

      {duzenleyebilir && (
        <div className="vp-lejant-not">
          İK'nın yaptığı değişiklik mağaza müdürünün mobil Vardiya Planı ekranında da görünür.
        </div>
      )}
    </div>
  );
}

/* ========================================================================== */

/** Vardiya türleri: müdürler yalnızca bunlardan seçer. Saat tutulmuyor. */
function VardiyaAyarlari({ kapat, degisti }: { kapat: () => void; degisti: () => void }) {
  const { message } = AntdApp.useApp();

  const [veri, setVeri] = useState<any>(null);
  const [duzenlenen, setDuzenlenen] = useState<any>(null);

  const getir = useCallback(async () => {
    const c = await api.al<any>("/api/VardiyaPlan/Sablonlar");
    setVeri(c);
  }, []);

  useEffect(() => {
    getir();
  }, [getir]);

  const kaydet = async (s: any) => {
    try {
      await api.gonder("/api/VardiyaPlan/Sablon", s);
      message.success("Kaydedildi.");
      setDuzenlenen(null);
      getir();
      degisti();
    } catch (h: any) {
      message.error(h.message);
    }
  };

  return (
    <Modal open width={620} title="Vardiya türleri" onCancel={kapat} footer={null}>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="Türlerde saat yok"
        description="Her mağazanın açılış kapanış saati farklı olduğu için türler yalnızca sabahçı / aracı / akşamcı bilgisini taşır. Sınıf, dinlenme uyarısı için kullanılır: akşamcı çalışan personele ertesi gün sabahçı verildiğinde mağaza müdürü uyarılır, kayıt engellenmez."
      />

      {!veri ? (
        <Spin />
      ) : (
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={veri.sablonlar}
          columns={[
            {
              title: "Tür",
              render: (_: unknown, s: any) => {
                const r = RENKLER[s.renk] ?? RENKLER.mavi;
                return (
                  <Tag style={{ background: r.zemin, color: r.yazi, border: 0, fontWeight: 700 }}>{s.ad}</Tag>
                );
              },
            },
            {
              title: "Sınıf",
              render: (_: unknown, s: any) =>
                TIP_SECENEKLERI.find((t) => t.value === s.tip)?.label ?? "Diğer",
            },
            {
              title: "Durum",
              dataIndex: "aktif",
              width: 90,
              render: (d: boolean) => (d ? <Tag color="green">Açık</Tag> : <Tag>Kapalı</Tag>),
            },
            {
              title: "",
              width: 90,
              render: (_: unknown, s: any) => (
                <Button size="small" onClick={() => setDuzenlenen(s)}>
                  Düzenle
                </Button>
              ),
            },
          ]}
        />
      )}

      <Button
        type="dashed"
        block
        style={{ marginTop: 10 }}
        onClick={() => setDuzenlenen({ aktif: true, sira: 99, tip: "diger", renk: "mavi" })}
      >
        ＋ Tür ekle
      </Button>

      <Modal
        open={!!duzenlenen}
        title={duzenlenen?.id ? "Türü düzenle" : "Yeni vardiya türü"}
        okText="Kaydet"
        cancelText="Vazgeç"
        onCancel={() => setDuzenlenen(null)}
        onOk={() => kaydet(duzenlenen)}
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <Input
            placeholder="Ad — Sabahçı, Akşamcı, Aracı…"
            value={duzenlenen?.ad}
            onChange={(e) => setDuzenlenen({ ...duzenlenen, ad: e.target.value })}
          />
          <div>
            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>Sınıf (dinlenme uyarısı için)</div>
            <Segmented
              value={duzenlenen?.tip ?? "diger"}
              onChange={(v) => setDuzenlenen({ ...duzenlenen, tip: String(v) })}
              options={TIP_SECENEKLERI}
            />
          </div>
          <Segmented
            value={duzenlenen?.renk ?? "mavi"}
            onChange={(v) => setDuzenlenen({ ...duzenlenen, renk: String(v) })}
            options={Object.keys(RENKLER).map((r) => ({
              value: r,
              label: (
                <span
                  style={{
                    display: "inline-block",
                    width: 16,
                    height: 16,
                    borderRadius: 8,
                    background: RENKLER[r].zemin,
                    border: `2px solid ${RENKLER[r].yazi}`,
                    verticalAlign: "middle",
                  }}
                />
              ),
            }))}
          />
          <Space>
            <Switch
              checked={duzenlenen?.aktif ?? true}
              onChange={(v) => setDuzenlenen({ ...duzenlenen, aktif: v })}
            />
            <span>{duzenlenen?.aktif === false ? "Kapalı — müdürlere görünmez" : "Açık"}</span>
          </Space>
        </Space>
      </Modal>
    </Modal>
  );
}
