/**
 * Yıllık İzin · Pano
 * ---------------------------------------------------------------------------
 * Açılış sekmesi: kullanım oranı, şu an izinde olanlar, önümüzdeki 30 gün,
 * aylara göre kullanım, şube kırılımı ve izin biriktirenler. Her kutu,
 * satır, takvim günü ve ay çubuğu tıklanabilir.
 *
 * Hak ediş verisi /api/Izin/Durum'dan (üst bileşen verir), günlük hesaplar
 * için izin kayıtları /api/Izin/Kayitlar'dan gelir.
 */

import { useEffect, useMemo, useState } from "react";
import { Button, Drawer, Space, Tag, Tooltip, Typography } from "antd";
import dayjs, { Dayjs } from "dayjs";

import Tablo from "./Tablo";
import { api } from "./api";
import "./IkPerformans.css";
import "./IzinPano.css";
import { PersonelAdi } from "./personelKarti";

const { Text } = Typography;

const gun = (v: unknown): string => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ",");
};

const AYLAR = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const RENKLER = ["#5f8c10", "#1a5fb4", "#722ed1", "#e8481c", "#08979c", "#b7791f", "#c41d7f"];
const avRengi = (s: string) => {
  let t = 0;
  for (const c of s ?? "") t = (t * 31 + c.charCodeAt(0)) >>> 0;
  return RENKLER[t % RENKLER.length];
};
const basHarf = (s: string) =>
  String(s ?? "").split(" ").filter(Boolean).slice(0, 2).map((x) => x[0]).join("");

const kalanRenk = (k: number | null) =>
  k === null || k === undefined ? "#9aa3af" : k < 0 || k >= 25 ? "#cf1322" : k >= 15 ? "#e8481c" : "#1f2933";

type Liste = { baslik: string; kisiler: any[]; sag?: (k: any) => string };

interface Props {
  /** /api/Izin/Durum kayıtları (arama ve şube süzgeci uygulanmış) */
  kisiler: any[];
  /** Üst bileşen veriyi yenilediğinde kayıtlar da yeniden çekilir */
  surum: unknown;
  onKisi: (k: any) => void;
  onListe: (l: Liste) => void;
}

function Avatar({ k }: { k: any }) {
  const [bozuk, setBozuk] = useState(false);
  return (
    <span className="yp-av" style={{ background: avRengi(k.adSoyad) }}>
      {basHarf(k.adSoyad)}
      {!bozuk && <img src={api.resimAdresi(k.personelKodu)} alt="" onError={() => setBozuk(true)} />}
    </span>
  );
}

export default function IzinPano({ kisiler, surum, onKisi, onListe }: Props) {
  const bugun = dayjs().startOf("day");
  const yil = bugun.year();

  const [izinler, setIzinler] = useState<any[]>([]);
  const [izCip, setIzCip] = useState<"izinde" | "donecek">("izinde");
  const [subeSira, setSubeSira] = useState<{ k: string; y: number }>({ k: "oran", y: 1 });
  const [izinListesi, setIzinListesi] = useState<{ baslik: string; alt: string; kayitlar: any[] } | null>(null);

  useEffect(() => {
    const q = new URLSearchParams({
      bas: `${yil}-01-01`,
      bit: bugun.add(60, "day").isAfter(dayjs(`${yil}-12-31`)) ? bugun.add(60, "day").format("YYYY-MM-DD") : `${yil}-12-31`,
    });
    api
      .al<any>(`/api/Izin/Kayitlar?${q}`)
      .then((d) => setIzinler(d.kayitlar ?? []))
      .catch(() => setIzinler([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surum]);

  const kisiHaritasi = useMemo(
    () => new Map(kisiler.map((k) => [String(k.personelKodu).trim(), k])),
    [kisiler]
  );

  /* Yalnızca ekrandaki (süzülmüş) personelin kayıtları */
  const kayitlar = useMemo(
    () =>
      izinler
        .filter((z) => kisiHaritasi.has(String(z.personelKodu).trim()))
        .map((z) => ({
          ...z,
          kisi: kisiHaritasi.get(String(z.personelKodu).trim()),
          c: dayjs(z.cikisTarihi).startOf("day"),
          d: dayjs(z.donusTarihi).startOf("day"),
        })),
    [izinler, kisiHaritasi]
  );

  const izinliMi = (z: any, g: Dayjs) => !z.c.isAfter(g) && !z.d.isBefore(g);

  /* ------------------------------------------------------------ özet */
  const girilen = kisiler.filter((k) => k.girildiMi);
  const bakiyesiz = kisiler.filter((k) => !k.girildiMi);
  const hak = girilen.reduce((t, k) => t + Number(k.hakedilen || 0) + Number(k.devir || 0), 0);
  const kullanilan = girilen.reduce((t, k) => t + Number(k.kullanilan || 0), 0);
  const kalan = girilen.reduce((t, k) => t + Number(k.kalan || 0), 0);
  const oran = hak ? Math.round((kullanilan * 100) / hak) : 0;

  const izinde = kisiler.filter((k) => k.izinde).sort((a, b) => dayjs(a.izinDonus).valueOf() - dayjs(b.izinDonus).valueOf());
  const donecek = izinde.filter((k) => k.izinDonus && dayjs(k.izinDonus).diff(bugun, "day") <= 7);

  const otuzGun = bugun.add(30, "day");
  const planKayitlari = kayitlar
    .filter((z) => z.c.isAfter(bugun) && !z.c.isAfter(otuzGun))
    .sort((a, b) => a.c.valueOf() - b.c.valueOf());
  const planKisileri = [...new Map(planKayitlari.map((z) => [z.personelKodu, z.kisi])).values()];

  const hicKullanmayan = girilen
    .filter((k) => Number(k.hakedilen) > 0 && Number(k.kullanilan) === 0 && !k.izinde)
    .sort((a, b) => Number(b.kalan) - Number(a.kalan));

  const kisiKaydi = (kod: string) => kayitlar.filter((z) => z.personelKodu === kod);

  /* ------------------------------------------------------------ takvim */
  const gunler = [...Array(30)].map((_, i) => bugun.add(i, "day"));
  const gunKisileri = (g: Dayjs) => {
    const m = new Map<string, any>();
    kayitlar.filter((z) => izinliMi(z, g)).forEach((z) => m.set(z.personelKodu, z));
    return [...m.values()];
  };
  const takvim = gunler.map((g) => {
    const a = gunKisileri(g);
    return { g, a, devam: a.filter((z) => !z.c.isAfter(bugun)).length };
  });
  const takvimMax = Math.max(1, ...takvim.map((x) => x.a.length));

  /* Aynı şubede aynı anda çok kişi: en az 3 kişi ve şubenin %15'i */
  const subeKisiSayisi = useMemo(() => {
    const m = new Map<string, number>();
    kisiler.forEach((k) => m.set(k.subeAdi, (m.get(k.subeAdi) ?? 0) + 1));
    return m;
  }, [kisiler]);

  const cakismalar = useMemo(() => {
    const sonuc: { sube: string; bas: Dayjs; bit: Dayjs; en: number; kayitlar: any[] }[] = [];
    [...subeKisiSayisi.keys()].forEach((sube) => {
      const toplam = subeKisiSayisi.get(sube) ?? 0;
      let bas: Dayjs | null = null, bit: Dayjs | null = null, en = 0;
      const kay = new Map<number, any>();
      takvim.forEach(({ g, a }) => {
        const s = a.filter((z) => z.kisi?.subeAdi === sube);
        if (s.length >= 3 && s.length >= toplam * 0.15) {
          bas = bas ?? g; bit = g; en = Math.max(en, s.length);
          s.forEach((z) => kay.set(z.id, z));
        }
      });
      if (bas && bit) sonuc.push({ sube, bas, bit, en, kayitlar: [...kay.values()] });
    });
    return sonuc.sort((a, b) => b.en - a.en);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kayitlar, subeKisiSayisi]);

  /* ------------------------------------------------------------ aylar */
  const aylar = AYLAR.map((_, i) => {
    const k = kayitlar.filter((z) => z.tur === "Yıllık İzin" && z.c.year() === yil && z.c.month() === i);
    return {
      k,
      kul: k.filter((z) => !z.c.isAfter(bugun)).reduce((t, z) => t + Number(z.gun || 0), 0),
      pla: k.filter((z) => z.c.isAfter(bugun)).reduce((t, z) => t + Number(z.gun || 0), 0),
    };
  });
  const ayMax = Math.max(1, ...aylar.map((x) => x.kul + x.pla));

  /* ------------------------------------------------------------ şube */
  const subeler = useMemo(() => {
    const m = new Map<string, any[]>();
    kisiler.forEach((k) => m.set(k.subeAdi || "Belirtilmemiş", [...(m.get(k.subeAdi || "Belirtilmemiş") ?? []), k]));
    return [...m.entries()].map(([sube, a]) => {
      const g = a.filter((k) => k.girildiMi);
      const h = g.reduce((t, k) => t + Number(k.hakedilen || 0) + Number(k.devir || 0), 0);
      const ku = g.reduce((t, k) => t + Number(k.kullanilan || 0), 0);
      const pl = g.reduce((t, k) => t + Number(k.planli || 0), 0);
      return { sube, kisi: a.length, hak: h, kul: ku, pla: pl, kalan: h - ku - pl, oran: h ? (ku * 100) / h : 0, a };
    });
  }, [kisiler]);
  const siraliSubeler = [...subeler].sort((x: any, y: any) =>
    (typeof x[subeSira.k] === "string" ? x[subeSira.k].localeCompare(y[subeSira.k], "tr") : x[subeSira.k] - y[subeSira.k]) * subeSira.y
  );

  const izinListesiAc = (baslik: string, alt: string, k: any[]) =>
    setIzinListesi({ baslik, alt, kayitlar: [...k].sort((a, b) => a.c.valueOf() - b.c.valueOf()) });

  const kutular = [
    {
      c: "#1a4d80", t: "Şu an izinde", v: izinde.length, a: `${donecek.length}'${donecek.length === 1 ? "i" : "ı"} bu hafta dönüyor`,
      f: () => onListe({ baslik: "Şu an izinde", kisiler: izinde, sag: (k) => `${dayjs(k.izinDonus).format("DD.MM")} dönüş` }),
    },
    {
      c: "#722ed1", t: "Planlanmış", v: planKisileri.length, a: `önümüzdeki 30 gün · ${gun(planKayitlari.reduce((t, z) => t + Number(z.gun || 0), 0))} gün`,
      f: () => izinListesiAc("Planlanmış izinler", "Önümüzdeki 30 gün", planKayitlari),
    },
    {
      c: "#e8481c", t: "Kalan izin", v: `${gun(kalan)} gün`, a: `kişi başı ortalama ${gun(girilen.length ? Math.round((kalan * 10) / girilen.length) / 10 : 0)} gün`,
      f: () => onListe({ baslik: "Kalan izin", kisiler: [...girilen].sort((a, b) => Number(b.kalan) - Number(a.kalan)), sag: (k) => `${gun(k.kalan)} gün` }),
    },
    {
      c: "#cf1322", t: "Hiç kullanmayan", v: hicKullanmayan.length, a: "bu yıl izin kullanmadı",
      f: () => onListe({ baslik: "Bu yıl hiç izin kullanmayanlar", kisiler: hicKullanmayan, sag: (k) => `${gun(k.kalan)} gün birikmiş` }),
    },
  ];

  const izListe = izCip === "izinde" ? izinde : donecek;

  return (
    <div className="ip">
      {bakiyesiz.length > 0 && (
        <div className="yp-uyari">
          <span>ℹ</span>
          <span>
            <b>{bakiyesiz.length} personelin izin hak edişi girilmemiş.</b> Bu kişilere izin kaydı yapılamaz.
          </span>
          <Button size="small" onClick={() => onListe({ baslik: "Hak edişi girilmemiş personel", kisiler: bakiyesiz, sag: () => "hak ediş girilmedi" })}>
            Listeyi gör
          </Button>
        </div>
      )}

      {/* ------------------------------------------------------------ kutular */}
      <div className="yp-kpi">
        <button className="ip-k yp-buyuk"
          onClick={() =>
            onListe({
              baslik: "İzin kullanımı",
              kisiler: [...girilen].sort(
                (a, b) =>
                  Number(a.kullanilan) / (Number(a.hakedilen) + Number(a.devir) || 1) -
                  Number(b.kullanilan) / (Number(b.hakedilen) + Number(b.devir) || 1)
              ),
              sag: (k) => `${gun(k.kullanilan)} / ${gun(Number(k.hakedilen) + Number(k.devir))} gün`,
            })
          }>
          <span className="yp-halka" data-v={`%${oran}`}
            style={{ background: `conic-gradient(#c6f36b ${oran}%, rgba(255,255,255,.2) 0)` }} />
          <div>
            <span>Yıllık izin kullanımı</span>
            <b>{gun(kullanilan)} / {gun(hak)} gün</b>
            <small>kullanılan / toplam hak (devir dahil)</small>
          </div>
        </button>

        {kutular.map((k) => (
          <button key={k.t} className="ip-k" style={{ ["--c" as any]: k.c, ["--c2" as any]: k.c }} onClick={k.f}>
            <span>{k.t}</span>
            <b>{k.v}</b>
            <small>{k.a}</small>
          </button>
        ))}
      </div>

      <div className="yp-ana">
        {/* ----------------------------------------------------- şu an izinde */}
        <div className="ip-panel">
          <div className="ip-pbas">
            <div>
              <b>{izCip === "izinde" ? "Şu an izinde" : "Bu hafta dönecekler"}</b>
              <small>Çubuk, iznin ne kadarının geçtiğini gösterir · kişiye tıklayın</small>
            </div>
            <div className="ip-cipler">
              <button className={izCip === "izinde" ? "acik" : ""} onClick={() => setIzCip("izinde")}>İzinde ({izinde.length})</button>
              <button className={izCip === "donecek" ? "acik" : ""} onClick={() => setIzCip("donecek")}>Bu hafta dönecek ({donecek.length})</button>
            </div>
          </div>

          {izListe.length === 0 ? (
            <div className="yp-bos">Şu anda izinde personel yok.</div>
          ) : (
            <>
              {izListe.slice(0, 6).map((k) => {
                const c = dayjs(k.izinCikis), d = dayjs(k.izinDonus);
                const top = Math.max(1, d.diff(c, "day") + 1);
                const gec = bugun.diff(c, "day") + 1;
                const kal = d.diff(bugun, "day");
                const z = kisiKaydi(k.personelKodu).find((x) => izinliMi(x, bugun));
                return (
                  <div key={k.personelKodu} className="yp-kisi" onClick={() => onKisi(k)}>
                    <Avatar k={k} />
                    <div className="yp-ad" style={{ minWidth: 0 }}>
                      <b><PersonelAdi kod={k.personelKodu}>{k.adSoyad}</PersonelAdi></b>
                      <small>{k.gorev} · {k.subeAdi}</small>
                    </div>
                    <div className="yp-sure">
                      <div className="c"><i style={{ width: `${Math.min(100, (gec * 100) / top)}%` }} /></div>
                      <div className="t">
                        <span>{c.format("DD.MM")}</span>
                        <span>{z ? `${gun(z.gun)} gün · ${z.tur}` : `${top} gün`}</span>
                        <span>{d.format("DD.MM")}</span>
                      </div>
                    </div>
                    <div className="yp-sag">
                      <Tag color={kal <= 0 ? "volcano" : kal <= 3 ? "gold" : "blue"} style={{ marginInlineEnd: 0 }}>
                        {kal <= 0 ? "bugün son gün" : kal === 1 ? "yarın" : kal <= 7 ? `${kal} gün` : d.format("DD.MM")}
                      </Tag>
                    </div>
                  </div>
                );
              })}
              {izListe.length > 6 && (
                <div style={{ textAlign: "center", marginTop: 8 }}>
                  <Button size="small"
                    onClick={() => onListe({ baslik: izCip === "izinde" ? "Şu an izinde" : "Bu hafta dönecekler", kisiler: izListe, sag: (k) => `${dayjs(k.izinDonus).format("DD.MM")} dönüş` })}>
                    +{izListe.length - 6} kişi daha · tümünü gör
                  </Button>
                </div>
              )}
            </>
          )}
        </div>

        {/* ------------------------------------------------- önümüzdeki 30 gün */}
        <div className="ip-panel">
          <div className="ip-pbas">
            <div>
              <b>Önümüzdeki 30 gün</b>
              <small>Günlük izinli kişi sayısı · güne tıklayın</small>
            </div>
            <div className="ip-lej">
              <span><i style={{ background: "#1a4d80" }} />Devam eden</span>
              <span><i style={{ background: "#722ed1" }} />Planlı</span>
            </div>
          </div>

          <div className="yp-takvim">
            {takvim.map(({ g, a, devam }, i) => (
              <Tooltip key={i} title={`${g.format("DD.MM.YYYY dddd")} · ${a.length} kişi izinli`}>
                <button
                  className={`yp-gun${g.day() === 0 ? " hs" : ""}${i === 0 ? " bugun" : ""}`}
                  onClick={() =>
                    onListe({
                      baslik: `${g.format("DD.MM.YYYY")} tarihinde izinli olanlar`,
                      kisiler: a.map((z) => z.kisi).filter(Boolean),
                      sag: (k) => {
                        const z = a.find((x) => x.personelKodu === k.personelKodu);
                        return z ? `${z.c.format("DD.MM")} – ${z.d.format("DD.MM")} · ${z.tur}` : "";
                      },
                    })
                  }>
                  <i style={{
                    height: (a.length * 34) / takvimMax,
                    background: `linear-gradient(to top, #1a4d80 ${(devam * 100) / (a.length || 1)}%, #722ed1 0)`,
                  }} />
                  {g.date()}
                </button>
              </Tooltip>
            ))}
          </div>
          <div className="yp-takvim-alt">
            <span>{gunler[0].format("DD.MM")}</span>
            <span>{gunler[15].format("DD.MM")}</span>
            <span>{gunler[29].format("DD.MM")}</span>
          </div>

          {planKayitlari.length === 0 ? (
            <div className="yp-bos" style={{ padding: 12 }}>Önümüzdeki 30 günde planlanmış izin yok.</div>
          ) : (
            <>
              {planKayitlari.slice(0, 5).map((z) => (
                <div key={z.id} className="yp-plan" onClick={() => z.kisi && onKisi(z.kisi)}>
                  <span>
                    <b><PersonelAdi kod={z.personelKodu}>{z.adSoyad || z.kisi?.adSoyad}</PersonelAdi></b>{" "}
                    <span className="yp-soluk">· {z.kisi?.gorev ?? z.gorev} · {z.kisi?.subeAdi ?? z.subeAdi}</span>
                  </span>
                  <span style={{ whiteSpace: "nowrap" }}>
                    <Tag color="purple" style={{ marginInlineEnd: 6 }}>{z.c.format("DD.MM")} – {z.d.format("DD.MM")}</Tag>
                    <span className="yp-soluk">{gun(z.gun)} gün</span>
                  </span>
                </div>
              ))}
              {planKayitlari.length > 5 && (
                <div style={{ textAlign: "center", marginTop: 6 }}>
                  <Button size="small" onClick={() => izinListesiAc("Planlanmış izinler", "Önümüzdeki 30 gün", planKayitlari)}>
                    +{planKayitlari.length - 5} planlı izin daha
                  </Button>
                </div>
              )}
            </>
          )}

          {cakismalar.slice(0, 3).map((c) => (
            <div key={c.sube} className="yp-cakisma"
              onClick={() => izinListesiAc(`${c.sube} · aynı anda izinde`, `${c.bas.format("DD.MM.YYYY")} – ${c.bit.format("DD.MM.YYYY")}`, c.kayitlar)}>
              ⚠ <b style={{ color: "#e8481c" }}>{c.sube}</b>'de {c.bas.format("DD.MM")}–{c.bit.format("DD.MM")} arası{" "}
              {c.en} kişi aynı anda izinde (şubede {subeKisiSayisi.get(c.sube)} personel). Ayrıntı için tıklayın.
            </div>
          ))}
          {cakismalar.length > 3 && (
            <div className="yp-cakisma"
              onClick={() => izinListesiAc("Aynı anda çok kişinin izinde olduğu şubeler", cakismalar.map((c) => c.sube).join(", "), cakismalar.flatMap((c) => c.kayitlar))}>
              ⚠ +{cakismalar.length - 3} şubede daha aynı anda çok kişi izinde. Tümünü görmek için tıklayın.
            </div>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------------ aylar */}
      <div className="ip-panel" style={{ marginBottom: 14 }}>
        <div className="ip-pbas">
          <div>
            <b>Aylara göre izin kullanımı · {yil}</b>
            <small>Yeşil kullanılan, mor planlanmış yıllık izin günü · aya tıklayın</small>
          </div>
        </div>
        <div className="yp-aylar">
          {aylar.map((x, i) => (
            <Tooltip key={i} title={`${AYLAR[i]}: ${gun(x.kul)} gün kullanılan, ${gun(x.pla)} gün planlı · ${x.k.length} izin kaydı`}>
              <button className="yp-ay" onClick={() => izinListesiAc(`${AYLAR[i]} ${yil} izinleri`, `${x.k.length} kayıt · ${gun(x.kul + x.pla)} gün`, x.k)}>
                <b>{x.kul + x.pla ? gun(x.kul + x.pla) : ""}</b>
                <div className="s" style={{ height: ((x.kul + x.pla) * 150) / ayMax }}>
                  <i style={{ height: (x.kul * 150) / ayMax, background: "#7cb518" }} />
                  <i style={{ height: (x.pla * 150) / ayMax, background: "#b8a3e8" }} />
                </div>
                <span style={{ color: i > bugun.month() ? "#722ed1" : undefined }}>{AYLAR[i]}</span>
              </button>
            </Tooltip>
          ))}
        </div>
      </div>

      <div className="yp-alt">
        {/* ------------------------------------------------------ şube tablosu */}
        <div className="ip-panel">
          <div className="ip-pbas">
            <div>
              <b>Şube bazında</b>
              <small>Başlığa tıklayarak sıralayın · satıra tıklayınca şube personeli</small>
            </div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="yp-tablo">
              <thead>
                <tr>
                  {([["sube", "Şube"], ["kisi", "Personel"], ["hak", "Hak"], ["kul", "Kullanılan"], ["pla", "Planlı"], ["kalan", "Kalan"], ["oran", "Kullanım"]] as const).map(([k, t]) => (
                    <th key={k} className={k === "sube" || k === "oran" ? "" : "s"}
                      onClick={() => setSubeSira({ k, y: subeSira.k === k ? -subeSira.y : 1 })}>
                      {t}{subeSira.k === k ? (subeSira.y > 0 ? " ▲" : " ▼") : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {siraliSubeler.map((x) => (
                  <tr key={x.sube}
                    onClick={() => onListe({ baslik: `${x.sube} personeli`, kisiler: x.a, sag: (k) => (k.girildiMi ? `${gun(k.kalan)} gün kalan` : "hak ediş yok") })}>
                    <td><b>{x.sube}</b></td>
                    <td className="s">{x.kisi}</td>
                    <td className="s">{gun(x.hak)}</td>
                    <td className="s">{gun(x.kul)}</td>
                    <td className="s">{gun(x.pla)}</td>
                    <td className="s">{gun(x.kalan)}</td>
                    <td>
                      <div className="yp-kull">
                        <div className="c">
                          <i style={{ width: `${x.oran}%`, background: "#7cb518" }} />
                          <i style={{ width: `${x.hak ? (x.pla * 100) / x.hak : 0}%`, background: "#b8a3e8" }} />
                        </div>
                        <b style={{ color: x.oran < 25 ? "#cf1322" : x.oran < 35 ? "#b7791f" : x.oran > 50 ? "#5f8c10" : "#1f2933" }}>
                          %{Math.round(x.oran)}
                        </b>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ------------------------------------------------------ biriktirenler */}
        <div className="ip-panel">
          <div className="ip-pbas">
            <div>
              <b>İzin biriktirenler</b>
              <small>Bu yıl hiç izin kullanmamış, kalan günü en yüksek olanlar</small>
            </div>
            <Tag color="red" style={{ cursor: "pointer" }}
              onClick={() => onListe({ baslik: "İzin biriktirenler", kisiler: hicKullanmayan, sag: (k) => `${gun(k.kalan)} gün` })}>
              {hicKullanmayan.length} kişi
            </Tag>
          </div>
          {hicKullanmayan.length === 0 ? (
            <div className="yp-bos">Herkes izin kullanmış.</div>
          ) : (
            <>
              {hicKullanmayan.slice(0, 5).map((k) => (
                <div key={k.personelKodu} className="yp-birik" onClick={() => onKisi(k)}>
                  <Avatar k={k} />
                  <div style={{ minWidth: 0 }}>
                    <b><PersonelAdi kod={k.personelKodu}>{k.adSoyad}</PersonelAdi></b>
                    <span className="yp-soluk">
                      {k.gorev} · {k.subeAdi}
                      {(k.hakedisEsas ?? k.girisTarihi) && ` · ${bugun.diff(dayjs(k.hakedisEsas ?? k.girisTarihi), "year")} yıl kıdem`}
                    </span>
                  </div>
                  <div className="yp-sag">
                    <b style={{ color: kalanRenk(Number(k.kalan)) }}>{gun(k.kalan)} gün</b>
                    <span className="yp-soluk">devir {gun(k.devir)}</span>
                  </div>
                </div>
              ))}
              <div style={{ textAlign: "center", marginTop: 8 }}>
                <Button size="small" onClick={() => onListe({ baslik: "İzin biriktirenler", kisiler: hicKullanmayan, sag: (k) => `${gun(k.kalan)} gün` })}>
                  Tümünü gör
                </Button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------ izin kayıtları */}
      <Drawer
        open={!!izinListesi}
        onClose={() => setIzinListesi(null)}
        width="min(960px, 96vw)"
        title={
          izinListesi && (
            <Space wrap>
              <Text strong>{izinListesi.baslik}</Text>
              <Tag color="blue">{izinListesi.kayitlar.length} kayıt</Tag>
              <Text type="secondary" style={{ fontSize: 12.5 }}>{izinListesi.alt}</Text>
            </Space>
          )
        }
      >
        {izinListesi && (
          <Tablo
            rowKey="id"
            size="small"
            dataSource={izinListesi.kayitlar}
            pagination={{ pageSize: 25, showSizeChanger: false }}
            rowClassName="rp-tiklanabilir"
            onRow={(z: any) => ({ onClick: () => z.kisi && (setIzinListesi(null), onKisi(z.kisi)) })}
            scroll={{ x: 820 }}
            columns={[
              { title: "Personel", dataIndex: "adSoyad", width: 180, render: (v: string, z: any) => <Text strong><PersonelAdi kod={z.personelKodu}>{v || z.kisi?.adSoyad}</PersonelAdi></Text> },
              { title: "Şube", key: "sube", width: 150, render: (_: any, z: any) => z.kisi?.subeAdi ?? z.subeAdi },
              {
                title: "Tür", dataIndex: "tur", width: 150,
                render: (v: string, z: any) => (
                  <span>
                    {v} {z.c.isAfter(bugun) && <Tag color="purple">planlı</Tag>}
                    {!z.c.isAfter(bugun) && !z.d.isBefore(bugun) && <Tag color="blue">devam ediyor</Tag>}
                  </span>
                ),
              },
              { title: "Çıkış", key: "c", width: 105, sorter: (a: any, b: any) => a.c.valueOf() - b.c.valueOf(), render: (_: any, z: any) => z.c.format("DD.MM.YYYY") },
              { title: "Dönüş", key: "d", width: 105, render: (_: any, z: any) => z.d.format("DD.MM.YYYY") },
              { title: "Gün", dataIndex: "gun", width: 70, align: "right" as const, render: (v: number) => gun(v) },
              { title: "Giren", dataIndex: "giren", ellipsis: true },
            ]}
          />
        )}
      </Drawer>
    </div>
  );
}
