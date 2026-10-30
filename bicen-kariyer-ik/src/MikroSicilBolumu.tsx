/**
 * Mikro Sicil Kartı (09.10.2026)
 * ---------------------------------------------------------------------------
 * İşe Al penceresinin alt bölümü: "Mikro'da sicil kartını aç" seçilirse
 * aday bilgileri başvurudan doldurulur, İK eksikleri tamamlar. Kart işe
 * alım onaylanınca MikroDesktop_2004BICEN'de (GYRSM) açılır; reddedilirse
 * açılmaz. MikroDesktop_BICEN (RSM) yalnızca okunur, ona hiçbir şey
 * yazılmaz.
 *
 * Başvuru kartındaki durum şeridi (MikroSicilDurumu) aynı dosyada.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormInstance } from "antd";
import {
  Alert,
  App as AntdApp,
  Button,
  Checkbox,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Radio,
  Segmented,
  Select,
  Skeleton,
  Space,
  Switch,
  Tag,
  Tooltip,
} from "antd";
import dayjs from "dayjs";
import { ShieldCheck, Database, Hash, Contact as IdCard, MapPin, Briefcase, UserRound, RefreshCw, CircleCheck, CircleAlert, Clock } from "lucide-react";
import { api } from "./api";
import "./MikroSicilBolumu.css";

interface Unvan {
  kod: string;
  ad: string;
  adet: number;
  meslek?: string;
  gorev?: string;
  meslekKodu?: string;
  bolum?: string;
}

interface Hazirlik {
  oneri: Record<string, any>;
  sonrakiKod: number;
  mikroKullanici: { no: number; ad?: string } | null;
  isGruplari: { kod: string; ad: string }[];
  birimEsleme: Record<string, string>;
  unvanlar: Unvan[];
  tahsiller: { kod: number; ad: string }[];
  gyrsm?: {
    aktif?: { kod: string; birim?: string; giris?: string } | null;
    eski?: { kod: string; birim?: string; cikis?: string } | null;
    adet: number;
  } | null;
  rsm?: { var: boolean | null; aktif: boolean; kod?: string; mesaj: string } | null;
  kayit?: SicilKaydi | null;
}

export interface SicilKaydi {
  id: number;
  durum: "bekliyor" | "aciliyor" | "acildi" | "hata" | "iptal";
  isteyen?: string;
  mikroKullaniciNo?: number;
  sicil?: string;
  hata?: string;
  olusturma: string;
  acilma?: string;
  deneme: number;
}

const tarih = (v?: string | null) => (v ? dayjs(v).format("DD.MM.YYYY") : "");

const buyuk = (v: string) => (v ?? "").toLocaleUpperCase("tr");

const sade = (v?: string) =>
  (v ?? "")
    .toLocaleUpperCase("tr")
    .replace(/İ/g, "I")
    .replace(/[^A-Z0-9ÇĞÖŞÜ ]/g, "")
    .trim();

/** TC kimlik algoritması */
const tcGecerli = (tc: string) => {
  if (!/^[1-9]\d{10}$/.test(tc)) return false;
  const d = tc.split("").map(Number);
  const on = ((d[0] + d[2] + d[4] + d[6] + d[8]) * 7 - (d[1] + d[3] + d[5] + d[7])) % 10;
  if ((on + 10) % 10 !== d[9]) return false;
  return d.slice(0, 10).reduce((a, b) => a + b, 0) % 10 === d[10];
};

/** TR IBAN mod-97 */
const ibanGecerli = (ham: string) => {
  const s = ham.replace(/\s/g, "").toUpperCase();
  if (!/^TR\d{24}$/.test(s)) return false;
  const yeni = s.slice(4) + s.slice(0, 4);
  let mod = 0;
  for (const c of yeni) {
    const p = /[A-Z]/.test(c) ? String(c.charCodeAt(0) - 55) : c;
    for (const x of p) mod = (mod * 10 + Number(x)) % 97;
  }
  return mod === 1;
};

const ibanBicim = (v: string) =>
  v
    .replace(/[^0-9A-Za-z]/g, "")
    .toUpperCase()
    .slice(0, 26)
    .replace(/(.{4})/g, "$1 ")
    .trim();

const yasHesapla = (d?: dayjs.Dayjs | null) => (d ? dayjs().diff(d, "year") : null);

interface Props {
  basvuruId: number;
  acik: boolean;
  acikDegisti: (v: boolean) => void;
  form: FormInstance;
  /** İşe Al formundaki seçimler: rotasyon birimi, pozisyon, anlaşılan ücret */
  subeKodu?: string;
  bolum?: string;
  ucret?: number | null;
}

export default function MikroSicilBolumu({ basvuruId, acik, acikDegisti, form, subeKodu, bolum, ucret }: Props) {
  const [veri, setVeri] = useState<Hazirlik | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  const dolduruldu = useRef<number | null>(null);
  const elleUcret = useRef(false);
  const elleUnvan = useRef(false);

  /* Pencere başka başvuru için açılınca sıfırla */
  useEffect(() => {
    setVeri(null);
    setHata(null);
    dolduruldu.current = null;
    elleUcret.current = false;
    elleUnvan.current = false;
  }, [basvuruId]);

  const getir = async () => {
    setYukleniyor(true);
    setHata(null);
    try {
      const c = await api.al<{ veri: Hazirlik }>(`/api/MikroSicil/Hazirla/${basvuruId}`);
      setVeri(c.veri);
    } catch (e: any) {
      setHata(e.message);
    } finally {
      setYukleniyor(false);
    }
  };

  useEffect(() => {
    if (acik && !veri && !yukleniyor) getir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acik, basvuruId]);

  /* İlk doldurma: başvurudan gelen öneri */
  useEffect(() => {
    if (!veri || dolduruldu.current === basvuruId) return;
    dolduruldu.current = basvuruId;
    const o = veri.oneri ?? {};
    form.setFieldsValue({
      ad: o.ad || undefined,
      soyad: o.soyad || undefined,
      tcKimlikNo: o.tcKimlikNo || undefined,
      cinsiyet: undefined,
      dogumTarihi: o.dogumTarihi ? dayjs(o.dogumTarihi) : undefined,
      dogumYeri: o.dogumYeri || undefined,
      medeniHal: o.medeniHal || undefined,
      tahsil: o.tahsil ?? undefined,
      telefon: o.telefon || undefined,
      il: o.il || "İSTANBUL",
      ilce: o.ilce || undefined,
      semt: o.semt || undefined,
      mahalle: o.mahalle || undefined,
      cadde: o.cadde || undefined,
      sokak: o.sokak || undefined,
      binaNo: o.binaNo || undefined,
      daireNo: o.daireNo || undefined,
      isGrubuKodu: (subeKodu && veri.birimEsleme?.[subeKodu]) || o.isGrubuKodu || undefined,
      ucret: ucret ?? o.ucret ?? undefined,
      brutNet: "net",
      asgariUcretli: false,
      iban: undefined,
      bes: o.bes ?? true,
      sigortaGrubu: 0,
      sakatDerece: o.sakatDerece ?? 0,
      engellilikOrani: o.engellilikOrani ?? undefined,
    });
    unvanBul(bolum);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [veri]);

  /* Rotasyon: çalışacağı birim değişince iş grubu da değişsin */
  useEffect(() => {
    if (!veri || !subeKodu) return;
    const ig = veri.birimEsleme?.[subeKodu];
    if (ig) form.setFieldValue("isGrubuKodu", ig);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subeKodu]);

  /* Pozisyon → Mikro ünvanı */
  const unvanBul = (b?: string) => {
    if (!veri || !b || elleUnvan.current) return;
    const a = sade(b.split(",")[0]);
    const u =
      veri.unvanlar.find((x) => sade(x.bolum) === a) ??
      veri.unvanlar.find((x) => sade(x.ad) === a) ??
      veri.unvanlar.find((x) => sade(x.meslek) === a);
    if (u) form.setFieldsValue({ unvanKodu: u.kod, meslek: u.meslek || u.ad });
  };

  useEffect(() => {
    unvanBul(bolum);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bolum]);

  /* Anlaşılan ücret → kart ücreti (elle değiştirilmediyse) */
  useEffect(() => {
    if (!veri || elleUcret.current || ucret == null) return;
    form.setFieldValue("ucret", ucret);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ucret]);

  const unvanKodu = Form.useWatch("unvanKodu", form);
  const sakatDerece = Form.useWatch("sakatDerece", form);
  const dogum = Form.useWatch("dogumTarihi", form);
  const secilenUnvan = useMemo(() => veri?.unvanlar.find((x) => x.kod === unvanKodu), [veri, unvanKodu]);
  const yas = yasHesapla(dogum);

  const kullaniciYok = veri && !veri.mikroKullanici;
  const aktifVar = !!veri?.gyrsm?.aktif;

  return (
    <section className={`ms-kutu${acik ? " ms-acik" : ""}`}>
      <header className="ms-baslik">
        <span className="ms-simge">
          <Database size={16} strokeWidth={2.2} />
        </span>
        <div className="ms-baslik-metin">
          <b>Mikro'da sicil kartını aç</b>
          <span>GYRSM · MikroDesktop_2004BICEN — işe alım onaylanınca otomatik açılır, reddedilirse açılmaz</span>
        </div>
        <Switch
          checked={acik}
          onChange={(v) => acikDegisti(v)}
          checkedChildren="Açılsın"
          unCheckedChildren="Hayır"
        />
      </header>

      {acik && (
        <div className="ms-govde">
          {yukleniyor && !veri && <Skeleton active paragraph={{ rows: 4 }} />}

          {hata && (
            <Alert
              type="error"
              showIcon
              message="Mikro bilgileri alınamadı"
              description={hata}
              action={
                <Button size="small" icon={<RefreshCw size={13} />} onClick={getir}>
                  Tekrar dene
                </Button>
              }
            />
          )}

          {veri && (
            <>
              {/* ---------------------------------------------- özet şeridi */}
              <div className="ms-serit">
                <div className="ms-serit-kalem">
                  <Hash size={14} />
                  <span>Açılacak personel kodu</span>
                  <b>≈ {veri.sonrakiKod}</b>
                  <Tooltip title="per_kod: Mikro'da en son açılan kartın numarasının bir fazlası (sicil no alanına T.C. kimlik no yazılır). Kart açıldığı anda kesinleşir; o arada Mikro'dan kart açılırsa sıradaki boş numara verilir.">
                    <i>onayda kesinleşir</i>
                  </Tooltip>
                </div>
                <div className="ms-serit-kalem">
                  <UserRound size={14} />
                  <span>Mikro kullanıcısı</span>
                  {veri.mikroKullanici ? (
                    <b>
                      {veri.mikroKullanici.no}
                      {veri.mikroKullanici.ad ? ` · ${veri.mikroKullanici.ad}` : ""}
                    </b>
                  ) : (
                    <Tag color="red" style={{ margin: 0 }}>
                      tanımlı değil
                    </Tag>
                  )}
                </div>
                <div className="ms-serit-kalem">
                  <span className={`ms-nokta ${aktifVar ? "kirmizi" : "yesil"}`} />
                  <span>GYRSM</span>
                  <b>{aktifVar ? `aktif sicil var · ${veri.gyrsm!.aktif!.kod}` : veri.gyrsm?.eski ? "eski kaydı var" : "kaydı yok"}</b>
                </div>
                <div className="ms-serit-kalem">
                  <span className={`ms-nokta ${veri.rsm?.aktif ? "turuncu" : "gri"}`} />
                  <span>RSM</span>
                  <b>{veri.rsm ? veri.rsm.mesaj.replace(/^RSM'de /, "") : "—"}</b>
                </div>
              </div>

              {kullaniciYok && (
                <Alert
                  type="error"
                  showIcon
                  className="ms-uyari"
                  message="Mikro kullanıcı numaranız tanımlı değil"
                  description="Kart sizin Mikro kullanıcınızla açılır. Yönetim › Kullanıcılar'da hesabınıza Mikro kullanıcı numaranızı yazdırın (ör. 130)."
                />
              )}

              {aktifVar && (
                <Alert
                  type="error"
                  showIcon
                  className="ms-uyari"
                  message={`Bu T.C. ile GYRSM'de aktif sicil var: ${veri.gyrsm!.aktif!.kod}${veri.gyrsm!.aktif!.birim ? ` · ${veri.gyrsm!.aktif!.birim}` : ""}`}
                  description="Hâlen çalışan bir personele yeni kart açılmaz. Birim değişikliği ise Mikro kaydı açmadan rotasyonla yapılır; bu seçeneği kapatın."
                />
              )}

              {!aktifVar && veri.gyrsm?.eski && (
                <Alert
                  type="info"
                  showIcon
                  className="ms-uyari"
                  message={`Daha önce ${veri.gyrsm.eski.kod} sicilinde çalışmış${veri.gyrsm.eski.birim ? ` (${veri.gyrsm.eski.birim})` : ""}, çıkış ${tarih(veri.gyrsm.eski.cikis)}. Eski kart değişmez; yeni personel koduyla yeni kart açılır.`}
                />
              )}

              <Form form={form} layout="vertical" requiredMark className="ms-form" size="middle">
                {/* ------------------------------------------------ kimlik */}
                <fieldset className="ms-grup">
                  <legend>
                    <IdCard size={14} /> Kimlik
                  </legend>
                  <div className="ms-izgara">
                    <Form.Item name="ad" label="Ad" rules={[{ required: true, message: "Ad giriniz." }]} normalize={buyuk}>
                      <Input maxLength={50} />
                    </Form.Item>
                    <Form.Item name="soyad" label="Soyad" rules={[{ required: true, message: "Soyad giriniz." }]} normalize={buyuk}>
                      <Input maxLength={50} />
                    </Form.Item>
                    <Form.Item
                      name="tcKimlikNo"
                      label="T.C. kimlik no"
                      normalize={(v) => String(v ?? "").replace(/\D/g, "").slice(0, 11)}
                      rules={[
                        { required: true, message: "T.C. kimlik numarası giriniz." },
                        { validator: async (_, v) => { if (v && !tcGecerli(v)) throw new Error("Geçersiz T.C. kimlik numarası."); } },
                      ]}
                    >
                      <Input inputMode="numeric" maxLength={11} />
                    </Form.Item>
                    <Form.Item name="cinsiyet" label="Cinsiyet" rules={[{ required: true, message: "Cinsiyet seçiniz." }]}>
                      <Radio.Group optionType="button" buttonStyle="solid" className="ms-ikili">
                        <Radio.Button value="E">Erkek</Radio.Button>
                        <Radio.Button value="K">Kadın</Radio.Button>
                      </Radio.Group>
                    </Form.Item>
                    <Form.Item
                      name="dogumTarihi"
                      label="Doğum tarihi"
                      extra={yas != null ? `${yas} yaşında` : undefined}
                      rules={[{ required: true, message: "Doğum tarihi giriniz." }]}
                    >
                      <DatePicker
                        format="DD.MM.YYYY"
                        style={{ width: "100%" }}
                        disabledDate={(d) => d.isAfter(dayjs().subtract(15, "year"))}
                        onChange={(d) => {
                          const y = yasHesapla(d);
                          if (y != null) form.setFieldValue("bes", y < 45);
                        }}
                      />
                    </Form.Item>
                    <Form.Item name="dogumYeri" label="Doğum yeri" normalize={buyuk}>
                      <Input maxLength={40} />
                    </Form.Item>
                    <Form.Item name="medeniHal" label="Medeni hâl" rules={[{ required: true, message: "Medeni hâli seçiniz." }]}>
                      <Radio.Group optionType="button" buttonStyle="solid" className="ms-ikili">
                        <Radio.Button value="Bekar">Bekâr</Radio.Button>
                        <Radio.Button value="Evli">Evli</Radio.Button>
                      </Radio.Group>
                    </Form.Item>
                    <Form.Item name="tahsil" label="Tahsil">
                      <Select
                        placeholder="Seçiniz"
                        options={veri.tahsiller.map((t) => ({ value: t.kod, label: `${t.ad}` }))}
                      />
                    </Form.Item>
                  </div>
                </fieldset>

                {/* ------------------------------------------ görev ve ücret */}
                <fieldset className="ms-grup">
                  <legend>
                    <Briefcase size={14} /> Görev ve ücret
                  </legend>
                  <div className="ms-izgara">
                    <Form.Item
                      name="isGrubuKodu"
                      label="Şube / iş grubu (Mikro)"
                      rules={[{ required: true, message: "İş grubunu seçiniz." }]}
                      className="ms-genis"
                    >
                      <Select
                        showSearch
                        optionFilterProp="label"
                        placeholder="Seçiniz"
                        options={veri.isGruplari.map((g) => ({ value: g.kod, label: `${g.ad} · ${g.kod}` }))}
                      />
                    </Form.Item>
                    <Form.Item
                      name="unvanKodu"
                      label="Ünvan (Mikro)"
                      rules={[{ required: true, message: "Mikro ünvanını seçiniz." }]}
                      className="ms-genis"
                      extra={
                        secilenUnvan ? (
                          <span className="ms-sablon">
                            Görev kodu <b>{secilenUnvan.gorev || "—"}</b> · SGK meslek <b>{secilenUnvan.meslekKodu || "—"}</b> ·{" "}
                            {secilenUnvan.adet} aktif personelden
                          </span>
                        ) : (
                          "Görev kodu ve SGK meslek kodu bu ünvandaki personelden alınır."
                        )
                      }
                    >
                      <Select
                        showSearch
                        optionFilterProp="label"
                        placeholder="Seçiniz"
                        onChange={(v) => {
                          elleUnvan.current = true;
                          const u = veri.unvanlar.find((x) => x.kod === v);
                          if (u) form.setFieldValue("meslek", u.meslek || u.ad);
                        }}
                        options={veri.unvanlar.map((u) => ({
                          value: u.kod,
                          label: `${u.ad}${u.meslek && sade(u.meslek) !== sade(u.ad) ? ` (${u.meslek})` : ""} · ${u.adet} kişi`,
                        }))}
                      />
                    </Form.Item>
                    <Form.Item name="meslek" label="Kartta görünen meslek" normalize={buyuk}>
                      <Input maxLength={50} />
                    </Form.Item>
                    <Form.Item
                      name="ucret"
                      label="Ücret"
                      rules={[{ required: true, message: "Ücret giriniz." }]}
                    >
                      <InputNumber
                        min={1}
                        max={9999999}
                        style={{ width: "100%" }}
                        addonAfter="TL"
                        onChange={() => (elleUcret.current = true)}
                        formatter={(v?: number | string) => `${v ?? ""}`.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}
                        parser={(v?: string) => Number((v ?? "").replace(/[^\d]/g, "")) as 1}
                      />
                    </Form.Item>
                    <Form.Item name="brutNet" label="Ücret türü">
                      <Segmented block options={[{ label: "Net", value: "net" }, { label: "Brüt", value: "brut" }]} />
                    </Form.Item>
                    <Form.Item
                      name="iban"
                      label="Maaş IBAN"
                      className="ms-genis"
                      normalize={ibanBicim}
                      extra="Boş bırakılabilir; maaş bankası IBAN'dan bulunur."
                      rules={[{ validator: async (_, v) => { if (v && !ibanGecerli(v)) throw new Error("Geçersiz IBAN (TR ile başlayan 26 karakter)."); } }]}
                    >
                      <Input placeholder="TR00 0000 0000 0000 0000 0000 00" maxLength={32} />
                    </Form.Item>
                    <div className="ms-secenekler">
                      <Form.Item name="asgariUcretli" valuePropName="checked" noStyle>
                        <Checkbox>Asgari ücretli</Checkbox>
                      </Form.Item>
                      <Form.Item name="bes" valuePropName="checked" noStyle>
                        <Checkbox>
                          Otomatik BES'e dahil{" "}
                          <Tooltip title="45 yaş altı çalışanlar otomatik katılım sistemine dahil edilir; doğum tarihine göre işaretlenir.">
                            <span className="ms-ipucu">?</span>
                          </Tooltip>
                        </Checkbox>
                      </Form.Item>
                    </div>
                  </div>
                </fieldset>

                {/* ------------------------------------ SGK ve engellilik */}
                <fieldset className="ms-grup">
                  <legend>
                    <ShieldCheck size={14} /> SGK ve engellilik
                  </legend>
                  <div className="ms-izgara">
                    <Form.Item
                      name="sigortaGrubu"
                      label="Sigorta grubu"
                      className="ms-genis"
                      rules={[{ required: true, message: "Sigorta grubunu seçiniz." }]}
                      extra="Emekli çalışanlar (SGDP) için Emekli seçin."
                    >
                      <Segmented
                        block
                        options={[
                          { label: "Normal", value: 0 },
                          { label: "Emekli", value: 1 },
                          { label: "Çırak", value: 2 },
                          { label: "Yabancı", value: 3 },
                          { label: "Öğrenci", value: 4 },
                        ]}
                      />
                    </Form.Item>
                    <Form.Item
                      name="sakatDerece"
                      label="Engellilik"
                      extra="Personel listesindeki engelli kadrosu bu alandan sayılır."
                    >
                      <Select
                        options={[
                          { value: 0, label: "Engelli değil" },
                          { value: 1, label: "1. derece (%80 ve üzeri)" },
                          { value: 2, label: "2. derece (%60–79)" },
                          { value: 3, label: "3. derece (%40–59)" },
                        ]}
                        onChange={(v) => {
                          if (!v) form.setFieldValue("engellilikOrani", undefined);
                        }}
                      />
                    </Form.Item>
                    {sakatDerece > 0 && (
                      <Form.Item name="engellilikOrani" label="Engellilik oranı">
                        <InputNumber min={1} max={100} precision={0} addonAfter="%" style={{ width: "100%" }} placeholder="Rapordaki oran" />
                      </Form.Item>
                    )}
                  </div>
                </fieldset>

                {/* --------------------------------------- iletişim ve adres */}
                <fieldset className="ms-grup">
                  <legend>
                    <MapPin size={14} /> İletişim ve adres
                  </legend>
                  <div className="ms-izgara">
                    <Form.Item
                      name="telefon"
                      label="Cep telefonu"
                      normalize={(v) => String(v ?? "").replace(/\D/g, "").replace(/^0/, "").slice(0, 10)}
                      rules={[
                        { required: true, message: "Cep telefonu giriniz." },
                        { pattern: /^5\d{9}$/, message: "5 ile başlayan 10 hane." },
                      ]}
                    >
                      <Input addonBefore="0" inputMode="numeric" maxLength={10} placeholder="5XX XXX XX XX" />
                    </Form.Item>
                    <Form.Item name="il" label="İl" normalize={buyuk}>
                      <Input maxLength={30} />
                    </Form.Item>
                    <Form.Item name="ilce" label="İlçe" normalize={buyuk}>
                      <Input maxLength={30} />
                    </Form.Item>
                    <Form.Item name="semt" label="Semt" normalize={buyuk}>
                      <Input maxLength={30} />
                    </Form.Item>
                    <Form.Item name="mahalle" label="Mahalle" normalize={buyuk}>
                      <Input maxLength={50} />
                    </Form.Item>
                    <Form.Item name="cadde" label="Cadde" normalize={buyuk}>
                      <Input maxLength={50} />
                    </Form.Item>
                    <Form.Item name="sokak" label="Sokak" normalize={buyuk}>
                      <Input maxLength={50} />
                    </Form.Item>
                    <div className="ms-ikiz">
                      <Form.Item name="binaNo" label="Bina no" normalize={buyuk}>
                        <Input maxLength={10} />
                      </Form.Item>
                      <Form.Item name="daireNo" label="Daire" normalize={buyuk}>
                        <Input maxLength={10} />
                      </Form.Item>
                    </div>
                  </div>
                </fieldset>
              </Form>

              <p className="ms-dipnot">
                Şube, departman, bölge, SGK işyeri ve Mikro'nun sabit alanları bu şubede son açılan kartlardan alınır;
                kart açılınca Mikro'dan kontrol edebilirsiniz. RSM'ye (MikroDesktop_BICEN) hiçbir kayıt yazılmaz.
              </p>
            </>
          )}
        </div>
      )}
    </section>
  );
}

/** Sunucuya gidecek gövde */
export const sicilGovdesi = (d: Record<string, any>) => ({
  ...d,
  dogumTarihi: d.dogumTarihi ? dayjs(d.dogumTarihi).format("YYYY-MM-DD") : null,
  iban: d.iban ? String(d.iban).replace(/\s/g, "") : "",
  tahsil: d.tahsil ?? null,
});

/* ========================================================================== */
/* Başvuru kartındaki durum şeridi                                            */
/* ========================================================================== */

export function MikroSicilDurumu({ basvuruId, iseAlindi, surum }: { basvuruId: number; iseAlindi: boolean; surum?: number }) {
  const { message } = AntdApp.useApp();
  const [kayit, setKayit] = useState<SicilKaydi | null>(null);
  const [isliyor, setIsliyor] = useState(false);

  const getir = () =>
    api
      .al<{ kayit: SicilKaydi | null }>(`/api/MikroSicil/Durum/${basvuruId}`)
      .then((c) => setKayit(c.kayit))
      .catch(() => setKayit(null));

  useEffect(() => {
    getir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basvuruId, surum]);

  if (!kayit || kayit.durum === "iptal") return null;

  const ac = async () => {
    setIsliyor(true);
    try {
      const c = await api.gonder<{ mesaj: string }>(`/api/MikroSicil/${basvuruId}/Ac`, {});
      message.success(c.mesaj);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setIsliyor(false);
      getir();
    }
  };

  const vazgec = async () => {
    try {
      await api.gonder(`/api/MikroSicil/${basvuruId}/Iptal`, {});
      message.info("Mikro sicil isteği kapatıldı; kartı Mikro'dan elle açabilirsiniz.");
      getir();
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const ikon =
    kayit.durum === "acildi" ? <CircleCheck size={16} /> : kayit.durum === "hata" ? <CircleAlert size={16} /> : <Clock size={16} />;

  return (
    <div className={`ms-durum ms-durum-${kayit.durum}`}>
      <span className="ms-durum-ikon">{ikon}</span>
      <div className="ms-durum-metin">
        {kayit.durum === "acildi" && (
          <>
            <b>Mikro'da sicil kartı açıldı · {kayit.sicil}</b>
            <span>
              {kayit.acilma ? dayjs(kayit.acilma).format("DD.MM.YYYY HH:mm") : ""} · Mikro kullanıcısı {kayit.mikroKullaniciNo}
              {kayit.isteyen ? ` · isteyen ${kayit.isteyen}` : ""}
            </span>
          </>
        )}
        {kayit.durum === "bekliyor" && (
          <>
            <b>Mikro sicil kartı onay bekliyor</b>
            <span>
              {iseAlindi
                ? "İşe alım onaylı; kart henüz açılmadı."
                : "İşe alım onaylanınca MikroDesktop_2004BICEN'de otomatik açılacak."}
              {kayit.isteyen ? ` · isteyen ${kayit.isteyen}` : ""}
            </span>
          </>
        )}
        {kayit.durum === "aciliyor" && (
          <>
            <b>Mikro'da sicil kartı açılıyor…</b>
            <span>Birkaç saniye sonra yenileyin.</span>
          </>
        )}
        {kayit.durum === "hata" && (
          <>
            <b>Mikro sicil kartı açılamadı</b>
            <span>{kayit.hata}</span>
          </>
        )}
      </div>
      {(kayit.durum === "hata" || kayit.durum === "bekliyor") && (
        <Space size={6} className="ms-durum-dugme">
          {iseAlindi && (
            <Button size="small" type="primary" loading={isliyor} onClick={ac}>
              {kayit.durum === "hata" ? "Tekrar dene" : "Mikro'da aç"}
            </Button>
          )}
          <Button size="small" onClick={vazgec}>
            Vazgeç
          </Button>
        </Space>
      )}
      {kayit.durum === "aciliyor" && (
        <Button size="small" icon={<RefreshCw size={13} />} onClick={getir} />
      )}
    </div>
  );
}
