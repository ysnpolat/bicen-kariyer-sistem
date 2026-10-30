/**
 * Personel Bütçesi (30.10.2026) — İK'nın B_T_E Excel'inin panel karşılığı.
 *
 * Yıl / senaryo başına kişi listesi, zam kuralları ve bütün varsayımlar
 * (asgari ücret, vergi dilimleri, SGK oranları, yan giderler, tek seferlik
 * kalemler, gece çalışması); hesap sunucuda (ButceHesap). Sekmeler: Özet,
 * Kişiler, Zam kuralları, Parametreler, Karşılaştır, Mikro eşleme, Günlük.
 * "Yeni senaryo" sihirbazı baz yıldan yeni yılı türetir ("2027'de herkese
 * %27 zam gelirse maliyet ne olur?").
 *
 * Yalnız Admin, GMY ve İK yöneticisi (sunucu her uçta denetler; her
 * görüntüleme ve dışa aktarma günlüğe yazılır). Ücret verisi adres
 * satırına ve localStorage'a yazılmaz.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { App as AntdApp, Input, Select, Spin } from "antd";
import { BarChart3, CheckCircle2, FileSpreadsheet, GitCompare, History, ListChecks, Lock, Plus, RefreshCw, Settings2, Sparkles, Trash2, Users, UserSearch, Wallet } from "lucide-react";
import { oturumOku } from "./api";
import "./PersonelButcesi.css";
import type { Donem, DonemYaniti, Kural, Parametre } from "./butce/butceOrtak";
import { butceApi, DURUM_ADI, KURAL_TUR_ADI, tarihSaat, yuzde } from "./butce/butceOrtak";
import ButceOzet from "./butce/ButceOzet";
import ButceKisiler from "./butce/ButceKisiler";
import ButceParametreler, { KuralDuzenleyici } from "./butce/ButceParametreler";
import ButceSihirbaz from "./butce/ButceSihirbaz";
import ButceIceAktar from "./butce/ButceIceAktar";
import ButceKarsilastir from "./butce/ButceKarsilastir";

type Sekme = "ozet" | "kisiler" | "kurallar" | "parametre" | "karsilastir" | "mikro" | "gunluk";

/** Panelde menü kapısı: sunucudaki Butce/Ben ile aynı kural */
export const butceGorme = (o: ReturnType<typeof oturumOku>) => !!o && ["Admin", "GenelMudurYardimcisi", "IKYoneticisi"].includes(o.rol);

export default function PersonelButcesi() {
  const { message, modal } = AntdApp.useApp();
  const [ben, setBen] = useState<{ yetkili: boolean; varsayilan?: Parametre } | null>(null);
  const [donemler, setDonemler] = useState<Donem[] | null>(null);
  const [seciliId, setSeciliId] = useState<number | null>(null);
  const [veri, setVeri] = useState<DonemYaniti | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [sekme, setSekme] = useState<Sekme>("ozet");
  const [kisiSuzgec, setKisiSuzgec] = useState<{ sube?: string; meslek?: string } | null>(null);
  const [sihirbaz, setSihirbaz] = useState(false);
  const [iceAktar, setIceAktar] = useState(false);

  useEffect(() => { butceApi.ben().then(setBen).catch(() => setBen({ yetkili: false })); }, []);

  const donemleriYukle = useCallback(async (secilecek?: number) => {
    try {
      const r = await butceApi.donemler();
      setDonemler(r.donemler);
      setSeciliId((s) => secilecek ?? (s && r.donemler.some((d) => d.id === s) ? s : r.donemler[0]?.id ?? null));
    } catch (h: any) { message.error(h?.message ?? "Dönemler okunamadı"); setDonemler([]); }
  }, [message]);
  useEffect(() => { if (ben?.yetkili) void donemleriYukle(); }, [ben, donemleriYukle]);

  const donemYukle = useCallback(async () => {
    if (!seciliId) { setVeri(null); return; }
    setYukleniyor(true);
    try { setVeri(await butceApi.donem(seciliId)); }
    catch (h: any) { message.error(h?.message ?? "Dönem okunamadı"); setVeri(null); }
    finally { setYukleniyor(false); }
  }, [seciliId, message]);
  useEffect(() => { void donemYukle(); }, [donemYukle]);

  const degisti = useCallback(() => { void donemYukle(); void donemleriYukle(); }, [donemYukle, donemleriYukle]);

  if (ben === null) return <div className="pb"><div className="pb-bos"><Spin /></div></div>;
  if (!ben.yetkili) return <div className="pb"><div className="pb-bos"><Lock /><b>Bu sayfa yalnız yönetime açık</b><p>Personel bütçesi ücret verisi içerir; Yönetici, Genel Müdür Yardımcısı ve İK Yöneticisi dışındaki roller göremez.</p></div></div>;

  const d = veri?.donem;
  const sekmeler: { k: Sekme; ad: string; ikon: JSX.Element; sayi?: number }[] = [
    { k: "ozet", ad: "Özet", ikon: <BarChart3 size={15} /> },
    { k: "kisiler", ad: "Kişiler", ikon: <Users size={15} />, sayi: d?.kisiSayisi },
    { k: "kurallar", ad: "Zam kuralları", ikon: <ListChecks size={15} />, sayi: veri?.kurallar.length },
    { k: "parametre", ad: "Parametreler", ikon: <Settings2 size={15} /> },
    { k: "karsilastir", ad: "Karşılaştır", ikon: <GitCompare size={15} /> },
    { k: "mikro", ad: "Mikro eşleme", ikon: <UserSearch size={15} /> },
    { k: "gunluk", ad: "Günlük", ikon: <History size={15} /> },
  ];

  const durumDegistir = (durum: "taslak" | "onayli" | "arsiv") => d && butceApi.donemGuncelle(d.id, { durum }).then(() => { message.success(durum === "onayli" ? "Onaylandı" : durum === "arsiv" ? "Arşivlendi" : "Taslağa alındı"); degisti(); }).catch((h: any) => message.error(h?.message));

  const sil = () => d && modal.confirm({
    title: `${d.ad} silinsin mi?`, content: "Senaryo, kişileri ve kurallarıyla birlikte listeden kalkar.", okText: "Sil", okButtonProps: { danger: true }, cancelText: "Vazgeç",
    onOk: async () => { await butceApi.donemSil(d.id); message.success("Silindi"); setSeciliId(null); void donemleriYukle(); },
  });

  const adDegistir = () => {
    if (!d) return;
    let yeni = d.ad; let aciklama = d.aciklama ?? "";
    modal.confirm({
      title: "Senaryo adı ve açıklaması", okText: "Kaydet", cancelText: "Vazgeç",
      content: <div style={{ display: "grid", gap: 8, marginTop: 8 }}><Input defaultValue={d.ad} onChange={(e) => { yeni = e.target.value; }} placeholder="Ad" /><Input defaultValue={aciklama} onChange={(e) => { aciklama = e.target.value; }} placeholder="Açıklama" /></div>,
      onOk: async () => { await butceApi.donemGuncelle(d.id, { ad: yeni, aciklama }); degisti(); },
    });
  };

  return (
    <div className="pb">
      <div className="pb-ust">
        <div>
          <h1><Wallet size={22} style={{ verticalAlign: -4, marginRight: 8 }} />Personel Bütçesi<small>Yıllık personel maliyeti ve zam senaryoları — bordro, işveren SGK, yan giderler ve tek seferlik kalemler tek yerde.</small></h1>
          <div className="pb-senaryo">
            <Select value={seciliId ?? undefined} onChange={(v) => { setSeciliId(v); setSekme("ozet"); }} placeholder={donemler?.length ? "Senaryo seçin" : "Henüz senaryo yok"} loading={donemler === null}
              options={(donemler ?? []).map((x) => ({ value: x.id, label: `${x.ad}  ·  ${x.yil}  ·  ${x.kisiSayisi} kişi  ·  ${DURUM_ADI[x.durum] ?? x.durum}` }))} />
            {d && <span className={"pb-durum " + d.durum}>{d.durum === "onayli" && <CheckCircle2 size={12} />}{DURUM_ADI[d.durum]}</span>}
            {veri?.baz && <span className="pb-durum baz">baz: {veri.baz.donem.ad}</span>}
            {d && <span className="kucuk">{d.olusturan} · {tarihSaat(d.olusturma)}{d.guncelleme ? ` · son değişiklik ${tarihSaat(d.guncelleme)}` : ""}</span>}
            {yukleniyor && <Spin size="small" />}
          </div>
        </div>
        <div className="islemler">
          <button className="pb-btn" onClick={() => setIceAktar(true)}><FileSpreadsheet /> Excel'den içe aktar</button>
          <button className="pb-btn koyu" disabled={!d} onClick={() => setSihirbaz(true)}><Sparkles /> Yeni senaryo</button>
        </div>
      </div>

      {donemler && donemler.length === 0 && (
        <div className="pb-pk"><div className="pb-bos"><FileSpreadsheet /><b>İlk bütçeyi Excel'den alın</b><p>B_T_E dosyasını "Excel'den içe aktar" ile yükleyin; kişiler, oranlar ve yan giderler okunur. Sonra "Yeni senaryo" ile 2027 için zam senaryoları türetin.</p><button className="pb-btn koyu" onClick={() => setIceAktar(true)}><Plus /> Excel'den içe aktar</button></div></div>
      )}

      {d && veri && (
        <>
          <div className="pb-sekmeler">
            {sekmeler.map((s) => <button key={s.k} className={sekme === s.k ? "on" : ""} onClick={() => setSekme(s.k)}>{s.ikon}{s.ad}{s.sayi ? <em>{s.sayi}</em> : null}</button>)}
            <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6, alignItems: "center", paddingBottom: 6 }}>
              <button className="pb-btn kucuk" onClick={adDegistir}>Ad / açıklama</button>
              {d.durum !== "onayli" ? <button className="pb-btn kucuk" onClick={() => durumDegistir("onayli")}><CheckCircle2 /> Onayla</button> : <button className="pb-btn kucuk" onClick={() => durumDegistir("taslak")}>Taslağa al</button>}
              {d.durum !== "arsiv" && d.durum !== "onayli" && <button className="pb-btn kucuk" onClick={() => durumDegistir("arsiv")}>Arşivle</button>}
              <button className="pb-btn kucuk" onClick={degisti} title="Yeniden hesapla"><RefreshCw /></button>
              {d.durum !== "onayli" && <button className="pb-btn kucuk tehlike" onClick={sil}><Trash2 /></button>}
            </span>
          </div>
          {d.aciklama && <div className="kucuk" style={{ marginTop: -10 }}>{d.aciklama}</div>}

          {sekme === "ozet" && <ButceOzet veri={veri} subeyeGit={(s) => { setKisiSuzgec({ sube: s }); setSekme("kisiler"); }} meslegeGit={(m) => { setKisiSuzgec({ meslek: m }); setSekme("kisiler"); }} />}
          {sekme === "kisiler" && <ButceKisiler donem={d} subeler={veri.subeler} meslekler={veri.meslekler} yanGiderKalemleri={veri.parametre.yanGiderler} onSuzgec={kisiSuzgec} degisti={degisti} />}
          {sekme === "kurallar" && <KurallarSekmesi veri={veri} degisti={degisti} />}
          {sekme === "parametre" && <ParametreSekmesi veri={veri} degisti={degisti} />}
          {sekme === "karsilastir" && <ButceKarsilastir donemler={donemler ?? []} ilkA={d.id} ilkB={d.bazDonemId} />}
          {sekme === "mikro" && <MikroSekmesi donem={d} />}
          {sekme === "gunluk" && <GunlukSekmesi />}
        </>
      )}

      {sihirbaz && d && veri && (
        <ButceSihirbaz donemler={donemler ?? []} bazId={d.id} bazParametre={veri.parametre} subeler={veri.subeler} meslekler={veri.meslekler}
          kapat={() => setSihirbaz(false)} olusturuldu={(id) => { setSihirbaz(false); void donemleriYukle(id); setSekme("ozet"); }} />
      )}
      {iceAktar && ben.varsayilan && (
        <ButceIceAktar varsayilan={ben.varsayilan} kapat={() => setIceAktar(false)} olusturuldu={(id) => { setIceAktar(false); void donemleriYukle(id); setSekme("ozet"); }} />
      )}
    </div>
  );
}

/* ============================================================ zam kuralları */

function KurallarSekmesi({ veri, degisti }: { veri: DonemYaniti; degisti: () => void }) {
  const { message, modal } = AntdApp.useApp();
  const [kurallar, setKurallar] = useState<Kural[]>(veri.kurallar);
  const [kisiler, setKisiler] = useState<{ id: number; ad: string }[] | null>(null);
  const [gidiyor, setGidiyor] = useState(false);
  useEffect(() => { setKurallar(veri.kurallar); }, [veri]);
  useEffect(() => { butceApi.kisiler(veri.donem.id).then((r) => setKisiler(r.kisiler.map((k) => ({ id: k.id, ad: `${k.ad} · ${k.sube} · ${k.meslek ?? ""}` })))).catch(() => setKisiler([])); }, [veri.donem.id]);
  const degistiMi = useMemo(() => JSON.stringify(kurallar) !== JSON.stringify(veri.kurallar), [kurallar, veri.kurallar]);

  const kaydet = (uygula: boolean) => {
    const git = async () => {
      setGidiyor(true);
      try {
        const r = await butceApi.kurallar(veri.donem.id, kurallar, uygula);
        message.success(uygula ? `Kurallar kaydedildi, ${r.uygulanan} kişiye uygulandı` : "Kurallar kaydedildi");
        degisti();
      } catch (h: any) { message.error(h?.message ?? "Kaydedilemedi"); }
      finally { setGidiyor(false); }
    };
    if (uygula) modal.confirm({
      title: "Kurallar kişilere uygulansın mı?", okText: "Uygula", cancelText: "Vazgeç",
      content: veri.baz ? `Her kişinin ${veri.baz.donem.ad} senaryosundaki ücreti üzerine kurallar yeniden uygulanır. Elle düzeltilen kişiler korunur.` : "Bu senaryo bir bazdan türemedi: kişilerin bugünkü ücreti baz sayılır ve kurallar üzerine uygulanır. Elle düzeltilen kişiler korunur.",
      onOk: git,
    }); else void git();
  };

  return (
    <div className="pb-pk">
      <h3>Zam kuralları <small>{veri.baz ? `baz: ${veri.baz.donem.ad} → ${veri.donem.yil}` : "bu senaryonun bugünkü ücretleri üzerine"}</small></h3>
      <p className="aciklama">Kurallar kaydedilip "uygula" denince kişilerin bordro neti ve GRM'si baz ücret × (1 + oran) olarak yeniden yazılır. Sadece kaydetmek ücretleri değiştirmez. Kişinin aldığı etkin oran Kişiler sekmesindeki "Zam" sütununda görünür.</p>
      <KuralDuzenleyici kurallar={kurallar} degistir={setKurallar} subeler={veri.subeler} meslekler={veri.meslekler} kisiler={kisiler ?? undefined} />
      {veri.kurallar.length > 0 && (
        <div className="kucuk" style={{ marginTop: 12 }}>Kayıtlı: {veri.kurallar.map((k) => `${KURAL_TUR_ADI[k.tur]}${k.sube ? ` ${k.sube}` : ""}${k.meslek ? ` ${k.meslek}` : ""}${k.tur === "kisi" ? ` #${k.kisiId}` : ""} ${yuzde(k.bordroOran)}${k.grmOran !== null && k.grmOran !== undefined ? ` (GRM ${yuzde(k.grmOran)})` : ""}`).join(" · ")}</div>
      )}
      <div className="pb-yapiskan">
        <span className="not">{degistiMi ? "Kaydedilmemiş değişiklik var" : ""}</span>
        <button className="pb-btn" disabled={gidiyor} onClick={() => kaydet(false)}>Kaydet</button>
        <button className="pb-btn koyu" disabled={gidiyor || kurallar.length === 0} onClick={() => kaydet(true)}>{gidiyor ? <Spin size="small" /> : <RefreshCw />} Kaydet ve kişilere uygula</button>
      </div>
    </div>
  );
}

/* ============================================================== parametreler */

function ParametreSekmesi({ veri, degisti }: { veri: DonemYaniti; degisti: () => void }) {
  const { message } = AntdApp.useApp();
  const [p, setP] = useState<Parametre>(veri.parametre);
  const [gidiyor, setGidiyor] = useState(false);
  useEffect(() => { setP(veri.parametre); }, [veri]);
  const degistiMi = useMemo(() => JSON.stringify(p) !== JSON.stringify(veri.parametre), [p, veri.parametre]);
  const kaydet = async () => {
    setGidiyor(true);
    try { await butceApi.parametre(veri.donem.id, p); message.success("Parametreler kaydedildi, bütçe yeniden hesaplandı"); degisti(); }
    catch (h: any) { message.error(h?.message ?? "Kaydedilemedi"); }
    finally { setGidiyor(false); }
  };
  return (
    <div className="pb-pk">
      <h3>Parametreler <small>{veri.donem.yil} · asgari net {veri.ozet.asgariNet.toLocaleString("tr-TR", { maximumFractionDigits: 2 })} ₺</small></h3>
      <p className="aciklama">Senaryonun bütün varsayımları. Değişiklik kaydedilince bütün kişiler yeniden hesaplanır; kişi ücretleri değişmez.</p>
      <ButceParametreler p={p} degistir={setP} subeler={veri.subeler} />
      <div className="pb-yapiskan">
        <span className="not">{degistiMi ? "Kaydedilmemiş değişiklik var" : ""}</span>
        <button className="pb-btn" disabled={!degistiMi} onClick={() => setP(veri.parametre)}>Geri al</button>
        <button className="pb-btn koyu" disabled={gidiyor || !degistiMi} onClick={kaydet}>{gidiyor ? <Spin size="small" /> : null} Kaydet ve yeniden hesapla</button>
      </div>
    </div>
  );
}

/* ============================================================== Mikro eşleme */

function MikroSekmesi({ donem }: { donem: Donem }) {
  const [v, setV] = useState<Awaited<ReturnType<typeof butceApi.mikro>> | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  useEffect(() => { setV(null); butceApi.mikro(donem.id).then(setV).catch((h: any) => setHata(h?.message ?? "Okunamadı")); }, [donem.id]);
  if (hata) return <div className="pb-hata">{hata}</div>;
  if (!v) return <div className="pb-bos"><Spin /></div>;
  if (!v.hazir) return <div className="pb-uyari">{v.hata}</div>;
  return (
    <div className="pb-izg esit">
      <div className="pb-pk">
        <h3>Bütçede var, Mikro'da aktif değil <small>{v.butcedeOlupMikrodaYok?.length} kişi</small></h3>
        <p className="aciklama">Bütçedeki sicil / TC, Mikro'daki aktif personelle eşleşmedi: ayrılmış olabilir ya da sicil hatalı. Kişiler sekmesinden pasife alın ya da düzeltin.{v.sicilsiz ? ` Sicili olmayan ${v.sicilsiz} kayıt (boş kadro) eşlemeye girmez.` : ""}</p>
        <div className="pb-tablo yuksek"><table><thead><tr><th>Ad soyad</th><th>Şube</th><th>Meslek</th><th>Sicil</th></tr></thead><tbody>
          {v.butcedeOlupMikrodaYok?.map((k) => <tr key={k.id}><td>{k.ad}</td><td>{k.sube}</td><td>{k.meslek}</td><td className="mono">{k.sicil}</td></tr>)}
        </tbody></table></div>
      </div>
      <div className="pb-pk">
        <h3>Mikro'da aktif, bütçede yok <small>{v.mikrodaOlupButcedeYok?.length} kişi</small></h3>
        <p className="aciklama">Mikro'da çalışan görünen ama bütçede olmayan personel ({v.mikroAktif} aktif / {v.butceAktif} bütçede). Yeni girişler olabilir; Kişiler › "Kişi ekle" ile ekleyin.</p>
        <div className="pb-tablo yuksek"><table><thead><tr><th>Ad soyad</th><th>Şube</th><th>Pozisyon</th><th>Sicil</th><th>Giriş</th></tr></thead><tbody>
          {v.mikrodaOlupButcedeYok?.map((k, i) => <tr key={i}><td>{k.ad}</td><td>{k.sube}</td><td>{k.pozisyon}</td><td className="mono">{k.sicil}</td><td>{k.giris ? new Date(k.giris).toLocaleDateString("tr-TR") : ""}</td></tr>)}
        </tbody></table></div>
      </div>
    </div>
  );
}

/* ==================================================================== günlük */

const ISLEM_ADI: Record<string, string> = {
  goruntule: "Görüntüledi", kisi_listesi: "Kişi listesini açtı", kisi_detay: "Kişi bordrosunu açtı", donem_olustur: "Dönem oluşturdu", donem_guncelle: "Başlık değiştirdi", donem_sil: "Sildi",
  kisi_ekle: "Kişi ekledi", kisi_guncelle: "Kişi düzenledi", kisi_sil: "Kişi sildi", kisi_toplu: "Toplu düzenledi", parametre: "Parametre değiştirdi", kurallar: "Kuralları kaydetti",
  kural_uygula: "Kuralları uyguladı", onizle: "Önizleme hesapladı", senaryo_olustur: "Senaryo oluşturdu", karsilastir: "Karşılaştırdı", mikro_esleme: "Mikro eşlemesi",
  panel_excel_aylik: "Excel: aylık", panel_excel_subeler: "Excel: şubeler", panel_excel_kisiler: "Excel: kişiler", panel_excel_bordro: "Excel: kişi bordrosu",
};

function GunlukSekmesi() {
  const [l, setL] = useState<Awaited<ReturnType<typeof butceApi.gunluk>>["kayitlar"] | null>(null);
  useEffect(() => { butceApi.gunluk().then((r) => setL(r.kayitlar)).catch(() => setL([])); }, []);
  return (
    <div className="pb-pk">
      <h3>Erişim ve değişiklik günlüğü <small>son {l?.length ?? 0} kayıt</small></h3>
      <p className="aciklama">Bütçeye her bakış, dışa aktarma ve değişiklik kullanıcı, zaman ve adresle kaydedilir.</p>
      {!l ? <Spin /> : (
        <div className="pb-tablo yuksek"><table><thead><tr><th>Zaman</th><th>Kullanıcı</th><th>İşlem</th><th>Senaryo</th><th>Ayrıntı</th><th>Adres</th></tr></thead><tbody>
          {l.map((k) => <tr key={k.id}><td>{tarihSaat(k.zaman)}</td><td>{k.ad}<small>{k.kullanici} · {k.rol}</small></td><td>{ISLEM_ADI[k.islem] ?? k.islem}</td><td>{k.donemAd ?? (k.donemId ? `#${k.donemId}` : "")}</td><td style={{ whiteSpace: "normal" }}>{k.ayrinti}</td><td className="mono kucuk">{k.ip}</td></tr>)}
        </tbody></table></div>
      )}
    </div>
  );
}
