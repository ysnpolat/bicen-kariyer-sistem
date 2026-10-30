/**
 * ---------------------------------------------------------------------------
 * Arıza Kayıtları (yenilendi 13.10.2026)
 * ---------------------------------------------------------------------------
 * Hazır görünümler (kapanmamış, bana atanan, atanmamış, geciken, çözüldü,
 * tümü), özet kutuları, mağaza / departman / öncelik / kategori süzgeci,
 * liste ve pano görünümü, toplu atama ve durum. Satıra tıklayınca sağdan
 * ayrıntı açılıyor: durum adımları, sorumlu seçimi (sicil yazmadan),
 * yorumlar ve hareketler tek akışta, servis formu ve cihaz geçmişi.
 *
 * Kapsam sunucuda: kullanıcı yalnızca rolünün / temsilcisi olduğu
 * departmanların kayıtlarını görür. Yönetme (durum, atama) rolde ayrıca
 * açılır; açık değilse ekran salt okunur.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Drawer,
  Empty,
  Image,
  Input,
  Select,
  Spin,
  Table,
  Tabs,
  Tooltip,
  message,
} from "antd";
import {
  Camera,
  Clock3,
  Columns3,
  Download,
  List,
  Lock,
  MessageSquare,
  Monitor,
  Phone,
  Plus,
  Search,
  Settings2,
  X,
} from "lucide-react";
import dayjs from "dayjs";

import { API_TABAN, api, oturumOku } from "../api";
import { sorguOku } from "../rota";
import ServisFormu from "./ServisFormu";
import ArizaAc from "./ArizaAc";
import { Kategoriler } from "./Yonetim";
import SoruAkisi from "./SoruAkisi";

/* -------------------------------------------------------------------------- */

const DURUMLAR: Record<string, { ad: string; renk: string; zemin: string }> = {
  acik: { ad: "Açık", renk: "#cf1322", zemin: "#fff1f0" },
  devam: { ad: "Devam ediyor", renk: "#1a5fb4", zemin: "#e7f0fc" },
  beklemede: { ad: "Beklemede", renk: "#b8860b", zemin: "#fdf6e3" },
  cozuldu: { ad: "Çözüldü", renk: "#5f8c10", zemin: "#f2f9e8" },
  kapandi: { ad: "Kapandı", renk: "#6b7280", zemin: "#f1f3ee" },
};
const SIRA = ["acik", "devam", "beklemede", "cozuldu", "kapandi"];

const ONCELIKLER: Record<string, { ad: string; renk: string }> = {
  acil: { ad: "Acil", renk: "#cf1322" },
  yuksek: { ad: "Yüksek", renk: "#e8481c" },
  orta: { ad: "Orta", renk: "#d4a106" },
  dusuk: { ad: "Düşük", renk: "#9aa1a9" },
};

const GORUNUMLER: { kod: string; ad: string; ozet: string; kirmizi?: boolean }[] = [
  { kod: "kapanmamis", ad: "Kapanmamış", ozet: "aktif" },
  { kod: "bana", ad: "Bana atanan", ozet: "bana" },
  { kod: "atanmamis", ad: "Atanmamış", ozet: "atanmamis" },
  { kod: "geciken", ad: "Geciken", ozet: "geciken", kirmizi: true },
  { kod: "cozuldu", ad: "Çözüldü · onay bekliyor", ozet: "cozuldu" },
  { kod: "tumu", ad: "Tümü", ozet: "toplam" },
];

const telefonYaz = (ham: string) => {
  const r = (ham ?? "").replace(/\D/g, "");
  if (r.length !== 10) return ham;
  return `0${r.slice(0, 3)} ${r.slice(3, 6)} ${r.slice(6, 8)} ${r.slice(8)}`;
};

const zaman = (d: unknown) => (d ? dayjs(d as string).format("DD.MM.YYYY HH:mm") : "—");

const once = (d: unknown) => {
  if (!d) return "";
  const s = dayjs().diff(dayjs(d as string), "minute");
  if (s < 60) return `${Math.max(s, 1)} dk önce`;
  if (s < 60 * 24) return `${Math.round(s / 60)} sa önce`;
  return `${Math.round(s / 1440)} gün önce`;
};

const bas = (a?: string | null) =>
  (a || "?")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x[0])
    .join("")
    .toLocaleUpperCase("tr");

const kapali = (d: string) => d === "cozuldu" || d === "kapandi";

const depoOku = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const depoYaz = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* depolama kapalı */
  }
};

interface Kayit {
  id: number;
  baslik: string;
  durum: string;
  oncelik: string;
  olusturma: string;
  slaBitis: string | null;
  subeKodu: string | null;
  acanAdi: string | null;
  atananAdi: string | null;
  atananKodu: string | null;
  departman: string | null;
  departmanId: number | null;
  tur: string | null;
  cihaz: string | null;
  akisOzet: string | null;
  gecikti: number;
  gorselSayisi: number;
  yorumSayisi: number;
}

interface Ozet {
  toplam: number;
  aktif: number;
  acik: number;
  devam: number;
  beklemede: number;
  kapali: number;
  geciken: number;
  atanmamis?: number;
  bana?: number;
  cozuldu?: number;
  ortCozumSaat?: number | null;
}

interface Kisi {
  kod: string;
  ad: string;
  kaynak: string;
}

/* -------------------------------------------------------------------------- */

function Sla({ k }: { k: { slaBitis: string | null; olusturma: string; durum: string } }) {
  if (!k.slaBitis) return <span className="ar-ipucu">—</span>;
  if (kapali(k.durum)) return <span className="ar-ipucu">{DURUMLAR[k.durum]?.ad}</span>;

  const toplam = Math.max(dayjs(k.slaBitis).diff(dayjs(k.olusturma), "minute"), 1);
  const gecen = dayjs().diff(dayjs(k.olusturma), "minute");
  const oran = Math.min(gecen / toplam, 1);
  const kalan = dayjs(k.slaBitis).diff(dayjs(), "hour", true);
  const renk = kalan < 0 ? "#cf1322" : oran > 0.75 ? "#e8481c" : "#7cb518";

  return (
    <div className="ar-sla">
      <div className="c">
        <i style={{ width: `${Math.max(oran * 100, 4)}%`, background: renk }} />
      </div>
      <small style={{ color: renk }}>
        {kalan < 0 ? `${Math.round(-kalan)} sa gecikti` : kalan < 1 ? "1 saatten az" : `${Math.round(kalan)} sa kaldı`}
      </small>
    </div>
  );
}

const DurumEtiketi = ({ d }: { d: string }) => (
  <span className="ar-etiket" style={{ color: DURUMLAR[d]?.renk, background: DURUMLAR[d]?.zemin }}>
    {DURUMLAR[d]?.ad ?? d}
  </span>
);

const OncelikEtiketi = ({ o }: { o: string }) => (
  <span className="ar-etiket cerceve" style={{ color: ONCELIKLER[o]?.renk, borderColor: `${ONCELIKLER[o]?.renk}44` }}>
    {ONCELIKLER[o]?.ad ?? o}
  </span>
);

const Atanan = ({ k }: { k: { atananAdi: string | null } }) =>
  k.atananAdi ? (
    <span className="ar-atanan">
      <span className="av">{bas(k.atananAdi)}</span>
      {k.atananAdi}
    </span>
  ) : (
    <span className="ar-atanmadi">Atanmadı</span>
  );

/* ========================================================================== */

export default function Arizalar() {
  /* Anasayfadan gelen süzgeç (?durum=acik, ?sla=gecikti, ?sube=, ?departman=ad, ?kayit=12) */
  const ilkSorgu = useMemo(() => sorguOku(), []);

  const [liste, setListe] = useState<Kayit[]>([]);
  const [ozet, setOzet] = useState<Ozet | null>(null);
  const [yonetir, setYonetir] = useState(false);
  const [kapsamAdi, setKapsamAdi] = useState<string | null>(null);
  const [turler, setTurler] = useState<{ id: number; ad: string; departmanId: number | null }[]>([]);
  const [departmanlar, setDepartmanlar] = useState<{ id: number; ad: string }[]>([]);
  const [subeler, setSubeler] = useState<string[]>([]);

  const [gorunum, setGorunum] = useState(() =>
    ilkSorgu.sla === "gecikti" ? "geciken" : ilkSorgu.durum === "kapanmis" || ilkSorgu.durum ? "tumu" : "kapanmamis",
  );
  const [durum, setDurum] = useState<string | undefined>(() =>
    ilkSorgu.durum === "kapanmis" ? "kapandi" : ilkSorgu.durum && DURUMLAR[ilkSorgu.durum] ? ilkSorgu.durum : undefined,
  );
  const [sube, setSube] = useState<string | undefined>(ilkSorgu.sube || undefined);
  const [departman, setDepartman] = useState<number | undefined>();
  const [oncelik, setOncelik] = useState<string | undefined>();
  const [tur, setTur] = useState<number | undefined>();
  const [ara, setAra] = useState("");
  const [tip, setTip] = useState<"liste" | "pano">(() => (depoOku("arizaGorunum") === "pano" ? "pano" : "liste"));

  const [secili, setSecili] = useState<number[]>([]);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [hata, setHata] = useState<string | null>(null);
  const [acik, setAcik] = useState<number | null>(() => (Number(ilkSorgu.kayit) > 0 ? Number(ilkSorgu.kayit) : null));
  const [acmaAcik, setAcmaAcik] = useState(false);
  const [atanabilir, setAtanabilir] = useState<Kisi[]>([]);

  /* Departmanın kendi arıza türleri ve soru akışı (13.10.2026) */
  const [turYonetir, setTurYonetir] = useState(false);
  const [turlerAcik, setTurlerAcik] = useState(false);
  const [turSekme, setTurSekme] = useState("turler");
  const [akisTuru, setAkisTuru] = useState<number | null>(null);

  useEffect(() => depoYaz("arizaGorunum", tip), [tip]);

  const getir = useCallback(async () => {
    setYukleniyor(true);
    setHata(null);

    try {
      const s = new URLSearchParams();
      if (gorunum === "kapanmamis") s.set("durum", "aktif");
      if (gorunum === "bana") s.set("gorunum", "bana");
      if (gorunum === "atanmamis") s.set("gorunum", "atanmamis");
      if (gorunum === "geciken") s.set("geciken", "true");
      if (gorunum === "cozuldu") s.set("durum", "cozuldu");
      if (durum && gorunum === "tumu") s.set("durum", durum);
      if (sube) s.set("sube", sube);
      if (departman) s.set("departman", String(departman));
      if (oncelik) s.set("oncelik", oncelik);
      if (tur) s.set("tur", String(tur));
      if (ara.trim()) s.set("ara", ara.trim());

      const c = await api.getir<{ kayitlar: Kayit[]; ozet: Ozet; yonetir?: boolean; kapsamAdi?: string; turYonetir?: boolean }>(
        `Ariza/Kayitlarim?${s.toString()}`,
      );

      setListe(c.kayitlar ?? []);
      setOzet(c.ozet ?? null);
      setYonetir(!!c.yonetir);
      setTurYonetir(!!c.turYonetir);
      setKapsamAdi(c.kapsamAdi ?? null);
      setSecili((o) => o.filter((id) => (c.kayitlar ?? []).some((k) => k.id === id)));
      setSubeler((o) => Array.from(new Set([...o, ...(c.kayitlar ?? []).map((k) => k.subeKodu).filter(Boolean) as string[]])).sort((a, b) => a.localeCompare(b, "tr")));
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Kayıtlar alınamadı.");
    } finally {
      setYukleniyor(false);
    }
  }, [gorunum, durum, sube, departman, oncelik, tur, ara]);

  useEffect(() => {
    api.getir<any[]>("Ariza/Turler").then(setTurler).catch(() => undefined);

    api
      .getir<{ departmanlar: { id: number; ad: string }[] }>("Ariza/Form")
      .then((c) => {
        setDepartmanlar(c.departmanlar ?? []);
        if (ilkSorgu.departman) {
          const d = (c.departmanlar ?? []).find((x) => x.ad === ilkSorgu.departman || String(x.id) === ilkSorgu.departman);
          if (d) setDepartman(d.id);
        }
      })
      .catch(() => undefined);

    api
      .getir<any>("Envanter/Subeler")
      .then((c) => {
        const l: string[] = (Array.isArray(c) ? c : c?.subeler ?? []).map((x: any) => (typeof x === "string" ? x : x?.subeKodu ?? x?.kod)).filter(Boolean);
        if (l.length) setSubeler((o) => Array.from(new Set([...o, ...l])).sort((a, b) => a.localeCompare(b, "tr")));
      })
      .catch(() => undefined);

    api.getir<Kisi[]>("Ariza/Atanabilir").then(setAtanabilir).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Arama yazarken her harfte istek gitmesin */
  useEffect(() => {
    const z = setTimeout(getir, ara ? 350 : 0);
    return () => clearTimeout(z);
  }, [getir, ara]);

  const toplu = async (govde: { durum?: string; atananKodu?: string }) => {
    try {
      const c = await api.gonder<{ yapilan: number; atlanan: number }>("Ariza/Toplu", { idler: secili, ...govde });
      message.success(`${c.yapilan} kayıt güncellendi${c.atlanan ? `, ${c.atlanan} kayıt atlandı (yetki)` : ""}.`);
      setSecili([]);
      getir();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Güncellenemedi.");
    }
  };

  const csv = () => {
    const satirlar = [
      ["No", "Başlık", "Departman", "Kategori", "Mağaza", "Açan", "Atanan", "Öncelik", "Durum", "Açılış", "SLA bitiş"],
      ...liste.map((k) => [
        k.id, k.baslik, k.departman ?? "", k.tur ?? "", k.subeKodu ?? "", k.acanAdi ?? "", k.atananAdi ?? "",
        ONCELIKLER[k.oncelik]?.ad ?? k.oncelik, DURUMLAR[k.durum]?.ad ?? k.durum, zaman(k.olusturma), zaman(k.slaBitis),
      ]),
    ];
    const metin = "﻿" + satirlar.map((s) => s.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([metin], { type: "text/csv;charset=utf-8" }));
    a.download = `ariza-kayitlari-${dayjs().format("YYYYMMDD-HHmm")}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const suzgecVar = !!(sube || departman || oncelik || tur || ara || (gorunum === "tumu" && durum));
  const ort = ozet?.ortCozumSaat;

  return (
    <div className="ar">
      <style>{CSS}</style>

      <div className="ar-ust">
        <h2>Arıza Kayıtları</h2>
        {kapsamAdi && (
          <span className="ar-kapsam">
            <Lock size={13} /> Kapsam: <b>{kapsamAdi}</b>
          </span>
        )}
        {!yonetir && !yukleniyor && (
          <Tooltip title="Rolünüzde arıza kayıtları yalnızca görüntüleme olarak açık. Temsilcisi olduğunuz departmanların kayıtlarını yine yönetebilirsiniz.">
            <span className="ar-kapsam">Görüntüleme</span>
          </Tooltip>
        )}
        <span className="ar-ust-sag">
          {turYonetir && (
            <Button icon={<Settings2 size={15} />} onClick={() => { setTurSekme("turler"); setTurlerAcik(true); }}>
              Arıza türleri
            </Button>
          )}
          <Button icon={<Download size={15} />} onClick={csv} disabled={liste.length === 0}>
            Dışa aktar
          </Button>
          <Button type="primary" icon={<Plus size={15} />} onClick={() => setAcmaAcik(true)}>
            Kayıt aç
          </Button>
        </span>
      </div>

      {hata && <Alert type="error" message={hata} showIcon style={{ marginBottom: 12 }} />}

      <div className="ar-gorunumler">
        {GORUNUMLER.map((g) => (
          <button
            key={g.kod}
            className={`${gorunum === g.kod ? "on" : ""} ${g.kirmizi && (ozet as any)?.[g.ozet] ? "kirmizi" : ""}`}
            onClick={() => {
              setGorunum(g.kod);
              setSecili([]);
            }}
          >
            {g.ad} <span className="n">{(ozet as any)?.[g.ozet] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="ar-kpi">
        <div className="k" onClick={() => { setGorunum("tumu"); setDurum("acik"); }}>
          <span>Açık</span>
          <b>{ozet?.acik ?? 0}</b>
          <small>henüz işleme alınmadı</small>
        </div>
        <div className="k" onClick={() => setGorunum("kapanmamis")}>
          <span>Devam / beklemede</span>
          <b>{(ozet?.devam ?? 0) + (ozet?.beklemede ?? 0)}</b>
          <small>üzerinde çalışılıyor</small>
        </div>
        <div className="k uyari" onClick={() => setGorunum("geciken")}>
          <span>SLA aşıldı</span>
          <b>{ozet?.geciken ?? 0}</b>
          <small>süresi geçmiş açık kayıt</small>
        </div>
        <div className="k">
          <span>Ort. çözüm süresi</span>
          <b>{ort == null ? "—" : ort < 24 ? `${Math.round(ort)} sa` : `${(ort / 24).toFixed(1).replace(".", ",")} gün`}</b>
          <small>son 30 gün</small>
        </div>
        <div className="k" onClick={() => setGorunum("atanmamis")}>
          <span>Atanmamış</span>
          <b>{ozet?.atanmamis ?? 0}</b>
          <small>sorumlusu yok</small>
        </div>
      </div>

      <div className="ar-suzgec">
        <Input
          allowClear
          prefix={<Search size={15} color="#9aa1a9" />}
          placeholder="No, başlık, akış, mağaza, açan ara"
          value={ara}
          onChange={(e) => setAra(e.target.value)}
          style={{ flex: "1 1 240px", minWidth: 0 }}
        />
        <Select allowClear showSearch placeholder="Mağaza" value={sube} onChange={setSube} style={{ width: 170 }}
          options={subeler.map((s) => ({ value: s, label: s }))} />
        <Select allowClear placeholder="Departman" value={departman} onChange={setDepartman} style={{ width: 180 }}
          options={departmanlar.map((d) => ({ value: d.id, label: d.ad }))} />
        <Select allowClear placeholder="Öncelik" value={oncelik} onChange={setOncelik} style={{ width: 130 }}
          options={Object.entries(ONCELIKLER).map(([k, v]) => ({ value: k, label: v.ad }))} />
        <Select allowClear showSearch optionFilterProp="label" placeholder="Kategori" value={tur} onChange={setTur} style={{ width: 170 }}
          options={turler.filter((t) => !departman || !t.departmanId || t.departmanId === departman).map((t) => ({ value: t.id, label: t.ad }))} />
        {gorunum === "tumu" && (
          <Select allowClear placeholder="Durum" value={durum} onChange={setDurum} style={{ width: 150 }}
            options={SIRA.map((k) => ({ value: k, label: DURUMLAR[k].ad }))} />
        )}
        {suzgecVar && (
          <Button type="text" icon={<X size={14} />} onClick={() => { setSube(undefined); setDepartman(undefined); setOncelik(undefined); setTur(undefined); setAra(""); setDurum(undefined); }}>
            Temizle
          </Button>
        )}
        <div className="ar-tip">
          <button className={tip === "liste" ? "on" : ""} onClick={() => setTip("liste")}><List size={15} />Liste</button>
          <button className={tip === "pano" ? "on" : ""} onClick={() => setTip("pano")}><Columns3 size={15} />Pano</button>
        </div>
      </div>

      {yonetir && secili.length > 0 && (
        <div className="ar-toplu">
          <b>{secili.length} kayıt seçili</b>
          <Select placeholder="Ata…" style={{ width: 210 }} showSearch optionFilterProp="label" value={null}
            onChange={(v: string) => v && toplu({ atananKodu: v })}
            options={atanabilir.map((k) => ({ value: k.kod, label: `${k.ad} · ${k.kaynak}` }))} />
          <Select placeholder="Durum…" style={{ width: 170 }} value={null}
            onChange={(v: string) => v && toplu({ durum: v })}
            options={["acik", "devam", "beklemede"].map((k) => ({ value: k, label: DURUMLAR[k].ad }))} />
          <span className="ar-ipucu" style={{ color: "#c3c9bf" }}>Çözüldü / Kapandı servis formuyla tek tek yapılır</span>
          <Button size="small" style={{ marginLeft: "auto" }} onClick={() => setSecili([])}>Seçimi kaldır</Button>
        </div>
      )}

      {tip === "liste" ? (
        <Table
          className="ar-tablo"
          rowKey="id"
          size="middle"
          loading={yukleniyor}
          dataSource={liste}
          scroll={{ x: 980 }}
          onRow={(k) => ({ onClick: () => setAcik(k.id), style: { cursor: "pointer", ["--onc" as any]: ONCELIKLER[k.oncelik]?.renk } })}
          rowSelection={yonetir ? { selectedRowKeys: secili, onChange: (k) => setSecili(k as number[]), columnWidth: 36 } : undefined}
          pagination={{ pageSize: 25, showSizeChanger: false, hideOnSinglePage: true }}
          locale={{ emptyText: <Empty description="Bu görünümde kayıt yok." /> }}
          columns={[
            { title: "No", dataIndex: "id", width: 72, render: (n: number) => <span className="ar-no">#{n}</span> },
            {
              title: "Arıza",
              dataIndex: "baslik",
              render: (b: string, k: Kayit) => (
                <div className="ar-bas">
                  <b>{b}</b>
                  {k.akisOzet && k.akisOzet !== b && <div className="akis">{k.akisOzet}</div>}
                  <small>{[k.departman, k.tur].filter(Boolean).join(" · ")}</small>
                  <div className="meta">
                    {k.cihaz && <span><Monitor size={12} />{k.cihaz}</span>}
                    {k.gorselSayisi > 0 && <span><Camera size={12} />{k.gorselSayisi}</span>}
                    {k.yorumSayisi > 0 && <span><MessageSquare size={12} />{k.yorumSayisi}</span>}
                    <span><Clock3 size={12} />{once(k.olusturma)}</span>
                  </div>
                </div>
              ),
            },
            {
              title: "Mağaza",
              dataIndex: "subeKodu",
              width: 150,
              render: (s: string, k: Kayit) => (
                <div>
                  {s ?? "—"}
                  <div className="ar-ipucu">{k.acanAdi}</div>
                </div>
              ),
            },
            { title: "Öncelik", dataIndex: "oncelik", width: 96, render: (o: string) => <OncelikEtiketi o={o} /> },
            { title: "Atanan", width: 170, render: (_: unknown, k: Kayit) => <Atanan k={k} /> },
            { title: "SLA", width: 140, render: (_: unknown, k: Kayit) => <Sla k={k} /> },
            { title: "Durum", dataIndex: "durum", width: 120, render: (d: string) => <DurumEtiketi d={d} /> },
          ]}
        />
      ) : (
        <Spin spinning={yukleniyor}>
          <div className="ar-pano">
            {["acik", "devam", "beklemede", "cozuldu"].map((d) => {
              const k = liste.filter((x) => x.durum === d);
              return (
                <div key={d} className="ar-sutun">
                  <h4><DurumEtiketi d={d} /><span className="n">{k.length}</span></h4>
                  {k.map((a) => (
                    <div key={a.id} className="ar-pk" style={{ ["--onc" as any]: ONCELIKLER[a.oncelik]?.renk }} onClick={() => setAcik(a.id)}>
                      <span className="ar-ipucu">#{a.id} · {a.subeKodu ?? "—"}</span>
                      <b>{a.baslik}</b>
                      <div className="alt">
                        <span style={{ color: ONCELIKLER[a.oncelik]?.renk, fontWeight: 700 }}>{ONCELIKLER[a.oncelik]?.ad}</span>
                        <span>· {a.tur ?? a.departman}</span>
                        {a.atananAdi ? <Tooltip title={a.atananAdi}><span className="av">{bas(a.atananAdi)}</span></Tooltip> : <span className="ar-atanmadi kucuk">Atanmadı</span>}
                      </div>
                      {!kapali(a.durum) && <Sla k={a} />}
                    </div>
                  ))}
                  {k.length === 0 && <span className="ar-ipucu" style={{ padding: 8 }}>Kayıt yok</span>}
                </div>
              );
            })}
          </div>
        </Spin>
      )}

      {acmaAcik && (
        <ArizaAc
          departmanlar={departmanlar}
          turler={turler as any}
          kapat={() => setAcmaAcik(false)}
          acildi={() => {
            setAcmaAcik(false);
            getir();
          }}
        />
      )}

      <Detay id={acik} turler={turler} kapat={() => setAcik(null)} guncellendi={getir} />

      <Drawer
        open={turlerAcik}
        onClose={() => {
          setTurlerAcik(false);
          api.getir<any[]>("Ariza/Turler").then(setTurler).catch(() => undefined);
        }}
        width="min(1100px, 100vw)"
        title="Arıza türleri ve soru akışı"
        destroyOnHidden
      >
        <Tabs
          activeKey={turSekme}
          onChange={setTurSekme}
          items={[
            {
              key: "turler",
              label: "Türler",
              children: (
                <Kategoriler
                  akisaGit={(id) => {
                    setAkisTuru(id);
                    setTurSekme("akis");
                  }}
                />
              ),
            },
            { key: "akis", label: "Soru akışı", children: <SoruAkisi baslangicTuru={akisTuru} /> },
          ]}
        />
      </Drawer>
    </div>
  );
}

/* ========================================================================== */
/* Ayrıntı                                                                    */
/* ========================================================================== */

function Detay({
  id,
  turler,
  kapat,
  guncellendi,
}: {
  id: number | null;
  turler: { id: number; ad: string; departmanId: number | null }[];
  kapat: () => void;
  guncellendi: () => void;
}) {
  const [veri, setVeri] = useState<any>(null);
  const [servisFormuDurumu, setServisFormuDurumu] = useState<string | null>(null);
  const [servisFormu, setServisFormu] = useState<any>(null);
  const [kisiler, setKisiler] = useState<Kisi[]>([]);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [isleniyor, setIsleniyor] = useState(false);
  const [yorum, setYorum] = useState("");
  const [icNot, setIcNot] = useState(false);
  const [cozum, setCozum] = useState(false);

  const oku = useCallback(() => {
    if (!id) return;
    setYukleniyor(true);
    api
      .getir<any>(`Ariza/${id}`)
      .then((c) => {
        setVeri(c);
        api.getir<Kisi[]>(`Ariza/Atanabilir?departman=${c?.kayit?.departmanId ?? ""}`).then(setKisiler).catch(() => setKisiler([]));
      })
      .catch((h) => message.error(h instanceof Error ? h.message : "Kayıt alınamadı."))
      .finally(() => setYukleniyor(false));
  }, [id]);

  useEffect(() => {
    if (!id) {
      setVeri(null);
      setServisFormu(null);
      setYorum("");
      setIcNot(false);
      setCozum(false);
      return;
    }
    oku();
  }, [id, oku]);

  useEffect(() => {
    if (!id) return;
    api.getir<any>(`ServisFormu/Ariza/${id}`).then(setServisFormu).catch(() => setServisFormu(null));
  }, [id, veri]);

  const guncelle = async (govde: Record<string, unknown>) => {
    if (!id) return;
    setIsleniyor(true);
    try {
      await api.gonder(`Ariza/${id}/Guncelle`, govde);
      message.success("Kayıt güncellendi.");
      oku();
      guncellendi();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Güncellenemedi.");
    } finally {
      setIsleniyor(false);
    }
  };

  const yorumYaz = async () => {
    if (!id || !yorum.trim()) return;
    setIsleniyor(true);
    try {
      await api.gonder(`Ariza/${id}/Yorum`, { metin: yorum.trim(), icNot, cozum });
      setYorum("");
      setIcNot(false);
      setCozum(false);
      message.success("Yorum eklendi.");
      oku();
      guncellendi();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Yorum eklenemedi.");
    } finally {
      setIsleniyor(false);
    }
  };

  const kayit = veri?.kayit;
  const yonetir = !!veri?.yonetir;
  const tutarGorur = veri?.tutarGorur !== false;

  const gorselAdresi = (gid: number) =>
    `${API_TABAN}/api/Ariza/Gorsel/${gid}?j=${encodeURIComponent(oturumOku()?.jeton ?? "")}`;

  const belge = (boyut: string) =>
    window.open(
      `${API_TABAN}/api/ServisFormu/${servisFormu.form.id}/Belge?boyut=${boyut}&j=${encodeURIComponent(oturumOku()?.jeton ?? "")}`,
      "_blank",
    );

  const cihaz = [kayit?.cihazTuru, kayit?.cihazMarka, kayit?.cihazModel].filter(Boolean).join(" ");
  const kayitTurleri = turler.filter((t) => !t.departmanId || t.departmanId === kayit?.departmanId);

  /* Yorumlar ve hareketler tek akışta, zamana göre */
  const akis = useMemo(() => {
    if (!veri) return [];
    const h = (veri.hareketler ?? []).map((x: any) => ({ tur: "h", z: x.olusturma, x }));
    const y = (veri.yorumlar ?? []).map((x: any) => ({ tur: "y", z: x.olusturma, x }));
    return [...h, ...y].sort((a, b) => dayjs(a.z).valueOf() - dayjs(b.z).valueOf());
  }, [veri]);

  const durumSec = (d: string) => {
    if (!yonetir || !kayit || d === kayit.durum) return;
    if (d === "cozuldu" || d === "kapandi") setServisFormuDurumu(d);
    else guncelle({ durum: d });
  };

  const atananListesi = useMemo(() => {
    const l = [...kisiler];
    if (kayit?.atananKodu && !l.some((k) => k.kod === kayit.atananKodu))
      l.unshift({ kod: kayit.atananKodu, ad: kayit.atananAdi ?? kayit.atananKodu, kaynak: "Şu an atanan" });
    return l;
  }, [kisiler, kayit]);

  const sira = SIRA.indexOf(kayit?.durum ?? "");

  return (
    <Drawer open={!!id} onClose={kapat} width="min(980px, 100vw)" closable={false} styles={{ body: { padding: 0, background: "#f4f6f2" } }}>
      <style>{CSS}</style>
      {yukleniyor && !kayit && <Spin style={{ display: "block", margin: "60px auto" }} />}

      {kayit && (
        <div className="ard">
          <div className="ard-ust">
            <div className="s1">
              <span className="no">#{kayit.id}</span>
              <DurumEtiketi d={kayit.durum} />
              <OncelikEtiketi o={kayit.oncelik} />
              {kayit.gecikti === 1 && <span className="ar-etiket" style={{ background: "#fff1f0", color: "#cf1322" }}>SLA aşıldı</span>}
              <button className="x" onClick={kapat} aria-label="Kapat"><X size={20} /></button>
            </div>
            <h2>{kayit.baslik}</h2>
            <div className="ard-adimlar">
              {SIRA.map((d, j) => (
                <button key={d} className={j < sira ? "gecti" : j === sira ? "on" : ""} disabled={!yonetir || isleniyor} onClick={() => durumSec(d)}>
                  {DURUMLAR[d].ad}
                </button>
              ))}
            </div>
            {!yonetir && (
              <span className="ar-ipucu"><Lock size={12} style={{ verticalAlign: -2 }} /> Bu kaydı görüntülüyorsunuz; durum ve atama değiştirme yetkiniz yok.</span>
            )}
          </div>

          <div className="ard-govde">
            <div className="ard-sol">
              <div className="ard-kart">
                <h4>Arıza bildirimi</h4>
                {kayit.akisOzet && <div className="ard-akisozet">{kayit.akisOzet}</div>}
                {(veri.yanitlar ?? []).map((y: any, i: number) => (
                  <div key={i} className="ard-cevap">
                    <span>{y.soru ?? "Seçim"}</span>
                    <b>
                      {y.cevap}
                      {y.aciklama && <div className="ack">{y.aciklama}</div>}
                    </b>
                  </div>
                ))}
                {!!kayit.aciklama && <p className="ard-not">{kayit.aciklama}</p>}
                {!kayit.akisOzet && !(veri.yanitlar ?? []).length && !kayit.aciklama && <span className="ar-ipucu">Açıklama yok.</span>}
                {veri.gorseller?.length > 0 && (
                  <Image.PreviewGroup>
                    <div className="ard-foto">
                      {veri.gorseller.map((g: number) => (
                        <Image key={g} src={gorselAdresi(g)} width={96} height={76} style={{ objectFit: "cover", borderRadius: 8 }} />
                      ))}
                    </div>
                  </Image.PreviewGroup>
                )}
              </div>

              <div className="ard-kart">
                <h4>Hareketler ve yorumlar</h4>
                <div className="ard-akis">
                  {akis.length === 0 && <span className="ar-ipucu">Henüz hareket yok.</span>}
                  {akis.map((a: any, i: number) =>
                    a.tur === "h" ? (
                      <div key={`h${i}`} className="o sistem">
                        <span className="nk"><i /></span>
                        <span>{a.x.aciklama || DURUMLAR[a.x.durum]?.ad || a.x.durum}{a.x.yapan ? ` · ${a.x.yapan}` : ""} · {once(a.x.olusturma)}</span>
                      </div>
                    ) : (
                      <div key={`y${a.x.id}`} className={`o ${a.x.icNot ? "ic" : ""} ${a.x.cozum ? "cozum" : ""}`}>
                        <span className="av">{bas(a.x.yazanAdi)}</span>
                        <div className="g">
                          <div className="s">
                            <b>{a.x.yazanAdi ?? "—"}</b> · <Tooltip title={zaman(a.x.olusturma)}>{once(a.x.olusturma)}</Tooltip>
                            {a.x.icNot && <span className="etk ic">İç not</span>}
                            {a.x.cozum && <span className="etk cz">Çözüm</span>}
                          </div>
                          <p>{a.x.metin}</p>
                        </div>
                      </div>
                    ),
                  )}
                </div>
                <div className="ard-yorum">
                  <Input.TextArea
                    autoSize={{ minRows: 2, maxRows: 6 }}
                    variant="borderless"
                    placeholder="Yorum yazın; iç not değilse mağaza uygulamada görür"
                    value={yorum}
                    onChange={(e) => setYorum(e.target.value)}
                  />
                  <div className="alt">
                    {yonetir && (
                      <>
                        <Checkbox checked={icNot} onChange={(e) => setIcNot(e.target.checked)}>İç not (mağaza görmez)</Checkbox>
                        <Checkbox checked={cozum} onChange={(e) => setCozum(e.target.checked)}>Çözüm notu</Checkbox>
                      </>
                    )}
                    <Button type="primary" size="small" loading={isleniyor} disabled={!yorum.trim()} onClick={yorumYaz} style={{ marginLeft: "auto" }}>
                      Gönder
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            <div className="ard-sag">
              <div className="ard-kart">
                <h4>Sorumlu</h4>
                {yonetir ? (
                  <>
                    <Select
                      style={{ width: "100%" }}
                      showSearch
                      allowClear
                      optionFilterProp="label"
                      placeholder="Atanmadı"
                      value={kayit.atananKodu || undefined}
                      disabled={isleniyor}
                      onChange={(v?: string) => guncelle({ atananKodu: v ?? "" })}
                      options={atananListesi.map((k) => ({ value: k.kod, label: `${k.ad} · ${k.kaynak}` }))}
                      notFoundContent="Bu departmanda temsilci ya da rol kullanıcısı yok"
                    />
                    <p className="ar-ipucu" style={{ margin: "8px 0 0" }}>Departmanın temsilcileri ve bu departmanı kapsayan roldeki kişiler listelenir.</p>
                  </>
                ) : (
                  <Atanan k={kayit} />
                )}
                <div style={{ marginTop: 12 }}><Sla k={kayit} /></div>
              </div>

              <div className="ard-kart">
                <h4>Bilgiler</h4>
                <div className="ard-bs"><span>Departman</span><b>{kayit.departman ?? "—"}</b></div>
                <div className="ard-bs">
                  <span>Kategori</span>
                  {yonetir ? (
                    <Select size="small" variant="borderless" style={{ minWidth: 150, textAlign: "right" }} value={kayit.turId ?? undefined}
                      onChange={(d) => guncelle({ turId: d })} disabled={isleniyor} popupMatchSelectWidth={false}
                      options={kayitTurleri.map((t) => ({ value: t.id, label: t.departmanId ? t.ad : `${t.ad} · genel` }))} />
                  ) : (
                    <b>{kayit.tur ?? "—"}</b>
                  )}
                </div>
                <div className="ard-bs">
                  <span>Öncelik</span>
                  {yonetir ? (
                    <Select size="small" variant="borderless" style={{ minWidth: 110 }} value={kayit.oncelik} onChange={(d) => guncelle({ oncelik: d })} disabled={isleniyor}
                      options={Object.entries(ONCELIKLER).map(([k, v]) => ({ value: k, label: v.ad }))} />
                  ) : (
                    <b>{ONCELIKLER[kayit.oncelik]?.ad}</b>
                  )}
                </div>
                <div className="ard-bs"><span>Mağaza</span><b>{kayit.subeKodu ?? "—"}</b></div>
                <div className="ard-bs">
                  <span>Açan</span>
                  <b>
                    {kayit.acanAdi ?? "—"}
                    {veri.acanTelefon && (
                      <a href={`tel:${veri.acanTelefon}`} className="tel"><Phone size={12} /> {telefonYaz(veri.acanTelefon)}</a>
                    )}
                  </b>
                </div>
                <div className="ard-bs"><span>Açılış</span><b>{zaman(kayit.olusturma)}</b></div>
                <div className="ard-bs"><span>SLA hedefi</span><b>{zaman(kayit.slaBitis)}</b></div>
                {!!cihaz && (
                  <div className="ard-bs">
                    <span>Cihaz</span>
                    <b>
                      {cihaz}
                      {kayit.cihazSeriNo ? <div className="ar-ipucu">{kayit.cihazSeriNo}</div> : null}
                      {kayit.envanterId && (
                        <a
                          href={`${import.meta.env.BASE_URL.replace(/\/+$/, "")}/envanter?cihaz=${kayit.envanterId}`}
                          className="tel"
                          onClick={(e) => {
                            /* Portal içinde geçiş: sayfa yeniden yüklenmesin */
                            e.preventDefault();
                            window.history.pushState({}, "", (e.currentTarget as HTMLAnchorElement).getAttribute("href") ?? "");
                            window.dispatchEvent(new PopStateEvent("popstate"));
                          }}
                        >
                          Envanterde aç ›
                        </a>
                      )}
                    </b>
                  </div>
                )}
              </div>

              <div className="ard-kart">
                <h4>Servis formu</h4>
                {servisFormu?.form ? (
                  <>
                    <div className="ard-bs"><span>Form no</span><b>{servisFormu.form.formNo}</b></div>
                    <div className="ard-bs"><span>Müdahale</span><b>{({ uzaktan: "Uzaktan", yerinde: "Yerinde", merkezde: "Merkezde" } as any)[servisFormu.form.mudahale] ?? servisFormu.form.mudahale}</b></div>
                    <div className="ard-bs"><span>Teknisyen</span><b>{servisFormu.form.teknisyen || servisFormu.form.servisFirma || "—"}</b></div>
                    <div className="ard-bs"><span>Yapılan</span><b style={{ whiteSpace: "pre-wrap" }}>{servisFormu.form.yapilanIslem}</b></div>
                    {(servisFormu.parcalar ?? []).length > 0 && (
                      <div className="ard-bs"><span>Parçalar</span><b>{servisFormu.parcalar.map((p: any) => `${p.ad} ×${p.adet}`).join(", ")}</b></div>
                    )}
                    {tutarGorur && servisFormu.form.toplam != null ? (
                      <>
                        <div className="ard-bs"><span>Parça</span><b>{Number(servisFormu.form.parcaTutari ?? 0).toLocaleString("tr-TR")} ₺</b></div>
                        <div className="ard-bs"><span>İşçilik</span><b>{Number(servisFormu.form.iscilik ?? 0).toLocaleString("tr-TR")} ₺</b></div>
                        <div className="ard-bs"><span>Toplam</span><b style={{ color: "#5f8c10" }}>{Number(servisFormu.form.toplam).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ₺</b></div>
                      </>
                    ) : (
                      <div className="ard-gizli"><Lock size={12} /> Tutarlar rolünüzde gizli.</div>
                    )}
                    <div className="ard-dugmeler">
                      <Button size="small" onClick={() => belge("a4")}>A4</Button>
                      <Button size="small" onClick={() => belge("a5")}>A5</Button>
                      {yonetir && <Button size="small" type="primary" onClick={() => setServisFormuDurumu(kayit.durum === "kapandi" ? "kapandi" : "cozuldu")}>Düzenle</Button>}
                    </div>
                  </>
                ) : (
                  <span className="ar-ipucu">Kayıt “Çözüldü” ya da “Kapandı” yapılınca doldurulur.</span>
                )}
              </div>

              {veri.cihazGecmisi?.length > 0 && (
                <div className="ard-kart">
                  <h4>Cihazın geçmişi</h4>
                  <div className="ard-gecmis">
                    {veri.cihazGecmisi.map((g: any) => (
                      <div key={g.id}>
                        <DurumEtiketi d={g.durum} />
                        <span>#{g.id} · {g.akisOzet || g.baslik}</span>
                        <small>{dayjs(g.olusturma).format("DD.MM")}</small>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {servisFormuDurumu && kayit && (
        <ServisFormu
          arizaId={kayit.id}
          envanterId={kayit.envanterId ?? kayit.cihazId ?? null}
          yeniDurum={servisFormuDurumu}
          kapat={() => setServisFormuDurumu(null)}
          kaydedildi={() => {
            setServisFormuDurumu(null);
            oku();
            guncellendi();
          }}
        />
      )}
    </Drawer>
  );
}

/* ========================================================================== */

const CSS = `
.ar-ust{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px}
.ar-ust h2{margin:0;font-size:20px;letter-spacing:-.3px}
.ar-ust-sag{margin-left:auto;display:flex;gap:8px}
.ar-kapsam{display:inline-flex;align-items:center;gap:6px;background:#fff;border:1px solid #e3e6e1;border-radius:20px;padding:3px 11px;font-size:12.5px;color:#4b5563}
.ar-kapsam b{color:#1f2933}
.ar-ipucu{font-size:12px;color:#6b7280}
.ar-gorunumler{display:flex;gap:2px;border-bottom:1px solid #e3e6e1;margin-bottom:14px;overflow-x:auto}
.ar-gorunumler button{border:0;background:none;padding:9px 12px;font-size:13.5px;font-weight:600;color:#6b7280;border-bottom:2px solid transparent;white-space:nowrap;display:flex;gap:6px;align-items:center;cursor:pointer}
.ar-gorunumler button:hover{color:#1f2933}
.ar-gorunumler button.on{color:#3f6408;border-bottom-color:#7cb518}
.ar-gorunumler .n{background:#eef1ea;color:#4b5563;font-size:11.5px;border-radius:10px;padding:1px 7px;font-variant-numeric:tabular-nums}
.ar-gorunumler button.on .n{background:#7cb518;color:#fff}
.ar-gorunumler button.kirmizi .n{background:#fff1f0;color:#cf1322}
.ar-kpi{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:14px}
.ar-kpi .k{background:#fff;border:1px solid #e3e6e1;border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:2px;cursor:pointer;transition:border-color .15s}
.ar-kpi .k:hover{border-color:#c9d0c4}
.ar-kpi .k span{font-size:12px;color:#6b7280;font-weight:600}
.ar-kpi .k b{font-size:24px;letter-spacing:-.6px;font-variant-numeric:tabular-nums;line-height:1.2}
.ar-kpi .k small{font-size:11.5px;color:#6b7280}
.ar-kpi .k.uyari b{color:#cf1322}
.ar-suzgec{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px}
.ar-tip{display:flex;border:1px solid #e3e6e1;border-radius:8px;overflow:hidden;margin-left:auto;background:#fff}
.ar-tip button{border:0;background:#fff;padding:5px 11px;display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600;color:#6b7280;cursor:pointer}
.ar-tip button.on{background:#f2f9e8;color:#3f6408}
.ar-toplu{display:flex;align-items:center;gap:10px;background:#1f2933;color:#fff;border-radius:10px;padding:8px 12px;margin-bottom:10px;font-size:13px;flex-wrap:wrap}
.ar-tablo .ant-table{border:1px solid #e3e6e1;border-radius:12px;overflow:hidden}
.ar-tablo .ant-table-tbody>tr>td:first-child{position:relative}
.ar-tablo .ant-table-tbody>tr>td:first-child::before{content:"";position:absolute;left:0;top:10px;bottom:10px;width:3px;border-radius:2px;background:var(--onc,transparent)}
.ar-no{color:#6b7280;font-variant-numeric:tabular-nums;font-size:12.5px}
.ar-bas b{display:block;font-size:13.5px;font-weight:600}
.ar-bas .akis{font-size:12px;color:#1f2933}
.ar-bas small{color:#6b7280;font-size:12px}
.ar-bas .meta{display:flex;gap:10px;margin-top:3px;color:#9aa1a9;font-size:11.5px;flex-wrap:wrap}
.ar-bas .meta span{display:inline-flex;align-items:center;gap:3px}
.ar-etiket{display:inline-flex;align-items:center;font-size:12px;font-weight:600;padding:2px 8px;border-radius:6px;white-space:nowrap;border:1px solid transparent}
.ar-etiket.cerceve{background:#fff}
.ar-atanan{display:inline-flex;align-items:center;gap:7px}
.av{width:26px;height:26px;border-radius:50%;display:inline-grid;place-items:center;font-size:10.5px;font-weight:800;flex:none;background:#f2f9e8;color:#3f6408}
.ar-atanmadi{color:#e8481c;font-weight:600;font-size:12px;border:1px dashed #f3b39f;background:#fff;border-radius:7px;padding:2px 8px;white-space:nowrap}
.ar-atanmadi.kucuk{margin-left:auto;font-size:11px;padding:1px 6px}
.ar-sla{display:flex;flex-direction:column;gap:4px;min-width:100px}
.ar-sla .c{height:5px;border-radius:3px;background:#eef1ea;overflow:hidden}
.ar-sla .c i{display:block;height:100%;border-radius:3px}
.ar-sla small{font-size:11.5px;font-weight:600;font-variant-numeric:tabular-nums}
.ar-pano{display:grid;grid-template-columns:repeat(4,minmax(240px,1fr));gap:12px;overflow-x:auto;padding-bottom:6px}
.ar-sutun{background:#eef1ea;border-radius:12px;padding:10px;display:flex;flex-direction:column;gap:8px;min-height:200px}
.ar-sutun h4{margin:2px 4px 4px;font-size:13px;display:flex;align-items:center;gap:7px}
.ar-sutun h4 .n{margin-left:auto;font-size:12px;color:#6b7280}
.ar-pk{background:#fff;border-radius:10px;padding:10px 12px;border:1px solid #e3e6e1;border-left:3px solid var(--onc,#e3e6e1);cursor:pointer;display:flex;flex-direction:column;gap:6px}
.ar-pk:hover{box-shadow:0 4px 14px -8px rgba(0,0,0,.25)}
.ar-pk b{font-size:13px;line-height:1.35}
.ar-pk .alt{display:flex;align-items:center;gap:6px;font-size:11.5px;color:#6b7280;flex-wrap:wrap}
.ar-pk .alt .av{width:22px;height:22px;font-size:9.5px;margin-left:auto}

.ard{display:flex;flex-direction:column;min-height:100%}
.ard-ust{background:#fff;border-bottom:1px solid #e3e6e1;padding:14px 20px;display:flex;flex-direction:column;gap:10px;position:sticky;top:0;z-index:3}
.ard-ust .s1{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.ard-ust .no{color:#6b7280;font-weight:700;font-variant-numeric:tabular-nums}
.ard-ust .x{margin-left:auto;border:0;background:none;color:#6b7280;padding:4px;cursor:pointer}
.ard-ust h2{margin:0;font-size:18px;letter-spacing:-.2px}
.ard-adimlar{display:flex;flex-wrap:wrap}
.ard-adimlar button{border:1px solid #e3e6e1;background:#fff;padding:6px 16px 6px 20px;font-size:12.5px;font-weight:600;color:#6b7280;clip-path:polygon(0 0,calc(100% - 10px) 0,100% 50%,calc(100% - 10px) 100%,0 100%,10px 50%);margin-right:-6px;cursor:pointer}
.ard-adimlar button:first-child{clip-path:polygon(0 0,calc(100% - 10px) 0,100% 50%,calc(100% - 10px) 100%,0 100%);padding-left:12px}
.ard-adimlar button.gecti{background:#f2f9e8;color:#3f6408}
.ard-adimlar button.on{background:#7cb518;color:#fff;border-color:#7cb518}
.ard-adimlar button:disabled{cursor:default}
.ard-adimlar button:not(:disabled):not(.on):hover{background:#f7f9f5}
.ard-govde{display:grid;grid-template-columns:minmax(0,1fr) 310px;gap:14px;padding:16px 20px 30px;align-items:start}
@media (max-width:820px){.ard-govde{grid-template-columns:1fr}}
.ard-sol,.ard-sag{display:flex;flex-direction:column;gap:14px;min-width:0}
.ard-kart{background:#fff;border:1px solid #e3e6e1;border-radius:12px;padding:14px 16px}
.ard-kart h4{margin:0 0 10px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.5px}
.ard-akisozet{background:#f2f9e8;border-radius:8px;padding:8px 12px;margin-bottom:8px;font-weight:600}
.ard-cevap{display:flex;gap:10px;padding:7px 0;border-bottom:1px dashed #eceee9;font-size:13px}
.ard-cevap:last-of-type{border-bottom:0}
.ard-cevap span{color:#6b7280;flex:0 0 44%}
.ard-cevap .ack{font-weight:400;white-space:pre-wrap;color:#4b5563;margin-top:3px}
.ard-not{margin:10px 0 0;font-size:13px;line-height:1.55;white-space:pre-wrap}
.ard-foto{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.ard-akis{display:flex;flex-direction:column;gap:12px}
.ard-akis .o{display:flex;gap:10px}
.ard-akis .o .av{width:30px;height:30px}
.ard-akis .o .g{flex:1;min-width:0}
.ard-akis .o .s{font-size:12px;color:#6b7280;display:flex;gap:4px;align-items:center;flex-wrap:wrap}
.ard-akis .o .s b{color:#1f2933}
.ard-akis .o .etk{font-size:10.5px;font-weight:700;border-radius:5px;padding:0 6px}
.ard-akis .o .etk.ic{background:#fff8e6;color:#ad6800}
.ard-akis .o .etk.cz{background:#f2f9e8;color:#3f6408}
.ard-akis .o p{margin:4px 0 0;font-size:13px;line-height:1.5;background:#f7f9f5;border-radius:0 10px 10px 10px;padding:8px 11px;white-space:pre-wrap}
.ard-akis .o.ic p{background:#fff8e6;border:1px dashed #f3d48a}
.ard-akis .o.cozum p{background:#f2f9e8}
.ard-akis .o.sistem{align-items:center;font-size:12.5px;color:#6b7280}
.ard-akis .o.sistem .nk{width:30px;display:grid;place-items:center;flex:none}
.ard-akis .o.sistem .nk i{width:8px;height:8px;border-radius:50%;background:#c3c9bf}
.ard-yorum{margin-top:12px;border:1px solid #e3e6e1;border-radius:10px;background:#fff;padding:4px}
.ard-yorum .alt{display:flex;align-items:center;gap:12px;padding:4px 6px 4px 8px;flex-wrap:wrap}
.ard-bs{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid #f2f3ef;font-size:13px}
.ard-bs:last-child{border-bottom:0}
.ard-bs>span{color:#6b7280;flex:none}
.ard-bs>b{font-weight:600;text-align:right;min-width:0;overflow-wrap:anywhere}
.ard-bs .tel{display:block;font-size:12px;font-weight:600}
.ard-gizli{font-size:12px;color:#6b7280;background:#f7f8f6;border-radius:8px;padding:8px 10px;margin-top:6px;display:flex;gap:6px;align-items:center}
.ard-dugmeler{display:flex;gap:6px;margin-top:10px}
.ard-gecmis{font-size:12.5px;display:flex;flex-direction:column;gap:7px}
.ard-gecmis div{display:flex;gap:8px;align-items:center}
.ard-gecmis span:nth-child(2){flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ard-gecmis small{color:#6b7280;white-space:nowrap}
`;
