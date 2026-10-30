/**
 * Yönetim › Avans kuralları
 * ---------------------------------------------------------------------------
 * Mobil avans talebi bu kurallarla denetleniyor. Personel üst limitini
 * görmüyor; aştığında "Bu tutarda avans talebi oluşturamazsınız. Üst
 * limitiniz …" uyarısı alıyor. Kayıt KRY_AYARLAR · AVANS_KURAL.
 */

import { useEffect, useState } from "react";
import { App as AntdApp, Button, Checkbox, Input, InputNumber, Spin, Switch } from "antd";

import { api } from "./api";
import AvansNedenleri from "./AvansNedenleri";
import "./AvansTalepleri.css";

interface Kural {
  acik: boolean;
  yuzde: number;
  ustuAcik: boolean;
  ustCarpan: number;
  taksitler: number[];
  yillikHak: number;
  kesintiGunu: number;
  devamEngel: boolean;
  enAzTutar: number;
  ilkKesintiSecenek: number;
  redGerekceleri: string[];
  bilgiAcik?: boolean;
  bilgiBaslik?: string;
  bilgiMetni?: string;
  karsilananDurumlar?: string[];
}

const tl = (v: number) => `₺${Math.round(v).toLocaleString("tr-TR")}`;

export default function AvansKurallari() {
  const { message } = AntdApp.useApp();

  const [kural, setKural] = useState<Kural | null>(null);
  const [ilk, setIlk] = useState<Kural | null>(null);
  const [kaydediliyor, setKaydediliyor] = useState(false);

  useEffect(() => {
    api
      .al<{ kural: Kural }>("/api/Avans/Kural")
      .then((d) => {
        setKural(d.kural);
        setIlk(d.kural);
      })
      .catch((h: any) => message.error(h.message));
  }, [message]);

  if (!kural) return <Spin />;

  const degis = (p: Partial<Kural>) => setKural({ ...kural, ...p });

  const kaydet = async () => {
    setKaydediliyor(true);

    try {
      const d = await api.gonder<{ kural: Kural }>("/api/Avans/Kural", kural);
      setKural(d.kural);
      setIlk(d.kural);
      message.success("Avans kuralları kaydedildi.");
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setKaydediliyor(false);
    }
  };

  /* Örnek: ₺32.000 maaş */
  const ornekMaas = 32000;
  const limit = Math.floor((ornekMaas * kural.yuzde) / 100 / 100) * 100;
  const ust = kural.ustuAcik ? limit * kural.ustCarpan : limit;
  const degisti = JSON.stringify(kural) !== JSON.stringify(ilk);

  return (
    <div className="avk">
      <div className="avk-satir">
        <div>
          <b>Avans talebi</b>
          <small>Kapalıyken mobil uygulamada yeni talep oluşturulamaz; mevcut avanslar görünmeye devam eder.</small>
        </div>
        <div className="avk-deger">
          <Switch checked={kural.acik} onChange={(v) => degis({ acik: v })} />
          {kural.acik ? "Açık" : "Kapalı"}
        </div>
      </div>

      <div className="avk-satir">
        <div>
          <b>Üst limit</b>
          <small>Aylık net maaşın yüzdesi. Maaş genel merkezde bordrodan, diğer birimlerde personel kartından.</small>
        </div>
        <div className="avk-deger">
          Personel en fazla maaşının
          <InputNumber min={10} max={300} value={kural.yuzde} onChange={(v) => degis({ yuzde: Number(v ?? 95) })} addonBefore="%" style={{ width: 120 }} />
          kadar talep edebilir.
        </div>
      </div>

      <div className="avk-satir">
        <div>
          <b>Maaşın üzerinde talep</b>
          <small>Açıksa limitin katı kadar istenebilir; her taksit limiti aşmayacak kadar taksit zorunlu.</small>
        </div>
        <div className="avk-deger">
          <Switch checked={kural.ustuAcik} onChange={(v) => degis({ ustuAcik: v })} />
          {kural.ustuAcik ? (
            <>
              en fazla limitin
              <InputNumber min={1} max={6} value={kural.ustCarpan} onChange={(v) => degis({ ustCarpan: Number(v ?? 2) })} style={{ width: 70 }} />
              katı
            </>
          ) : (
            "Kapalı: limit aşılamaz"
          )}
        </div>
      </div>

      <div className="avk-satir">
        <div>
          <b>Taksit seçenekleri</b>
          <small>Personel yalnızca seçili taksit sayılarından birini seçebilir. İK onayda başka bir sayı verebilir.</small>
        </div>
        <div className="avk-deger">
          <Checkbox.Group
            value={kural.taksitler}
            onChange={(v) => degis({ taksitler: (v as number[]).sort((a, b) => a - b) })}
            options={[1, 2, 3, 4, 5, 6, 9, 12].map((x) => ({ value: x, label: x === 1 ? "Tek seferde" : `${x} taksit` }))}
          />
        </div>
      </div>

      <div className="avk-satir">
        <div>
          <b>Yılda en fazla talep</b>
          <small>Takvim yılı; reddedilen ve iptal edilen talepler sayılmaz.</small>
        </div>
        <div className="avk-deger">
          <InputNumber min={1} max={24} value={kural.yillikHak} onChange={(v) => degis({ yillikHak: Number(v ?? 2) })} style={{ width: 80 }} />
          kez
        </div>
      </div>

      <div className="avk-satir">
        <div>
          <b>Kesinti günü</b>
          <small>Taksitler her ay bu gün bir önceki ayın maaşından kesilir; personel ekranındaki tarihler buna göre.</small>
        </div>
        <div className="avk-deger">
          Her ayın
          <InputNumber min={1} max={28} value={kural.kesintiGunu} onChange={(v) => degis({ kesintiGunu: Number(v ?? 5) })} style={{ width: 70 }} />
          'i · personel ilk kesinti için sonraki
          <InputNumber min={1} max={6} value={kural.ilkKesintiSecenek} onChange={(v) => degis({ ilkKesintiSecenek: Number(v ?? 3) })} style={{ width: 60 }} />
          aydan birini seçer
        </div>
      </div>

      <div className="avk-satir">
        <div>
          <b>Devam eden avans</b>
          <small>Açıkken ödemesi süren avansı olan personel son taksit kesilene kadar yeni talep oluşturamaz.</small>
        </div>
        <div className="avk-deger">
          <Switch checked={kural.devamEngel} onChange={(v) => degis({ devamEngel: v })} />
          {kural.devamEngel ? "Yeni talep engellenir" : "Yeni talebe izin verilir"}
        </div>
      </div>

      <div className="avk-satir">
        <div>
          <b>En düşük tutar</b>
        </div>
        <div className="avk-deger">
          <InputNumber min={0} step={100} value={kural.enAzTutar} onChange={(v) => degis({ enAzTutar: Number(v ?? 0) })} addonBefore="₺" style={{ width: 150 }} />
        </div>
      </div>

      <div className="avk-satir">
        <div>
          <b>Avans talep kuralları (açılır pencere)</b>
          <small>
            Personel Biçen360'ta avans ekranını açtığında çıkan bilgilendirme. Hangi durumlardaki taleplerin
            karşılanacağını yazın; personel "Okudum, anladım" diyerek devam eder (1.8).
          </small>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
          <Checkbox checked={kural.bilgiAcik ?? true} onChange={(e) => degis({ bilgiAcik: e.target.checked })}>
            Avans ekranı açılınca göster
          </Checkbox>
          <Input
            value={kural.bilgiBaslik ?? ""}
            maxLength={100}
            placeholder="Başlık (ör. Avans talep kuralları)"
            onChange={(e) => degis({ bilgiBaslik: e.target.value })}
          />
          <Input.TextArea
            value={kural.bilgiMetni ?? ""}
            maxLength={1000}
            autoSize={{ minRows: 2, maxRows: 5 }}
            placeholder="Ör. Avans talepleri aşağıdaki durumlarla sınırlıdır. Yalnızca bu kurallara uygun görülen talepler karşılanacaktır."
            onChange={(e) => degis({ bilgiMetni: e.target.value })}
          />
          <small style={{ color: "#6b7280" }}>Karşılanan durumlar</small>
          {(kural.karsilananDurumlar ?? []).map((g, i) => (
            <div key={i} style={{ display: "flex", gap: 6 }}>
              <Input
                value={g}
                maxLength={200}
                placeholder="Ör. Sağlık sorunları"
                onChange={(e) => {
                  const l = [...(kural.karsilananDurumlar ?? [])];
                  l[i] = e.target.value;
                  degis({ karsilananDurumlar: l });
                }}
              />
              <Button
                danger
                type="text"
                onClick={() => degis({ karsilananDurumlar: (kural.karsilananDurumlar ?? []).filter((_, j) => j !== i) })}
              >
                Sil
              </Button>
            </div>
          ))}
          {(kural.karsilananDurumlar?.length ?? 0) < 20 && (
            <Button
              type="dashed"
              onClick={() => degis({ karsilananDurumlar: [...(kural.karsilananDurumlar ?? []), ""] })}
              style={{ alignSelf: "flex-start" }}
            >
              + Durum ekle
            </Button>
          )}
        </div>
      </div>

      <div className="avk-satir">
        <div>
          <b>Hazır ret gerekçeleri</b>
          <small>
            Avans talebini reddederken mobilde (Biçen360 1.8) ve bu panelde çıkan seçenekler. Dokununca gerekçe
            kutusuna yazılır, istenirse düzenlenir. Personel bu metni görür.
          </small>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
          {(kural.redGerekceleri ?? []).map((g, i) => (
            <div key={i} style={{ display: "flex", gap: 6 }}>
              <Input
                value={g}
                maxLength={200}
                onChange={(e) => {
                  const l = [...(kural.redGerekceleri ?? [])];
                  l[i] = e.target.value;
                  degis({ redGerekceleri: l });
                }}
              />
              <Button
                danger
                type="text"
                onClick={() => degis({ redGerekceleri: (kural.redGerekceleri ?? []).filter((_, j) => j !== i) })}
              >
                Sil
              </Button>
            </div>
          ))}
          {(kural.redGerekceleri?.length ?? 0) < 12 && (
            <Button
              type="dashed"
              onClick={() => degis({ redGerekceleri: [...(kural.redGerekceleri ?? []), ""] })}
              style={{ alignSelf: "flex-start" }}
            >
              + Gerekçe ekle
            </Button>
          )}
        </div>
      </div>

      <div className="avk-satir">
        <div>
          <b>Talep nedenleri</b>
          <small>
            Personelin avans isterken seçtiği nedenler. Kaldırılan ya da kapatılan neden yeni taleplerde çıkmaz; eski
            taleplerde yazılı kalır. Bu liste ayrı kaydedilir ("Nedenleri kaydet").
          </small>
        </div>
        <AvansNedenleri />
      </div>

      <div className="avk-ornek">
        <b>Örnek:</b> maaşı {tl(ornekMaas)} olan personel en fazla <b>{tl(ust)}</b> talep edebilir
        {kural.ustuAcik ? ` (limit ${tl(limit)}; üzerinde en az ${Math.ceil(ust / limit)} taksit)` : ""}. {tl(ust + 3000)} yazarsa:
        “Bu tutarda avans talebi oluşturamazsınız. Üst limitiniz {tl(ust)}.” · Yılda {kural.yillikHak} talep ·{" "}
        {kural.devamEngel ? "devam eden avans bitmeden yeni talep yok" : "devam eden avans varken de talep edilebilir"}.
      </div>

      <div>
        <Button type="primary" onClick={kaydet} loading={kaydediliyor} disabled={!degisti}>
          Kaydet
        </Button>
        {degisti && (
          <Button type="text" onClick={() => setKural(ilk)} style={{ marginLeft: 8 }}>
            Geri al
          </Button>
        )}
      </div>
    </div>
  );
}
