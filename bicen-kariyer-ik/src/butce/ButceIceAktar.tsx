/**
 * Excel'den içe aktarma (30.10.2026): B_T_E dosyası tarayıcıda okunur
 * (butceExcel.ts), önizleme ve uyarılar gösterilir, onaylanınca yeni dönem
 * olarak kaydedilir. Dosya sunucuya gönderilmez; yalnız okunan JSON gider.
 */
import { useRef, useState } from "react";
import { App as AntdApp, Input, InputNumber, Modal, Spin } from "antd";
import { AlertTriangle, FileSpreadsheet, Upload } from "lucide-react";
import type { Parametre } from "./butceOrtak";
import { butceApi, para, sayi } from "./butceOrtak";
import { butceExcelOku, type OkumaSonucu } from "./butceExcel";

interface Props { varsayilan: Parametre; kapat: () => void; olusturuldu: (id: number) => void }

export default function ButceIceAktar({ varsayilan, kapat, olusturuldu }: Props) {
  const { message } = AntdApp.useApp();
  const giris = useRef<HTMLInputElement>(null);
  const [okunuyor, setOkunuyor] = useState(false);
  const [sonuc, setSonuc] = useState<OkumaSonucu | null>(null);
  const [dosyaAdi, setDosyaAdi] = useState("");
  const [ustunde, setUstunde] = useState(false);
  const [ad, setAd] = useState("");
  const [yil, setYil] = useState(new Date().getFullYear());
  const [gidiyor, setGidiyor] = useState(false);

  const oku = async (f: File) => {
    setOkunuyor(true);
    try {
      const veri = await f.arrayBuffer();
      const r = butceExcelOku(veri, varsayilan);
      setSonuc(r);
      setDosyaAdi(f.name);
      const y = /20\d\d/.exec(r.sayfa)?.[0];
      if (y) { setYil(Number(y)); setAd(`${y} bütçesi (Excel)`); } else setAd(f.name.replace(/\.[^.]+$/, ""));
    } catch (h: any) { message.error(h?.message ?? "Dosya okunamadı"); }
    finally { setOkunuyor(false); }
  };

  const kaydet = async () => {
    if (!sonuc) return;
    if (!ad.trim()) return message.warning("Dönem adı gerekli");
    setGidiyor(true);
    try {
      const r = await butceApi.donemOlustur({ ad: ad.trim(), yil, kaynak: `excel:${dosyaAdi}`.slice(0, 40), parametre: { ...sonuc.parametre, yil }, kisiler: sonuc.kisiler });
      message.success(`${r.kisi} kişi içe aktarıldı`);
      olusturuldu(r.id);
    } catch (h: any) { message.error(h?.message ?? "Kaydedilemedi"); }
    finally { setGidiyor(false); }
  };

  const hatalar = sonuc?.uyarilar.filter((u) => u.tur === "hata") ?? [];
  const uyarilar = sonuc?.uyarilar.filter((u) => u.tur === "uyari") ?? [];
  const fte = sonuc?.kisiler.reduce((t, k) => t + (k.gun >= 30 ? 1 : 0.5), 0) ?? 0;
  const subeSayisi = new Set(sonuc?.kisiler.map((k) => k.sube)).size;

  return (
    <Modal open onCancel={kapat} width={860} destroyOnClose title="Excel'den içe aktar"
      okText={sonuc ? "Dönem olarak kaydet" : "Kaydet"} cancelText="Vazgeç" onOk={kaydet} okButtonProps={{ disabled: !sonuc || gidiyor, loading: gidiyor }}>
      <div className="pb" style={{ minHeight: 0, padding: 0, background: "none", borderRadius: 0, gap: 12 }}>
        {!sonuc && (
          <div className={"pb-yukle" + (ustunde ? " ustunde" : "")} onClick={() => giris.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setUstunde(true); }} onDragLeave={() => setUstunde(false)}
            onDrop={(e) => { e.preventDefault(); setUstunde(false); const f = e.dataTransfer.files?.[0]; if (f) void oku(f); }}>
            {okunuyor ? <Spin /> : <Upload />}
            <b>B_T_E Excel dosyasını bırakın ya da seçin</b>
            <span>.xlsm / .xlsx — "… BÜTÇE", "HESAP VE TANIM" ve "GECE ÇALIŞMASI AYRINTI" sayfaları okunur. Makro çalıştırılmaz, dosya sunucuya gitmez.</span>
            <input ref={giris} type="file" accept=".xlsx,.xlsm,.xls" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void oku(f); e.target.value = ""; }} />
          </div>
        )}

        {sonuc && (
          <>
            <div className="pb-bilgi" style={{ display: "flex", gap: 10, alignItems: "center" }}><FileSpreadsheet size={16} /> {dosyaAdi} · sayfa "{sonuc.sayfa}" <button className="pb-btn kucuk" style={{ marginLeft: "auto" }} onClick={() => setSonuc(null)}>Başka dosya</button></div>
            <div className="pb-onizleme-ozet">
              <div><small>Kişi</small><b>{sayi(sonuc.kisiler.length)}</b></div>
              <div><small>FTE</small><b>{sayi(fte, 1)}</b></div>
              <div><small>Şube</small><b>{subeSayisi}</b></div>
              <div><small>Emekli</small><b>{sonuc.kisiler.filter((k) => k.emekli).length}</b></div>
              <div><small>Part-time</small><b>{sonuc.kisiler.filter((k) => k.gun < 30).length}</b></div>
              <div><small>Asgari ücret</small><b>{para(sonuc.parametre.asgariUcretBrut)}</b></div>
              <div><small>Yan gider / kişi</small><b>{para(sonuc.parametre.yanGiderler.reduce((t, y) => t + y.tutar, 0))}</b></div>
              <div><small>Tek seferlik kalem</small><b>{sonuc.parametre.tekSeferlikler.length}</b></div>
            </div>
            <div className="pb-form">
              <div className="grup">
                <div><label>Dönem adı</label><Input value={ad} onChange={(e) => setAd(e.target.value)} /></div>
                <div><label>Yıl</label><InputNumber value={yil} onChange={(v) => setYil(v ?? yil)} min={2020} max={2100} /></div>
              </div>
            </div>
            <div className="kucuk">
              Okunan yan giderler: {sonuc.bulunan.yanGider.join(", ") || "yok"}. Tek seferlik: {sonuc.bulunan.tekSeferlik.join(", ") || "yok"}.
              Parametre sayfası {sonuc.bulunan.parametre ? "okundu" : "bulunamadı (varsayılan)"}; gece çalışması tablosu {sonuc.bulunan.gece ? `${sonuc.parametre.geceSubeler.length} şube` : "bulunamadı"}.
              Kazan-Kazan Excel'de toplamdan çıkarılıyordu; burada maliyet olarak eklendi.
            </div>
            {hatalar.length > 0 && <div className="pb-hata"><b>{hatalar.length} satırda eksik veri</b> — bu satırlar yine de aktarılır; Kişiler sekmesinden düzeltin.<ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{hatalar.slice(0, 20).map((u, i) => <li key={i}>Satır {u.satir}{u.ad ? ` · ${u.ad}` : ""}: {u.metin}</li>)}{hatalar.length > 20 && <li>… ve {hatalar.length - 20} satır daha</li>}</ul></div>}
            {uyarilar.length > 0 && <div className="pb-uyari"><AlertTriangle size={16} /><div><b>{uyarilar.length} uyarı</b><ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{uyarilar.slice(0, 30).map((u, i) => <li key={i}>{u.satir ? `Satır ${u.satir}` : ""}{u.ad ? ` · ${u.ad}` : ""}{u.satir || u.ad ? ": " : ""}{u.metin}</li>)}{uyarilar.length > 30 && <li>… ve {uyarilar.length - 30} uyarı daha</li>}</ul></div></div>}
            <div className="pb-tablo yuksek" style={{ maxHeight: 260 }}>
              <table>
                <thead><tr><th>Şube</th><th>Ad soyad</th><th>Meslek</th><th>Gün</th><th>SGK</th><th className="sag">GRM önceki</th><th className="sag">GRM</th><th className="sag">Bordro net</th></tr></thead>
                <tbody>{sonuc.kisiler.slice(0, 200).map((k, i) => (
                  <tr key={i}><td>{k.sube}</td><td>{k.ad}</td><td>{k.meslek}</td><td>{k.gun}</td><td>{k.emekli ? "Emekli" : "Normal"}</td><td className="sag mono">{para(k.grmOnceki)}</td><td className="sag mono">{para(k.grm)}</td><td className="sag mono">{para(k.bordroNet)}</td></tr>
                ))}</tbody>
              </table>
              {sonuc.kisiler.length > 200 && <div className="kucuk" style={{ padding: 8 }}>İlk 200 satır gösteriliyor; tamamı aktarılır.</div>}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
