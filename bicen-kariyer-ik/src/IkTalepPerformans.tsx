/**
 * İK Performans › Personel talepleri (21.10.2026)
 * ---------------------------------------------------------------------------
 * İK uzmanlarının Personel Talepleri sayfasındaki işleri: izin kararları ve
 * karar süresi, İK evrakı yükleme oranı, eksik bildirimleri, fazla mesai /
 * avans / rotasyon / vardiya düzeltme kararları, şubelerinde şu an
 * bekleyenler. Kaynak: GET /api/IkTalepPerformans.
 */
import { useCallback, useEffect, useState } from "react";
import { App as AntdApp, Button, DatePicker, Drawer, Space, Table, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs, { Dayjs } from "dayjs";
import { ClipboardCheck, Download, FileCheck2, FileWarning, Hourglass, RefreshCw, Timer, Users } from "lucide-react";
import { api } from "./api";
import { tabloIndir } from "./raporExcel";
import "./IkPerformans.css";

const { RangePicker } = DatePicker;

interface Uzman {
  kullaniciAdi: string;
  adSoyad: string;
  rol: string;
  unvan: string | null;
  bolge: string | null;
  izinOnay: number;
  izinRed: number;
  izinDigerAsama: number;
  izinOrtSaat: number | null;
  izinMedyanSaat: number | null;
  izinEnUzunSaat: number | null;
  izin24: number;
  ikEvrak: number;
  fmEvrak: number;
  onayBelgeli: number;
  evrakSonraBekleyen: number;
  personelBelgeGerekli: number;
  personelBelgeYuklendi: number;
  eksik: number;
  eksikTamamlanan: number;
  eksikKapatma: number;
  fmOnay: number;
  fmRed: number;
  fmOrtSaat: number | null;
  avansKarar: number;
  avansOdeme: number;
  rotasyon: number;
  vardiyaDuzeltme: number;
  bekleyenIzin: number;
  enEskiBekleyenGun: number | null;
  kapsamEvrakSonra: number;
  acikEksik: number;
  toplam: number;
  sonIslem: string | null;
}

interface Veri {
  genel: {
    izinKarar: number;
    izinOrtSaat: number | null;
    izinMedyanSaat: number | null;
    izin24Oran: number | null;
    ikEvrak: number;
    izinOnay: number;
    onayBelgeli: number;
    personelBelgeGerekli: number;
    personelBelgeYuklendi: number;
    eksik: number;
    eksikTamamlanan: number;
    fmKarar: number;
    digerKarar: number;
    bekleyenIzin: number;
    evrakSonraBekleyen: number;
    acikEksik: number;
  };
  uzmanlar: Uzman[];
}

const sure = (saat: number | null | undefined) => {
  if (saat == null) return "—";
  if (saat < 1) return `${Math.max(1, Math.round(saat * 60))} dk`;
  if (saat < 24) return `${Math.round(saat * 10) / 10} saat`.replace(".", ",");
  return `${Math.round((saat / 24) * 10) / 10} gün`.replace(".", ",");
};
const sureRengi = (saat: number | null | undefined) =>
  saat == null ? undefined : saat <= 8 ? "#4d7a0c" : saat <= 24 ? "#6aa312" : saat <= 72 ? "#b7791f" : "#d0421a";
const yuzde = (a: number, b: number) => (b ? Math.round((a * 100) / b) : null);
const oranYaz = (a: number, b: number) => (b ? `%${yuzde(a, b)}` : "—");
const oranRengi = (a: number, b: number) => {
  const y = yuzde(a, b);
  return y == null ? undefined : y >= 90 ? "#4d7a0c" : y >= 70 ? "#b7791f" : "#d0421a";
};
const sayi = (n: number) => (n ? n.toLocaleString("tr-TR") : <span style={{ color: "#c3c8bf" }}>0</span>);

const AV_RENK = ["#5f8c10", "#1a5fb4", "#722ed1", "#e8481c", "#08979c", "#b7791f", "#c41d7f"];
const avRengi = (s: string) => {
  let t = 0;
  for (const c of s ?? "") t = (t * 31 + c.charCodeAt(0)) >>> 0;
  return AV_RENK[t % AV_RENK.length];
};
const basHarf = (s: string) =>
  (s ?? "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x[0])
    .join("");

export default function IkTalepPerformans() {
  const { message } = AntdApp.useApp();
  const [aralik, setAralik] = useState<[Dayjs, Dayjs]>([dayjs().startOf("month"), dayjs()]);
  const [hazir, setHazir] = useState<"ay" | "3ay" | "yil" | null>("ay");
  const [veri, setVeri] = useState<Veri | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [secili, setSecili] = useState<Uzman | null>(null);

  const getir = useCallback(() => {
    setYukleniyor(true);
    api
      .al<Veri>(`/api/IkTalepPerformans?bas=${aralik[0].format("YYYY-MM-DD")}&bit=${aralik[1].format("YYYY-MM-DD")}`)
      .then(setVeri)
      .catch((e: any) => message.error(e?.message ?? "Veri alınamadı"))
      .finally(() => setYukleniyor(false));
  }, [aralik, message]);

  useEffect(() => {
    getir();
  }, [getir]);

  const hazirSec = (h: "ay" | "3ay" | "yil") => {
    setHazir(h);
    setAralik(
      h === "ay" ? [dayjs().startOf("month"), dayjs()]
      : h === "3ay" ? [dayjs().subtract(2, "month").startOf("month"), dayjs()]
      : [dayjs().startOf("year"), dayjs()]
    );
  };

  const g = veri?.genel;
  const uzmanlar = veri?.uzmanlar ?? [];

  const excel = () =>
    tabloIndir({
      baslik: "İK Performans · Personel talepleri",
      altBaslik: `${aralik[0].format("DD.MM.YYYY")} – ${aralik[1].format("DD.MM.YYYY")}`,
      sayfaAdi: "Uzmanlar",
      dosyaAdi: `ik-talep-performans-${aralik[0].format("YYYYMMDD")}-${aralik[1].format("YYYYMMDD")}`,
      genelToplam: true,
      sutunlar: [
        { ad: "Uzman", genislik: 24 },
        { ad: "İzin onay", tip: "sayi" },
        { ad: "İzin red", tip: "sayi" },
        { ad: "Ort. karar (saat)", tip: "ondalik", toplam: false },
        { ad: "İK evrakı", tip: "sayi" },
        { ad: "Evrak oranı", tip: "yuzde", toplam: false },
        { ad: "Personel belge oranı", tip: "yuzde", toplam: false },
        { ad: "Eksik bildirimi", tip: "sayi" },
        { ad: "Eksik tamamlanan", tip: "sayi" },
        { ad: "Fazla mesai karar", tip: "sayi" },
        { ad: "Avans karar", tip: "sayi" },
        { ad: "Avans ödeme", tip: "sayi" },
        { ad: "Rotasyon", tip: "sayi" },
        { ad: "Vardiya düzeltme", tip: "sayi" },
        { ad: "Toplam işlem", tip: "sayi", veriCubugu: true },
        { ad: "Bekleyen izin", tip: "sayi" },
        { ad: "En eski bekleyen (gün)", tip: "ondalik", toplam: false },
      ],
      satirlar: uzmanlar.map((u) => [
        u.adSoyad || u.kullaniciAdi, u.izinOnay, u.izinRed, u.izinOrtSaat,
        u.ikEvrak + u.fmEvrak,
        u.izinOnay ? u.onayBelgeli / u.izinOnay : null,
        u.personelBelgeGerekli ? u.personelBelgeYuklendi / u.personelBelgeGerekli : null,
        u.eksik, u.eksikTamamlanan, u.fmOnay + u.fmRed, u.avansKarar, u.avansOdeme, u.rotasyon, u.vardiyaDuzeltme,
        u.toplam, u.bekleyenIzin, u.enEskiBekleyenGun,
      ]),
    });

  const sutunlar: ColumnsType<Uzman> = [
    {
      title: "Uzman",
      key: "ad",
      fixed: "left",
      width: 210,
      render: (_, u) => (
        <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span className="ip-av" style={{ width: 32, height: 32, fontSize: 12, background: avRengi(u.kullaniciAdi) }}>
            {basHarf(u.adSoyad || u.kullaniciAdi)}
          </span>
          <span style={{ minWidth: 0 }}>
            <b style={{ display: "block" }}>{u.adSoyad || u.kullaniciAdi}</b>
            <small style={{ color: "#8a9187" }}>{u.unvan || u.rol}</small>
          </span>
        </span>
      ),
    },
    {
      title: "İzin kararı",
      key: "izin",
      align: "right",
      sorter: (a, b) => a.izinOnay + a.izinRed - (b.izinOnay + b.izinRed),
      render: (_, u) => (
        <Tooltip title={`${u.izinOnay} onay · ${u.izinRed} red${u.izinDigerAsama ? ` · ${u.izinDigerAsama} mağaza/bölge aşamasında` : ""}`}>
          <b>{sayi(u.izinOnay + u.izinRed)}</b>
          {u.izinRed ? <small style={{ color: "#d0421a" }}> · {u.izinRed} red</small> : null}
        </Tooltip>
      ),
    },
    {
      title: <Tooltip title="Talebin İK aşamasına gelişinden karara kadar">Karar süresi</Tooltip>,
      key: "sure",
      align: "right",
      sorter: (a, b) => (a.izinOrtSaat ?? 1e9) - (b.izinOrtSaat ?? 1e9),
      render: (_, u) => (
        <Tooltip title={u.izinMedyanSaat != null ? `Ortanca ${sure(u.izinMedyanSaat)} · en uzun ${sure(u.izinEnUzunSaat)} · 24 saatte ${u.izin24}/${u.izinOnay + u.izinRed}` : ""}>
          <b style={{ color: sureRengi(u.izinOrtSaat) }}>{sure(u.izinOrtSaat)}</b>
        </Tooltip>
      ),
    },
    {
      title: <Tooltip title="Onayladığı izinlerde İK evrakının yüklenme oranı (evrak sonra bekleyenler dahil değil)">Evrak oranı</Tooltip>,
      key: "evrak",
      align: "right",
      sorter: (a, b) => (yuzde(a.onayBelgeli, a.izinOnay) ?? -1) - (yuzde(b.onayBelgeli, b.izinOnay) ?? -1),
      render: (_, u) => (
        <Tooltip title={`${u.onayBelgeli}/${u.izinOnay} onayda İK evrakı var · ${u.evrakSonraBekleyen} "evrak sonra" bekliyor · toplam ${u.ikEvrak} izin + ${u.fmEvrak} fazla mesai evrakı yükledi`}>
          <b style={{ color: oranRengi(u.onayBelgeli, u.izinOnay) }}>{oranYaz(u.onayBelgeli, u.izinOnay)}</b>
          {u.evrakSonraBekleyen ? <small style={{ color: "#b7791f" }}> · {u.evrakSonraBekleyen} bekliyor</small> : null}
        </Tooltip>
      ),
    },
    {
      title: <Tooltip title="Belge istenen izinlerde personelin belgeyi yükleme oranı">Personel belgesi</Tooltip>,
      key: "pbelge",
      align: "right",
      render: (_, u) => (
        <Tooltip title={`${u.personelBelgeYuklendi}/${u.personelBelgeGerekli} talepte personel belgesi tamam`}>
          <span style={{ color: oranRengi(u.personelBelgeYuklendi, u.personelBelgeGerekli), fontWeight: 700 }}>
            {oranYaz(u.personelBelgeYuklendi, u.personelBelgeGerekli)}
          </span>
        </Tooltip>
      ),
    },
    {
      title: "Eksik bildirimi",
      key: "eksik",
      align: "right",
      sorter: (a, b) => a.eksik - b.eksik,
      render: (_, u) => (
        <Tooltip title={`${u.eksik} bildirim · ${u.eksikTamamlanan} tamamlandı · ${u.eksikKapatma} kapattı · ${u.acikEksik} açık`}>
          <b>{sayi(u.eksik)}</b>
          {u.acikEksik ? <small style={{ color: "#b7791f" }}> · {u.acikEksik} açık</small> : null}
        </Tooltip>
      ),
    },
    {
      title: "Fazla mesai",
      key: "fm",
      align: "right",
      sorter: (a, b) => a.fmOnay + a.fmRed - (b.fmOnay + b.fmRed),
      render: (_, u) => (
        <Tooltip title={`${u.fmOnay} onay · ${u.fmRed} red · ort. ${sure(u.fmOrtSaat)}`}>{sayi(u.fmOnay + u.fmRed)}</Tooltip>
      ),
    },
    {
      title: "Avans",
      key: "avans",
      align: "right",
      render: (_, u) => <Tooltip title={`${u.avansKarar} karar · ${u.avansOdeme} ödeme`}>{sayi(u.avansKarar + u.avansOdeme)}</Tooltip>,
    },
    { title: "Rotasyon", key: "rot", align: "right", render: (_, u) => sayi(u.rotasyon) },
    { title: "Vardiya düzeltme", key: "vd", align: "right", render: (_, u) => sayi(u.vardiyaDuzeltme) },
    {
      title: "Toplam",
      key: "toplam",
      align: "right",
      defaultSortOrder: "descend",
      sorter: (a, b) => a.toplam - b.toplam,
      render: (_, u) => <b>{sayi(u.toplam)}</b>,
    },
    {
      title: <Tooltip title="Uzmanın şubelerinde şu an İK kararı bekleyen izin talepleri">Bekleyen</Tooltip>,
      key: "bek",
      align: "right",
      sorter: (a, b) => a.bekleyenIzin - b.bekleyenIzin,
      render: (_, u) =>
        u.bekleyenIzin ? (
          <Tooltip title={`En eskisi ${u.enEskiBekleyenGun} gündür bekliyor`}>
            <b style={{ color: (u.enEskiBekleyenGun ?? 0) > 3 ? "#d0421a" : "#b7791f" }}>{u.bekleyenIzin}</b>
          </Tooltip>
        ) : (
          sayi(0)
        ),
    },
  ];

  return (
    <div className="ip">
      <div className="ip-baslik">
        <div>
          <p style={{ margin: 0 }}>
            {aralik[0].format("DD.MM.YYYY")} – {aralik[1].format("DD.MM.YYYY")} · İK uzmanlarının Personel Talepleri'ndeki işleri
          </p>
        </div>
        <Space wrap size={8}>
          <div className="ip-cipler">
            {([["ay", "Bu ay"], ["3ay", "Son 3 ay"], ["yil", "Bu yıl"]] as const).map(([k, t]) => (
              <button key={k} className={hazir === k ? "acik" : ""} onClick={() => hazirSec(k)}>
                {t}
              </button>
            ))}
          </div>
          <RangePicker
            value={aralik}
            format="DD.MM.YYYY"
            allowClear={false}
            onChange={(d) => {
              if (!d) return;
              setHazir(null);
              setAralik(d as [Dayjs, Dayjs]);
            }}
          />
          <Button loading={yukleniyor} icon={<RefreshCw size={15} />} onClick={getir}>
            Yenile
          </Button>
          <Button icon={<Download size={15} />} onClick={excel} disabled={!uzmanlar.length}>
            Excel
          </Button>
        </Space>
      </div>

      <div className="ip-kpi">
        <div className="ip-k" style={{ ["--c" as any]: "#1a5fb4", cursor: "default" }}>
          <span>
            <ClipboardCheck size={13} /> İzin kararı
          </span>
          <b>{(g?.izinKarar ?? 0).toLocaleString("tr-TR")}</b>
          <small>İK aşamasında onay ve red</small>
        </div>
        <div className="ip-k" style={{ ["--c" as any]: "#5f8c10", cursor: "default" }}>
          <span>
            <Timer size={13} /> Ort. karar süresi
          </span>
          <b style={{ color: sureRengi(g?.izinOrtSaat) }}>{sure(g?.izinOrtSaat)}</b>
          <small>
            ortanca {sure(g?.izinMedyanSaat)}
            {g?.izin24Oran != null ? ` · %${g.izin24Oran}'i 24 saatte` : ""}
          </small>
        </div>
        <div className="ip-k" style={{ ["--c" as any]: "#08979c", cursor: "default" }}>
          <span>
            <FileCheck2 size={13} /> İK evrakı oranı
          </span>
          <b style={{ color: oranRengi(g?.onayBelgeli ?? 0, g?.izinOnay ?? 0) }}>{oranYaz(g?.onayBelgeli ?? 0, g?.izinOnay ?? 0)}</b>
          <small>
            {g?.onayBelgeli ?? 0}/{g?.izinOnay ?? 0} onayda evrak · {g?.ikEvrak ?? 0} yükleme
          </small>
        </div>
        <div className="ip-k" style={{ ["--c" as any]: "#722ed1", cursor: "default" }}>
          <span>
            <Users size={13} /> Personel belgesi
          </span>
          <b style={{ color: oranRengi(g?.personelBelgeYuklendi ?? 0, g?.personelBelgeGerekli ?? 0) }}>
            {oranYaz(g?.personelBelgeYuklendi ?? 0, g?.personelBelgeGerekli ?? 0)}
          </b>
          <small>
            belge istenen {g?.personelBelgeGerekli ?? 0} izinde yüklenen
          </small>
        </div>
        <div className="ip-k" style={{ ["--c" as any]: "#b7791f", cursor: "default" }}>
          <span>
            <FileWarning size={13} /> Eksik bildirimi
          </span>
          <b>{(g?.eksik ?? 0).toLocaleString("tr-TR")}</b>
          <small>
            {g?.eksikTamamlanan ?? 0} tamamlandı · şu an {g?.acikEksik ?? 0} açık
          </small>
        </div>
        <div className="ip-k" style={{ ["--c" as any]: "#e8481c", cursor: "default" }}>
          <span>
            <Hourglass size={13} /> Şu an bekleyen
          </span>
          <b>{(g?.bekleyenIzin ?? 0).toLocaleString("tr-TR")}</b>
          <small>İK kararı bekleyen izin · {g?.evrakSonraBekleyen ?? 0} evrak sonra</small>
        </div>
      </div>

      <div className="ip-panel">
        <div className="ip-pbas">
          <div>
            <b>Uzmanlar</b>
            <small style={{ display: "block", color: "#8a9187" }}>
              Satıra tıklayın · sayıların üstüne gelince ayrıntı · fazla mesai {g?.fmKarar ?? 0}, avans/rotasyon/vardiya {g?.digerKarar ?? 0} işlem
            </small>
          </div>
        </div>
        <Table<Uzman>
          rowKey="kullaniciAdi"
          size="middle"
          loading={yukleniyor}
          dataSource={uzmanlar}
          columns={sutunlar}
          pagination={false}
          scroll={{ x: 1300 }}
          onRow={(u) => ({ onClick: () => setSecili(u), style: { cursor: "pointer" } })}
        />
      </div>

      <Drawer open={!!secili} onClose={() => setSecili(null)} width={520} title={secili?.adSoyad || secili?.kullaniciAdi}>
        {secili && <UzmanAyrinti u={secili} />}
      </Drawer>
    </div>
  );
}

function UzmanAyrinti({ u }: { u: Uzman }) {
  const satir = (ad: string, deger: React.ReactNode, alt?: string) => (
    <div className="ip-satir" style={{ borderBottom: "1px solid #f0f2ee", padding: "9px 0" }}>
      <span>
        {ad}
        {alt ? <small style={{ display: "block", color: "#8a9187" }}>{alt}</small> : null}
      </span>
      <b>{deger}</b>
    </div>
  );
  return (
    <div>
      <div className="ip-sayilar" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
        <div>
          <b style={{ fontSize: 20 }}>{u.toplam}</b>
          <div style={{ fontSize: 11.5, color: "#8a9187" }}>toplam işlem</div>
        </div>
        <div>
          <b style={{ fontSize: 20, color: sureRengi(u.izinOrtSaat) }}>{sure(u.izinOrtSaat)}</b>
          <div style={{ fontSize: 11.5, color: "#8a9187" }}>ort. izin kararı</div>
        </div>
        <div>
          <b style={{ fontSize: 20, color: oranRengi(u.onayBelgeli, u.izinOnay) }}>{oranYaz(u.onayBelgeli, u.izinOnay)}</b>
          <div style={{ fontSize: 11.5, color: "#8a9187" }}>İK evrakı</div>
        </div>
      </div>
      <h4 style={{ margin: "14px 0 4px" }}>İzin talepleri</h4>
      {satir("Onayladığı", u.izinOnay)}
      {satir("Reddettiği", u.izinRed)}
      {u.izinDigerAsama ? satir("Mağaza/bölge aşamasında karar", u.izinDigerAsama, "yönetici yerine verdiği kararlar") : null}
      {satir("Karar süresi", `${sure(u.izinOrtSaat)} ort. · ${sure(u.izinMedyanSaat)} ortanca`, `en uzun ${sure(u.izinEnUzunSaat)} · 24 saat içinde ${u.izin24}`)}
      <h4 style={{ margin: "14px 0 4px" }}>Evrak</h4>
      {satir("İK evrakı yüklediği izin", u.ikEvrak)}
      {satir("Onayında evrakı olan", `${u.onayBelgeli}/${u.izinOnay}`, oranYaz(u.onayBelgeli, u.izinOnay))}
      {satir('"Evrak sonra" bekleyen', u.evrakSonraBekleyen, "onayladığı, İK evrakı henüz yüklenmemiş")}
      {satir("Personel belgesi tamam", `${u.personelBelgeYuklendi}/${u.personelBelgeGerekli}`, "belge istenen izinlerinde")}
      {satir("Fazla mesai evrakı yüklediği", u.fmEvrak)}
      <h4 style={{ margin: "14px 0 4px" }}>Eksik bildirimleri</h4>
      {satir("Gönderdiği", u.eksik)}
      {satir("Personelin tamamladığı", u.eksikTamamlanan)}
      {satir("Kapattığı", u.eksikKapatma)}
      {satir("Şu an açık", u.acikEksik)}
      <h4 style={{ margin: "14px 0 4px" }}>Diğer talepler</h4>
      {satir("Fazla mesai kararı", `${u.fmOnay + u.fmRed}`, `${u.fmOnay} onay · ${u.fmRed} red · ort. ${sure(u.fmOrtSaat)}`)}
      {satir("Avans", `${u.avansKarar} karar · ${u.avansOdeme} ödeme`)}
      {satir("Rotasyon kararı", u.rotasyon)}
      {satir("Vardiya düzeltme kararı", u.vardiyaDuzeltme)}
      <h4 style={{ margin: "14px 0 4px" }}>Şubelerinde şu an</h4>
      {satir("İK kararı bekleyen izin", u.bekleyenIzin, u.enEskiBekleyenGun != null ? `en eskisi ${u.enEskiBekleyenGun} gün` : undefined)}
      {satir('"Evrak sonra" bekleyen', u.kapsamEvrakSonra)}
      {u.sonIslem ? <div className="ip-alt">Son işlem: {dayjs(u.sonIslem).format("DD.MM.YYYY HH:mm")}</div> : null}
    </div>
  );
}
