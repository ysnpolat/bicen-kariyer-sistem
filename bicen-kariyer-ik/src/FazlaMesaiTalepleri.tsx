/* ===========================================================================
   Personel Talepleri › Fazla mesai (06.10.2026)

   Yönetici Biçen360'tan girer, form (İK-FM-01) şubenin mailine gider;
   çalışan, birim yöneticisi ve bölge müdürü imzalayıp ıslak imzalı formu
   İK'ya fiziki gönderir. Burada İK formu yükleyip onaylar (form
   yüklenmeden onay yok) ya da reddeder.
   =========================================================================== */

import { PersonelAdi } from "./personelKarti";
import { useEffect, useMemo, useState } from "react";
import { App as AntdApp, Input, Modal, Table, Tooltip } from "antd";
import { BarChart3, CalendarPlus, Clock3, FileCheck2, GitBranch, Mail, Printer, RefreshCw, Search, Upload } from "lucide-react";
import dayjs from "dayjs";

import { useUzman, uzmanSorgu } from "./uzmanFiltresi";
import { api, oturumOku } from "./api";
import { sekmedeAc } from "./sekmedeAc";
import { EksikDugmesi, useTalepEksikleri } from "./TalepEksik";
import TaramaDugmesi from "./TaramaDugmesi";
import "./FazlaMesaiTalepleri.css";
import FazlaMesaiAkis from "./FazlaMesaiAkis";
import FazlaMesaiRaporu from "./FazlaMesaiRaporu";
import FazlaMesaiGeriyeGir from "./FazlaMesaiGeriyeGir";
import FazlaMesaiPersonel from "./FazlaMesaiPersonel";
import { KarsilikEtiketi, type Karsilik } from "./FazlaMesaiKarsilik";

interface Kayit {
  id: number;
  sicil: string;
  adSoyad: string;
  sube: string | null;
  gorev: string | null;
  tarih: string;
  baslangic: string;
  bitis: string;
  sureDk: number;
  sure: string;
  aciklama: string | null;
  talepEden: string | null;
  birimYonetici: string | null;
  bolgeMuduru: string | null;
  durum: "form" | "ust" | "bekliyor" | "onaylandi" | "reddedildi" | "iptal";
  durumAdi: string;
  formEposta: string | null;
  formGonderim: string | null;
  formHata: string | null;
  belgeVar: boolean;
  belgeYukleyen: string | null;
  belgeTarihi: string | null;
  kararVeren: string | null;
  kararTarihi: string | null;
  kararNotu: string | null;
  olusturma: string;
  /* Onay akışı (08.10.2026): izinle aynı; giren yönetici 1. aşama, üst yönetici 2., İK son */
  ustKarar: string | null;
  ustKisi: string | null;
  ustTarih: string | null;
  ustNot: string | null;
  /* Bölge müdürünün Biçen360'tan yüklediği imzalı form (09.10.2026) */
  bolgeBelgeVar?: boolean;
  bolgeBelgeYukleyen?: string | null;
  bolgeBelgeTarihi?: string | null;
  /* Birim yöneticisi onayı (formu yükleyip onaylayan) */
  birimOnay?: string | null;
  birimOnayTarihi?: string | null;
}

type Gorunum = "form" | "ust" | "bekliyor" | "onaylandi" | "reddedildi" | "tumu";

const DURUM_SINIF: Record<string, string> = {
  form: "fm-r-gri",
  ust: "fm-r-mavi",
  bekliyor: "fm-r-sari",
  onaylandi: "fm-r-yesil",
  reddedildi: "fm-r-kirmizi",
  iptal: "fm-r-gri",
};

const saatYaz = (dk: number) => {
  const s = Math.floor(dk / 60);
  const d = dk % 60;
  return d === 0 ? `${s} sa` : s === 0 ? `${d} dk` : `${s} sa ${d} dk`;
};

export default function FazlaMesaiTalepleri({ sayacDegisti }: { sayacDegisti?: (n: number) => void }) {
  const { message } = AntdApp.useApp();

  const [kayitlar, setKayitlar] = useState<Kayit[]>([]);
  const [ustAdlar, setUstAdlar] = useState<Record<string, string>>({});
  /* 15.10.2026: kayıt başına FM ücreti (onay sürecindekiler dahil; ücret yetkisi olana) */
  const [ucretler, setUcretler] = useState<Record<string, Karsilik>>({});
  /* Üst yönetici aşamasında yalnızca Admin ve GMY karar verebilir (izindeki gibi) */
  const ustAdina = ["Admin", "GenelMudurYardimcisi"].includes(oturumOku()?.rol ?? "");
  const [yukleniyor, setYukleniyor] = useState(true);
  const [gorunum, setGorunum] = useState<Gorunum>("bekliyor");
  const [arama, setArama] = useState("");
  /* Akış kontrolü (09.10.2026): kim girer, kime onaya gider, form nereye */
  const [akisAcik, setAkisAcik] = useState(false);
  const [geriyeAcik, setGeriyeAcik] = useState(false);
  /* Fazla mesai raporu (09.10.2026): ay ay şube ve personel kırılımı */
  const [raporAcik, setRaporAcik] = useState(false);
  const [onay, setOnay] = useState<Kayit | null>(null);
  /* 15.10.2026: satıra tıklayınca yan pencere (kayıt ayrıntısı + personelin fazla mesai geçmişi) */
  const [secili, setSecili] = useState<Kayit | null>(null);
  const [red, setRed] = useState<Kayit | null>(null);
  const eksik = useTalepEksikleri("fazlamesai");

  const uzman = useUzman();

  const getir = async () => {
    setYukleniyor(true);
    try {
      const c = await api.al<{ kayitlar: Kayit[]; sayilar: any; ustOnaylayanlar?: Record<string, string>; ucretler?: Record<string, Karsilik> }>(
        `/api/FazlaMesai/Liste${uzmanSorgu(uzman)}`
      );
      setKayitlar(c.kayitlar ?? []);
      setUcretler(c.ucretler ?? {});
      setUstAdlar(c.ustOnaylayanlar ?? {});
      sayacDegisti?.(c.sayilar?.bekliyor ?? 0);
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setYukleniyor(false);
    }
  };

  useEffect(() => {
    getir();
  }, [uzman]);

  const sayilar = useMemo(() => {
    const ayBasi = dayjs().startOf("month");
    const buAy = kayitlar.filter((k) => k.durum === "onaylandi" && !dayjs(k.tarih).isBefore(ayBasi));
    return {
      form: kayitlar.filter((k) => k.durum === "form").length,
      ust: kayitlar.filter((k) => k.durum === "ust").length,
      bekliyor: kayitlar.filter((k) => k.durum === "bekliyor").length,
      evrakli: kayitlar.filter((k) => k.durum === "bekliyor" && k.belgeVar).length,
      onaylandi: kayitlar.filter((k) => k.durum === "onaylandi").length,
      buAyDk: buAy.reduce((t, k) => t + k.sureDk, 0),
      reddedildi: kayitlar.filter((k) => k.durum === "reddedildi").length,
    };
  }, [kayitlar]);

  const liste = useMemo(() => {
    const q = arama.trim().toLocaleLowerCase("tr");
    return kayitlar.filter(
      (k) =>
        (gorunum === "tumu" ? k.durum !== "onaylandi" && k.durum !== "reddedildi" : k.durum === gorunum) &&
        (!q || `${k.adSoyad} ${k.sicil} ${k.sube ?? ""} ${k.talepEden ?? ""}`.toLocaleLowerCase("tr").includes(q))
    );
  }, [kayitlar, gorunum, arama]);

  const formAc = (k: Kayit) => sekmedeAc(`/api/FazlaMesai/${k.id}/Form`).catch((h: any) => message.error(h.message));
  const belgeAc = (k: Kayit) => sekmedeAc(`/api/FazlaMesai/${k.id}/Belge`).catch((h: any) => message.error(h.message));
  const bolgeBelgeAc = (k: Kayit) => sekmedeAc(`/api/FazlaMesai/${k.id}/Belge?bolge=true`).catch((h: any) => message.error(h.message));

  const yenidenGonder = async (k: Kayit) => {
    try {
      const c = await api.gonder<any>(`/api/FazlaMesai/${k.id}/FormGonder`, {});
      message.success(`Form ${c.adres} adresine yeniden gönderildi.`);
      getir();
    } catch (h: any) {
      message.error(h.message);
    }
  };

  /* 14.10.2026: kayıt kuraldan önce girildiyse güncel kurala göre yeniden hesapla ve formu yeni alıcıya gönder */
  const akisYenile = async (k: Kayit) => {
    try {
      const c = await api.gonder<any>(`/api/FazlaMesai/${k.id}/AkisYenile`, {});
      message.success(c.mesaj, 6);
      getir();
    } catch (h: any) {
      message.error(h.message);
    }
  };

  /* Seçilen kaydın ayrıntısı (eskiden satırın "+" ile açılan kısmı) */
  const kayitAyrinti = (k: Kayit) => (
                <div className="fm-ayrinti">
                  <div>
                    <small>Neden / açıklama</small>
                    <p>{k.aciklama}</p>
                  </div>
                  <div>
                    <small>Formdaki onaylayanlar</small>
                    <p>
                      Birim yöneticisi: <b>{k.birimYonetici ?? "—"}</b> · Bölge müdürü: <b>{k.bolgeMuduru ?? "—"}</b>
                    </p>
                  </div>
                  <div>
                    <small>Form</small>
                    <p>
                      {k.formGonderim
                        ? `${k.formEposta} adresine ${dayjs(k.formGonderim).format("DD.MM.YYYY HH:mm")}'de gönderildi.`
                        : `Gönderilemedi: ${k.formHata ?? "—"}`}{" "}
                      {/* 09.10.2026: üst yönetici onayındaki kayıtta da (form adresi düzeltilince) */}
                      {(k.durum === "bekliyor" || k.durum === "ust" || k.durum === "form") && (
                        <button type="button" className="fm-link" onClick={() => yenidenGonder(k)}>
                          Şubeye yeniden gönder
                        </button>
                      )}
                      {(k.durum === "ust" || k.durum === "form") && (
                        <>
                          {" · "}
                          <button
                            type="button"
                            className="fm-link"
                            title="Yönetim › Fazla mesai akışı'ndaki güncel kurala göre onay sırasını ve form alıcısını yeniden hesaplar, formu yeni alıcıya gönderir"
                            onClick={() => akisYenile(k)}
                          >
                            Güncel kurala göre yenile ve gönder
                          </button>
                        </>
                      )}
                    </p>
                  </div>
                  <div>
                    <small>Birim yöneticisinin yüklediği imzalı form</small>
                    <p>
                      {k.bolgeBelgeVar ? (
                        <>
                          {k.bolgeBelgeYukleyen} · {k.bolgeBelgeTarihi ? dayjs(k.bolgeBelgeTarihi).format("DD.MM.YYYY HH:mm") : ""}{" "}
                          <button type="button" className="fm-link" onClick={() => bolgeBelgeAc(k)}>
                            Aç
                          </button>
                        </>
                      ) : k.durum === "form" ? (
                        "Birim yöneticisi henüz yüklemedi (Biçen360'ta ana sayfa kartından ya da İzin Onayları'ndan yükler, sonra onaylar)."
                      ) : (
                        "—"
                      )}
                    </p>
                  </div>
                  <div>
                    <small>Islak imzalı form (İK)</small>
                    <p>
                      {k.belgeVar
                        ? `${k.belgeYukleyen} · ${k.belgeTarihi ? dayjs(k.belgeTarihi).format("DD.MM.YYYY HH:mm") : ""}`
                        : "Henüz yüklenmedi."}
                    </p>
                  </div>
                  {(k.durum === "bekliyor" || k.durum === "ust" || k.durum === "form") && (
                    <div>
                      <button type="button" className="fm-link fm-link-kirmizi" onClick={() => iptal(k)}>
                        Kaydı iptal et
                      </button>
                    </div>
                  )}
                </div>
);

  const ustOnayla = (k: Kayit) =>
    Modal.confirm({
      title: "Üst yönetici adına onaylansın mı?",
      content: `${k.adSoyad} · ${dayjs(k.tarih).format("DD.MM.YYYY")} · ${k.baslangic}–${k.bitis}. Kayıt İK onayına geçer.`,
      okText: "Onayla",
      cancelText: "Vazgeç",
      onOk: async () => {
        try {
          await api.gonder(`/api/FazlaMesai/${k.id}/Karar`, { onay: true, not: "" });
          message.success("Üst yönetici adına onaylandı; İK onayına geçti.");
          getir();
        } catch (h: any) {
          message.error(h.message);
        }
      },
    });

  const iptal = (k: Kayit) =>
    Modal.confirm({
      title: "Fazla mesai kaydı iptal edilsin mi?",
      content: `${k.adSoyad} · ${dayjs(k.tarih).format("DD.MM.YYYY")} · ${k.baslangic}–${k.bitis}`,
      okText: "İptal et",
      okButtonProps: { danger: true },
      cancelText: "Vazgeç",
      onOk: async () => {
        try {
          await api.gonder(`/api/FazlaMesai/${k.id}/Iptal`, {});
          getir();
        } catch (h: any) {
          message.error(h.message);
        }
      },
    });

  return (
    <div className="fm">
      <div className="it-kpiler">
        {[
          { k: "bekliyor" as Gorunum, et: "İK onayı bekleyen", d: sayilar.bekliyor, alt: `${sayilar.evrakli} tanesinin formu yüklendi`, renk: "sari" },
          { k: "ust" as Gorunum, et: "Üst yönetici onayında", d: sayilar.ust, alt: "bölge müdürü / üst yönetici", renk: "mavi" },
          { k: "form" as Gorunum, et: "Birim yöneticisinde", d: sayilar.form, alt: "imzalı formu yükleyip onaylayacak", renk: "turuncu" },
          { k: "onaylandi" as Gorunum, et: "Onaylanan", d: sayilar.onaylandi, alt: `bu ay ${saatYaz(sayilar.buAyDk)}`, renk: "yesil" },
          { k: "reddedildi" as Gorunum, et: "Reddedilen", d: sayilar.reddedildi, alt: "sebebiyle", renk: "kirmizi" },
          { k: "tumu" as Gorunum, et: "Açık talepler", d: kayitlar.filter((k) => k.durum !== "onaylandi" && k.durum !== "reddedildi").length, alt: "onaylanan/reddedilen hariç", renk: "turuncu" },
        ].map((x) => (
          <button
            key={x.k}
            type="button"
            className={`it-kpi it-kpi-${x.renk}${gorunum === x.k ? " secili" : ""}`}
            onClick={() => setGorunum(x.k)}
          >
            <span className="et">{x.et}</span>
            <span className="d">{x.d.toLocaleString("tr-TR")}</span>
            <span className="alt">{x.alt}</span>
          </button>
        ))}
      </div>

      <div className="it-kart">
        <div className="it-kart-bas">
          <span className="it-kart-simge fm-simge">
            <Clock3 size={15} strokeWidth={2} />
          </span>
          <h3>Fazla mesai</h3>
          <span>birim yöneticisi formu yükleyip onaylar → bölge müdürü → İK</span>
          <div className="it-sag">
            <Input
              allowClear
              size="small"
              prefix={<Search size={14} />}
              placeholder="Ad, sicil, şube, giren"
              value={arama}
              onChange={(e) => setArama(e.target.value)}
              style={{ width: 210 }}
            />
            <button type="button" className="it-dg kucuk" onClick={() => setGeriyeAcik(true)}>
              <CalendarPlus size={14} strokeWidth={2} /> Geriye dönük gir
            </button>
            <button type="button" className="it-dg kucuk" onClick={() => setAkisAcik(true)}>
              <GitBranch size={14} strokeWidth={2} /> Akışı kontrol et
            </button>
            <button type="button" className="it-dg kucuk" onClick={getir} disabled={yukleniyor}>
              <RefreshCw size={14} strokeWidth={2} className={yukleniyor ? "it-don" : undefined} /> Yenile
            </button>
            <button type="button" className="it-dg kucuk" onClick={() => setRaporAcik(true)}>
              <BarChart3 size={14} strokeWidth={2} /> Rapor
            </button>
            <FazlaMesaiAkis acik={akisAcik} kapat={() => setAkisAcik(false)} />
            <FazlaMesaiGeriyeGir acik={geriyeAcik} kapat={() => setGeriyeAcik(false)} kaydedildi={getir} />
            <FazlaMesaiRaporu acik={raporAcik} kapat={() => setRaporAcik(false)} />
          </div>
        </div>

        <div className="it-kart-ic">
          <Table<Kayit>
            rowKey="id"
            size="small"
            loading={yukleniyor}
            dataSource={liste}
            pagination={{ pageSize: 25, hideOnSinglePage: true }}
            locale={{ emptyText: gorunum === "bekliyor" ? "Onay bekleyen fazla mesai yok." : "Kayıt yok." }}
            columns={[
              {
                title: "Personel",
                key: "kisi",
                render: (_, k) => (
                  <div className="fm-kisi">
                    <b className="fm-kisi-ad">{k.adSoyad}</b>
                    <small>
                      {k.sicil} · {k.gorev ?? "—"} · {k.sube ?? "—"}
                    </small>
                  </div>
                ),
              },
              {
                title: "Fazla mesai",
                key: "mesai",
                width: 210,
                render: (_, k) => (
                  <div className="fm-kisi">
                    <b>
                      {dayjs(k.tarih).format("DD.MM.YYYY ddd")} · {k.baslangic}–{k.bitis}
                    </b>
                    <small>
                      {k.sure}
                      <KarsilikEtiketi k={ucretler[String(k.id)]} onayli={k.durum === "onaylandi"} />
                    </small>
                  </div>
                ),
                sorter: (a, b) => a.tarih.localeCompare(b.tarih),
              },
              {
                title: "Neden",
                dataIndex: "aciklama",
                ellipsis: { showTitle: false },
                render: (v: string) => (
                  <Tooltip title={v} placement="topLeft">
                    <span className="fm-neden">{v}</span>
                  </Tooltip>
                ),
              },
              {
                title: "Giren · form",
                key: "giren",
                width: 200,
                render: (_, k) => (
                  <div className="fm-kisi">
                    <span>{k.talepEden ?? "—"}</span>
                    {k.formGonderim ? (
                      <Tooltip title={`${k.formEposta} · ${dayjs(k.formGonderim).format("DD.MM HH:mm")}`}>
                        <small className="fm-ok">
                          <Mail size={12} /> şubeye gitti
                        </small>
                      </Tooltip>
                    ) : (
                      <Tooltip title={k.formHata ?? ""}>
                        <small className="fm-hata">
                          <Mail size={12} /> mail gitmedi
                        </small>
                      </Tooltip>
                    )}
                  </div>
                ),
              },
              {
                title: "Durum",
                key: "durum",
                width: 190,
                render: (_, k) => (
                  <div className="fm-kisi">
                    <span className={`fm-rozet ${DURUM_SINIF[k.durum]}`}>
                      {k.durum === "bekliyor" ? (k.belgeVar ? "Form yüklendi · onay bekliyor" : "İK onayı bekliyor · form isteğe bağlı") : k.durumAdi}
                    </span>
                    {k.durum === "form" ? (
                      <small>{k.talepEden ?? "Giren yönetici"} · {k.bolgeBelgeVar ? "form yüklendi, onay bekleniyor" : "formu yüklemesi bekleniyor"}</small>
                    ) : k.durum === "ust" ? (
                      <small>
                        Onaylayacak: {ustAdlar[String(k.id)] || "üst yönetici"}
                        {k.birimOnay ? ` · birim onayı: ${k.birimOnay}` : ""}
                      </small>
                    ) : k.ustKarar ? (
                      <small>
                        Üst yönetici: {k.ustKisi ?? "—"} · {k.ustKarar}
                        {k.ustTarih ? ` · ${dayjs(k.ustTarih).format("DD.MM")}` : ""}
                      </small>
                    ) : null}
                    {k.durum === "onaylandi" || k.durum === "reddedildi" ? (
                      <small>
                        {k.kararVeren} · {k.kararTarihi ? dayjs(k.kararTarihi).format("DD.MM.YYYY") : ""}
                        {k.kararNotu ? ` · ${k.kararNotu}` : ""}
                      </small>
                    ) : null}
                  </div>
                ),
              },
              {
                title: "",
                key: "islem",
                width: 360,
                render: (_, k) => (
                  <div className="fm-dugmeler">
                    <Tooltip title="Formu aç / yazdır">
                      <button type="button" className="it-dg kucuk" onClick={() => formAc(k)}>
                        <Printer size={14} />
                      </button>
                    </Tooltip>
                    {k.bolgeBelgeVar && (
                      <Tooltip
                        title={`Birim yöneticisinin yüklediği imzalı form${k.bolgeBelgeYukleyen ? ` · ${k.bolgeBelgeYukleyen}` : ""}${
                          k.bolgeBelgeTarihi ? ` · ${dayjs(k.bolgeBelgeTarihi).format("DD.MM HH:mm")}` : ""
                        }`}
                      >
                        <button type="button" className="it-dg kucuk" onClick={() => bolgeBelgeAc(k)} style={{ color: "#1f4f82" }}>
                          <FileCheck2 size={14} />
                        </button>
                      </Tooltip>
                    )}
                    {k.belgeVar && (
                      <Tooltip title="Islak imzalı formu aç">
                        <button type="button" className="it-dg kucuk" onClick={() => belgeAc(k)}>
                          <FileCheck2 size={14} />
                        </button>
                      </Tooltip>
                    )}
                    {k.durum === "bekliyor" && (
                      <EksikDugmesi tur="fazlamesai" talepId={k.id} e={eksik.harita[k.id]} yenile={eksik.yenile} yetkili={eksik.yetkili} />
                    )}
                    {k.durum === "ust" && ustAdina && (
                      <>
                        <button type="button" className="it-dg kucuk fm-onayla" onClick={() => ustOnayla(k)}>
                          Üst yönetici adına onayla
                        </button>
                        <button type="button" className="it-dg kucuk fm-reddet" onClick={() => setRed(k)}>
                          Reddet
                        </button>
                      </>
                    )}
                    {k.durum === "bekliyor" && (
                      <>
                        <button type="button" className="it-dg kucuk fm-onayla" onClick={() => setOnay(k)}>
                          <Upload size={14} /> Form yükle · onayla
                        </button>
                        <button type="button" className="it-dg kucuk fm-reddet" onClick={() => setRed(k)}>
                          Reddet
                        </button>
                      </>
                    )}
                  </div>
                ),
              },
            ]}
            onRow={(k) => ({
              onClick: (e) => {
                /* Düğmeler ve bağlantılar kendi işini yapsın */
                if ((e.target as HTMLElement).closest("button, a, input, .ant-popover, .ant-tooltip")) return;
                setSecili(k);
              },
              style: { cursor: "pointer" },
            })}
            rowClassName={(k) => (secili?.id === k.id ? "fm-satir-secili" : "")}
          />
        </div>
      </div>

      <FazlaMesaiPersonel sicil={secili?.sicil ?? null} adSoyad={secili?.adSoyad} seciliId={secili?.id} kapat={() => setSecili(null)}>
        {secili && kayitAyrinti(kayitlar.find((x) => x.id === secili.id) ?? secili)}
      </FazlaMesaiPersonel>

      <OnayPenceresi kayit={onay} kapat={() => setOnay(null)} bitti={() => { setOnay(null); getir(); }} />
      <RedPenceresi kayit={red} kapat={() => setRed(null)} bitti={() => { setRed(null); getir(); }} />
    </div>
  );
}

/* ------------------------------------------------------------ onay */

function OnayPenceresi({ kayit, kapat, bitti }: { kayit: Kayit | null; kapat: () => void; bitti: () => void }) {
  const { message } = AntdApp.useApp();
  const [dosya, setDosya] = useState<File | null>(null);
  const [isleniyor, setIsleniyor] = useState(false);

  useEffect(() => {
    setDosya(null);
  }, [kayit?.id]);

  const yukluVar = !!kayit?.belgeVar;

  const tamam = async () => {
    if (!kayit) return;

    setIsleniyor(true);
    try {
      if (dosya) {
        const form = new FormData();
        form.append("dosya", dosya);
        await api.dosyaGonder<any>(`/api/FazlaMesai/${kayit.id}/Belge`, form);
      }

      await api.gonder(`/api/FazlaMesai/${kayit.id}/Karar`, { onay: true });
      message.success(`${kayit.adSoyad} · fazla mesai onaylandı.`);
      bitti();
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setIsleniyor(false);
    }
  };

  const yalnizYukle = async () => {
    if (!kayit || !dosya) return;
    setIsleniyor(true);
    try {
      const form = new FormData();
      form.append("dosya", dosya);
      await api.dosyaGonder<any>(`/api/FazlaMesai/${kayit.id}/Belge`, form);
      message.success("Islak imzalı form yüklendi.");
      bitti();
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setIsleniyor(false);
    }
  };

  return (
    <Modal
      open={!!kayit}
      onCancel={kapat}
      title="Fazla mesaiyi onayla"
      okText={dosya ? "Yükle ve onayla" : "Onayla"}
      cancelText="Vazgeç"
      confirmLoading={isleniyor}
      onOk={tamam}
      width={520}
      footer={(_, { OkBtn, CancelBtn }) => (
        <>
          <CancelBtn />
          {dosya && (
            <button type="button" className="it-dg" onClick={yalnizYukle} disabled={isleniyor} style={{ marginRight: 8 }}>
              Yalnızca yükle
            </button>
          )}
          <OkBtn />
        </>
      )}
    >
      {kayit && (
        <div className="fm-pencere">
          <div className="fm-ozet">
            <b><PersonelAdi kod={kayit.sicil}>{kayit.adSoyad}</PersonelAdi></b>
            <span>
              {dayjs(kayit.tarih).format("DD.MM.YYYY dddd")} · {kayit.baslangic}–{kayit.bitis} · {kayit.sure}
            </span>
            <small>{kayit.aciklama}</small>
          </div>

          <p className="fm-bilgi">
            Formda çalışanın, birim yöneticisinin ({kayit.birimYonetici ?? "—"}) ve bölge müdürünün (
            {kayit.bolgeMuduru ?? "—"}) imzası olmalı. Form yüklemek isteğe bağlıdır;
            yüklerseniz personelin belgelerine "Fazla Mesai Formu" olarak kaydedilir.
          </p>

          {yukluVar && !dosya ? (
            <div className="fm-yuklu">
              <FileCheck2 size={16} /> Form daha önce yüklendi ({kayit.belgeYukleyen}). İsterseniz yenisini seçin.
            </div>
          ) : null}

          <label className="fm-dosya">
            <Upload size={16} />
            <span>{dosya ? dosya.name : "Dosya seçin (PDF, JPG, PNG) · isteğe bağlı"}</span>
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.heic,.webp,.doc,.docx"
              onChange={(e) => setDosya(e.target.files?.[0] ?? null)}
            />
          </label>

          <div className="tarama-satir">
            <TaramaDugmesi boyut="small" ad="fazla-mesai-formu" onDosya={setDosya} />
            <span>Form tarayıcıdaysa taranıp PDF olarak eklenir.</span>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------ red */

function RedPenceresi({ kayit, kapat, bitti }: { kayit: Kayit | null; kapat: () => void; bitti: () => void }) {
  const { message } = AntdApp.useApp();
  const [sebep, setSebep] = useState("");
  const [isleniyor, setIsleniyor] = useState(false);

  useEffect(() => setSebep(""), [kayit?.id]);

  const tamam = async () => {
    if (!kayit) return;
    if (sebep.trim().length < 3) {
      message.warning("Reddetme sebebini yazınız; giren yönetici ve personel görür.");
      return;
    }
    setIsleniyor(true);
    try {
      await api.gonder(`/api/FazlaMesai/${kayit.id}/Karar`, { onay: false, not: sebep.trim() });
      message.success("Fazla mesai reddedildi.");
      bitti();
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setIsleniyor(false);
    }
  };

  return (
    <Modal
      open={!!kayit}
      onCancel={kapat}
      title="Fazla mesaiyi reddet"
      okText="Reddet"
      okButtonProps={{ danger: true }}
      cancelText="Vazgeç"
      confirmLoading={isleniyor}
      onOk={tamam}
    >
      {kayit && (
        <div className="fm-pencere">
          <div className="fm-ozet">
            <b><PersonelAdi kod={kayit.sicil}>{kayit.adSoyad}</PersonelAdi></b>
            <span>
              {dayjs(kayit.tarih).format("DD.MM.YYYY")} · {kayit.baslangic}–{kayit.bitis} · {kayit.sure}
            </span>
          </div>
          <Input.TextArea
            rows={3}
            value={sebep}
            onChange={(e) => setSebep(e.target.value)}
            placeholder="Sebep (giren yönetici ve personel bildirimle görür)"
            maxLength={500}
          />
        </div>
      )}
    </Modal>
  );
}
