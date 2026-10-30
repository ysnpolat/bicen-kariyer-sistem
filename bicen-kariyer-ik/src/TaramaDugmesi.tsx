/**
 * Tara düğmesi (07.10.2026)
 * ---------------------------------------------------------------------------
 * Evrak yükleme alanlarının yanında durur; bilgisayara bağlı tarayıcıdaki
 * (taramalı yazıcıdaki) evrakı tarayıp PDF olarak yükleme alanına ekler.
 *
 * Web sayfası tarayıcıya kendisi erişemediği için tarama, bilgisayara bir
 * kez kurulan "Biçen Tarayıcı Köprüsü" ile yapılıyor (araclar/
 * tarayici-koprusu). Köprü yalnızca bu bilgisayarın içinden ulaşılabilen
 * 127.0.0.1:47115 adresini dinliyor ve yalnızca panelin adresinden gelen
 * isteği kabul ediyor.
 *
 * Köprü kurulu değilse düğmeye basınca kurulum anlatılıyor ve indirme
 * bağlantısı veriliyor; sayfa açılırken köprü yoklanmıyor (köprüsüz
 * bilgisayarlarda Chrome'un yerel ağ izni sorusu boş yere çıkmasın).
 *
 * Ayarlar (tarayıcı, renk, çözünürlük, kaynak) bu bilgisayarda hatırlanır.
 */

import { useEffect, useState } from "react";
import { App as AntdApp, Button, Input, Modal, Popover, Segmented, Select, Space, Spin, Tooltip } from "antd";
import dayjs from "dayjs";
import { Download, ScanText, Settings2 } from "lucide-react";

const KOPRU = "http://127.0.0.1:47115";
const AYAR_ANAHTARI = "bicen.tarama.ayar";
export const KOPRU_INDIR = `${import.meta.env.BASE_URL}indir/tarayici-koprusu.zip`;

type Renk = "gri" | "renkli" | "sb";
type Kaynak = "otomatik" | "besleyici" | "cam";

interface Ayar {
  cihaz: string;
  renk: Renk;
  dpi: number;
  kaynak: Kaynak;
}

interface Cihaz {
  id: string;
  ad: string;
  besleyici: boolean;
  cam: boolean;
  /** wia: Windows sürücüsüyle · ag: sürücüsüz ağ taraması (eSCL, köprü 1.1) */
  tur?: "wia" | "ag";
  ip?: string;
  ulasilamiyor?: boolean;
}

const VARSAYILAN: Ayar = { cihaz: "", renk: "gri", dpi: 200, kaynak: "otomatik" };

const ayarOku = (): Ayar => {
  try {
    const s = window.localStorage.getItem(AYAR_ANAHTARI);
    return s ? { ...VARSAYILAN, ...JSON.parse(s) } : VARSAYILAN;
  } catch {
    return VARSAYILAN;
  }
};

const ayarYaz = (a: Ayar) => {
  try {
    window.localStorage.setItem(AYAR_ANAHTARI, JSON.stringify(a));
  } catch {
    /* hatırlanamazsa her seferinde varsayılan */
  }
};

/** Bağlantı kurulamadı (köprü kurulu değil / çalışmıyor / izin verilmedi) */
class KopruYok extends Error {}

async function kopruIstek(yol: string, init?: RequestInit, sureMs = 30_000): Promise<Response> {
  const ctrl = new AbortController();
  const z = window.setTimeout(() => ctrl.abort(), sureMs);
  try {
    return await fetch(`${KOPRU}${yol}`, { ...init, signal: ctrl.signal });
  } catch (e) {
    if (ctrl.signal.aborted) throw new Error("Tarayıcı zamanında yanıt vermedi.");
    throw new KopruYok(String(e));
  } finally {
    window.clearTimeout(z);
  }
}

async function hataMetni(r: Response) {
  try {
    const j = await r.json();
    if (j?.hata) return String(j.hata);
  } catch {
    /* gövde JSON değil */
  }
  return `Tarama yapılamadı (${r.status}).`;
}

export default function TaramaDugmesi({
  onDosya,
  ad = "tarama",
  boyut = "middle",
  kucuk = false,
  disabled = false,
  metin = "Tara",
}: {
  /** Taranan PDF; mevcut yükleme akışına dosya seçilmiş gibi verilir */
  onDosya: (dosya: File) => void;
  /** Dosya adının başı: "izin-formu" → izin-formu-20261007-1412.pdf */
  ad?: string;
  boyut?: "small" | "middle";
  /** Yalnızca simge; ayarlar ve Tara düğmesi açılan kutuda */
  kucuk?: boolean;
  disabled?: boolean;
  metin?: string;
}) {
  const { message } = AntdApp.useApp();

  const [ayar, setAyar] = useState<Ayar>(ayarOku);
  const [taraniyor, setTaraniyor] = useState(false);
  const [ayarAcik, setAyarAcik] = useState(false);
  const [kurulumAcik, setKurulumAcik] = useState(false);
  const [cihazlar, setCihazlar] = useState<Cihaz[] | null>(null);
  const [cihazYukleniyor, setCihazYukleniyor] = useState(false);
  const [cihazHatasi, setCihazHatasi] = useState("");
  const [kopruSurum, setKopruSurum] = useState<string | null>(null);
  const [yenile, setYenile] = useState(0);
  const [agIp, setAgIp] = useState("");
  const [agIsleniyor, setAgIsleniyor] = useState(false);

  const ayarDegis = (d: Partial<Ayar>) => {
    const y = { ...ayar, ...d };
    setAyar(y);
    ayarYaz(y);
  };

  /* Ayar kutusu açılınca bu bilgisayardaki tarayıcılar */
  useEffect(() => {
    if (!ayarAcik) return;
    let iptal = false;
    setCihazYukleniyor(true);
    setCihazHatasi("");
    kopruIstek("/cihazlar", undefined, 40_000)
      .then(async (r) => {
        if (!r.ok) throw new Error(await hataMetni(r));
        return r.json();
      })
      .then((j) => {
        if (iptal) return;
        setCihazlar(j?.cihazlar ?? []);
        setKopruSurum(j?.surum ?? null);
      })
      .catch((e) => {
        if (iptal) return;
        setCihazlar(null);
        if (e instanceof KopruYok) {
          setAyarAcik(false);
          setKurulumAcik(true);
        } else setCihazHatasi(e.message);
      })
      .finally(() => !iptal && setCihazYukleniyor(false));
    return () => {
      iptal = true;
    };
  }, [ayarAcik, yenile]);

  /* Ağ tarayıcısı (eSCL, köprü 1.1): sürücü gerekmez, yazıcının IP'si yeter */
  const agIstek = async (yol: string, ip: string) => {
    setAgIsleniyor(true);
    try {
      const r = await kopruIstek(`${yol}?ip=${encodeURIComponent(ip)}`, { method: "POST", headers: { "X-Bicen-Tarayici": "1" } }, 20_000);
      if (r.status === 404 && !kopruSurum) throw new Error("Ağ tarayıcısı için köprünün yeni sürümü gerekiyor; köprüyü indirip kur.bat'ı yeniden çalıştırın.");
      if (!r.ok) throw new Error(await hataMetni(r));
      return await r.json();
    } finally {
      setAgIsleniyor(false);
    }
  };

  const agEkle = async () => {
    const ip = agIp.trim();
    if (!ip) return;
    try {
      const c = await agIstek("/ag-tarayici", ip);
      message.success(`${c?.ad ?? ip} eklendi.`);
      setAgIp("");
      ayarDegis({ cihaz: `escl:${ip}` });
      setYenile((x) => x + 1);
    } catch (e: any) {
      message.error({ content: e?.message ?? "Eklenemedi.", duration: 7 });
    }
  };

  const agSil = async (ip: string) => {
    try {
      await agIstek("/ag-tarayici-sil", ip);
      if (ayar.cihaz === `escl:${ip}`) ayarDegis({ cihaz: "" });
      setYenile((x) => x + 1);
    } catch (e: any) {
      message.error(e?.message ?? "Kaldırılamadı.");
    }
  };

  const tara = async () => {
    if (taraniyor) return;
    setAyarAcik(false);
    setTaraniyor(true);
    const anahtar = `tarama-${Date.now()}`;
    message.loading({ key: anahtar, content: "Taranıyor… Evrak tarayıcıda olmalı.", duration: 0 });

    try {
      const q = new URLSearchParams({
        cihaz: ayar.cihaz,
        renk: ayar.renk,
        dpi: String(ayar.dpi),
        kaynak: ayar.kaynak,
      });
      const r = await kopruIstek(`/tara?${q}`, { method: "POST", headers: { "X-Bicen-Tarayici": "1" } }, 300_000);

      if (!r.ok) {
        message.error({ key: anahtar, content: await hataMetni(r), duration: 6 });
        return;
      }

      const sayfa = Number(r.headers.get("X-Sayfa-Sayisi") ?? "1") || 1;
      const veri = await r.blob();
      const dosya = new File([veri], `${ad}-${dayjs().format("YYYYMMDD-HHmmss")}.pdf`, { type: "application/pdf" });

      onDosya(dosya);
      message.success({ key: anahtar, content: `${sayfa} sayfa tarandı ve eklendi.`, duration: 3 });
    } catch (e: any) {
      if (e instanceof KopruYok) {
        message.destroy(anahtar);
        setKurulumAcik(true);
      } else message.error({ key: anahtar, content: e?.message ?? "Tarama yapılamadı.", duration: 6 });
    } finally {
      setTaraniyor(false);
    }
  };

  const secili = cihazlar?.find((c) => c.id === ayar.cihaz) ?? cihazlar?.[0];

  const ayarIcerik = (
    <div className="tr-ayar" onClick={(e) => e.stopPropagation()}>
      <div className="tr-etiket">Tarayıcı</div>
      {cihazYukleniyor ? (
        <div className="tr-yukleniyor">
          <Spin size="small" /> Tarayıcılar aranıyor…
        </div>
      ) : cihazHatasi ? (
        <div className="tr-hata">{cihazHatasi}</div>
      ) : cihazlar && cihazlar.length === 0 ? (
        <div className="tr-hata">
          Bu bilgisayarda tanımlı tarayıcı yok. Yazıcı ağa bağlıysa IP adresini aşağıya ekleyin; sürücü gerekmez.
        </div>
      ) : (
        <Select
          size="small"
          style={{ width: "100%" }}
          value={cihazlar?.some((c) => c.id === ayar.cihaz) ? ayar.cihaz : ""}
          onChange={(v) => ayarDegis({ cihaz: v })}
          options={[
            { value: "", label: cihazlar && cihazlar.length > 1 ? `İlk bulunan (${cihazlar[0].ad})` : cihazlar?.[0]?.ad ?? "İlk bulunan" },
            ...(cihazlar && cihazlar.length > 1 ? cihazlar.map((c) => ({ value: c.id, label: c.ad })) : []),
          ]}
          getPopupContainer={(n) => n.parentElement ?? document.body}
        />
      )}

      <div className="tr-etiket">Ağ tarayıcısı (sürücüsüz)</div>
      {(cihazlar ?? [])
        .filter((c) => c.tur === "ag")
        .map((c) => (
          <div key={c.id} className="tr-ag-satir">
            <span style={{ color: c.ulasilamiyor ? "#b45309" : undefined }}>{c.ad}</span>
            <button type="button" onClick={() => c.ip && agSil(c.ip)} disabled={agIsleniyor}>
              Kaldır
            </button>
          </div>
        ))}
      <Space.Compact size="small" className="tr-ag-ekle" style={{ width: "100%" }}>
        <Input
          size="small"
          placeholder="Yazıcı IP adresi · 192.168.1.50"
          value={agIp}
          onChange={(e) => setAgIp(e.target.value)}
          onPressEnter={agEkle}
        />
        <Button size="small" onClick={agEkle} loading={agIsleniyor} disabled={!agIp.trim()}>
          Ekle
        </Button>
      </Space.Compact>
      <div className="tr-not">Çok fonksiyonlu yazıcının ağdan taramasını (AirScan/eSCL) kullanır; yazıcı ekranındaki ağ ayarlarında IP yazar.</div>

      <div className="tr-etiket">Renk</div>
      <Segmented
        size="small"
        block
        value={ayar.renk}
        onChange={(v) => ayarDegis({ renk: v as Renk })}
        options={[
          { value: "gri", label: "Gri" },
          { value: "renkli", label: "Renkli" },
          { value: "sb", label: "Siyah-beyaz" },
        ]}
      />

      <div className="tr-etiket">Çözünürlük</div>
      <Segmented
        size="small"
        block
        value={ayar.dpi}
        onChange={(v) => ayarDegis({ dpi: Number(v) })}
        options={[
          { value: 150, label: "150 dpi" },
          { value: 200, label: "200 dpi" },
          { value: 300, label: "300 dpi" },
        ]}
      />

      <div className="tr-etiket">Kaynak</div>
      <Segmented
        size="small"
        block
        value={ayar.kaynak}
        onChange={(v) => ayarDegis({ kaynak: v as Kaynak })}
        options={[
          { value: "otomatik", label: "Otomatik" },
          { value: "besleyici", label: "Besleyici", disabled: !!secili && !secili.besleyici },
          { value: "cam", label: "Cam", disabled: !!secili && !secili.cam },
        ]}
      />
      <div className="tr-not">
        {ayar.kaynak === "otomatik"
          ? "Besleyicide kağıt varsa oradaki bütün sayfalar, yoksa camdaki sayfa taranır."
          : ayar.kaynak === "besleyici"
          ? "Besleyicideki bütün sayfalar tek PDF olur."
          : "Camdaki tek sayfa taranır."}
      </div>

      <Button type="primary" block icon={<ScanText size={15} />} onClick={tara} loading={taraniyor} style={{ marginTop: 10 }}>
        Tara
      </Button>
    </div>
  );

  const kurulum = (
    <Modal
      open={kurulumAcik}
      onCancel={() => setKurulumAcik(false)}
      title="Tarayıcı köprüsü bu bilgisayarda çalışmıyor"
      width={520}
      footer={[
        <Button key="k" onClick={() => setKurulumAcik(false)}>
          Kapat
        </Button>,
        <Button key="i" type="primary" icon={<Download size={15} />} href={KOPRU_INDIR} download>
          Köprüyü indir
        </Button>,
      ]}
    >
      <p style={{ marginTop: 0 }}>
        Panelin tarayıcıyı kullanabilmesi için bilgisayara küçük bir yardımcının (<b>Biçen Tarayıcı Köprüsü</b>) bir kez
        kurulması gerekir. Yönetici yetkisi gerekmez.
      </p>
      <ol className="tr-adimlar">
        <li>
          <b>Köprüyü indir</b> düğmesiyle zip dosyasını indirip bir klasöre açın.
        </li>
        <li>
          <b>kur.bat</b> dosyasına çift tıklayın; ekranda tarayıcınızın adı görünürse kurulum tamamdır.
        </li>
        <li>Bu sayfaya dönüp tekrar <b>Tara</b>'ya basın.</li>
      </ol>
      <p className="tr-not" style={{ marginBottom: 0 }}>
        Kuruluysa: Chrome ya da Edge "yerel ağdaki cihazlara erişim" izni sorduysa ve reddedildiyse adres çubuğundaki kilit
        simgesinden izin verin. Bilgisayar yeniden başlatıldıysa köprü oturum açılınca kendiliğinden çalışır.
      </p>
    </Modal>
  );

  if (kucuk)
    return (
      <>
        <Popover
          trigger="click"
          open={ayarAcik}
          onOpenChange={(a) => !taraniyor && setAyarAcik(a)}
          content={ayarIcerik}
          title="Tarayıcıdan tara"
          placement="bottomRight"
          destroyOnHidden
        >
          <Tooltip title={ayarAcik ? "" : "Tarayıcıdan tara"}>
            <Button
              size={boyut}
              icon={taraniyor ? <Spin size="small" /> : <ScanText size={14} strokeWidth={2.2} />}
              disabled={disabled || taraniyor}
              aria-label="Tarayıcıdan tara"
            />
          </Tooltip>
        </Popover>
        {kurulum}
      </>
    );

  return (
    <>
      <Space.Compact size={boyut}>
        <Button icon={<ScanText size={15} strokeWidth={2.2} />} onClick={tara} loading={taraniyor} disabled={disabled}>
          {taraniyor ? "Taranıyor…" : metin}
        </Button>
        <Popover
          trigger="click"
          open={ayarAcik}
          onOpenChange={(a) => !taraniyor && setAyarAcik(a)}
          content={ayarIcerik}
          title="Tarama ayarları"
          placement="bottomRight"
          destroyOnHidden
        >
          <Tooltip title={ayarAcik ? "" : "Tarama ayarları"}>
            <Button icon={<Settings2 size={14} />} disabled={disabled || taraniyor} aria-label="Tarama ayarları" />
          </Tooltip>
        </Popover>
      </Space.Compact>
      {kurulum}
    </>
  );
}
