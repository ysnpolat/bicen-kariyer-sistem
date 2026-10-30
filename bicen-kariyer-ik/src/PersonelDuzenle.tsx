/**
 * ---------------------------------------------------------------------------
 * Personel bilgilerini düzenleme (personel kartı → "Düzenle")
 * ---------------------------------------------------------------------------
 * Kimlik, iletişim, görev ve adres bilgileri DOĞRUDAN MİKRO'YA yazılır
 * (PERSONELLER tablosu, yalnızca panelin zaten okuduğu kolonlar). Yol ücreti
 * Mikro'da tutulmuyor; kariyer sistemindeki KRY_PERSONEL_YOL'a yazılır.
 *
 * Ücret, giriş/çıkış tarihi, TC kimlik, SGK, çıkış sebebi ve personel kodu
 * bordro ve yasal bildirimleri etkilediği için burada salt okunur; Mikro'dan
 * değiştirilir. Asıl denetim sunucuda (PersonelMikroController).
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  App as AntdApp,
  AutoComplete,
  Button,
  Input,
  InputNumber,
  Modal,
  Select,
  Spin,
  Tag,
  Tooltip,
} from "antd";
import dayjs from "dayjs";
import {
  BriefcaseBusiness,
  BusFront,
  Contact,
  History,
  Lock,
  MapPin,
  RefreshCw,
  SquarePen,
} from "lucide-react";

import { api } from "./api";
import { ilceleriGetir, mahalleleriGetir, ADRES_VERISI } from "./adresVerisi";

interface MikroAlan {
  anahtar: string;
  etiket: string;
  kolon: string;
  tur: "metin" | "telefon" | "isGrubu";
  grup: "kimlik" | "gorev" | "adres";
  zorunlu: boolean;
  deger: string | null;
  uzunluk: number;
  duzenlenebilir: boolean;
  neden?: string | null;
}

interface GecmisSatiri {
  id: number;
  alan: string;
  eski: string | null;
  yeni: string | null;
  yapan: string | null;
  zaman: string;
  hedef: "MIKRO" | "KARIYER";
  durum: string;
}

interface FormVerisi {
  personelKodu: string;
  mikro: { alanlar: MikroAlan[]; isGruplari: { kod: string; ad: string }[] };
  yol: { tutar: number; aciklama: string | null; guncelleyen?: string; guncelleme?: string } | null;
  yolGizli: boolean;
  gecmis: GecmisSatiri[];
}

/** Sunucudaki YoneticiBulucu.TelefonSadelestir ile aynı kural */
const telefonSadelestir = (ham: string): string | null => {
  let t = (ham ?? "").replace(/\D/g, "");
  if (t.startsWith("90") && t.length === 12) t = t.slice(2);
  if (t.startsWith("0") && t.length === 11) t = t.slice(1);
  return t.length === 10 && t.startsWith("5") ? t : null;
};

/** Sunucudaki gibi: boşluklar teke iner, baş ve son kırpılır */
const sadele = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

const BOLUMLER: { grup: MikroAlan["grup"]; baslik: string; ikon: JSX.Element }[] = [
  { grup: "kimlik", baslik: "Kimlik ve iletişim", ikon: <Contact size={15} strokeWidth={2} /> },
  { grup: "gorev", baslik: "Görev", ikon: <BriefcaseBusiness size={15} strokeWidth={2} /> },
  { grup: "adres", baslik: "Adres", ikon: <MapPin size={15} strokeWidth={2} /> },
];

/** Adres alanlarının ızgaradaki genişliği (12'lik ızgarada) */
const GENISLIK: Record<string, number> = {
  ad: 4, soyad: 4, telefon: 4,
  isGrubu: 6, meslek: 6,
  adrIl: 4, adrIlce: 4, adrSemt: 4,
  adrMahalle: 6, adrCadde: 6,
  adrSokak: 6, adrApartmanNo: 3, adrDaireNo: 3,
};

export default function PersonelDuzenle({
  acik,
  kod,
  adSoyad,
  pozisyonlar,
  salt,
  kapat,
  kaydedildi,
}: {
  acik: boolean;
  kod: string;
  adSoyad: string;
  /** Ünvan önerileri: listedeki mevcut ünvanlar */
  pozisyonlar: string[];
  /** Mikro'dan değiştirilen, burada yalnızca gösterilen alanlar */
  salt: { etiket: string; deger: string }[];
  kapat: () => void;
  kaydedildi: () => void;
}) {
  const { message, modal } = AntdApp.useApp();

  const [veri, setVeri] = useState<FormVerisi | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [kaydediliyor, setKaydediliyor] = useState(false);

  const [degerler, setDegerler] = useState<Record<string, string>>({});
  const [yolTutar, setYolTutar] = useState<number | null>(null);
  const [yolAciklama, setYolAciklama] = useState("");
  const [gecmisAcik, setGecmisAcik] = useState(false);

  const yukle = useCallback(async () => {
    if (!kod) return;

    setYukleniyor(true);
    setHata(null);

    try {
      const d = await api.al<FormVerisi>(`/api/Personel/${encodeURIComponent(kod)}/Mikro`);
      setVeri(d);

      const ilk: Record<string, string> = {};
      (d.mikro?.alanlar ?? []).forEach((a) => (ilk[a.anahtar] = a.deger ?? ""));
      setDegerler(ilk);

      setYolTutar(d.yol?.tutar ?? null);
      setYolAciklama(d.yol?.aciklama ?? "");
    } catch (h: any) {
      setHata(h.message);
      setVeri(null);
    } finally {
      setYukleniyor(false);
    }
  }, [kod]);

  useEffect(() => {
    if (acik) {
      setGecmisAcik(false);
      yukle();
    } else {
      setVeri(null);
      setHata(null);
    }
  }, [acik, yukle]);

  const alanlar = veri?.mikro?.alanlar ?? [];

  /* ------------------------------------------------------------ değişenler */

  const ilkDeger = (a: MikroAlan) => a.deger ?? "";

  const degistiMi = (a: MikroAlan) => {
    if (!a.duzenlenebilir) return false;
    const yeni = degerler[a.anahtar] ?? "";
    const ilk = ilkDeger(a);

    if (sadele(yeni) === sadele(ilk)) return false;

    /* Telefon farklı biçimde yazılmış aynı numaraysa değişmiş sayılmaz */
    if (a.tur === "telefon")
      return (telefonSadelestir(yeni) ?? sadele(yeni)) !== (telefonSadelestir(ilk) ?? sadele(ilk));

    return true;
  };

  const alanHatasi = (a: MikroAlan): string | null => {
    if (!degistiMi(a)) return null;
    const yeni = sadele(degerler[a.anahtar]);

    if (a.zorunlu && !yeni) return `${a.etiket} boş bırakılamaz`;
    if (a.tur === "telefon" && !telefonSadelestir(yeni))
      return "5 ile başlayan 10 haneli olmalı";
    if (a.uzunluk > 0 && yeni.length > a.uzunluk)
      return `Mikro'da en fazla ${a.uzunluk} karakter`;

    return null;
  };

  const mikroDegisenler = alanlar.filter(degistiMi);
  const hatalar = alanlar.map(alanHatasi).filter(Boolean);

  const yolTutarDegisti = !!veri && !veri.yolGizli && (yolTutar ?? null) !== (veri.yol?.tutar ?? null);
  const yolAciklamaDegisti =
    !!veri && !veri.yolGizli && yolTutar != null && sadele(yolAciklama) !== sadele(veri.yol?.aciklama);
  const yolDegisti = yolTutarDegisti || yolAciklamaDegisti;

  const degisenSayisi = mikroDegisenler.length + (yolDegisti ? 1 : 0);

  /* ------------------------------------------------------------ seçenekler */

  const isGrubuSecenekleri = useMemo(() => {
    const gruplar = veri?.mikro?.isGruplari ?? [];
    const mevcut = alanlar.find((a) => a.anahtar === "isGrubu")?.deger ?? "";

    const secenekler = gruplar.map((g) => ({
      value: g.kod,
      label: `${g.ad} (${g.kod})`,
    }));

    if (mevcut && !gruplar.some((g) => g.kod === mevcut))
      secenekler.unshift({ value: mevcut, label: `${mevcut} — Mikro'da tanımsız` });

    return secenekler;
  }, [veri, alanlar]);

  /** Mikro il adı büyük harfli olabilir ("İSTANBUL"); adres verisindeki karşılığı */
  const ilAnahtari = (il: string) =>
    Object.keys(ADRES_VERISI).find(
      (k) => k.toLocaleUpperCase("tr") === sadele(il).toLocaleUpperCase("tr")
    );

  const oneriler = (anahtar: string): string[] => {
    const il = ilAnahtari(degerler.adrIl ?? "");

    if (anahtar === "adrIl") return Object.keys(ADRES_VERISI);
    if (anahtar === "adrIlce") return ilceleriGetir(il);
    if (anahtar === "adrMahalle") {
      const ilce = ilceleriGetir(il).find(
        (x) => x.toLocaleUpperCase("tr") === sadele(degerler.adrIlce).toLocaleUpperCase("tr")
      );
      return mahalleleriGetir(il, ilce);
    }
    if (anahtar === "meslek") return pozisyonlar;

    return [];
  };

  /* ------------------------------------------------------------- kaydet */

  const kaydet = async () => {
    if (!veri) return;

    if (hatalar.length > 0) {
      message.warning("Kırmızı işaretli alanları düzeltin.");
      return;
    }

    if (degisenSayisi === 0) {
      message.info("Değişiklik yok.");
      return;
    }

    /* Ad ve soyad bordro, SGK ve Biçen Kart kayıtlarında da geçiyor; ayrıca onay */
    const adDegisti = mikroDegisenler.some((a) => a.anahtar === "ad" || a.anahtar === "soyad");

    if (adDegisti) {
      const onay = await modal.confirm({
        title: "Ad / soyad Mikro'da değişecek",
        content:
          "Ad ve soyad nüfus kaydıyla aynı olmalı; bordro ve SGK bildirimleri bu bilgiyi kullanır. Değişiklik doğru mu?",
        okText: "Evet, değiştir",
        cancelText: "Vazgeç",
      });

      if (!onay) return;
    }

    setKaydediliyor(true);

    try {
      const mesajlar: string[] = [];

      if (mikroDegisenler.length > 0) {
        const gonderilen: Record<string, string> = {};
        const onceki: Record<string, string> = {};

        mikroDegisenler.forEach((a) => {
          const yeni = sadele(degerler[a.anahtar]);
          gonderilen[a.anahtar] = a.tur === "telefon" ? telefonSadelestir(yeni) ?? yeni : yeni;
          onceki[a.anahtar] = ilkDeger(a);
        });

        /* PUT de kabul ediliyor; IIS'te WebDAV'a takılmasın diye POST */
        const s = await api.gonder<{ mesaj: string }>(
          `/api/Personel/${encodeURIComponent(kod)}/Mikro`,
          { degerler: gonderilen, onceki }
        );

        mesajlar.push(s?.mesaj || "Mikro'da güncellendi");
      }

      if (yolDegisti) {
        const s = await api.gonder<{ mesaj: string }>(
          `/api/YolUcreti/Personel/${encodeURIComponent(kod)}`,
          { tutar: yolTutar, aciklama: sadele(yolAciklama) || null }
        );

        mesajlar.push(s?.mesaj || "Yol ücreti kaydedildi");
      }

      message.success(mesajlar.join(" · "));
      kaydedildi();
      kapat();
    } catch (h: any) {
      message.error({ content: h.message, duration: 7 });

      /* Mikro'da başkası değiştirmişse güncel hâl yeniden okunur */
      if (/değiştirilmiş|formu yeniden/i.test(h.message ?? "")) yukle();
    } finally {
      setKaydediliyor(false);
    }
  };

  /* --------------------------------------------------------------- çizim */

  const alanCiz = (a: MikroAlan) => {
    const deger = degerler[a.anahtar] ?? "";
    const hataMetni = alanHatasi(a);
    const degisti = degistiMi(a);
    const ayarla = (v: string) => setDegerler((d) => ({ ...d, [a.anahtar]: v }));

    let girdi: JSX.Element;

    if (!a.duzenlenebilir) {
      girdi = (
        <Tooltip title={a.neden}>
          <Input value={a.deger ?? "—"} disabled prefix={<Lock size={13} />} />
        </Tooltip>
      );
    } else if (a.tur === "isGrubu") {
      girdi = (
        <Select
          showSearch
          value={deger || undefined}
          options={isGrubuSecenekleri}
          onChange={(v) => ayarla(v)}
          optionFilterProp="label"
          placeholder="Şube seçin"
          status={hataMetni ? "error" : undefined}
          style={{ width: "100%" }}
        />
      );
    } else if (oneriler(a.anahtar).length > 0 || a.anahtar === "meslek") {
      const q = sadele(deger).toLocaleLowerCase("tr");

      girdi = (
        <AutoComplete
          value={deger}
          onChange={(v) => ayarla(v)}
          options={oneriler(a.anahtar)
            .filter((x) => !q || x.toLocaleLowerCase("tr").includes(q))
            .slice(0, 50)
            .map((x) => ({ value: x }))}
          status={hataMetni ? "error" : undefined}
          style={{ width: "100%" }}
        >
          <Input maxLength={a.uzunluk > 0 ? a.uzunluk : undefined} />
        </AutoComplete>
      );
    } else {
      girdi = (
        <Input
          value={deger}
          onChange={(e) => ayarla(e.target.value)}
          maxLength={a.uzunluk > 0 ? a.uzunluk : undefined}
          inputMode={a.tur === "telefon" ? "tel" : undefined}
          placeholder={a.tur === "telefon" ? "5XX XXX XX XX" : undefined}
          status={hataMetni ? "error" : undefined}
        />
      );
    }

    return (
      <div
        key={a.anahtar}
        className={`pdz-alan${degisti && !hataMetni ? " pdz-degisti" : ""}`}
        style={{ gridColumn: `span ${GENISLIK[a.anahtar] ?? 6}` }}
      >
        <label>
          {a.etiket}
          {a.zorunlu && a.duzenlenebilir && <i>*</i>}
          {degisti && !hataMetni && <em>değişti</em>}
        </label>
        {girdi}
        {hataMetni ? (
          <div className="pdz-hata">{hataMetni}</div>
        ) : degisti ? (
          <div className="pdz-eski">
            Mikro'daki: {ilkDeger(a) || "boş"}
          </div>
        ) : null}
      </div>
    );
  };

  const gecmis = veri?.gecmis ?? [];

  return (
    <Modal
      open={acik}
      onCancel={kapat}
      width="min(860px, 96vw)"
      className="pdz-modal"
      destroyOnClose
      title={
        <div className="pdz-baslik">
          <span className="pdz-baslik-ikon">
            <SquarePen size={18} strokeWidth={2} />
          </span>
          <div>
            <div>Personel bilgilerini düzenle</div>
            <small>
              {adSoyad} · {kod}
            </small>
          </div>
        </div>
      }
      footer={
        <div className="pdz-alt">
          <span className="pdz-alt-ozet">
            {degisenSayisi > 0 ? (
              <>
                <b>{degisenSayisi}</b> alan değişti
                {mikroDegisenler.length > 0 && " · Mikro'ya yazılacak"}
              </>
            ) : (
              "Henüz değişiklik yok"
            )}
          </span>
          <Button onClick={kapat}>Vazgeç</Button>
          <Button
            type="primary"
            icon={<SquarePen size={14} strokeWidth={2} />}
            loading={kaydediliyor}
            disabled={!veri || degisenSayisi === 0 || hatalar.length > 0}
            onClick={kaydet}
          >
            Kaydet
          </Button>
        </div>
      }
    >
      {yukleniyor && !veri ? (
        <div style={{ textAlign: "center", padding: "48px 0" }}>
          <Spin />
        </div>
      ) : hata ? (
        <Alert
          type="error"
          showIcon
          message="Form açılamadı"
          description={hata}
          action={
            <Button size="small" icon={<RefreshCw size={13} />} onClick={yukle}>
              Tekrar dene
            </Button>
          }
        />
      ) : veri ? (
        <div className="pdz-govde">
          <Alert
            type="info"
            showIcon
            className="pdz-uyari"
            message={
              <>
                Bu formdaki bilgiler <b>doğrudan Mikro'ya</b> yazılır; yalnızca değiştirdiğiniz alanlar
                gönderilir ve her değişiklik kaydedilir.
              </>
            }
          />

          {BOLUMLER.map((b) => {
            const grup = alanlar.filter((a) => a.grup === b.grup);
            if (grup.length === 0) return null;

            return (
              <section className="pdz-bolum" key={b.grup}>
                <header>
                  <span className="pdz-bolum-ikon">{b.ikon}</span>
                  <b>{b.baslik}</b>
                  <Tag className="pdz-etiket-mikro">Mikro'ya yazılır</Tag>
                </header>
                <div className="pdz-izgara">{grup.map(alanCiz)}</div>
              </section>
            );
          })}

          {/* ---------------------------------------------------- yol ücreti */}
          <section className="pdz-bolum pdz-bolum-kariyer">
            <header>
              <span className="pdz-bolum-ikon">
                <BusFront size={15} strokeWidth={2} />
              </span>
              <b>Yol ücreti</b>
              <Tag className="pdz-etiket-kariyer">Kariyer sisteminde tutulur</Tag>
            </header>

            {veri.yolGizli ? (
              <div className="pdz-not">Ücret bilgisi rolünüzden gizli.</div>
            ) : (
              <>
                <div className="pdz-izgara">
                  <div
                    className={`pdz-alan${yolTutarDegisti ? " pdz-degisti" : ""}`}
                    style={{ gridColumn: "span 4" }}
                  >
                    <label>
                      Aylık tutar
                      {yolTutarDegisti && <em>değişti</em>}
                    </label>
                    <InputNumber<number>
                      value={yolTutar}
                      onChange={(v) => setYolTutar(v ?? null)}
                      min={0}
                      max={1_000_000}
                      precision={2}
                      decimalSeparator=","
                      addonAfter="TL"
                      placeholder="Yok"
                      style={{ width: "100%" }}
                    />
                  </div>
                  <div
                    className={`pdz-alan${yolAciklamaDegisti ? " pdz-degisti" : ""}`}
                    style={{ gridColumn: "span 8" }}
                  >
                    <label>
                      Açıklama
                      {yolAciklamaDegisti && <em>değişti</em>}
                    </label>
                    <Input
                      value={yolAciklama}
                      onChange={(e) => setYolAciklama(e.target.value)}
                      maxLength={200}
                      disabled={yolTutar == null}
                      placeholder="İsteğe bağlı (ör. servis güzergâhı)"
                    />
                  </div>
                </div>
                <div className="pdz-not">
                  Mikro'ya yazılmaz; Yönetim → Yol Ücretleri ile aynı kayıttır. Tutarı silerseniz
                  personelin yol ücreti kaydı kaldırılır.
                  {veri.yol?.guncelleyen && (
                    <>
                      {" "}Son güncelleyen: {veri.yol.guncelleyen}
                      {veri.yol.guncelleme && ` · ${dayjs(veri.yol.guncelleme).format("DD.MM.YYYY")}`}
                    </>
                  )}
                </div>
              </>
            )}
          </section>

          {/* ------------------------------------------- Mikro'dan değişenler */}
          {salt.length > 0 && (
            <section className="pdz-bolum pdz-bolum-salt">
              <header>
                <span className="pdz-bolum-ikon">
                  <Lock size={14} strokeWidth={2} />
                </span>
                <b>Mikro'dan değiştirilir</b>
              </header>
              <div className="pdz-salt">
                {salt.map((s) => (
                  <div key={s.etiket}>
                    <span>{s.etiket}</span>
                    <b>{s.deger || "—"}</b>
                  </div>
                ))}
              </div>
              <div className="pdz-not">
                Ücret, giriş/çıkış tarihi, TC kimlik, SGK, çıkış sebebi ve personel kodu bordro ve yasal
                bildirimleri etkilediği için yalnızca Mikro'dan değiştirilir.
              </div>
            </section>
          )}

          {/* ------------------------------------------------ son değişiklikler */}
          <section className="pdz-gecmis">
            <button type="button" className="pdz-gecmis-dugme" onClick={() => setGecmisAcik(!gecmisAcik)}>
              <History size={14} strokeWidth={2} />
              Son değişiklikler
              <Tag>{gecmis.length}</Tag>
              <span className="pdz-gecmis-ok">{gecmisAcik ? "▾" : "▸"}</span>
            </button>

            {gecmisAcik &&
              (gecmis.length === 0 ? (
                <div className="pdz-not" style={{ padding: "6px 2px" }}>
                  Panelden yapılmış değişiklik yok.
                </div>
              ) : (
                <div className="pdz-gecmis-liste">
                  {gecmis.map((g) => (
                    <div className="pdz-gecmis-satir" key={g.id}>
                      <span className="pdz-gecmis-zaman">
                        {dayjs(g.zaman).format("DD.MM.YYYY HH:mm")}
                      </span>
                      <b>{g.alan}</b>
                      <span className="pdz-gecmis-deger">
                        <s>{g.eski || "boş"}</s> → {g.yeni || "boş"}
                      </span>
                      <Tag color={g.hedef === "MIKRO" ? "green" : "blue"}>
                        {g.hedef === "MIKRO" ? "Mikro" : "Kariyer"}
                      </Tag>
                      {g.durum === "BASARISIZ" && <Tag color="red">yazılamadı</Tag>}
                      {g.durum === "YAZILIYOR" && <Tag color="orange">tamamlanmadı</Tag>}
                      {g.yapan && <span className="pdz-gecmis-yapan">{g.yapan}</span>}
                    </div>
                  ))}
                </div>
              ))}
          </section>
        </div>
      ) : null}
    </Modal>
  );
}
