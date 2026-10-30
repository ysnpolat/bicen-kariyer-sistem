/**
 * ---------------------------------------------------------------------------
 * Yönetim → İşe Giriş Evrakları (03.10.2026)
 * ---------------------------------------------------------------------------
 * Başvurudan işe alımda adaydan istenen evrak listesi. Sıra, ad, nereden
 * alındığı, hangi klasöre düştüğü düzenlenir. Kod değişmez: yüklenmiş
 * belgeler ona bağlı. Kaldırmak yerine "pasif" yapmak, yüklenmiş evrakı
 * listede tutar.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useState } from "react";
import { Alert, App as AntdApp, Button, Input, InputNumber, Popconfirm, Select, Spin, Switch, Tooltip } from "antd";
import { ArrowDown, ArrowUp, FileCheck2, Plus, Printer, RotateCcw, Save, Trash2 } from "lucide-react";
import { ayracSetiAc } from "./TopluTarama";

import { api, oturumOku } from "./api";
import "./IseGirisEvraklari.css";

interface Tanim {
  kod: string;
  ad: string;
  kaynak: string | null;
  kategori: string;
  adet: number;
  not: string | null;
  aktif: boolean;
  /** Kalıcı ayraç numarası; sunucu verir, değişmez */
  ayracNo?: number;
  /** Yeni eklenen satır (kodu henüz yok) */
  _yeni?: boolean;
}

export const evrakTanimDuzenleyebilir = () =>
  ["Admin", "IKYoneticisi"].includes(oturumOku()?.rol ?? "");

export default function IseGirisEvrakTanimlari() {
  const { message } = AntdApp.useApp();

  const [liste, setListe] = useState<Tanim[]>([]);
  const [kategoriler, setKategoriler] = useState<string[]>(["Özlük", "İzin", "Raporlar", "Disiplin", "Diğer"]);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const [degisti, setDegisti] = useState(false);

  const getir = async () => {
    setYukleniyor(true);
    try {
      const c = await api.al<{ evraklar: Tanim[]; kategoriler: string[] }>("/api/IseGirisEvrak/Tanimlar");
      setListe(c.evraklar ?? []);
      if (c.kategoriler?.length) setKategoriler(c.kategoriler);
      setDegisti(false);
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Liste alınamadı.");
    } finally {
      setYukleniyor(false);
    }
  };

  useEffect(() => {
    getir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const guncelle = (i: number, alan: Partial<Tanim>) => {
    setListe((l) => l.map((x, j) => (j === i ? { ...x, ...alan } : x)));
    setDegisti(true);
  };

  const tasi = (i: number, yon: -1 | 1) => {
    setListe((l) => {
      const y = [...l];
      const j = i + yon;
      if (j < 0 || j >= y.length) return l;
      [y[i], y[j]] = [y[j], y[i]];
      return y;
    });
    setDegisti(true);
  };

  const kaydet = async () => {
    if (liste.some((x) => !x.ad.trim())) return message.warning("Adı boş evrak var.");

    setKaydediliyor(true);
    try {
      const c = await api.gonder<{ evraklar: Tanim[] }>("/api/IseGirisEvrak/Tanimlar", {
        evraklar: liste.map(({ _yeni, ...x }) => ({ ...x, kod: _yeni ? "" : x.kod })),
      });
      setListe(c.evraklar);
      setDegisti(false);
      message.success("İşe giriş evrak listesi kaydedildi.");
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Kaydedilemedi.");
    } finally {
      setKaydediliyor(false);
    }
  };

  const varsayilan = async () => {
    try {
      const c = await api.al<{ evraklar: Tanim[] }>("/api/IseGirisEvrak/Varsayilan");
      setListe(c.evraklar);
      setDegisti(true);
      message.info("Varsayılan liste getirildi; kalıcı olması için Kaydet'e basınız.");
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Alınamadı.");
    }
  };

  if (yukleniyor)
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <Spin />
      </div>
    );

  return (
    <div className="ge ge-tanim">
      <div className="ge-bas">
        <div className="ge-bas-sol">
          <span className="ge-halka ge-halka-tamam">
            <FileCheck2 size={16} strokeWidth={2.2} />
          </span>
          <div>
            <b>İşe giriş evrakları</b>
            <small>
              Başvurular → İşe al penceresinde ve personel kartında istenen evrak listesi
            </small>
          </div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <Tooltip title={degisti ? "Önce kaydedin: yeni evrakın ayraç numarası kayıtta verilir" : "Toplu tarama için her evrak türüne bir ayraç; bir kez basılıp lamine edilir"}>
            <Button
              icon={<Printer size={14} />}
              disabled={degisti}
              onClick={() => ayracSetiAc(liste.filter((t) => t.aktif)) || message.warning("Ayraç numarası yok; sayfayı yenileyin.")}
            >
              Ayraç seti
            </Button>
          </Tooltip>
          <Popconfirm
            title="Varsayılan listeye dönülsün mü?"
            description="12 maddelik İK listesi getirilir; Kaydet'e basana kadar değişmez."
            okText="Getir"
            cancelText="Vazgeç"
            onConfirm={varsayilan}
          >
            <Button icon={<RotateCcw size={14} />}>Varsayılan</Button>
          </Popconfirm>
          <Button
            type="primary"
            icon={<Save size={14} />}
            disabled={!degisti}
            loading={kaydediliyor}
            onClick={kaydet}
          >
            Kaydet
          </Button>
        </div>
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="Evrakı listeden kaldırmak yerine pasif yapabilirsiniz"
        description="Pasif evrak yeni işe alımlarda istenmez ve eksik sayılmaz; daha önce yüklenmiş dosyalar personel kartında kalır."
      />

      <div className="ge-tanim-tablo">
        <div className="ge-tanim-satir ge-tanim-bas">
          <span>#</span>
          <span>Evrak</span>
          <span>Nereden alınır</span>
          <span>Klasör</span>
          <span>Adet</span>
          <span>Not</span>
          <span>Aktif</span>
          <span />
        </div>

        {liste.map((t, i) => (
          <div className={`ge-tanim-satir${t.aktif ? "" : " ge-tanim-pasif"}`} key={t._yeni ? `yeni-${i}` : t.kod}>
            <span className="ge-no">{i + 1}</span>
            <Input value={t.ad} maxLength={120} onChange={(e) => guncelle(i, { ad: e.target.value })} />
            <Input
              value={t.kaynak ?? ""}
              placeholder="e-Devlet"
              maxLength={120}
              onChange={(e) => guncelle(i, { kaynak: e.target.value })}
            />
            <Select
              value={t.kategori}
              onChange={(v) => guncelle(i, { kategori: v })}
              options={kategoriler.map((k) => ({ value: k, label: k }))}
            />
            <InputNumber style={{ width: "100%" }} min={1} max={20} value={t.adet} onChange={(v) => guncelle(i, { adet: Number(v) || 1 })} />
            <Input
              value={t.not ?? ""}
              placeholder="Kısa not"
              maxLength={200}
              onChange={(e) => guncelle(i, { not: e.target.value })}
            />
            <Switch size="small" checked={t.aktif} onChange={(v) => guncelle(i, { aktif: v })} />
            <span className="ge-tanim-arac">
              <Button size="small" type="text" icon={<ArrowUp size={14} />} disabled={i === 0} onClick={() => tasi(i, -1)} />
              <Button
                size="small"
                type="text"
                icon={<ArrowDown size={14} />}
                disabled={i === liste.length - 1}
                onClick={() => tasi(i, 1)}
              />
              <Tooltip title={t._yeni ? "Kaldır" : "Listeden kaldır (yüklenmiş dosyalar kartta kalır)"}>
                <Button
                  size="small"
                  type="text"
                  danger
                  icon={<Trash2 size={14} />}
                  onClick={() => {
                    setListe((l) => l.filter((_, j) => j !== i));
                    setDegisti(true);
                  }}
                />
              </Tooltip>
            </span>
          </div>
        ))}
      </div>

      <Button
        style={{ marginTop: 10 }}
        icon={<Plus size={14} />}
        onClick={() => {
          setListe((l) => [
            ...l,
            { kod: "", ad: "", kaynak: "", kategori: "Özlük", adet: 1, not: "", aktif: true, _yeni: true },
          ]);
          setDegisti(true);
        }}
      >
        Evrak ekle
      </Button>
    </div>
  );
}
