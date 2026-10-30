/**
 * Tamir / bakım kaydı penceresi.
 *
 * Kalemler (parça, işçilik, diğer) adet × birim fiyatla toplanıyor, KDV
 * seçilerek genel toplam çıkıyor. Tutarı sunucu yeniden hesaplıyor;
 * buradaki toplam yalnızca gösterim. "Garanti kapsamında" işaretlenirse
 * kayıt tutarıyla duruyor ama maliyete eklenmiyor.
 *
 * Bağlı arızanın servis formu varsa onun tutarı zaten maliyette: aynı
 * tutarı ikinci kez girmemek için uyarı çıkıyor.
 *
 * Aşama (09.10.2026): Merkezde bekliyor → Firmaya gönderildi (firma adı
 * zorunlu) → Tamamlandı. Bitmemiş kayıtta cihaz "Bakımda" görünüyor.
 * Kayda fotoğraf eklenebiliyor (gönderilmeden önceki hâli, servis fişi…).
 */

import { useEffect, useRef, useState } from "react";
import { Modal, Popconfirm, message } from "antd";

import { api } from "../../api";
import {
  ASAMA_AD,
  BUGUN,
  TAMIR_ASAMA,
  TAMIR_TUR,
  belgeAc,
  resimMi,
  useBelgeResimleri,
  type Belge,
  araToplam,
  gunFark,
  gunMetni,
  kalemTutari,
  tarih,
  tl,
  type Ariza,
  type Ayrinti,
  type Cihaz,
  type Kalem,
  type Tamir,
} from "./ortak";

export type TamirAcilis = { mevcut?: Tamir; tur?: string };

export default function TamirPenceresi({
  cihaz,
  arizalar,
  firmalar,
  belgeler = [],
  acilis,
  kapat,
  kaydedildi,
}: {
  cihaz: Cihaz;
  arizalar: Ariza[];
  firmalar: string[];
  belgeler?: Belge[];
  acilis: TamirAcilis;
  kapat: () => void;
  kaydedildi: (a: Ayrinti) => void;
}) {
  const m = acilis.mevcut;
  const garantide = !!cihaz.garantiBitis && gunFark(cihaz.garantiBitis) >= 0;
  const bakimTuru = acilis.tur === "bakim" || acilis.tur === "kalibrasyon";

  const [tur, setTur] = useState(m?.tur ?? acilis.tur ?? "tamir");
  const [t, setT] = useState(gunMetni(m?.tarih) || BUGUN());
  const [arizaId, setArizaId] = useState<number | "">(m?.arizaId ?? "");
  const [firma, setFirma] = useState(m?.firma ?? (bakimTuru ? cihaz.bakimFirmasi ?? "" : ""));
  const [yapan, setYapan] = useState(m?.yapan ?? "dis");
  const [gunDisi, setGunDisi] = useState(m?.gunDisi ?? 0);
  const [fatura, setFatura] = useState(m?.faturaNo ?? "");
  const [aciklama, setAciklama] = useState(m?.aciklama ?? "");
  const [kdv, setKdv] = useState(m?.kdv ?? 20);
  const [garanti, setGaranti] = useState(m ? m.garantide : garantide && !bakimTuru);
  const [durumGuncelle, setDurumGuncelle] = useState(true);
  /* Yeni arıza onarımı çoğunlukla merkezde başlıyor; bakım kaydı iş bitince giriliyor */
  const [asama, setAsama] = useState<string>(m?.asama ?? (bakimTuru ? "tamamlandi" : "merkezde"));
  const [fotolar, setFotolar] = useState<{ dosya: File; adres: string }[]>([]);
  const fotoRef = useRef<HTMLInputElement>(null);
  const mevcutFotolar = m ? belgeler.filter((b) => b.tamirId === m.id && (b.tur === "Fotoğraf" || resimMi(b.ozgunAd))) : [];
  const kucukResim = useBelgeResimleri(mevcutFotolar.map((b) => b.id));
  const bitti = asama === "tamamlandi";

  useEffect(() => () => fotolar.forEach((f) => URL.revokeObjectURL(f.adres)), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [kalemler, setKalemler] = useState<Kalem[]>(
    m?.kalemler?.length
      ? m.kalemler.map((k) => ({ ...k, birim: k.birim ?? 0 }))
      : [bakimTuru ? { ad: "Periyodik bakım", tip: "iscilik", adet: 1, birim: 0 } : { ad: "", tip: "parca", adet: 1, birim: 0 }]
  );
  const [dosyalar, setDosyalar] = useState<File[]>([]);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const dosyaRef = useRef<HTMLInputElement>(null);
  const ilkAlan = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => ilkAlan.current?.focus(), 80);
  }, []);

  const ara = araToplam(kalemler);
  const toplam = ara * (1 + kdv / 100);
  const secilenAriza = arizalar.find((a) => a.id === arizaId);

  const kalemDegistir = (n: number, alan: keyof Kalem, deger: string) =>
    setKalemler((l) =>
      l.map((k, i) => (i === n ? { ...k, [alan]: alan === "adet" || alan === "birim" ? Number(deger.replace(",", ".")) || 0 : deger } : k))
    );

  const kaydet = async () => {
    if (!t) return message.warning("Tarihi seçiniz.");
    if (!firma.trim() && asama !== "merkezde")
      return message.warning(asama === "firmada" ? "Cihazın gönderildiği firmayı yazınız." : "Servis ya da firma adını yazınız.");

    setKaydediliyor(true);

    try {
      const c = await api.gonder<{ id: number; ayrinti: Ayrinti }>(`Envanter/${cihaz.id}/Tamir`, {
        id: m?.id ?? 0,
        tarih: t,
        tur,
        arizaId: arizaId || null,
        firma: firma.trim(),
        yapan,
        gunDisi,
        kalemler: kalemler.filter((k) => k.ad.trim() || (k.birim ?? 0) > 0),
        kdv,
        garantide: garanti,
        faturaNo: fatura.trim() || null,
        aciklama: aciklama.trim() || null,
        durumGuncelle,
        asama,
      });

      let ayrinti = c.ayrinti;

      /* Seçilen belgeler ve fotoğraflar kayda bağlı yükleniyor */
      const yuklenecek: [File, string][] = [...dosyalar.map((d) => [d, "Fatura"] as [File, string]), ...fotolar.map((f) => [f.dosya, "Fotoğraf"] as [File, string])];
      if (yuklenecek.length) {
        for (const [d, belgeTur] of yuklenecek) {
          const f = new FormData();
          f.append("dosya", d, d.name || "fotograf.jpg");
          f.append("tur", belgeTur);
          f.append("tamirId", String(c.id));
          await api.dosyaGonder(`Envanter/${cihaz.id}/Belge`, f);
        }
        ayrinti = await api.getir<Ayrinti>(`Envanter/${cihaz.id}`);
      }

      message.success(
        bitti
          ? `Kaydedildi · ${garanti ? "garanti kapsamında" : tl(toplam)}`
          : `Kaydedildi · ${ASAMA_AD[asama]}${asama === "firmada" && firma.trim() ? ` (${firma.trim()})` : ""}`
      );
      kaydedildi(ayrinti);
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Kaydedilemedi.");
    } finally {
      setKaydediliyor(false);
    }
  };

  const sil = async () => {
    if (!m) return;

    try {
      const c = await api.sil<{ ayrinti: Ayrinti }>(`Envanter/Tamir/${m.id}`);
      message.success("Kayıt silindi.");
      kaydedildi(c.ayrinti);
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Silinemedi.");
    }
  };

  return (
    <Modal
      open
      width={820}
      rootClassName="ev"
      title={m ? "Tamir kaydını düzenle" : "Yeni tamir / bakım kaydı"}
      onCancel={kapat}
      footer={
        <div className="ev-satirac" style={{ justifyContent: "flex-start" }}>
          <button className="ev-btn ana" disabled={kaydediliyor} onClick={kaydet}>{kaydediliyor ? "Kaydediliyor…" : "Kaydet"}</button>
          <button className="ev-btn" onClick={kapat}>Vazgeç</button>
          <span className="ev-bos" />
          {m && (
            <Popconfirm title="Kayıt ve ekli belgeleri silinsin mi?" okText="Sil" okButtonProps={{ danger: true }} cancelText="Vazgeç" onConfirm={sil}>
              <button className="ev-btn tehlike">Kaydı sil</button>
            </Popconfirm>
          )}
        </div>
      }
    >
      <div className="ev-modal-ic">
        <div className="ev-tursec" role="group" aria-label="İş türü">
          {TAMIR_TUR.map(([k, a, r]) => (
            <button key={k} type="button" style={{ ["--d" as any]: r }} aria-pressed={tur === k} onClick={() => setTur(k)}>
              {a}
            </button>
          ))}
        </div>

        <div className="ev-asama" role="group" aria-label="Aşama">
          {TAMIR_ASAMA.map(([k, a, ikon]) => (
            <button key={k} type="button" aria-pressed={asama === k} onClick={() => setAsama(k)}>
              <span aria-hidden>{ikon}</span> {a}
            </button>
          ))}
        </div>
        <div className="ev-kucuk-not" style={{ marginTop: -4 }}>{TAMIR_ASAMA.find((x) => x[0] === asama)?.[3]}</div>

        <div className="ev-ikili">
          <label>
            {asama === "firmada" ? "Gönderim tarihi" : asama === "merkezde" ? "Kayıt tarihi" : "Tarih"}
            <input ref={ilkAlan} type="date" value={t} max={BUGUN()} onChange={(e) => setT(e.target.value)} />
          </label>
          <label>
            Bağlı arıza kaydı
            <select value={arizaId} onChange={(e) => setArizaId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">— yok —</option>
              {arizalar.map((a) => (
                <option key={a.id} value={a.id}>#{a.id} · {a.baslik}</option>
              ))}
            </select>
          </label>
          <label>
            {asama === "firmada" ? "Gönderilen firma *" : asama === "merkezde" ? "Servis / firma (belliyse)" : "Servis / firma"}
            <input
              value={firma}
              list="evFirmalar"
              placeholder={asama === "firmada" ? "Cihazın gönderildiği firma" : "Firma adı ya da iç ekip"}
              className={asama === "firmada" && !firma.trim() ? "ev-eksik" : undefined}
              onChange={(e) => setFirma(e.target.value)}
            />
          </label>
          <label>
            Kim yaptı
            <select value={yapan} onChange={(e) => setYapan(e.target.value)}>
              <option value="dis">Dış servis</option>
              <option value="ic">İç ekip (BT / teknik)</option>
            </select>
          </label>
          <label>
            Hizmet dışı kaldığı süre (gün)
            <input type="number" min={0} value={gunDisi} onChange={(e) => setGunDisi(Math.max(0, Number(e.target.value) || 0))} />
          </label>
          <label>
            Fatura / servis formu no
            <input className="ev-mono" value={fatura} onChange={(e) => setFatura(e.target.value)} />
          </label>
        </div>
        <datalist id="evFirmalar">
          {firmalar.map((f) => <option key={f} value={f} />)}
        </datalist>

        {secilenAriza?.servisToplam != null && (
          <div className="ev-uyarikutu">
            <span>ℹ️</span>
            <span>
              Bu arızanın servis formu ({secilenAriza.formNo}) <b>{tl(secilenAriza.servisToplam)}</b> olarak maliyete zaten dahil.
              Aynı parça ve işçiliği burada tekrar girmeyin; yalnızca forma girilmeyen ek giderleri yazın.
            </span>
          </div>
        )}

        <div>
          <div className="ev-tablo">
            <table className="ev-kalemtablo">
              <thead>
                <tr>
                  <th style={{ width: "40%" }}>Kalem</th>
                  <th>Tür</th>
                  <th className="sag" style={{ width: 70 }}>Adet</th>
                  <th className="sag" style={{ width: 130 }}>Birim fiyat (₺)</th>
                  <th className="sag" style={{ width: 110 }}>Tutar</th>
                  <th style={{ width: 30 }} />
                </tr>
              </thead>
              <tbody>
                {kalemler.map((k, n) => (
                  <tr key={n}>
                    <td>
                      <label className="ev-sr" htmlFor={`evKAd${n}`}>Kalem</label>
                      <input id={`evKAd${n}`} value={k.ad} placeholder="Parça ya da işçilik" onChange={(e) => kalemDegistir(n, "ad", e.target.value)} />
                    </td>
                    <td>
                      <label className="ev-sr" htmlFor={`evKTip${n}`}>Tür</label>
                      <select id={`evKTip${n}`} value={k.tip} onChange={(e) => kalemDegistir(n, "tip", e.target.value)}>
                        <option value="parca">Parça</option>
                        <option value="iscilik">İşçilik</option>
                        <option value="diger">Diğer</option>
                      </select>
                    </td>
                    <td>
                      <label className="ev-sr" htmlFor={`evKAdet${n}`}>Adet</label>
                      <input id={`evKAdet${n}`} type="number" min={0} step="1" style={{ textAlign: "right" }} value={k.adet} onChange={(e) => kalemDegistir(n, "adet", e.target.value)} />
                    </td>
                    <td>
                      <label className="ev-sr" htmlFor={`evKBirim${n}`}>Birim fiyat</label>
                      <input id={`evKBirim${n}`} type="number" min={0} step="0.01" style={{ textAlign: "right" }} value={k.birim ?? 0} onChange={(e) => kalemDegistir(n, "birim", e.target.value)} />
                    </td>
                    <td className="sag">{tl(kalemTutari(k))}</td>
                    <td>
                      <button type="button" className="ev-sil" style={{ border: 0, background: "none", color: "var(--soluk)", fontSize: 16 }} aria-label="Kalemi sil" onClick={() => setKalemler((l) => l.filter((_, i) => i !== n))}>×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="ev-satirac" style={{ marginTop: 6 }}>
            <button type="button" className="ev-btn kucuk" onClick={() => setKalemler((l) => [...l, { ad: "", tip: "parca", adet: 1, birim: 0 }])}>+ Parça</button>
            <button type="button" className="ev-btn kucuk" onClick={() => setKalemler((l) => [...l, { ad: "İşçilik", tip: "iscilik", adet: 1, birim: 0 }])}>+ İşçilik</button>
            <button type="button" className="ev-btn kucuk" onClick={() => setKalemler((l) => [...l, { ad: "", tip: "diger", adet: 1, birim: 0 }])}>+ Diğer (yol, nakliye)</button>
          </div>
        </div>

        <div className="ev-ikili" style={{ alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label className="ev-anahtar">
              <input type="checkbox" checked={garanti} onChange={(e) => setGaranti(e.target.checked)} /> Garanti kapsamında (bize maliyeti yok)
            </label>
            <span className="ev-kucuk-not">
              {garantide ? `Cihaz ${tarih(cihaz.garantiBitis)} tarihine kadar garantili.` : cihaz.garantiBitis ? `Cihazın garantisi ${tarih(cihaz.garantiBitis)} tarihinde bitti.` : "Cihazın garanti bilgisi yok."}
            </span>
            <label className="ev-anahtar">
              <input type="checkbox" checked={durumGuncelle} onChange={(e) => setDurumGuncelle(e.target.checked)} />
              {bitti
                ? <>Kaydedince cihazı "Çalışıyor" yap{tur === "bakim" || tur === "kalibrasyon" ? " ve sonraki bakımı hesapla" : ""}</>
                : <>Cihazı "Bakımda" göster (tamir bitene kadar)</>}
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 700, color: "var(--soluk)" }}>
              Açıklama
              <textarea rows={3} value={aciklama} placeholder="Ne yapıldı, parça nereden geldi…" onChange={(e) => setAciklama(e.target.value)} />
            </label>
            <div className="ev-fotolar">
              {mevcutFotolar.map((b) => (
                <button key={b.id} type="button" className="ev-foto" title={b.ozgunAd ?? "Fotoğraf"} onClick={() => belgeAc(b.id).catch((h) => message.error(h.message))}>
                  {kucukResim[b.id] ? <img src={kucukResim[b.id]} alt="" /> : <span>📷</span>}
                </button>
              ))}
              {fotolar.map((f, n) => (
                <span key={f.adres} className="ev-foto yeni">
                  <img src={f.adres} alt="" />
                  <button
                    type="button"
                    aria-label="Fotoğrafı kaldır"
                    onClick={() => {
                      URL.revokeObjectURL(f.adres);
                      setFotolar((l) => l.filter((_, i) => i !== n));
                    }}
                  >
                    ×
                  </button>
                </span>
              ))}
              <button type="button" className="ev-foto ekle" onClick={() => fotoRef.current?.click()}>
                <span>📷</span>
                <small>Fotoğraf ekle</small>
              </button>
            </div>
            <input
              ref={fotoRef}
              type="file"
              multiple
              hidden
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              onChange={(e) => {
                const l = [...(e.target.files ?? [])];
                e.target.value = "";
                setFotolar((d) => [...d, ...l.map((dosya) => ({ dosya, adres: URL.createObjectURL(dosya) }))]);
              }}
            />
            <div className="ev-satirac">
              <button type="button" className="ev-btn" onClick={() => dosyaRef.current?.click()}>📎 Fatura / servis formu ekle</button>
              {m && m.belgeSayisi > 0 && <span className="ev-kucuk-not">{m.belgeSayisi} belge ekli</span>}
              {dosyalar.map((d, n) => (
                <span key={n} className="ev-rozet">
                  {d.name}
                  <button type="button" style={{ border: 0, background: "none", padding: 0 }} aria-label="Kaldır" onClick={() => setDosyalar((l) => l.filter((_, i) => i !== n))}>×</button>
                </span>
              ))}
            </div>
            <input
              ref={dosyaRef}
              type="file"
              multiple
              hidden
              accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx"
              onChange={(e) => {
                const l = [...(e.target.files ?? [])];
                e.target.value = "";
                setDosyalar((d) => [...d, ...l]);
              }}
            />
          </div>
          <div className="ev-toplam">
            <span>Ara toplam</span>
            <b>{tl(ara)}</b>
            <span>
              KDV{" "}
              <label className="ev-sr" htmlFor="evKdv">KDV oranı</label>
              <select id="evKdv" value={kdv} style={{ padding: "1px 4px", fontSize: 12 }} onChange={(e) => setKdv(Number(e.target.value))}>
                {[0, 1, 10, 20].map((k) => <option key={k} value={k}>%{k}</option>)}
              </select>
            </span>
            <b>{tl(ara * kdv / 100)}</b>
            <span className="ev-buyuk">Toplam</span>
            <b className="ev-buyuk">{tl(toplam)}</b>
            {garanti && (
              <>
                <span>Bize maliyeti</span>
                <b style={{ color: "var(--iyi)" }}>₺0 · garantide</b>
              </>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
