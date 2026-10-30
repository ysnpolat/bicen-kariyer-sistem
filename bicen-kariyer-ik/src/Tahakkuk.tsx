/**
 * Tahakkuk — ücret hesap pusulası.
 *
 * Dönem (yıl, ay) ve SGK şubesi seçilir; o dönemde tahakkuku olan personel
 * listelenir; tek tek PDF ya da hepsi birden zip indirilir. Zip yapısı:
 * {yıl}-{ay}/{SGK no - şube}/{ad (kod)}.pdf — İK her şubenin klasörünü
 * ayrı gönderebilsin diye.
 *
 * "Sütun eşleme" sekmesi Mikro'nun tahakkuk tablosundaki sütunları
 * pusuladaki alanlara bağlar; otomatik tahmin yanlışsa buradan düzeltilir.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Input,
  Progress,
  Row,
  Segmented,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  App as AntdApp,
} from "antd";
import { Download, FileText, RefreshCw, Save, Search } from "lucide-react";
import { api, ikYoneticisiMi, oturumOku } from "./api";
import { pusulaPdf, pusulaZipIndir, type PusulaVerisi } from "./pusulaPdf";
import { dosyaIndir } from "./formIndir";
import { PersonelAdi } from "./personelKarti";

const { Title, Text, Paragraph } = Typography;

const AYLAR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz",
  "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

const para = (v: any) =>
  v === null || v === undefined ? "—"
    : Number(v).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* -------------------------------------------------------------------------- */
/* Makbuzlar                                                                  */
/* -------------------------------------------------------------------------- */
function Makbuzlar() {
  const { message } = AntdApp.useApp();
  const simdi = new Date();
  const [yil, setYil] = useState(simdi.getMonth() === 0 ? simdi.getFullYear() - 1 : simdi.getFullYear());
  const [ay, setAy] = useState(simdi.getMonth() === 0 ? 12 : simdi.getMonth());
  const [subeler, setSubeler] = useState<any[]>([]);
  const [subeYukleniyor, setSubeYukleniyor] = useState(false);
  const [seciliSube, setSeciliSube] = useState<number | "hepsi" | undefined>();
  const [veri, setVeri] = useState<PusulaVerisi | null>(null);
  const [veriYukleniyor, setVeriYukleniyor] = useState(false);
  const [ilerleme, setIlerleme] = useState<{ yapilan: number; toplam: number; ad: string } | null>(null);
  const [hata, setHata] = useState<string | null>(null);

  const subeleriGetir = useCallback(async () => {
    setSubeYukleniyor(true);
    setHata(null);
    setVeri(null);
    setSeciliSube(undefined);

    try {
      const d = await api.al<any[]>(`/api/Tahakkuk/Subeler?yil=${yil}&ay=${ay}`);
      setSubeler(d ?? []);
      if ((d ?? []).length === 0) message.info("Bu dönemde tahakkuk kaydı bulunamadı.");
    } catch (h: any) {
      setSubeler([]);
      setHata(h.message);
    } finally {
      setSubeYukleniyor(false);
    }
  }, [yil, ay, message]);

  useEffect(() => { subeleriGetir(); }, [subeleriGetir]);

  const pusulaGetir = useCallback(async (sskNo: number) =>
    api.al<PusulaVerisi>(`/api/Tahakkuk/Pusula?yil=${yil}&ay=${ay}&sskNo=${sskNo}`), [yil, ay]);

  useEffect(() => {
    if (seciliSube === undefined || seciliSube === "hepsi") { setVeri(null); return; }
    let iptal = false;
    setVeriYukleniyor(true);
    pusulaGetir(seciliSube)
      .then((d) => { if (!iptal) setVeri(d); })
      .catch((h: any) => { if (!iptal) { setVeri(null); message.error(h.message); } })
      .finally(() => { if (!iptal) setVeriYukleniyor(false); });
    return () => { iptal = true; };
  }, [seciliSube, pusulaGetir, message]);

  const toplamKisi = subeler.reduce((t, s) => t + (s.adet ?? 0), 0);

  const zipIndir = async () => {
    const hedefler = seciliSube === "hepsi" ? subeler.map((s) => s.sskNo) : seciliSube !== undefined ? [seciliSube] : [];
    if (hedefler.length === 0) { message.warning("Şube seçiniz."); return; }

    setIlerleme({ yapilan: 0, toplam: 0, ad: "veri alınıyor…" });
    try {
      const paketler: PusulaVerisi[] = [];
      for (const no of hedefler) {
        const p = seciliSube !== "hepsi" && veri ? veri : await pusulaGetir(no);
        if (p.kisiler.length > 0) paketler.push(p);
      }
      if (paketler.length === 0) { message.info("İndirilecek pusula yok."); setIlerleme(null); return; }
      await pusulaZipIndir(paketler, (yapilan, toplam, ad) => setIlerleme({ yapilan, toplam, ad }));
      message.success(`${paketler.reduce((t, p) => t + p.kisiler.length, 0)} pusula zip olarak indirildi.`);
    } catch (h: any) {
      message.error(h.message ?? "Zip oluşturulamadı.");
    } finally {
      setIlerleme(null);
    }
  };

  const tekPdf = async (k: any) => {
    if (!veri) return;
    try {
      const blob = await pusulaPdf(veri, k);
      dosyaIndir(blob, `${k.adSoyad} (${k.personelKodu}) ${yil}-${String(ay).padStart(2, "0")}.pdf`);
    } catch (h: any) {
      message.error(h.message ?? "PDF üretilemedi.");
    }
  };

  const yillar = Array.from({ length: 6 }, (_, i) => simdi.getFullYear() - i);

  return (
    <>
      <Card size="small" style={{ marginBottom: 12 }}>
        <Space wrap align="center">
          <Text strong>Dönem</Text>
          <Select value={yil} onChange={setYil} style={{ width: 100 }}
            options={yillar.map((y) => ({ value: y, label: y }))} />
          <Select value={ay} onChange={setAy} style={{ width: 130 }}
            options={AYLAR.map((a, i) => ({ value: i + 1, label: a }))} />
          <Button icon={<RefreshCw size={14} strokeWidth={2} />} loading={subeYukleniyor} onClick={subeleriGetir}>
            Şubeleri getir
          </Button>
          {subeler.length > 0 && (
            <Text type="secondary" style={{ fontSize: 12.5 }}>
              {subeler.length} SGK şubesi · {toplamKisi} personel
            </Text>
          )}
        </Space>

        {hata && <Alert type="error" showIcon style={{ marginTop: 10 }} message={hata} />}

        {subeler.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <Text strong>SGK şubesi</Text>
            <div className="th-subeler">
              <div
                className={"th-sube" + (seciliSube === "hepsi" ? " th-sube-secili" : "")}
                onClick={() => setSeciliSube("hepsi")}
              >
                <div className="th-sube-ad">Tüm şubeler</div>
                <div className="th-sube-alt">{toplamKisi} personel · her şube ayrı klasör</div>
              </div>
              {subeler.map((s) => (
                <div
                  key={s.sskNo}
                  className={"th-sube" + (seciliSube === s.sskNo ? " th-sube-secili" : "")}
                  onClick={() => setSeciliSube(s.sskNo)}
                >
                  <div className="th-sube-ad">
                    <span className="th-sube-no">{String(s.sskNo).padStart(3, "0")}</span>
                    {s.ad || "adsız şube"}
                  </div>
                  <div className="th-sube-alt">
                    {s.adet} personel
                    {s.adKaynagi === "birim" && " · personelin birimi"}
                    {!s.ad && " · adı İşyeri sekmesinden yazılır"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {seciliSube !== undefined && (
          <Space style={{ marginTop: 12 }} wrap>
            <Button type="primary" icon={<Download size={15} strokeWidth={2} />}
              loading={!!ilerleme} onClick={zipIndir}>
              {seciliSube === "hepsi" ? `Tüm şubeleri zip indir (${toplamKisi})` : `Bu şubeyi zip indir (${veri?.kisiler.length ?? "…"})`}
            </Button>
            <Text type="secondary" style={{ fontSize: 12.5 }}>
              Zip içi: {yil}-{String(ay).padStart(2, "0")} / SGK no – şube / ad (kod).pdf
            </Text>
          </Space>
        )}

        {ilerleme && (
          <div style={{ marginTop: 10, maxWidth: 520 }}>
            <Progress
              percent={ilerleme.toplam ? Math.round((ilerleme.yapilan / ilerleme.toplam) * 100) : 0}
              status="active" size="small"
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {ilerleme.toplam ? `${ilerleme.yapilan}/${ilerleme.toplam} · ${ilerleme.ad}` : ilerleme.ad}
            </Text>
          </div>
        )}
      </Card>

      {seciliSube !== undefined && seciliSube !== "hepsi" && (
        <Card size="small" loading={veriYukleniyor}>
          <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
            <div>
              <Text strong>{veri?.sube?.ad ? `${veri.sube.ad} · ` : ""}{AYLAR[ay - 1]} {yil}</Text>
              <div><Text type="secondary" style={{ fontSize: 12.5 }}>
                {veri?.kisiler.length ?? 0} personel · satırdaki PDF düğmesi tek pusula indirir
              </Text></div>
            </div>
            {veri?.isyeri?.unvan && <Text type="secondary" style={{ fontSize: 12 }}>{veri.isyeri.unvan}</Text>}
          </Space>

          <Table
            size="small" rowKey="personelKodu" style={{ marginTop: 10 }}
            dataSource={veri?.kisiler ?? []}
            pagination={{ pageSize: 25, hideOnSinglePage: true, showSizeChanger: false }}
            locale={{ emptyText: <Empty description="Bu şubede tahakkuk kaydı yok." /> }}
            columns={[
              { title: "Kod", dataIndex: "personelKodu", width: 90 },
              { title: "Personel", dataIndex: "adSoyad",
                render: (v: string, k: any) => (
                  <div><Text strong><PersonelAdi kod={k.personelKodu}>{v}</PersonelAdi></Text>
                    <div style={{ fontSize: 11.5, color: "#8a8f98" }}>{k.meslekAdi ?? k.gorevKodu ?? ""}</div></div>) },
              { title: "Giriş", dataIndex: "girisTarihi", width: 100,
                render: (v: string) => (v ? new Date(v).toLocaleDateString("tr-TR") : "—") },
              { title: "Ücret", dataIndex: "ucret", width: 110, align: "right" as const, render: (v: any) => para(v) },
              { title: "SGK günü", width: 80, align: "right" as const,
                render: (_: any, k: any) => k.alanlar?.sgkGunu ?? "—" },
              { title: "Toplam kazanç", width: 120, align: "right" as const,
                render: (_: any, k: any) => para(k.alanlar?.toplamKazanc) },
              { title: "Toplam kesinti", width: 120, align: "right" as const,
                render: (_: any, k: any) => para(k.alanlar?.toplamKesinti) },
              { title: "Net ödenecek", width: 120, align: "right" as const,
                render: (_: any, k: any) => <b style={{ color: "#5c8a12" }}>{para(k.alanlar?.netOdenecek)}</b> },
              { title: "", width: 70, align: "right" as const,
                render: (_: any, k: any) => (
                  <Tooltip title="Bu kişinin pusulasını PDF indir">
                    <Button size="small" icon={<FileText size={14} strokeWidth={2} />} onClick={() => tekPdf(k)} />
                  </Tooltip>) },
            ]}
          />
        </Card>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Sütun eşleme                                                               */
/* -------------------------------------------------------------------------- */
function SutunEsleme() {
  const { message } = AntdApp.useApp();
  const simdi = new Date();
  const [yil, setYil] = useState(simdi.getMonth() === 0 ? simdi.getFullYear() - 1 : simdi.getFullYear());
  const [ay, setAy] = useState(simdi.getMonth() === 0 ? 12 : simdi.getMonth());
  const [veri, setVeri] = useState<any>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [eslesme, setEslesme] = useState<Record<string, string>>({});
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const [arama, setArama] = useState("");
  const [degerArama, setDegerArama] = useState("");
  const [gorunum, setGorunum] = useState<"hepsi" | "bos">("hepsi");

  const getir = useCallback(async () => {
    setYukleniyor(true);
    try {
      const d = await api.al<any>(`/api/Tahakkuk/Sutunlar?yil=${yil}&ay=${ay}`);
      setVeri(d);
      setEslesme({ ...(d.eslesme ?? {}), ...(d.kayitli ?? {}) });
    } catch (h: any) {
      setVeri(null);
      message.error(h.message);
    } finally {
      setYukleniyor(false);
    }
  }, [yil, ay, message]);

  useEffect(() => { getir(); }, [getir]);

  const sutunSecenekleri = useMemo(
    () => (veri?.sutunlar ?? []).map((s: any) => ({
      value: s.ad,
      label: `${s.ad}${s.deger !== null && s.deger !== undefined ? ` = ${typeof s.deger === "number" ? s.deger.toLocaleString("tr-TR") : String(s.deger).slice(0, 24)}` : ""}`,
    })),
    [veri]
  );

  /* "27.525,00", "27525", "27525,00" hepsi aynı sayıya çözülür */
  const bulunanSutunlar = useMemo(() => {
    const ham = degerArama.trim();
    if (!ham) return [];
    const n = Number(ham.replace(/\./g, "").replace(",", "."));
    const sayisalMi = Number.isFinite(n) && ham !== "";

    return (veri?.sutunlar ?? []).filter((s: any) => {
      if (s.deger === null || s.deger === undefined) return false;
      if (sayisalMi && typeof s.deger === "number") return Math.abs(s.deger - n) < 0.005;
      return String(s.deger).toLocaleLowerCase("tr").includes(ham.toLocaleLowerCase("tr"));
    }).slice(0, 40);
  }, [degerArama, veri]);

  const degerBul = (sutun?: string) => {
    if (!sutun) return null;
    const s = (veri?.sutunlar ?? []).find((x: any) => x.ad === sutun);
    return s?.deger ?? null;
  };

  const kaydet = async () => {
    setKaydediliyor(true);
    try {
      await api.gonder("/api/Tahakkuk/Eslesme", eslesme);
      message.success("Eşleme kaydedildi; pusulalar artık bu sütunlardan okunur.");
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setKaydediliyor(false);
    }
  };

  const alanlar: any[] = (veri?.alanTanimlari ?? []).filter((a: any) => {
    if (gorunum === "bos" && eslesme[a.kod]) return false;
    if (arama.trim()) {
      const q = arama.trim().toLocaleLowerCase("tr");
      return `${a.etiket} ${a.kod} ${eslesme[a.kod] ?? ""}`.toLocaleLowerCase("tr").includes(q);
    }
    return true;
  });

  const grupAdi: Record<string, string> = {
    kazanc: "Kazanç", ekKazanc: "Ek kazanç", sosyal: "Sosyal yardım", ozelKesinti: "Özel kesinti",
    yasal: "Yasal kesinti / indirim", toplam: "Toplamlar",
  };
  const yillar = Array.from({ length: 6 }, (_, i) => simdi.getFullYear() - i);
  const bosSayisi = (veri?.alanTanimlari ?? []).filter((a: any) => !eslesme[a.kod]).length;

  return (
    <Card size="small">
      <Paragraph type="secondary" style={{ fontSize: 12.5 }}>
        Pusuladaki her alan Mikro'nun tahakkuk sütununa bağlıdır ve bağlantılar
        hazır gelir (kazanç 1–7, ek kazanç 1–11, sosyal yardım 1–32, özel
        kesinti 1–24 yuvaları). Burası yalnızca <b>denetim ve istisna</b>
        içindir: örnek değer sütunu seçilen dönemdeki{" "}
        <b>{veri?.personelKodu ?? "ilk"}</b> kaydından okunur, Mikro'daki
        makbuzla karşılaştırın; bir alan yanlış sütundan geliyorsa buradan
        değiştirin. Yuvaların <b>adlarını</b> "İşyeri bilgileri" sekmesinden
        düzenleyebilirsiniz.
      </Paragraph>

      <Space wrap style={{ marginBottom: 10 }}>
        <Select value={yil} onChange={setYil} style={{ width: 100 }} options={yillar.map((y) => ({ value: y, label: y }))} />
        <Select value={ay} onChange={setAy} style={{ width: 130 }} options={AYLAR.map((a, i) => ({ value: i + 1, label: a }))} />
        <Button icon={<RefreshCw size={14} strokeWidth={2} />} loading={yukleniyor} onClick={getir}>Sütunları oku</Button>
        <Segmented value={gorunum} onChange={(v) => setGorunum(v as any)}
          options={[{ value: "hepsi", label: "Tüm alanlar" }, { value: "bos", label: `Eşlenmemiş (${bosSayisi})` }]} />
        <Input allowClear value={arama} onChange={(e) => setArama(e.target.value)}
          placeholder="Alan ara" prefix={<Search size={14} />} style={{ width: 180 }} />
        <Button type="primary" icon={<Save size={14} strokeWidth={2} />} loading={kaydediliyor}
          onClick={kaydet} disabled={!ikYoneticisiMi(oturumOku())}>
          Eşlemeyi kaydet
        </Button>
      </Space>

      {/* Değere göre sütun bulma: makbuzdaki rakamı yaz, hangi sütunda
          olduğunu gör. Eşlemeyi tamamlamanın en hızlı yolu. */}
      <Card size="small" style={{ marginBottom: 10, background: "#f7fcf1" }}>
        <Space wrap align="center">
          <Text strong style={{ fontSize: 13 }}>Değere göre sütun bul</Text>
          <Input allowClear value={degerArama} onChange={(e) => setDegerArama(e.target.value)}
            placeholder="Örn. 27525 ya da 27.525,00" style={{ width: 200 }} />
          <Text type="secondary" style={{ fontSize: 12 }}>
            Mikro'daki makbuzdan bir rakam yazın; aynı değeri taşıyan sütunlar listelenir.
          </Text>
        </Space>

        {degerArama.trim() && (
          <div style={{ marginTop: 8 }}>
            {bulunanSutunlar.length === 0 ? (
              <Text type="secondary" style={{ fontSize: 12.5 }}>Bu değeri taşıyan sütun yok.</Text>
            ) : (
              <Space wrap>
                {bulunanSutunlar.map((s: any) => (
                  <Tag key={s.ad} color="green" style={{ fontSize: 12 }}>
                    {s.ad} = {typeof s.deger === "number" ? s.deger.toLocaleString("tr-TR") : String(s.deger)}
                  </Tag>
                ))}
              </Space>
            )}
          </div>
        )}
      </Card>

      <Table
        size="small" rowKey="kod" loading={yukleniyor} dataSource={alanlar} pagination={false}
        locale={{ emptyText: veri ? "Alan yok." : "Dönem seçip sütunları okuyun." }}
        columns={[
          { title: "Grup", dataIndex: "grup", width: 120, render: (g: string) => <Tag>{grupAdi[g] ?? g}</Tag> },
          { title: "Pusula alanı", key: "alan", width: 220,
            render: (_: any, a: any) => (
              <div><Text strong>{a.etiket}</Text>
                <div style={{ fontSize: 11.5, color: "#8a8f98" }}>{a.tur === "gun" ? "gün" : a.tur === "saat" ? "saat" : "tutar"} · {a.kod}</div></div>) },
          { title: "Mikro sütunu", key: "sutun",
            render: (_: any, a: any) =>
              /* Hesaplanan alanların Mikro'da sütunu yok; eşleme kutusu
                 göstermek "eksik bir şey var" izlenimi veriyordu. */
              a.hesaplanan ? (
                <Space size={6}>
                  <Tag color="blue">Hesaplanıyor</Tag>
                  <Text type="secondary" style={{ fontSize: 12 }}>{a.sutun}</Text>
                </Space>
              ) : (
              <Select showSearch allowClear style={{ width: "100%" }} value={eslesme[a.kod] || undefined}
                placeholder="Eşlenmedi" options={sutunSecenekleri}
                filterOption={(g, o) => (o?.label as string ?? "").toLocaleLowerCase("tr").includes(g.toLocaleLowerCase("tr"))}
                onChange={(v) => setEslesme((o) => { const y = { ...o }; if (v) y[a.kod] = v; else delete y[a.kod]; return y; })} />) },
          { title: "Örnek değer", key: "deger", width: 140, align: "right" as const,
            render: (_: any, a: any) => {
              if (a.hesaplanan) return <Text type="secondary">makbuzda</Text>;

              const d = degerBul(eslesme[a.kod]);
              return d === null || d === undefined ? <Text type="secondary">—</Text>
                : <b>{typeof d === "number" ? d.toLocaleString("tr-TR") : String(d)}</b>;
            } },
        ]}
      />
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* -------------------------------------------------------------------------- */
/* İşyeri ve şube bilgileri                                                   */
/* -------------------------------------------------------------------------- */
function IsyeriAyari() {
  const { message } = AntdApp.useApp();
  const [isyeri, setIsyeri] = useState<any>({});
  const [subeler, setSubeler] = useState<Record<string, { ad?: string; sicilNo?: string }>>({});
  const [donemSubeleri, setDonemSubeleri] = useState<any[]>([]);
  const [etiketler, setEtiketler] = useState<Record<string, string>>({});
  const [yuvalar, setYuvalar] = useState<any[]>([]);
  const [yuvaGrubu, setYuvaGrubu] = useState("kazanc");
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const simdi = new Date();

  useEffect(() => {
    api.al<any>("/api/Tahakkuk/Ayar").then((d) => {
      setIsyeri(d.isyeri ?? {});
      setSubeler(d.subeler ?? {});
      setEtiketler(d.etiketler ?? {});
      setYuvalar(d.yuvalar ?? []);
    }).catch(() => undefined);

    /* Hangi SGK şubelerinin olduğunu son dönemden çıkar */
    const y = simdi.getMonth() === 0 ? simdi.getFullYear() - 1 : simdi.getFullYear();
    const a = simdi.getMonth() === 0 ? 12 : simdi.getMonth();
    api.al<any[]>(`/api/Tahakkuk/Subeler?yil=${y}&ay=${a}`).then((d) => setDonemSubeleri(d ?? [])).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const kaydet = async () => {
    setKaydediliyor(true);
    try {
      await api.gonder("/api/Tahakkuk/Ayar", { isyeri, subeler, etiketler });
      message.success("Kaydedildi.");
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setKaydediliyor(false);
    }
  };

  const alan = (kod: string, etiket: string, genislik = 300) => (
    <div style={{ marginBottom: 8 }}>
      <Text type="secondary" style={{ fontSize: 12 }}>{etiket}</Text>
      <Input value={isyeri[kod] ?? ""} style={{ width: genislik, display: "block" }}
        onChange={(e) => setIsyeri((o: any) => ({ ...o, [kod]: e.target.value }))} />
    </div>
  );

  const numaralar = Array.from(new Set([
    ...donemSubeleri.map((s) => String(s.sskNo)),
    ...Object.keys(subeler),
  ])).sort((a, b) => Number(a) - Number(b));

  return (
    <Card size="small">
      <Paragraph type="secondary" style={{ fontSize: 12.5 }}>
        Pusulanın üst bloğundaki işyeri bilgileri ve SGK şubelerinin adı /
        işyeri sicil numarası. Bu bilgiler Mikro'da sürüme göre farklı
        sütunlarda durduğu ve nadiren değiştiği için burada tutulur.
      </Paragraph>

      <Row gutter={[16, 8]}>
        <Col xs={24} md={12}>
          {alan("unvan", "İş yeri ünvanı", 360)}
          {alan("adres1", "Adres satırı 1", 360)}
          {alan("adres2", "Adres satırı 2", 360)}
          {alan("adres3", "Adres satırı 3", 360)}
        </Col>
        <Col xs={24} md={12}>
          {alan("telefon", "Telefon", 220)}
          {alan("faks", "Faks", 220)}
          {alan("ticSicilNo", "Ticaret sicil no", 260)}
          {alan("web", "Web", 260)}
        </Col>
      </Row>

      <Text strong style={{ fontSize: 13 }}>SGK şubeleri</Text>
      <Table
        size="small" rowKey="no" style={{ marginTop: 6 }} pagination={false}
        dataSource={numaralar.map((no) => ({
          no,
          ...(subeler[no] ?? {}),
          otomatik: donemSubeleri.find((d) => String(d.sskNo) === no)?.adKaynagi === "birim"
            ? donemSubeleri.find((d) => String(d.sskNo) === no)?.ad
            : null,
        }))}
        locale={{ emptyText: "Şube bulunamadı; önce Makbuzlar sekmesinden bir dönem getirin." }}
        columns={[
          { title: "SGK no", dataIndex: "no", width: 90 },
          { title: "Şube adı", key: "ad",
            render: (_: any, r: any) => (
              <Input value={subeler[r.no]?.ad ?? ""}
                placeholder={r.otomatik ? `${r.otomatik} (personelin birimi)` : "Örn. Bahçelievler"}
                onChange={(e) => setSubeler((o) => ({ ...o, [r.no]: { ...o[r.no], ad: e.target.value } }))} />) },
          { title: "İş yeri sicil no", key: "sicil", width: 340,
            render: (_: any, r: any) => (
              <Input value={subeler[r.no]?.sicilNo ?? ""} placeholder="2 4711 01 011222034 034 28-90 000"
                onChange={(e) => setSubeler((o) => ({ ...o, [r.no]: { ...o[r.no], sicilNo: e.target.value } }))} />) },
        ]}
      />

      <div style={{ marginTop: 16 }}>
        <Text strong style={{ fontSize: 13 }}>Pusula satır adları</Text>
        <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 6 }}>
          Mikro'da kazanç, sosyal yardım ve kesinti yuvalarının adı firmaya göre
          tanımlanır. Aşağıdaki adlar pusulada görünür; Mikro'daki makbuzla
          aynı olmalı. Boş bırakılan yuva varsayılan adıyla kalır.
        </Paragraph>

        <Segmented value={yuvaGrubu} onChange={(v) => setYuvaGrubu(v as string)} style={{ marginBottom: 8 }}
          options={[
            { value: "kazanc", label: "Kazanç" },
            { value: "ekKazanc", label: "Ek kazanç" },
            { value: "sosyal", label: "Sosyal yardım" },
            { value: "ozelKesinti", label: "Özel kesinti" },
            { value: "yasal", label: "Yasal" },
            { value: "toplam", label: "Toplam" },
          ]} />

        <Row gutter={[10, 8]}>
          {yuvalar.filter((y) => y.grup === yuvaGrubu).map((y) => (
            <Col xs={24} sm={12} md={8} key={y.temel}>
              <Text type="secondary" style={{ fontSize: 11.5 }}>{y.temel}</Text>
              <Input value={etiketler[y.temel] ?? ""} placeholder={y.varsayilan}
                onChange={(e) => setEtiketler((o) => ({ ...o, [y.temel]: e.target.value }))} />
            </Col>
          ))}
        </Row>
      </div>

      <Button type="primary" icon={<Save size={14} strokeWidth={2} />} style={{ marginTop: 14 }}
        loading={kaydediliyor} onClick={kaydet} disabled={!ikYoneticisiMi(oturumOku())}>
        Kaydet
      </Button>
    </Card>
  );
}

/**
 * Tahakkuk bölümü.
 *
 * Kendi sayfası yerine Ücret Pusulaları sayfasının bir sekmesi olarak
 * duruyor: ikisi de aynı işin parçası — biri bordroyu Mikro'dan üretiyor,
 * diğeri personele iletip onayını topluyor. Ayrı menülerde durduklarında
 * kullanıcı hangisinden ne yapacağını karıştırıyordu.
 */
export default function Tahakkuk() {
  return (
    <div>
      <Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 12 }}>
        Mikro'daki bordro tahakkuklarından personel başına imzalı makbuz.
        Dönem ve SGK şubesi seçin; şubenin bütün pusulaları klasörlenmiş zip
        olarak iner. İşyeri ünvanı, adresi ve sicil bilgisi Mikro'daki SGK
        işyeri tanımından geliyor.
      </Paragraph>

      <Tabs
        items={[
          { key: "makbuz", label: "Makbuzlar", children: <Makbuzlar /> },
          { key: "esleme", label: "Sütun eşleme", children: <SutunEsleme /> },
          { key: "isyeri", label: "İşyeri ve satır adları", children: <IsyeriAyari /> },
        ]}
      />
    </div>
  );
}
