/**
 * Yönetim › Avans kuralları › Talep nedenleri (15.10.2026)
 * ---------------------------------------------------------------------------
 * Personelin avans isterken seçtiği nedenler (Biçen360). Aynı liste Ayarlar
 * Merkezi › Seçenek listeleri › Avans talep nedenleri'nde de var; burada
 * avans kurallarının yanında görünür. Kapatılan / silinen neden yeni
 * taleplerde çıkmaz; eski taleplerde yazılı kalır. Mobil listeyi sunucudan
 * aldığı için uygulama güncellemesi gerekmez (en geç bir dakikada görünür).
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from "react";
import { App as AntdApp, Button, Checkbox, Input, Popconfirm, Spin, Switch, Tooltip } from "antd";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";

import { api } from "./api";

interface Oge {
  ad: string;
  aciklamaZorunlu: boolean;
  acik: boolean;
  belgeGerekli?: boolean;
}

interface Liste {
  kod: string;
  digerVar: boolean;
  belgeSutunu?: boolean;
  ogeler: Oge[];
}

const KOD = "avansNedenleri";

export default function AvansNedenleri() {
  const { message } = AntdApp.useApp();
  const [liste, setListe] = useState<Liste | null>(null);
  const [yazabilir, setYazabilir] = useState(false);
  const [ogeler, setOgeler] = useState<Oge[]>([]);
  const [digerAcik, setDigerAcik] = useState(true);
  const [ilk, setIlk] = useState("");
  const [kaydediliyor, setKaydediliyor] = useState(false);

  const yukle = useCallback(async () => {
    try {
      const c = await api.al<{ yazabilir: boolean; listeler: Liste[] }>("/api/AyarMerkezi/Listeler");
      const l = c.listeler.find((x) => x.kod === KOD) ?? null;
      setYazabilir(c.yazabilir);
      setListe(l);
      const o = (l?.ogeler ?? []).filter((x) => x.ad !== "Diğer");
      const d = l?.ogeler.find((x) => x.ad === "Diğer")?.acik ?? true;
      setOgeler(o);
      setDigerAcik(d);
      setIlk(JSON.stringify({ o, d }));
    } catch (h: any) {
      message.error(h.message);
    }
  }, [message]);

  useEffect(() => {
    yukle();
  }, [yukle]);

  if (!liste) return <Spin />;

  const degisti = JSON.stringify({ o: ogeler, d: digerAcik }) !== ilk;
  const degis = (i: number, p: Partial<Oge>) => setOgeler((l) => l.map((x, j) => (j === i ? { ...x, ...p } : x)));

  const kaydet = async () => {
    if (ogeler.some((x) => !x.ad.trim())) return message.warning("Boş satırları silin ya da doldurun.");
    if (!ogeler.some((x) => x.acik) && !digerAcik) return message.warning("En az bir neden açık olmalı.");
    setKaydediliyor(true);
    try {
      await api.gonder("/api/AyarMerkezi/Listeler", {
        kod: KOD,
        ogeler: [...ogeler, ...(liste.digerVar ? [{ ad: "Diğer", aciklamaZorunlu: true, acik: digerAcik }] : [])],
      });
      message.success("Talep nedenleri kaydedildi; en geç bir dakika içinde uygulamada görünür.");
      yukle();
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setKaydediliyor(false);
    }
  };

  return (
    <div className="avn">
      <style>{CSS}</style>
      <div className="avn-bas">
        <span>Neden</span>
        <Tooltip title="Bu neden seçilince açıklama yazmak zorunlu">
          <span>Açıklama zorunlu</span>
        </Tooltip>
        {liste.belgeSutunu && (
          <Tooltip title="Bu neden seçilince belge (fatura, hastane belgesi…) yüklenene kadar talep onaya gitmez">
            <span>Belge istenir</span>
          </Tooltip>
        )}
        <span>Açık</span>
        <span />
      </div>

      {ogeler.map((x, i) => (
        <div key={i} className={`avn-satir${x.acik ? "" : " avn-kapali"}`}>
          <Input value={x.ad} maxLength={60} disabled={!yazabilir} onChange={(e) => degis(i, { ad: e.target.value })} />
          <Checkbox checked={x.aciklamaZorunlu} disabled={!yazabilir} onChange={(e) => degis(i, { aciklamaZorunlu: e.target.checked })} />
          {liste.belgeSutunu && (
            <Checkbox checked={!!x.belgeGerekli} disabled={!yazabilir} onChange={(e) => degis(i, { belgeGerekli: e.target.checked })} />
          )}
          <Switch size="small" checked={x.acik} disabled={!yazabilir} onChange={(v) => degis(i, { acik: v })} />
          <span className="avn-arac">
            <Button size="small" type="text" disabled={!yazabilir || i === 0} icon={<ArrowUp size={14} />}
              onClick={() => setOgeler((l) => { const k = [...l]; [k[i - 1], k[i]] = [k[i], k[i - 1]]; return k; })} />
            <Button size="small" type="text" disabled={!yazabilir || i === ogeler.length - 1} icon={<ArrowDown size={14} />}
              onClick={() => setOgeler((l) => { const k = [...l]; [k[i + 1], k[i]] = [k[i], k[i + 1]]; return k; })} />
            <Popconfirm title="Neden kaldırılsın mı?" description="Eski taleplerde yazılı kalır. Geçici olarak kaldırmak için kapatmanız yeterli." okText="Kaldır" cancelText="Vazgeç" onConfirm={() => setOgeler((l) => l.filter((_, j) => j !== i))} disabled={!yazabilir}>
              <Button size="small" type="text" danger disabled={!yazabilir} icon={<Trash2 size={14} />} />
            </Popconfirm>
          </span>
        </div>
      ))}

      {liste.digerVar && (
        <div className={`avn-satir${digerAcik ? "" : " avn-kapali"}`}>
          <Input value="Diğer" disabled />
          <Checkbox checked disabled />
          {liste.belgeSutunu && <Checkbox checked={!!liste.ogeler.find((x) => x.ad === "Diğer")?.belgeGerekli} disabled />}
          <Switch size="small" checked={digerAcik} disabled={!yazabilir} onChange={setDigerAcik} />
          <span className="avn-soluk">{digerAcik ? "açıklama her zaman zorunlu" : "kapalı"}</span>
        </div>
      )}

      {yazabilir && (
        <div className="avn-dugmeler">
          <Button icon={<Plus size={14} />} onClick={() => setOgeler((l) => [...l, { ad: "", aciklamaZorunlu: false, acik: true }])}>
            Neden ekle
          </Button>
          <Button type="primary" onClick={kaydet} loading={kaydediliyor} disabled={!degisti}>
            Nedenleri kaydet
          </Button>
          {degisti && (
            <Button type="text" onClick={yukle}>
              Geri al
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

const CSS = `
.avn{display:flex;flex-direction:column;gap:6px;min-width:0}
.avn-bas,.avn-satir{display:grid;grid-template-columns:minmax(0,1fr) 110px 100px 50px 96px;gap:8px;align-items:center}
.avn-bas{font-size:12px;color:#6b7280;font-weight:600}
.avn-satir.avn-kapali input{color:#9aa1a9;text-decoration:line-through}
.avn-arac{display:flex;gap:0}
.avn-soluk{font-size:12px;color:#8a929b}
.avn-dugmeler{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px}
@media (max-width:620px){.avn-bas{display:none}.avn-satir{grid-template-columns:minmax(0,1fr) auto auto auto}}
`;
