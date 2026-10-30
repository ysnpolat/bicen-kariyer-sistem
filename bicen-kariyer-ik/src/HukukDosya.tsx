/**
 * Hukuk masası · dava / süreç dosyası (24.10.2026)
 * Özet, süreç ve süreler, belgeler, yazışma, erişim ve günlük sekmeleri.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { App as AntdApp, Checkbox, DatePicker, Drawer, Input, InputNumber, Modal, Select, Spin } from "antd";
import { ArrowLeft, CalendarPlus, Check, FolderLock, Lock, PenLine, Pencil, RotateCcw, Trash2, Upload, UserPlus } from "lucide-react";
import dayjs from "dayjs";
import { api } from "./api";
import {
  Avatar, Belge, BelgeKarti, Ben, Dosya, HAK_ACIKLAMA, HAKLAR, OLAY_RENK, Olay, Risk, SONUCLAR, TUR_RENK, YaziOzet,
  kalan, para, tarihYaz, yerelTarih,
} from "./hukukOrtak";
import { YaziSatiri, YaziYaz, YaziTaslak } from "./HukukYazisma";

interface DosyaDetay {
  hak: "tam" | "standart" | "okuma";
  dosya: Dosya; olaylar: Olay[]; belgeler: Belge[]; yazilar: YaziOzet[];
  erisim: { anahtar: string; hak: string; ad: string; kurum: string | null }[] | null;
  ik: { aktif: boolean; pozisyon?: string; sube?: string; giris?: string } | null;
}

/* ------------------------------------------------------------------ */
/* Dosya formu (yeni / düzenle)                                         */
/* ------------------------------------------------------------------ */

export function DosyaFormu({ ben, acik, dosya, kapat, kaydedildi }: {
  ben: Ben; acik: boolean; dosya?: Dosya | null; kapat: () => void; kaydedildi: (id: number) => void;
}) {
  const { message } = AntdApp.useApp();
  const bos = { tur: "ise_iade", risk: 1 } as any;
  const [d, setD] = useState<any>(bos);
  const [gidiyor, setGidiyor] = useState(false);

  useEffect(() => {
    if (!acik) return;
    setD(dosya ? {
      ...dosya,
      davaTarihi: dosya.davaTarihi ? dayjs(dosya.davaTarihi) : null,
      tebligTarihi: dosya.tebligTarihi ? dayjs(dosya.tebligTarihi) : null,
    } : bos);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acik, dosya]);

  const a = (k: string) => (v: any) => setD((x: any) => ({ ...x, [k]: v?.target ? v.target.value : v }));
  const kaydet = async () => {
    setGidiyor(true);
    try {
      const g = {
        tur: d.tur, davaciAd: d.davaciAd, davaciSicil: d.davaciSicil, gorev: d.gorev, sube: d.sube, mahkeme: d.mahkeme,
        esasNo: d.esasNo, karsiVekil: d.karsiVekil, davaTarihi: yerelTarih(d.davaTarihi), tebligTarihi: yerelTarih(d.tebligTarihi),
        asama: d.asama, risk: d.risk ?? 1, talepTutar: d.talepTutar ?? null, ozet: d.ozet,
      };
      const r = await api.gonder<{ id: number; dosyaNo?: string }>(dosya ? `/api/Hukuk/Dosya/${dosya.id}` : "/api/Hukuk/Dosya", g);
      message.success(dosya ? "Dosya güncellendi." : `Dosya açıldı · ${r.dosyaNo}`);
      kaydedildi(r.id);
    } catch (e: any) { message.error(e.message); } finally { setGidiyor(false); }
  };

  const L = ({ c }: { c: string }) => <label style={{ fontSize: 11.5, color: "#6f7484", fontWeight: 700, textTransform: "uppercase", letterSpacing: .3 }}>{c}</label>;
  return (
    <Drawer open={acik} onClose={kapat} width={560} title={dosya ? `${dosya.dosyaNo} · düzenle` : "Yeni hukuk dosyası"} destroyOnClose
      extra={<button className="hk-btn koyu" style={{ background: "#14213d", color: "#fff" }} onClick={kaydet} disabled={gidiyor}>{gidiyor ? <Spin size="small" /> : <Check size={16} />} Kaydet</button>}>
      <div style={{ display: "grid", gap: 12 }}>
        <div><L c="Dosya türü" /><Select value={d.tur} onChange={a("tur")} style={{ width: "100%" }} options={ben.turler.map((t) => ({ value: t.kod, label: t.ad }))} /></div>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
          <div><L c="Davacı / karşı taraf" /><Input value={d.davaciAd} onChange={a("davaciAd")} maxLength={150} placeholder="Ad soyad ya da unvan" /></div>
          <div><L c="Sicil (personelse)" /><Input value={d.davaciSicil} onChange={a("davaciSicil")} maxLength={30} placeholder="Ör. 12345" /></div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div><L c="Görev" /><Input value={d.gorev} onChange={a("gorev")} maxLength={120} placeholder="Sicilden otomatik dolar" /></div>
          <div><L c="Şube" /><Input value={d.sube} onChange={a("sube")} maxLength={120} placeholder="Sicilden otomatik dolar" /></div>
        </div>
        <div><L c="Mahkeme / arabulucu" /><Input value={d.mahkeme} onChange={a("mahkeme")} maxLength={200} placeholder="Ör. İstanbul 12. İş Mahkemesi" /></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div><L c="Esas no" /><Input value={d.esasNo} onChange={a("esasNo")} maxLength={60} placeholder="2026/…" /></div>
          <div><L c="Aşama" /><Input value={d.asama} onChange={a("asama")} maxLength={120} placeholder="Ör. Tanık dinleme" /></div>
        </div>
        <div><L c="Karşı taraf vekili" /><Input value={d.karsiVekil} onChange={a("karsiVekil")} maxLength={200} /></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div><L c="Dava / başvuru tarihi" /><DatePicker value={d.davaTarihi} onChange={a("davaTarihi")} format="DD.MM.YYYY" style={{ width: "100%" }} /></div>
          <div><L c="Tebliğ tarihi" /><DatePicker value={d.tebligTarihi} onChange={a("tebligTarihi")} format="DD.MM.YYYY" style={{ width: "100%" }} /></div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div><L c="Risk" /><Select value={d.risk} onChange={a("risk")} style={{ width: "100%" }}
            options={[{ value: 1, label: "Düşük" }, { value: 2, label: "Orta" }, { value: 3, label: "Yüksek" }]} /></div>
          {ben.yetki === "tam" && (
            <div><L c="Talep tutarı (₺)" /><InputNumber value={d.talepTutar} onChange={a("talepTutar")} min={0} style={{ width: "100%" }}
              formatter={(v) => (v ? Number(v).toLocaleString("tr-TR") : "")} parser={(v) => Number((v ?? "").replace(/\D/g, "")) as any} /></div>
          )}
        </div>
        <div><L c="Özet" /><Input.TextArea value={d.ozet} onChange={a("ozet")} maxLength={2000} autoSize={{ minRows: 5, maxRows: 12 }}
          placeholder="Uyuşmazlığın konusu, talepler, şirketin savunması" /></div>
      </div>
    </Drawer>
  );
}

/* ------------------------------------------------------------------ */
/* Süre / süreç kaydı ekle-düzenle                                      */
/* ------------------------------------------------------------------ */

function OlayFormu({ ben, dosyaId, olay, acik, kapat, kaydedildi }: {
  ben: Ben; dosyaId: number; olay: Olay | null; acik: boolean; kapat: () => void; kaydedildi: () => void;
}) {
  const { message } = AntdApp.useApp();
  const [tur, setTur] = useState("durusma");
  const [tarih, setTarih] = useState<dayjs.Dayjs | null>(null);
  const [baslik, setBaslik] = useState("");
  const [aciklama, setAciklama] = useState("");
  const [tamam, setTamam] = useState(false);

  useEffect(() => {
    if (!acik) return;
    setTur(olay?.tur ?? "durusma");
    setTarih(olay ? dayjs(olay.tarih) : null);
    setBaslik(olay?.baslik ?? "");
    setAciklama(olay?.aciklama ?? "");
    setTamam(olay?.tamam ?? false);
  }, [acik, olay]);

  const kaydet = async () => {
    if (!tarih) return message.warning("Tarihi seçiniz.");
    try {
      const g = { tur, tarih: yerelTarih(tarih, true), baslik, aciklama, tamam };
      await api.gonder(olay ? `/api/Hukuk/Olay/${olay.id}` : `/api/Hukuk/Dosya/${dosyaId}/Olay`, g);
      message.success("Kaydedildi.");
      kaydedildi();
    } catch (e: any) { message.error(e.message); }
  };

  return (
    <Modal open={acik} onCancel={kapat} onOk={kaydet} okText="Kaydet" cancelText="Vazgeç" title={olay ? "Kaydı düzenle" : "Süre / süreç kaydı ekle"} destroyOnClose>
      <div style={{ display: "grid", gap: 10 }}>
        <Select value={tur} onChange={setTur} options={ben.olayTurleri.map((t) => ({ value: t.kod, label: t.ad }))} />
        <DatePicker value={tarih} onChange={setTarih} showTime={tur !== "surec" && tur !== "kesin_sure" && tur !== "sure" ? { format: "HH:mm", minuteStep: 5 } : false}
          format={tur === "durusma" || tur === "arabuluculuk" ? "DD.MM.YYYY HH:mm" : "DD.MM.YYYY"} style={{ width: "100%" }} placeholder="Tarih" />
        <Input value={baslik} onChange={(e) => setBaslik(e.target.value)} maxLength={200}
          placeholder={tur === "kesin_sure" ? "Ör. Bilirkişi raporuna itiraz" : tur === "surec" ? "Ör. Dilekçe verildi" : "Başlık (boşsa tür adı)"} />
        <Input.TextArea value={aciklama} onChange={(e) => setAciklama(e.target.value)} maxLength={1000} autoSize={{ minRows: 3, maxRows: 8 }} placeholder="Açıklama" />
        {tur !== "surec" && <Checkbox checked={tamam} onChange={(e) => setTamam(e.target.checked)}>Tamamlandı</Checkbox>}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Dosya sayfası                                                        */
/* ------------------------------------------------------------------ */

const SEKMELER = [
  { kod: "ozet", ad: "Özet" }, { kod: "surec", ad: "Süreç ve süreler" }, { kod: "belge", ad: "Belgeler" },
  { kod: "yazi", ad: "Yazışma" }, { kod: "erisim", ad: "Erişim" }, { kod: "gunluk", ad: "Günlük" },
];

export default function DosyaSayfasi({ id, ben, geri, yaziAc, dosyalar, degisti }: {
  id: number; ben: Ben; geri: () => void; yaziAc: (id: number) => void; dosyalar: { id: number; ad: string }[]; degisti: () => void;
}) {
  const { message, modal } = AntdApp.useApp();
  const [v, setV] = useState<DosyaDetay | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [sekme, setSekme] = useState("ozet");
  const [duzenle, setDuzenle] = useState(false);
  const [olayForm, setOlayForm] = useState<{ olay: Olay | null } | null>(null);
  const [taslak, setTaslak] = useState<YaziTaslak | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [surukle, setSurukle] = useState(false);
  const [gunluk, setGunluk] = useState<{ ad: string; islem: string; hedef: string | null; zaman: string }[] | null>(null);
  const [danismanlar, setDanismanlar] = useState<{ anahtar: string; adSoyad: string; unvan: string | null; kurum: string | null; aktif: boolean }[]>([]);
  const [yeniErisim, setYeniErisim] = useState<{ anahtar?: string; hak: string }>({ hak: "standart" });
  const [kapatForm, setKapatForm] = useState<{ sonuc: string } | null>(null);
  const dosyaGir = useRef<HTMLInputElement>(null);

  const yukle = useCallback(() => {
    api.al<DosyaDetay>(`/api/Hukuk/Dosya/${id}`).then(setV).catch((e) => setHata(e.message));
  }, [id]);
  useEffect(() => { setV(null); setSekme("ozet"); yukle(); }, [yukle]);
  useEffect(() => {
    if (sekme === "gunluk") api.al<{ gunluk: any[] }>(`/api/Hukuk/Dosya/${id}/Gunluk`).then((d) => setGunluk(d.gunluk)).catch(() => setGunluk([]));
    if (sekme === "erisim" && ben.yetki === "tam")
      api.al<{ danismanlar: any[] }>("/api/Hukuk/Danismanlar").then((d) => setDanismanlar(d.danismanlar)).catch(() => setDanismanlar([]));
  }, [sekme, id, ben.yetki]);

  if (hata) return <div className="hk-bos"><b>Dosya açılamadı</b>{hata}<button className="hk-btn" onClick={geri}>Geri dön</button></div>;
  if (!v) return <div className="hk-bos"><Spin /></div>;

  const d = v.dosya;
  const yazabilir = v.hak === "tam" || v.hak === "standart";
  const sonraki = v.olaylar.filter((o) => !o.tamam && o.tur !== "surec" && dayjs(o.tarih).isAfter(dayjs().startOf("day").subtract(1, "second")))[0];
  const sekmeler = SEKMELER.filter((s) => (s.kod !== "erisim" || ben.yetki === "tam") && (s.kod !== "gunluk" || ben.yetki === "tam"));

  const belgeYukle = async (l: File[]) => {
    if (!l.length) return;
    if (l.some((f) => f.size > 300 * 1024 * 1024)) return message.warning("Her belge en fazla 300 MB olabilir.");
    const f = new FormData();
    l.forEach((x) => f.append("dosyalar", x, x.name));
    setYukleniyor(true);
    try {
      await api.dosyaGonder(`/api/Hukuk/Dosya/${id}/Belge`, f);
      message.success(`${l.length} belge eklendi.`);
      yukle();
    } catch (e: any) { message.error(e.message); } finally { setYukleniyor(false); }
  };
  const belgeSil = (b: Belge) => modal.confirm({
    title: "Belge kaldırılsın mı?", content: b.ad, okText: "Kaldır", cancelText: "Vazgeç", okButtonProps: { danger: true },
    onOk: async () => { try { await api.sil(`/api/Hukuk/Belge/${b.id}`); yukle(); } catch (e: any) { message.error(e.message); } },
  });
  const olayTamam = async (o: Olay) => {
    try {
      await api.gonder(`/api/Hukuk/Olay/${o.id}`, { tur: o.tur, tarih: o.tarih, baslik: o.baslik, aciklama: o.aciklama, tamam: !o.tamam });
      yukle(); degisti();
    } catch (e: any) { message.error(e.message); }
  };
  const olaySil = (o: Olay) => modal.confirm({
    title: "Kayıt silinsin mi?", content: o.baslik, okText: "Sil", cancelText: "Vazgeç", okButtonProps: { danger: true },
    onOk: async () => { try { await api.sil(`/api/Hukuk/Olay/${o.id}`); yukle(); degisti(); } catch (e: any) { message.error(e.message); } },
  });
  const erisimYaz = async (anahtar: string, hak: string) => {
    try {
      await api.gonder("/api/Hukuk/Erisim", { dosyaId: id, anahtar, hak });
      message.success(hak ? "Erişim kaydedildi; danışmana bildirim gitti." : "Erişim kaldırıldı.");
      setYeniErisim({ hak: "standart" });
      yukle();
    } catch (e: any) { message.error(e.message); }
  };
  const durumYaz = async (kapat: boolean, sonuc?: string) => {
    try {
      await api.gonder(`/api/Hukuk/Dosya/${id}/Durum`, { kapat, sonuc });
      message.success(kapat ? "Dosya kapatıldı." : "Dosya yeniden açıldı.");
      setKapatForm(null);
      yukle(); degisti();
    } catch (e: any) { message.error(e.message); }
  };

  const ISLEM: Record<string, string> = {
    dosya_ac: "Dosyayı açtı", dosya_yeni: "Dosyayı oluşturdu", dosya_guncelle: "Dosyayı güncelledi", belge_ac: "Belgeyi açtı",
    belge_yukle: "Belge yükledi", belge_sil: "Belgeyi kaldırdı", olay_ekle: "Kayıt ekledi", olay_guncelle: "Kaydı güncelledi",
    olay_sil: "Kaydı sildi", erisim: "Erişimi değiştirdi", durum: "Durumu değiştirdi", yazi: "Yazı gönderdi",
  };

  return (
    <>
      <button className="hk-geri" onClick={geri}><ArrowLeft size={16} /> Dosyalar</button>
      <div className="hk-dust">
        <div>
          <div className="tur">{d.turAdi} · {d.dosyaNo}{d.durum === "kapandi" ? " · KAPANDI" : ""}</div>
          <h1>{d.davaciAd}</h1>
          <small>{[d.gorev, d.sube].filter(Boolean).join(" · ") || "—"}</small>
        </div>
        <div className="sag">
          {yazabilir && <button className="hk-btn" onClick={() => setTaslak({ dosyaId: id })}><PenLine /> Yazı yaz</button>}
          {v.hak === "tam" && <button className="hk-btn" onClick={() => setDuzenle(true)}><Pencil /> Düzenle</button>}
          {ben.yetki === "tam" && (d.durum === "acik"
            ? <button className="hk-btn altin" onClick={() => setKapatForm({ sonuc: "lehe" })}><Lock /> Dosyayı kapat</button>
            : <button className="hk-btn" onClick={() => durumYaz(false)}><RotateCcw /> Yeniden aç</button>)}
        </div>
        <div className="s4">
          <div>Mahkeme<b>{d.mahkeme || "—"}</b></div>
          <div>Esas no<b className="mono">{d.esasNo || "—"}</b></div>
          <div>Aşama<b>{d.durum === "kapandi" ? (SONUCLAR[d.sonuc ?? ""] ?? "Kapandı") : d.asama || "—"}</b></div>
          <div>Sıradaki<b>{sonraki ? `${sonraki.turAdi} · ${dayjs(sonraki.tarih).format("DD.MM")} (${kalan(sonraki.tarih).metin})` : "—"}</b></div>
          <div>{d.talepTutar != null ? "Talep tutarı" : "Risk"}<b>{d.talepTutar != null ? para(d.talepTutar) : ["Düşük", "Düşük", "Orta", "Yüksek"][d.risk]}</b></div>
        </div>
      </div>

      <div className="hk-sekme">
        {sekmeler.map((s) => (
          <button key={s.kod} className={sekme === s.kod ? "on" : ""} onClick={() => setSekme(s.kod)}>
            {s.ad}
            {s.kod === "surec" && <em>{v.olaylar.length}</em>}
            {s.kod === "belge" && <em>{v.belgeler.length}</em>}
            {s.kod === "yazi" && <em>{v.yazilar.length}</em>}
            {s.kod === "erisim" && <em>{v.erisim?.length ?? 0}</em>}
          </button>
        ))}
      </div>

      {sekme === "ozet" && (
        <div className="hk-iki">
          <div className="hk-pk">
            <h3>Dosya bilgileri <small>Açılış {tarihYaz(d.olusturma)}</small></h3>
            <div className="hk-alanlar">
              <div><span>Tür</span><span className={"hk-etiket " + (TUR_RENK[d.tur] ?? "e-gri")} style={{ textTransform: "none", letterSpacing: 0, fontSize: 11 }}>{d.turAdi}</span></div>
              <div><span>Risk</span><Risk d={d.risk} /></div>
              <div><span>Karşı taraf vekili</span>{d.karsiVekil || "—"}</div>
              <div><span>Sicil</span>{d.davaciSicil || "—"}</div>
              <div><span>Dava / başvuru</span>{tarihYaz(d.davaTarihi)}</div>
              <div><span>Tebliğ</span>{tarihYaz(d.tebligTarihi)}</div>
              {d.talepTutar != null && <div><span>Talep tutarı</span><b className="mono">{para(d.talepTutar)}</b></div>}
              {d.tutarGizli && <div><span>Talep tutarı</span><small style={{ color: "var(--s)" }}>Yalnız tam yetki görür</small></div>}
              {d.durum === "kapandi" && <div><span>Sonuç</span>{SONUCLAR[d.sonuc ?? ""] ?? d.sonuc ?? "—"} · {tarihYaz(d.kapanisTarihi)}</div>}
            </div>
            <h3 style={{ marginTop: 20 }}>Özet</h3>
            <p className="hk-ozet">{d.ozet || "Özet yazılmamış."}</p>
          </div>
          <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
            {v.ik && (
              <div className="hk-pk">
                <h3>İK kaydı</h3>
                {v.ik.aktif
                  ? <div className="hk-alanlar"><div><span>Pozisyon</span>{v.ik.pozisyon}</div><div><span>Şube</span>{v.ik.sube}</div><div><span>Giriş</span>{tarihYaz(v.ik.giris)}</div></div>
                  : <small style={{ color: "var(--s)" }}>Bu sicilde aktif personel yok (ayrılmış olabilir).</small>}
              </div>
            )}
            <div className="hk-pk">
              <h3>Yaklaşan <a onClick={() => setSekme("surec")}>Tümü</a></h3>
              {v.olaylar.filter((o) => !o.tamam && o.tur !== "surec").slice(0, 4).map((o) => (
                <div key={o.id} className="hk-olay" style={{ marginBottom: 8 }} onClick={() => setSekme("surec")}>
                  <span className={"hk-etiket " + (OLAY_RENK[o.tur] ?? "e-gri")}>{o.turAdi}</span>
                  <div><b>{o.baslik}</b><small>{tarihYaz(o.tarih, true)}</small></div>
                  <span className="hk-sayac" style={{ color: kalan(o.tarih).renk }}>{kalan(o.tarih).metin}</span>
                </div>
              ))}
              {v.olaylar.filter((o) => !o.tamam && o.tur !== "surec").length === 0 && <small style={{ color: "var(--s)" }}>Bekleyen süre yok.</small>}
            </div>
            {v.erisim && v.erisim.length > 0 && (
              <div className="hk-pk">
                <h3>Dosyadaki danışmanlar</h3>
                <div className="hk-erisim">
                  {v.erisim.map((e) => (
                    <div key={e.anahtar} className="s"><Avatar ad={e.ad} boyut={32} /><div><b>{e.ad}</b><small>{e.kurum ?? ""} · {HAKLAR[e.hak]}</small></div></div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {sekme === "surec" && (
        <div className="hk-pk">
          <h3>Süreç ve süreler
            {yazabilir && <button className="hk-btn koyu kucuk" style={{ marginLeft: "auto" }} onClick={() => setOlayForm({ olay: null })}><CalendarPlus /> Kayıt ekle</button>}
          </h3>
          {v.olaylar.length === 0 ? <div className="hk-bos"><b>Kayıt yok</b>Duruşma, kesin süre, arabuluculuk toplantısı ya da süreç kaydı ekleyiniz.</div> : (
            <div className="hk-cz">
              {[...v.olaylar].sort((a, b) => dayjs(b.tarih).valueOf() - dayjs(a.tarih).valueOf()).map((o) => {
                const gecmis = dayjs(o.tarih).isBefore(dayjs().startOf("day"));
                const cls = o.tur === "surec" ? "b" : o.tamam ? "" : o.tur === "kesin_sure" ? "k" : "a";
                return (
                  <div key={o.id} className="hk-ce">
                    <i className={cls} />
                    <div>
                      <span className={"hk-etiket " + (OLAY_RENK[o.tur] ?? "e-gri")}>{o.turAdi}</span>{" "}
                      {o.tamam && o.tur !== "surec" && <span className="hk-etiket e-yes">Tamamlandı</span>}
                      {!o.tamam && o.tur !== "surec" && <span className="hk-sayac" style={{ color: kalan(o.tarih).renk, marginLeft: 6 }}>{gecmis ? "Geçti" : kalan(o.tarih).metin}</span>}
                      <b style={{ marginTop: 4 }}>{o.baslik}</b>
                      <small>{tarihYaz(o.tarih, true)}{o.ekleyenAd ? ` · ${o.ekleyenAd}` : ""}</small>
                      {o.aciklama && <p>{o.aciklama}</p>}
                    </div>
                    {yazabilir && (
                      <div className="isl">
                        {o.tur !== "surec" && <button className="hk-btn kucuk" title={o.tamam ? "Tamamlanmadı" : "Tamamlandı"} onClick={() => olayTamam(o)}><Check /></button>}
                        <button className="hk-btn kucuk" title="Düzenle" onClick={() => setOlayForm({ olay: o })}><Pencil /></button>
                        {v.hak === "tam" && <button className="hk-btn kucuk tehlike" title="Sil" onClick={() => olaySil(o)}><Trash2 /></button>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {sekme === "belge" && (
        <div className="hk-pk" style={{ display: "grid", gap: 14 }}>
          <h3 style={{ margin: 0 }}>Belgeler <small>Dilekçe, tutanak, bilirkişi raporu, UYAP çıktıları, görseller</small></h3>
          {yazabilir && (
            <div className={"hk-surukle" + (surukle ? " ust" : "")} onClick={() => dosyaGir.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setSurukle(true); }} onDragLeave={() => setSurukle(false)}
              onDrop={(e) => { e.preventDefault(); setSurukle(false); belgeYukle(Array.from(e.dataTransfer.files)); }}>
              {yukleniyor ? <Spin /> : <><Upload size={18} style={{ verticalAlign: -4 }} /> Belgeleri buraya sürükleyin ya da tıklayıp seçin <small>(PDF, UDF, görsel, Word… en fazla 300 MB)</small></>}
              <input ref={dosyaGir} type="file" multiple hidden onChange={(e) => { belgeYukle(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
            </div>
          )}
          {v.belgeler.length === 0 ? <div className="hk-bos"><FolderLock /><b>Belge yok</b></div> : (
            <div className="hk-galeri">
              {v.belgeler.map((b) => <BelgeKarti key={b.id} b={b} sil={yazabilir && !b.yaziId ? () => belgeSil(b) : undefined} />)}
            </div>
          )}
        </div>
      )}

      {sekme === "yazi" && (
        <div className="hk-pk" style={{ padding: 0, overflow: "hidden" }}>
          <h3 style={{ padding: "16px 18px 0" }}>Dosyanın yazıları
            {yazabilir && <button className="hk-btn koyu kucuk" style={{ marginLeft: "auto" }} onClick={() => setTaslak({ dosyaId: id })}><PenLine /> Yeni yazı</button>}
          </h3>
          {v.yazilar.length === 0 ? <div className="hk-bos"><b>Yazı yok</b>Bu dosyayla ilgili resmi yazı bulunmuyor.</div>
            : v.yazilar.map((y) => <YaziSatiri key={y.id} y={y} tikla={() => yaziAc(y.id)} />)}
        </div>
      )}

      {sekme === "erisim" && v.erisim && (
        <div className="hk-iki">
          <div className="hk-pk">
            <h3>Dosyaya erişen dış danışmanlar</h3>
            <div className="hk-erisim">
              {v.erisim.length === 0 && <small style={{ color: "var(--s)" }}>Henüz danışman eklenmedi. İç ekip (İK hukuk) tüm dosyaları görür.</small>}
              {v.erisim.map((e) => (
                <div key={e.anahtar} className="s">
                  <Avatar ad={e.ad} boyut={34} />
                  <div><b>{e.ad}</b><small>{e.kurum ?? ""}</small></div>
                  <Select size="small" value={e.hak} style={{ width: 140 }} onChange={(h) => erisimYaz(e.anahtar, h)}
                    options={Object.entries(HAKLAR).map(([k, a]) => ({ value: k, label: a }))} />
                  <button className="hk-btn kucuk tehlike" onClick={() => erisimYaz(e.anahtar, "")} title="Erişimi kaldır"><Trash2 /></button>
                </div>
              ))}
            </div>
          </div>
          <div className="hk-pk">
            <h3>Danışman ekle</h3>
            <div style={{ display: "grid", gap: 10 }}>
              <Select placeholder="Danışman seçiniz" value={yeniErisim.anahtar} onChange={(a) => setYeniErisim({ ...yeniErisim, anahtar: a })}
                showSearch optionFilterProp="label"
                options={danismanlar.filter((x) => x.aktif && !v.erisim!.some((e) => e.anahtar === x.anahtar))
                  .map((x) => ({ value: x.anahtar, label: `${x.unvan ? x.unvan + " " : ""}${x.adSoyad}${x.kurum ? " · " + x.kurum : ""}` }))}
                notFoundContent="Aktif danışman yok; Yetkiler sayfasından ekleyiniz." />
              <div style={{ display: "grid", gap: 6 }}>
                {Object.entries(HAKLAR).map(([k, a]) => (
                  <label key={k} style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer", padding: "8px 10px", border: "1px solid var(--cizgi)", borderRadius: 10, background: yeniErisim.hak === k ? "var(--aA)" : "#fff" }}>
                    <input type="radio" checked={yeniErisim.hak === k} onChange={() => setYeniErisim({ ...yeniErisim, hak: k })} style={{ marginTop: 4 }} />
                    <span><b style={{ fontSize: 13 }}>{a}</b><br /><small style={{ color: "var(--s)" }}>{HAK_ACIKLAMA[k]}</small></span>
                  </label>
                ))}
              </div>
              <button className="hk-btn koyu" disabled={!yeniErisim.anahtar} onClick={() => erisimYaz(yeniErisim.anahtar!, yeniErisim.hak)}><UserPlus /> Erişim ver</button>
              <small style={{ color: "var(--s)" }}>Talep tutarı danışmanlara gösterilmez.</small>
            </div>
          </div>
        </div>
      )}

      {sekme === "gunluk" && (
        <div className="hk-pk">
          <h3>Erişim günlüğü <small>Son 300 işlem</small></h3>
          {gunluk === null ? <Spin /> : gunluk.length === 0 ? <small>Kayıt yok.</small> : (
            <div className="hk-tablo"><table style={{ minWidth: 520 }}>
              <thead><tr><th>Zaman</th><th>Kişi</th><th>İşlem</th><th>Ayrıntı</th></tr></thead>
              <tbody>{gunluk.map((g, i) => (
                <tr key={i} style={{ cursor: "default" }}>
                  <td className="mono">{dayjs(g.zaman).format("DD.MM.YYYY HH:mm")}</td><td>{g.ad}</td>
                  <td>{ISLEM[g.islem] ?? g.islem}</td><td><small>{g.hedef}</small></td>
                </tr>))}
              </tbody></table></div>
          )}
        </div>
      )}

      <DosyaFormu ben={ben} acik={duzenle} dosya={d} kapat={() => setDuzenle(false)} kaydedildi={() => { setDuzenle(false); yukle(); degisti(); }} />
      <OlayFormu ben={ben} dosyaId={id} acik={!!olayForm} olay={olayForm?.olay ?? null} kapat={() => setOlayForm(null)}
        kaydedildi={() => { setOlayForm(null); yukle(); degisti(); }} />
      <YaziYaz ben={ben} taslak={taslak} kapat={() => setTaslak(null)} dosyalar={dosyalar}
        gonderildi={(yid) => { setTaslak(null); yukle(); yaziAc(yid); }} />
      <Modal open={!!kapatForm} title="Dosyayı kapat" okText="Kapat" cancelText="Vazgeç" onCancel={() => setKapatForm(null)}
        onOk={() => durumYaz(true, kapatForm!.sonuc)}>
        <p style={{ color: "#6f7484" }}>Kapanan dosyanın bekleyen süreleri ajandadan çıkar; dosya ve belgeler arşivde kalır.</p>
        <Select style={{ width: "100%" }} value={kapatForm?.sonuc} onChange={(s) => setKapatForm({ sonuc: s })}
          options={Object.entries(SONUCLAR).map(([k, a]) => ({ value: k, label: a }))} />
      </Modal>
    </>
  );
}
