/* ===========================================================================
   İzin Yönetimi › Görevlendirme (26.10.2026)

   Şirketin gönderdiği iş görüşmesi, toplantı, seminer, eğitim, fuar…
   Personel Biçen360'tan gidiş/dönüş tarihi ve zorunlu açıklamayla girer.
   Bu sekmede:
     - Kayıtlar: tarih aralığı + durum + birim + kapsam süzgeci, ayrıntı
       çekmecesi (onay akışı), İK kararı, Excel.
     - Onay kurgusu: onay istenecek mi, hangi adımlar (birim yöneticisi,
       üst onay, İK), kim girebilir, etkinlik türleri.
   Kişi adımları izin onay zincirinden (avans onay tablosu) geliyor; şube
   personelinde GMY adımı yok.
   =========================================================================== */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  App as AntdApp,
  Button,
  Checkbox,
  DatePicker,
  Drawer,
  Empty,
  Input,
  InputNumber,
  Modal,
  Radio,
  Segmented,
  Select,
  Spin,
  Switch,
  Table,
  Tag,
} from "antd";
import { Briefcase, Download, Save, Settings2 } from "lucide-react";
import dayjs, { Dayjs } from "dayjs";

import { api } from "./api";
import { tabloIndir } from "./raporExcel";

interface AkisAdimi {
  ad: string;
  durum: "tamam" | "red" | "atlandi" | "sirada" | "bekliyor";
  karar?: string | null;
  kisi?: string | null;
  not?: string | null;
  tarih?: string | null;
  kisiler?: string[];
}

interface Kayit {
  id: number;
  personelKodu: string;
  adSoyad: string;
  birim: string;
  pozisyon: string;
  kapsam: "sehir_ici" | "sehir_disi";
  kapsamAdi: string;
  etkinlikTuru: string;
  etkinlikAdi: string;
  yer: string;
  gidis: string;
  donus: string;
  gun: number;
  aciklama: string;
  durum: "bekliyor" | "onaylandi" | "reddedildi" | "iptal";
  durumAdi: string;
  kimde?: string | null;
  gorevde: boolean;
  kararKisi?: string | null;
  kararNot?: string | null;
  kararTarih?: string | null;
  olusturma: string;
  akis?: AkisAdimi[] | null;
  karar: boolean;
}

interface ListeYaniti {
  ozet: { toplam: number; bekleyen: number; onayli: number; gorevde: number; sehirDisi: number };
  kayitlar: Kayit[];
}

interface Ayar {
  acik: boolean;
  onayGerekli: boolean;
  yoneticiOnayi: boolean;
  ustOnay: boolean;
  ikOnayi: boolean;
  kapsam: "hepsi" | "merkez" | "secili";
  birimler: string[];
  turler: string[];
  geriGun: number;
  enUzunGun: number;
  ikBilgi: boolean;
}

interface AyarYaniti {
  ayar: Ayar;
  birimler: { ad: string; kisi: number; merkez: boolean }[];
  varsayilanTurler: string[];
  duzenleyebilir: boolean;
}

const DURUM_RENK: Record<string, string> = {
  bekliyor: "gold",
  onaylandi: "green",
  reddedildi: "red",
  iptal: "default",
};

const t = (s?: string | null) => (s ? dayjs(s).format("DD.MM.YYYY") : "");

/** ExcelJS tarihi UTC yazıyor: yerel gece yarısı bir gün geri kayıyordu */
const gunTarihi = (s: string) => {
  const d = dayjs(s);
  return new Date(Date.UTC(d.year(), d.month(), d.date()));
};

export default function GorevlendirmeYonetimi() {
  const { message } = AntdApp.useApp();

  const [gorunum, setGorunum] = useState<"kayitlar" | "kurgu">("kayitlar");
  const [aralik, setAralik] = useState<[Dayjs, Dayjs]>([dayjs().subtract(30, "day"), dayjs().add(60, "day")]);
  const [durum, setDurum] = useState<string>("hepsi");
  const [birim, setBirim] = useState<string | undefined>();
  const [kapsam, setKapsam] = useState<string>("hepsi");
  const [ara, setAra] = useState("");
  const [veri, setVeri] = useState<ListeYaniti | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [secili, setSecili] = useState<Kayit | null>(null);
  const [ret, setRet] = useState<Kayit | null>(null);
  const [retNot, setRetNot] = useState("");
  const [islenen, setIslenen] = useState<number | null>(null);

  const getir = useCallback(async () => {
    setYukleniyor(true);
    try {
      const q = `bas=${aralik[0].format("YYYY-MM-DD")}&bit=${aralik[1].format("YYYY-MM-DD")}`;
      setVeri(await api.al<ListeYaniti>(`/api/Gorevlendirme/Liste?${q}`));
    } catch (e: any) {
      message.error(e?.message ?? "Görevlendirmeler alınamadı.");
    } finally {
      setYukleniyor(false);
    }
  }, [aralik, message]);

  useEffect(() => {
    getir();
  }, [getir]);

  const birimler = useMemo(
    () => Array.from(new Set((veri?.kayitlar ?? []).map((k) => k.birim).filter(Boolean))).sort((a, b) => a.localeCompare(b, "tr")),
    [veri]
  );

  const liste = useMemo(() => {
    const q = ara.trim().toLocaleLowerCase("tr");
    return (veri?.kayitlar ?? []).filter(
      (k) =>
        (durum === "hepsi" || (durum === "gorevde" ? k.gorevde : k.durum === durum)) &&
        (!birim || k.birim === birim) &&
        (kapsam === "hepsi" || k.kapsam === kapsam) &&
        (!q ||
          [k.adSoyad, k.personelKodu, k.yer, k.etkinlikAdi, k.etkinlikTuru]
            .join(" ")
            .toLocaleLowerCase("tr")
            .includes(q))
    );
  }, [veri, durum, birim, kapsam, ara]);

  const karar = async (k: Kayit, onay: boolean, not?: string) => {
    setIslenen(k.id);
    try {
      const r = await api.gonder<{ mesaj?: string }>(`/api/Gorevlendirme/${k.id}/Karar`, { onay, not: not ?? null });
      message.success(r?.mesaj ?? "Karar kaydedildi.");
      setRet(null);
      setRetNot("");
      setSecili(null);
      await getir();
    } catch (e: any) {
      message.error(e?.message ?? "Karar kaydedilemedi.");
    } finally {
      setIslenen(null);
    }
  };

  const excel = () =>
    tabloIndir({
      baslik: "Görevlendirmeler",
      altBaslik: `${aralik[0].format("DD.MM.YYYY")} – ${aralik[1].format("DD.MM.YYYY")} · ${liste.length} kayıt`,
      sayfaAdi: "Görevlendirme",
      dosyaAdi: "gorevlendirmeler",
      genelToplam: true,
      sutunlar: [
        { ad: "PER-KOD", genislik: 10 },
        { ad: "ADI SOYADI", genislik: 26 },
        { ad: "BİRİM", genislik: 22 },
        { ad: "POZİSYON", genislik: 22 },
        { ad: "KAPSAM", genislik: 12 },
        { ad: "ETKİNLİK TÜRÜ", genislik: 18 },
        { ad: "ETKİNLİK", genislik: 30 },
        { ad: "YER", genislik: 20 },
        { ad: "GİDİŞ", tip: "tarih" },
        { ad: "DÖNÜŞ", tip: "tarih" },
        { ad: "GÜN", tip: "sayi" },
        { ad: "DURUM", genislik: 14 },
        { ad: "KARAR VEREN", genislik: 24 },
        { ad: "AÇIKLAMA", genislik: 50 },
      ],
      satirlar: liste.map((k) => [
        k.personelKodu,
        k.adSoyad,
        k.birim,
        k.pozisyon,
        k.kapsamAdi,
        k.etkinlikTuru,
        k.etkinlikAdi,
        k.yer,
        gunTarihi(k.gidis),
        gunTarihi(k.donus),
        k.gun,
        k.kimde ?? k.durumAdi,
        k.kararKisi ?? "",
        k.aciklama,
      ]),
    });

  const o = veri?.ozet;

  return (
    <div className="gv-kok">
      <style>{CSS}</style>

      <div className="gv-ust">
        <Segmented
          value={gorunum}
          onChange={(v) => setGorunum(v as any)}
          options={[
            { value: "kayitlar", label: <span className="gv-seg"><Briefcase size={14} /> Kayıtlar</span> },
            { value: "kurgu", label: <span className="gv-seg"><Settings2 size={14} /> Onay kurgusu</span> },
          ]}
        />
      </div>

      {gorunum === "kurgu" ? (
        <Kurgu />
      ) : (
        <>
          <div className="gv-kpiler">
            {[
              { k: "hepsi", ad: "Toplam", d: o?.toplam },
              { k: "bekliyor", ad: "Onay bekleyen", d: o?.bekleyen, renk: "#ad6800" },
              { k: "onaylandi", ad: "Onaylı", d: o?.onayli, renk: "#3f6212" },
              { k: "gorevde", ad: "Bugün görevde", d: o?.gorevde, renk: "#0e7490" },
            ].map((x) => (
              <button key={x.k} className={`gv-kpi ${durum === x.k ? "acik" : ""}`} onClick={() => setDurum(x.k)}>
                <span>{x.ad}</span>
                <b style={{ color: x.renk }}>{x.d ?? "—"}</b>
              </button>
            ))}
          </div>

          <div className="gv-suzgec">
            <DatePicker.RangePicker
              value={aralik}
              format="DD.MM.YYYY"
              allowClear={false}
              onChange={(v) => v?.[0] && v?.[1] && setAralik([v[0], v[1]])}
            />
            <Select
              allowClear
              placeholder="Birim"
              style={{ minWidth: 180 }}
              value={birim}
              onChange={setBirim}
              options={birimler.map((b) => ({ value: b, label: b }))}
              showSearch
            />
            <Segmented
              value={kapsam}
              onChange={(v) => setKapsam(String(v))}
              options={[
                { value: "hepsi", label: "Tümü" },
                { value: "sehir_ici", label: "Şehir içi" },
                { value: "sehir_disi", label: "Şehir dışı" },
              ]}
            />
            <Input.Search placeholder="Ad, sicil, yer…" allowClear style={{ width: 200 }} value={ara} onChange={(e) => setAra(e.target.value)} />
            <span style={{ flex: 1 }} />
            <Button icon={<Download size={15} />} onClick={excel} disabled={liste.length === 0}>
              Excel
            </Button>
          </div>

          <Spin spinning={yukleniyor}>
            <Table<Kayit>
              rowKey="id"
              size="middle"
              dataSource={liste}
              pagination={{ pageSize: 50, hideOnSinglePage: true }}
              scroll={{ x: 900 }}
              locale={{ emptyText: <Empty description="Bu aralıkta görevlendirme yok" /> }}
              onRow={(k) => ({ onClick: () => setSecili(k), style: { cursor: "pointer" } })}
              columns={[
                {
                  title: "Personel",
                  key: "kisi",
                  render: (_, k) => (
                    <div>
                      <b>{k.adSoyad}</b>
                      <div className="gv-alt">
                        {k.personelKodu} · {k.birim}
                      </div>
                    </div>
                  ),
                },
                {
                  title: "Görev",
                  key: "gorev",
                  render: (_, k) => (
                    <div>
                      <b>{k.yer}</b>
                      <div className="gv-alt">
                        {k.kapsamAdi} · {k.etkinlikTuru} · {k.etkinlikAdi}
                      </div>
                    </div>
                  ),
                },
                {
                  title: "Tarih",
                  key: "tarih",
                  width: 190,
                  sorter: (a, b) => a.gidis.localeCompare(b.gidis),
                  render: (_, k) => (
                    <div>
                      {t(k.gidis)} – {t(k.donus)}
                      <div className="gv-alt">{k.gun} gün</div>
                    </div>
                  ),
                },
                {
                  title: "Durum",
                  key: "durum",
                  width: 200,
                  render: (_, k) => (
                    <div>
                      <Tag color={DURUM_RENK[k.durum]}>{k.durumAdi}</Tag>
                      {k.gorevde ? <Tag color="cyan">Görevde</Tag> : null}
                      {k.kimde ? <div className="gv-alt">{k.kimde}</div> : null}
                    </div>
                  ),
                },
                {
                  title: "",
                  key: "islem",
                  width: 170,
                  render: (_, k) =>
                    k.karar ? (
                      <div style={{ display: "flex", gap: 6 }} onClick={(e) => e.stopPropagation()}>
                        <Button size="small" danger onClick={() => setRet(k)} disabled={islenen === k.id}>
                          Reddet
                        </Button>
                        <Button size="small" type="primary" loading={islenen === k.id} onClick={() => karar(k, true)}>
                          Onayla
                        </Button>
                      </div>
                    ) : null,
                },
              ]}
            />
          </Spin>
        </>
      )}

      {/* ---------------------------------------------- ayrıntı çekmecesi */}
      <Drawer open={!!secili} onClose={() => setSecili(null)} width={460} title={secili?.adSoyad} destroyOnClose>
        {secili ? (
          <div className="gv-ayrinti">
            <div className="gv-alt">
              {secili.personelKodu} · {secili.pozisyon} · {secili.birim}
            </div>

            <div className="gv-kutu">
              <div className="gv-kutu-ust">
                <b>{secili.yer}</b>
                <Tag color={DURUM_RENK[secili.durum]}>{secili.durumAdi}</Tag>
              </div>
              <div>
                {secili.kapsamAdi} · {secili.etkinlikTuru}
              </div>
              <div style={{ fontWeight: 600 }}>{secili.etkinlikAdi}</div>
              <div>
                {t(secili.gidis)} – {t(secili.donus)} · {secili.gun} gün
              </div>
            </div>

            <h4>Açıklama</h4>
            <p className="gv-metin">{secili.aciklama}</p>

            <h4>Onay akışı</h4>
            {secili.akis?.length ? (
              <ol className="gv-akis">
                {secili.akis.map((a, i) => (
                  <li key={i} className={a.durum}>
                    <b>{a.ad}</b>
                    <span>
                      {a.karar ?? (a.durum === "sirada" ? "Sırada" : "Bekliyor")}
                      {a.kisi ? ` · ${a.kisi}` : ""}
                      {a.tarih ? ` · ${dayjs(a.tarih).format("DD.MM.YYYY HH:mm")}` : ""}
                    </span>
                    {a.not ? <em>{a.not}</em> : null}
                    {!a.karar && a.kisiler?.length ? <em>Onaylayabilecek: {a.kisiler.join(", ")}</em> : null}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="gv-metin">
                Onay istenmedi{secili.kararKisi ? ` (${secili.kararKisi})` : ""}; kayıt girildiği anda geçerli.
              </p>
            )}

            {secili.kararNot ? (
              <Alert type={secili.durum === "reddedildi" ? "error" : "info"} showIcon message={secili.kararNot} />
            ) : null}

            <div className="gv-alt" style={{ marginTop: 12 }}>
              Giriş: {dayjs(secili.olusturma).format("DD.MM.YYYY HH:mm")}
            </div>

            {secili.karar ? (
              <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                <Button danger block onClick={() => setRet(secili)}>
                  Reddet
                </Button>
                <Button type="primary" block loading={islenen === secili.id} onClick={() => karar(secili, true)}>
                  Onayla
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </Drawer>

      <Modal
        open={!!ret}
        title="Görevlendirmeyi reddet"
        okText="Reddet"
        okButtonProps={{ danger: true, disabled: retNot.trim().length < 3, loading: islenen === ret?.id }}
        cancelText="Vazgeç"
        onCancel={() => setRet(null)}
        onOk={() => ret && karar(ret, false, retNot.trim())}
      >
        <p>
          {ret?.adSoyad} · {ret?.yer} · {t(ret?.gidis)} – {t(ret?.donus)}
        </p>
        <Input.TextArea
          rows={3}
          maxLength={500}
          value={retNot}
          onChange={(e) => setRetNot(e.target.value)}
          placeholder="Sebep (personel görür)"
        />
      </Modal>

    </div>
  );
}

/* ====================================================== onay kurgusu */

function Kurgu() {
  const { message } = AntdApp.useApp();
  const [veri, setVeri] = useState<AyarYaniti | null>(null);
  const [ayar, setAyar] = useState<Ayar | null>(null);
  const [kaydediliyor, setKaydediliyor] = useState(false);

  useEffect(() => {
    api
      .al<AyarYaniti>("/api/Gorevlendirme/Ayar")
      .then((v) => {
        setVeri(v);
        setAyar(v.ayar);
      })
      .catch((e) => message.error(e?.message ?? "Ayar alınamadı."));
  }, [message]);

  if (!veri || !ayar) return <Spin style={{ display: "block", margin: "60px auto" }} />;

  const d = veri.duzenleyebilir;
  const degis = (p: Partial<Ayar>) => setAyar((a) => (a ? { ...a, ...p } : a));

  const adimlar = [
    ayar.yoneticiOnayi && "Birim yöneticisi",
    ayar.ustOnay && "Bölge müdürü / GMY",
    (ayar.ikOnayi || (!ayar.yoneticiOnayi && !ayar.ustOnay)) && "İnsan Kaynakları",
  ].filter(Boolean) as string[];

  const kaydet = async () => {
    setKaydediliyor(true);
    try {
      const r = await api.gonder<{ ayar: Ayar }>("/api/Gorevlendirme/Ayar", ayar);
      setAyar(r.ayar);
      message.success("Görevlendirme kurgusu kaydedildi.");
    } catch (e: any) {
      message.error(e?.message ?? "Kaydedilemedi.");
    } finally {
      setKaydediliyor(false);
    }
  };

  return (
    <div className="gv-kurgu">
      {!d ? <Alert type="info" showIcon message="Kurguyu yalnız Admin, GMY ve İK yöneticisi değiştirebilir." /> : null}

      <section className="gv-kart">
        <div className="gv-kart-ust">
          <div>
            <h3>Görevlendirme girişi</h3>
            <p>Kapalıyken Biçen360'ta görevlendirme kartı görünmez; eski kayıtlar korunur.</p>
          </div>
          <Switch checked={ayar.acik} disabled={!d} onChange={(v) => degis({ acik: v })} />
        </div>
      </section>

      <section className="gv-kart">
        <div className="gv-kart-ust">
          <div>
            <h3>Onay süreci</h3>
            <p>Kapalıysa kayıt girildiği anda geçerli olur ve İK'ya bilgi olarak düşer.</p>
          </div>
          <Switch checked={ayar.onayGerekli} disabled={!d} onChange={(v) => degis({ onayGerekli: v })} />
        </div>

        {ayar.onayGerekli ? (
          <>
            <div className="gv-adimlar">
              <Checkbox checked={ayar.yoneticiOnayi} disabled={!d} onChange={(e) => degis({ yoneticiOnayi: e.target.checked })}>
                <b>Birim yöneticisi</b>
                <span>Mağaza müdürü, muhasebe müdürü, depo müdürü… (izin onay tablosundaki ilk adım)</span>
              </Checkbox>
              <Checkbox checked={ayar.ustOnay} disabled={!d} onChange={(e) => degis({ ustOnay: e.target.checked })}>
                <b>Üst onay</b>
                <span>Bölge müdürü ve genel müdür yardımcısı. Şube personelinde GMY adımı yok.</span>
              </Checkbox>
              <Checkbox checked={ayar.ikOnayi} disabled={!d} onChange={(e) => degis({ ikOnayi: e.target.checked })}>
                <b>İnsan Kaynakları</b>
                <span>Son onay. Hiçbir adım seçilmezse ya da kişinin onay kuralı yoksa İK onaylar.</span>
              </Checkbox>
            </div>
            <div className="gv-onizleme">
              Akış: {adimlar.join(" → ")}
              <em>Onaylayacak kişi bulunamayan ya da talep edenin kendisi olan adım atlanır.</em>
            </div>
          </>
        ) : (
          <Checkbox checked={ayar.ikBilgi} disabled={!d} onChange={(e) => degis({ ikBilgi: e.target.checked })}>
            Yeni kayıtta İK'ya bildirim gönder
          </Checkbox>
        )}
      </section>

      <section className="gv-kart">
        <h3>Kim girebilir</h3>
        <Radio.Group value={ayar.kapsam} disabled={!d} onChange={(e) => degis({ kapsam: e.target.value })}>
          <Radio value="hepsi">Tüm personel</Radio>
          <Radio value="merkez">Yalnız genel merkez</Radio>
          <Radio value="secili">Seçili birimler</Radio>
        </Radio.Group>
        {ayar.kapsam === "secili" ? (
          <Select
            mode="multiple"
            style={{ width: "100%", marginTop: 10 }}
            placeholder="Birim seçin"
            disabled={!d}
            value={ayar.birimler}
            onChange={(v) => degis({ birimler: v })}
            optionFilterProp="label"
            options={veri.birimler.map((b) => ({ value: b.ad, label: `${b.ad} (${b.kisi})` }))}
          />
        ) : null}
      </section>

      <section className="gv-kart">
        <h3>Etkinlik türleri</h3>
        <p>Personel formda bunlardan birini seçer. Yazıp Enter'a basarak ekleyin.</p>
        <Select
          mode="tags"
          style={{ width: "100%" }}
          disabled={!d}
          value={ayar.turler}
          onChange={(v) => degis({ turler: v })}
          tokenSeparators={[","]}
        />
        {d ? (
          <Button type="link" size="small" style={{ paddingLeft: 0 }} onClick={() => degis({ turler: veri.varsayilanTurler })}>
            Varsayılanlara dön
          </Button>
        ) : null}
      </section>

      <section className="gv-kart gv-sayilar">
        <label>
          Geriye dönük giriş
          <InputNumber min={0} max={60} value={ayar.geriGun} disabled={!d} onChange={(v) => degis({ geriGun: Number(v ?? 0) })} addonAfter="gün" />
        </label>
        <label>
          En uzun görevlendirme
          <InputNumber min={1} max={180} value={ayar.enUzunGun} disabled={!d} onChange={(v) => degis({ enUzunGun: Number(v ?? 1) })} addonAfter="gün" />
        </label>
      </section>

      {d ? (
        <Button type="primary" icon={<Save size={15} />} loading={kaydediliyor} onClick={kaydet}>
          Kaydet
        </Button>
      ) : null}
    </div>
  );
}

const CSS = `
.gv-kok { display: flex; flex-direction: column; gap: 14px; }
.gv-ust { display: flex; }
.gv-seg { display: inline-flex; align-items: center; gap: 6px; }
.gv-kpiler { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
.gv-kpi { text-align: left; background: #fff; border: 1px solid #e6e9e3; border-radius: 12px; padding: 12px 14px; cursor: pointer; display: flex; flex-direction: column; gap: 2px; }
.gv-kpi span { font-size: 12px; color: #6b7280; }
.gv-kpi b { font-size: 22px; font-variant-numeric: tabular-nums; }
.gv-kpi.acik { border-color: #0e7490; box-shadow: 0 0 0 2px #e6f6f9; }
.gv-suzgec { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.gv-alt { font-size: 12px; color: #6b7280; }
.gv-ayrinti h4 { margin: 16px 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: .5px; color: #6b7280; }
.gv-kutu { margin-top: 12px; background: #e6f6f9; border-radius: 12px; padding: 12px 14px; display: flex; flex-direction: column; gap: 3px; }
.gv-kutu-ust { display: flex; justify-content: space-between; align-items: center; font-size: 15px; }
.gv-metin { white-space: pre-wrap; margin: 0; }
.gv-akis { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.gv-akis li { border-left: 3px solid #cdd3ca; padding: 2px 0 2px 10px; display: flex; flex-direction: column; }
.gv-akis li.tamam { border-color: #5f8c10; }
.gv-akis li.red { border-color: #cf1322; }
.gv-akis li.sirada { border-color: #d48806; }
.gv-akis li span { font-size: 12px; color: #6b7280; }
.gv-akis li em { font-size: 12px; color: #4b5563; }
.gv-kurgu { display: flex; flex-direction: column; gap: 12px; max-width: 760px; }
.gv-kart { background: #fff; border: 1px solid #e6e9e3; border-radius: 14px; padding: 16px 18px; }
.gv-kart h3 { margin: 0 0 4px; font-size: 15px; }
.gv-kart p { margin: 0 0 10px; color: #6b7280; font-size: 13px; }
.gv-kart-ust { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
.gv-adimlar { display: flex; flex-direction: column; gap: 10px; margin-top: 6px; }
.gv-adimlar .ant-checkbox-wrapper span:last-child { display: flex; flex-direction: column; }
.gv-adimlar span span { font-size: 12px; color: #6b7280; }
.gv-onizleme { margin-top: 12px; background: #f4f6f2; border-radius: 10px; padding: 10px 12px; font-weight: 600; display: flex; flex-direction: column; gap: 2px; }
.gv-onizleme em { font-weight: 400; font-size: 12px; color: #6b7280; }
.gv-sayilar { display: flex; flex-wrap: wrap; gap: 20px; }
.gv-sayilar label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: #4b5563; }
`;
