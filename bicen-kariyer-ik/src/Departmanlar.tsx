/**
 * ---------------------------------------------------------------------------
 * Departmanlar (Yönetim → Departmanlar)
 * ---------------------------------------------------------------------------
 * Genel merkez ve Akçaburgaz depo için ekip tanımı. Departmana yönetici ve
 * personel atanır:
 *   - personelin izin / haftalık izin talebinin 1. onayı departman
 *     yöneticisine gider,
 *   - mobilde Ekibim'de personel yalnızca kendi departmanını görür,
 *   - yönetici puantaj, vardiya planı ve onaylarda departmanını yönetir.
 *
 * Departmanı olmayanlar için izin onay tablosu aynen geçerli; mağazalar
 * bu ekrandan etkilenmez.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  App as AntdApp,
  Button,
  Empty,
  Input,
  Popconfirm,
  Select,
  Space,
  Spin,
  Tag,
  Tooltip,
} from "antd";
import { Building2, Plus, Search, Trash2, UserPlus, Users } from "lucide-react";

import { api } from "./api";
import "./Departmanlar.css";

type Kisi = { sicil: string; adSoyad: string; pozisyon?: string | null; isYeri?: string | null };

type Personel = Kisi & {
  isYeriTuru: string;
  departmanId: number | null;
  yonettigi: number[];
};

type Departman = {
  id: number;
  ad: string;
  isYeri?: string | null;
  aciklama?: string | null;
  sira: number;
  yoneticiler: Kisi[];
  personeller: Kisi[];
};

type Taslak = {
  id: number | null;
  ad: string;
  isYeri: string | undefined;
  aciklama: string;
  yoneticiler: string[];
  personeller: string[];
};

const K = (s: string) => (s ?? "").trim().replace(/^0+/, "");

/** "Z.MERKEZ BURO" → "Genel Merkez" gibi okunur ad */
const yerAdi = (y?: string | null) => {
  const a = (y ?? "").toLocaleLowerCase("tr");
  if (a.includes("merkez")) return "Genel Merkez";
  if (a.includes("depo")) return "Akçaburgaz Depo";
  return y || "Diğer";
};

const basHarf = (ad: string) =>
  ad
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x[0])
    .join("");

const bos = (isYeri?: string): Taslak => ({
  id: null,
  ad: "",
  isYeri,
  aciklama: "",
  yoneticiler: [],
  personeller: [],
});

export default function Departmanlar() {
  const { message, modal } = AntdApp.useApp();

  const [veri, setVeri] = useState<{
    departmanlar: Departman[];
    isYerleri: string[];
    personel: Personel[];
  } | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [kaydediliyor, setKaydediliyor] = useState(false);

  const [taslak, setTaslak] = useState<Taslak | null>(null);
  const [degisti, setDegisti] = useState(false);

  /* Atanmamış listesi süzgeçleri */
  const [ara, setAra] = useState("");
  const [yerSuz, setYerSuz] = useState<string>("hepsi");

  /* Önizleme */
  const [onizSicil, setOnizSicil] = useState<string | undefined>();
  const [oniz, setOniz] = useState<any>(null);
  const [onizYuk, setOnizYuk] = useState(false);

  const getir = useCallback(async () => {
    setYukleniyor(true);
    try {
      setVeri(await api.al<any>("/api/Departman"));
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setYukleniyor(false);
    }
  }, [message]);

  useEffect(() => {
    getir();
  }, [getir]);

  const departmanlar = veri?.departmanlar ?? [];
  const personel = veri?.personel ?? [];
  const isYerleri = veri?.isYerleri ?? [];

  const kisiBul = useMemo(() => {
    const m = new Map<string, Personel>();
    personel.forEach((p) => m.set(K(p.sicil), p));
    return (s: string) => m.get(K(s));
  }, [personel]);

  const depAdi = useMemo(() => {
    const m = new Map<number, string>();
    departmanlar.forEach((d) => m.set(d.id, d.ad));
    return (id: number | null | undefined) => (id == null ? undefined : m.get(id));
  }, [departmanlar]);

  /* Taslağa göre kişinin durumu: kaydedilmemiş seçimleri de hesaba katar */
  const taslakPersonel = useMemo(
    () => new Set((taslak?.personeller ?? []).map(K)),
    [taslak]
  );
  const taslakYonetici = useMemo(
    () => new Set((taslak?.yoneticiler ?? []).map(K)),
    [taslak]
  );

  const atanmamis = useMemo(
    () =>
      personel.filter(
        (p) => p.departmanId == null && p.yonettigi.length === 0 && p.isYeriTuru !== "ŞUBE"
      ),
    [personel]
  );

  const q = ara.trim().toLocaleLowerCase("tr");

  const atanmamisGorunen = useMemo(
    () =>
      atanmamis.filter(
        (p) =>
          (yerSuz === "hepsi" || p.isYeriTuru === yerSuz) &&
          !taslakPersonel.has(K(p.sicil)) &&
          !taslakYonetici.has(K(p.sicil)) &&
          (!q || `${p.adSoyad} ${p.pozisyon ?? ""} ${p.sicil}`.toLocaleLowerCase("tr").includes(q))
      ),
    [atanmamis, yerSuz, q, taslakPersonel, taslakYonetici]
  );

  /* Atanmamışlar pozisyona göre: "bütün temizlik görevlilerini ekle" için */
  const pozisyonGruplari = useMemo(() => {
    const m = new Map<string, Personel[]>();
    atanmamisGorunen.forEach((p) => {
      const k = (p.pozisyon ?? "—").trim();
      m.set(k, [...(m.get(k) ?? []), p]);
    });
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [atanmamisGorunen]);

  const atananSayisi = personel.filter((p) => p.departmanId != null).length;

  /* ------------------------------------------------------------ eylemler */

  const sec = (d: Departman | null, isYeri?: string) => {
    if (degisti) {
      modal.confirm({
        title: "Kaydedilmemiş değişiklikler var",
        content: "Kaydetmeden devam ederseniz değişiklikler kaybolur.",
        okText: "Devam et",
        cancelText: "Vazgeç",
        onOk: () => uygula(d, isYeri),
      });
      return;
    }
    uygula(d, isYeri);
  };

  const uygula = (d: Departman | null, isYeri?: string) => {
    setTaslak(
      d
        ? {
            id: d.id,
            ad: d.ad,
            isYeri: d.isYeri ?? undefined,
            aciklama: d.aciklama ?? "",
            yoneticiler: d.yoneticiler.map((x) => x.sicil),
            personeller: d.personeller.map((x) => x.sicil),
          }
        : bos(isYeri ?? isYerleri[0])
    );
    setDegisti(false);
    setOniz(null);
    setOnizSicil(undefined);

    /* Atanmamış listesi departmanın iş yerine süzülür: "Hepsini ekle"
       merkezdeki temizlik görevlisiyle depodakini karıştırmasın. */
    const yer = d ? d.isYeri : isYeri ?? isYerleri[0];
    setYerSuz(yer && isYerleri.includes(yer) ? yer : "hepsi");
  };

  const guncelle =(p: Partial<Taslak>) => {
    if (!taslak) return;
    setTaslak({ ...taslak, ...p });
    setDegisti(true);
  };

  const personelEkle = (siciller: string[]) => {
    if (!taslak) return;
    const mevcut = new Set(taslak.personeller.map(K));
    const yeni = siciller.filter((s) => !mevcut.has(K(s)) && !taslakYonetici.has(K(s)));
    if (yeni.length === 0) return;
    guncelle({ personeller: [...taslak.personeller, ...yeni] });
  };

  const kaydet = async () => {
    if (!taslak) return;

    if (!taslak.ad.trim()) {
      message.warning("Departman adını yazınız.");
      return;
    }

    setKaydediliyor(true);
    try {
      const r = await api.gonder<any>("/api/Departman", {
        id: taslak.id,
        ad: taslak.ad.trim(),
        isYeri: taslak.isYeri,
        aciklama: taslak.aciklama,
        sira: 0,
        yoneticiler: taslak.yoneticiler,
        personeller: taslak.personeller,
      });

      message.success(
        r?.tasinan
          ? `Kaydedildi · ${r.tasinan} kişi başka departmandan buraya taşındı.`
          : "Departman kaydedildi."
      );
      setTaslak({ ...taslak, id: r?.id ?? taslak.id });
      setDegisti(false);
      await getir();
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setKaydediliyor(false);
    }
  };

  const sil = async () => {
    if (!taslak?.id) return;
    try {
      await api.sil(`/api/Departman/${taslak.id}`);
      message.success("Departman kaldırıldı; üyeleri izin onay tablosuna döndü.");
      setTaslak(null);
      setDegisti(false);
      getir();
    } catch (h: any) {
      message.error(h.message);
    }
  };

  const onizle = async (sicil: string | undefined) => {
    setOnizSicil(sicil);
    setOniz(null);
    if (!sicil) return;
    setOnizYuk(true);
    try {
      setOniz(await api.al<any>(`/api/Departman/Onizleme?sicil=${encodeURIComponent(sicil)}`));
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setOnizYuk(false);
    }
  };

  /* ------------------------------------------------------------ seçenekler */

  const secenek = (p: Personel, rol: "yonetici" | "personel") => {
    const baska =
      rol === "personel" && p.departmanId != null && p.departmanId !== taslak?.id
        ? depAdi(p.departmanId)
        : undefined;

    return {
      value: p.sicil,
      ara: `${p.adSoyad} ${p.pozisyon ?? ""} ${p.sicil}`.toLocaleLowerCase("tr"),
      label: (
        <span className="dp-secenek">
          <b>{p.adSoyad}</b>
          <small>
            {p.pozisyon || "—"} · {yerAdi(p.isYeriTuru)}
            {baska && <em> · şu an {baska}</em>}
          </small>
        </span>
      ),
    };
  };

  const yoneticiSecenekleri = useMemo(
    () => personel.filter((p) => !taslakPersonel.has(K(p.sicil))).map((p) => secenek(p, "yonetici")),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [personel, taslakPersonel]
  );

  const personelSecenekleri = useMemo(
    () => personel.filter((p) => !taslakYonetici.has(K(p.sicil))).map((p) => secenek(p, "personel")),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [personel, taslakYonetici, taslak?.id, depAdi]
  );

  const tasinacaklar = (taslak?.personeller ?? [])
    .map((s) => kisiBul(s))
    .filter((p): p is Personel => !!p && p.departmanId != null && p.departmanId !== taslak?.id);

  /* ------------------------------------------------------------ çizim */

  if (yukleniyor && !veri) {
    return (
      <div style={{ padding: 60, textAlign: "center" }}>
        <Spin />
      </div>
    );
  }

  const gruplar = [
    ...isYerleri,
    ...departmanlar
      .map((d) => d.isYeri ?? "")
      .filter((y) => y && !isYerleri.includes(y)),
  ].filter((y, i, a) => a.indexOf(y) === i);

  const yerSiz = departmanlar.filter((d) => !d.isYeri);

  return (
    <div className="dp">
      <div className="dp-ust">
        <div>
          <h3>
            <i>
              <Building2 size={17} />
            </i>
            Departmanlar
          </h3>
          <p>
            Genel merkez ve depo için ekip tanımı. Personelin izin talebi departman
            yöneticisine gider, mobilde Ekibim'de yalnızca kendi departmanı görünür.
            Mağazalar bu ekrandan etkilenmez.
          </p>
        </div>
        <Button type="primary" icon={<Plus size={15} />} onClick={() => sec(null)}>
          Yeni departman
        </Button>
      </div>

      <div className="dp-sayilar">
        <div>
          <b>{departmanlar.length}</b>
          <span>departman</span>
        </div>
        <div>
          <b>{atananSayisi}</b>
          <span>personel atandı</span>
        </div>
        <button
          type="button"
          className={atanmamis.length ? "uyari" : ""}
          onClick={() => document.getElementById("dp-atanmamis")?.scrollIntoView({ behavior: "smooth" })}
        >
          <b>{atanmamis.length}</b>
          <span>merkez / depo personeli atanmamış</span>
        </button>
      </div>

      <div className="dp-govde">
        {/* ------------------------------------------------ sol: liste */}
        <div className="dp-liste">
          {departmanlar.length === 0 && (
            <div className="dp-bos">
              <Users size={28} />
              <p>Henüz departman yok.</p>
              <Button size="small" onClick={() => sec(null)}>
                İlk departmanı oluştur
              </Button>
            </div>
          )}

          {[...gruplar, ...(yerSiz.length ? [""] : [])].map((yer) => {
            const liste = departmanlar.filter((d) => (d.isYeri ?? "") === yer);
            if (liste.length === 0 && departmanlar.length === 0) return null;

            return (
              <div key={yer || "yok"} className="dp-grup">
                <div className="dp-grup-bas">
                  <span>{yer ? yerAdi(yer) : "İş yeri seçilmemiş"}</span>
                  {yer && (
                    <Tooltip title={`${yerAdi(yer)} için yeni departman`}>
                      <button type="button" onClick={() => sec(null, yer)}>
                        <Plus size={14} />
                      </button>
                    </Tooltip>
                  )}
                </div>

                {liste.length === 0 && <div className="dp-grup-bos">Departman yok</div>}

                {liste.map((d) => (
                  <button
                    type="button"
                    key={d.id}
                    className={`dp-kart${taslak?.id === d.id ? " acik" : ""}`}
                    onClick={() => sec(d)}
                  >
                    <div className="dp-kart-ust">
                      <b>{d.ad}</b>
                      <em>{d.personeller.length}</em>
                    </div>
                    <small>
                      {d.yoneticiler.length
                        ? d.yoneticiler.map((y) => y.adSoyad).join(", ")
                        : "Yönetici atanmamış"}
                    </small>
                  </button>
                ))}
              </div>
            );
          })}
        </div>

        {/* ------------------------------------------------ sağ: düzenleyici */}
        <div className="dp-duzen">
          {!taslak ? (
            <div className="dp-bos buyuk">
              <Building2 size={34} />
              <p>Düzenlemek için soldan bir departman seçin ya da yeni departman oluşturun.</p>
            </div>
          ) : (
            <>
              <div className="dp-duzen-bas">
                <b>{taslak.id ? taslak.ad || "Departman" : "Yeni departman"}</b>
                {degisti && <Tag color="orange">Kaydedilmedi</Tag>}
                <span style={{ flex: 1 }} />
                {taslak.id && (
                  <Popconfirm
                    title="Departman kaldırılsın mı?"
                    description="Üyeleri izin onay tablosundaki kurala döner."
                    okText="Kaldır"
                    cancelText="Vazgeç"
                    okButtonProps={{ danger: true }}
                    onConfirm={sil}
                  >
                    <Button danger size="small" icon={<Trash2 size={14} />}>
                      Kaldır
                    </Button>
                  </Popconfirm>
                )}
                <Button type="primary" size="small" loading={kaydediliyor} onClick={kaydet}>
                  Kaydet
                </Button>
              </div>

              <div className="dp-alanlar">
                <label>
                  <span>Departman adı</span>
                  <Input
                    value={taslak.ad}
                    onChange={(e) => guncelle({ ad: e.target.value })}
                    placeholder="Örn. Bilgi Teknolojileri"
                    maxLength={120}
                  />
                </label>
                <label>
                  <span>İş yeri</span>
                  <Select
                    value={taslak.isYeri}
                    onChange={(v) => {
                      guncelle({ isYeri: v });
                      setYerSuz(v);
                    }}
                    options={isYerleri.map((y) => ({ value: y, label: yerAdi(y) }))}
                    placeholder="Seçiniz"
                  />
                </label>
                <label className="genis">
                  <span>Açıklama (isteğe bağlı)</span>
                  <Input
                    value={taslak.aciklama}
                    onChange={(e) => guncelle({ aciklama: e.target.value })}
                    maxLength={300}
                  />
                </label>
              </div>

              <div className="dp-bolum">
                <div className="dp-bolum-bas">
                  <b>Yöneticiler</b>
                  <small>Personelin izin talebinin 1. onayı · ekibi yönetir</small>
                </div>
                <Select
                  mode="multiple"
                  style={{ width: "100%" }}
                  value={taslak.yoneticiler}
                  onChange={(v) => guncelle({ yoneticiler: v })}
                  options={yoneticiSecenekleri}
                  filterOption={(girdi, o: any) =>
                    (o?.ara ?? "").includes(girdi.toLocaleLowerCase("tr"))
                  }
                  optionLabelProp="value"
                  tagRender={(t) => {
                    const p = kisiBul(String(t.value));
                    return (
                      <Tag closable={t.closable} onClose={t.onClose} color="purple" className="dp-etiket">
                        {p?.adSoyad ?? t.value}
                      </Tag>
                    );
                  }}
                  placeholder="Yönetici seçin (birden fazla olabilir)"
                />
                {taslak.yoneticiler.length === 0 && (
                  <div className="dp-not">
                    Yönetici seçilmezse personelin izni eski kurala (izin onay tablosu) göre gider.
                  </div>
                )}
              </div>

              <div className="dp-bolum">
                <div className="dp-bolum-bas">
                  <b>Personel ({taslak.personeller.length})</b>
                  <small>Mobilde birbirini Ekibim'de görür</small>
                </div>
                <Select
                  mode="multiple"
                  style={{ width: "100%" }}
                  value={taslak.personeller}
                  onChange={(v) => guncelle({ personeller: v })}
                  options={personelSecenekleri}
                  filterOption={(girdi, o: any) =>
                    (o?.ara ?? "").includes(girdi.toLocaleLowerCase("tr"))
                  }
                  optionLabelProp="value"
                  maxTagCount={0}
                  maxTagPlaceholder={() => "Personel ekle / çıkar…"}
                  placeholder="Personel ara ve ekle"
                />

                {tasinacaklar.length > 0 && (
                  <Alert
                    style={{ marginTop: 8 }}
                    type="warning"
                    showIcon
                    message={`${tasinacaklar.length} kişi başka departmandan buraya taşınacak`}
                    description={tasinacaklar
                      .map((p) => `${p.adSoyad} (${depAdi(p.departmanId)})`)
                      .join(", ")}
                  />
                )}

                <div className="dp-uyeler">
                  {taslak.personeller.length === 0 && (
                    <div className="dp-not">Henüz personel yok. Yukarıdan arayın ya da aşağıdaki atanmamış listeden ekleyin.</div>
                  )}
                  {taslak.personeller.map((s) => {
                    const p = kisiBul(s);
                    return (
                      <div className="dp-uye" key={s}>
                        <i>{basHarf(p?.adSoyad ?? s)}</i>
                        <div>
                          <b>{p?.adSoyad ?? `${s} (aktif değil)`}</b>
                          <small>{p ? `${p.pozisyon || "—"} · ${yerAdi(p.isYeriTuru)}` : "Mikro'da aktif değil"}</small>
                        </div>
                        <button
                          type="button"
                          title="Çıkar"
                          onClick={() => guncelle({ personeller: taslak.personeller.filter((x) => x !== s) })}
                        >
                          ✕
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* --------------------------------------- önizleme */}
              <div className="dp-bolum dp-oniz">
                <div className="dp-bolum-bas">
                  <b>Kontrol et</b>
                  <small>Kaydettikten sonra bir kişinin izninin kime gittiğini ve Ekibim'de kimi gördüğünü gösterir</small>
                </div>
                <Select
                  showSearch
                  allowClear
                  style={{ width: "100%" }}
                  value={onizSicil}
                  onChange={onizle}
                  disabled={degisti}
                  placeholder={degisti ? "Önce kaydedin" : "Departmandan bir kişi seçin"}
                  options={[...taslak.yoneticiler, ...taslak.personeller].map((s) => ({
                    value: s,
                    label: kisiBul(s)?.adSoyad ?? s,
                  }))}
                  filterOption={(g, o) =>
                    String(o?.label ?? "").toLocaleLowerCase("tr").includes(g.toLocaleLowerCase("tr"))
                  }
                />

                {onizYuk && (
                  <div style={{ padding: 16, textAlign: "center" }}>
                    <Spin size="small" />
                  </div>
                )}

                {oniz && (
                  <div className="dp-oniz-sonuc">
                    <div>
                      <span>İzin talebi (1. onay)</span>
                      <b>
                        {oniz.onaylayanlar?.length
                          ? oniz.onaylayanlar.map((x: Kisi) => x.adSoyad).join(", ")
                          : "Doğrudan İK"}
                      </b>
                      <small>
                        {oniz.kaynak === "departman" ? "Departmandan" : "İzin onay tablosundan"}
                        {oniz.onayUnvan ? ` · ${oniz.onayUnvan}` : ""}
                      </small>
                    </div>
                    <div>
                      <span>Ekibim'de görür ({oniz.ekip?.length ?? 0})</span>
                      <p>{(oniz.ekip ?? []).map((x: Kisi) => x.adSoyad).join(", ") || "—"}</p>
                    </div>
                    {(oniz.sorumlu?.length ?? 0) > 0 && (
                      <div>
                        <span>Sorumlu olduğu ({oniz.sorumlu.length})</span>
                        <p>{oniz.sorumlu.map((x: Kisi) => x.adSoyad).join(", ")}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ------------------------------------------------ atanmamışlar */}
      <div className="dp-atanmamis" id="dp-atanmamis">
        <div className="dp-bolum-bas">
          <b>Atanmamış personel ({atanmamis.length})</b>
          <small>
            Genel merkez ve depoda departmanı olmayanlar. Bunların izni ve ekibi hâlâ izin onay
            tablosuna göre çalışır.
          </small>
        </div>

        <Space wrap style={{ marginBottom: 10 }}>
          <Input
            allowClear
            prefix={<Search size={14} />}
            placeholder="Ad, pozisyon, sicil"
            value={ara}
            onChange={(e) => setAra(e.target.value)}
            style={{ width: 240 }}
          />
          <Select
            value={yerSuz}
            onChange={setYerSuz}
            style={{ width: 190 }}
            options={[
              { value: "hepsi", label: "Tüm iş yerleri" },
              ...isYerleri.map((y) => ({ value: y, label: yerAdi(y) })),
            ]}
          />
          {!taslak && <span className="dp-not">Eklemek için önce bir departman seçin.</span>}
        </Space>

        {atanmamisGorunen.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={atanmamis.length ? "Süzgece uyan kimse yok." : "Herkes bir departmanda."}
          />
        ) : (
          <div className="dp-pozlar">
            {pozisyonGruplari.map(([poz, kisiler]) => (
              <div className="dp-poz" key={poz}>
                <div className="dp-poz-bas">
                  <b>{poz}</b>
                  <em>{kisiler.length}</em>
                  <span style={{ flex: 1 }} />
                  {taslak && kisiler.length > 1 && (
                    <Button size="small" type="link" onClick={() => personelEkle(kisiler.map((x) => x.sicil))}>
                      Hepsini ekle
                    </Button>
                  )}
                </div>
                {kisiler.map((p) => (
                  <div className="dp-poz-kisi" key={p.sicil}>
                    <div>
                      <b>{p.adSoyad}</b>
                      <small>
                        {yerAdi(p.isYeriTuru)} · {p.sicil}
                      </small>
                    </div>
                    {taslak && (
                      <Tooltip title={`${taslak.ad || "Departmana"} ekle`}>
                        <button type="button" onClick={() => personelEkle([p.sicil])}>
                          <UserPlus size={14} />
                        </button>
                      </Tooltip>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
