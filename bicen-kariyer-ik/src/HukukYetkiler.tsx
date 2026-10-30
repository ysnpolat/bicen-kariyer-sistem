/**
 * Hukuk masası · yetkiler (24.10.2026)
 * Dış hukuk danışmanları: kimlik numarası ve cep telefonu tanımlanır; mobil
 * uygulamaya ve panele bunlarla (SMS koduyla) girerler. Kimlik numarası
 * sunucuda saklanmaz, yalnız özeti tutulur. İç ekip yetkileri: panel
 * kullanıcısı ya da personel sicili.
 */
import { useCallback, useEffect, useState } from "react";
import { App as AntdApp, Drawer, Input, Select, Spin, Switch } from "antd";
import { Check, Pencil, ShieldCheck, Smartphone, Trash2, UserPlus } from "lucide-react";
import dayjs from "dayjs";
import { api } from "./api";
import { Avatar, Ben, HAKLAR } from "./hukukOrtak";
import "./HukukMasasi.css";

interface Danisman {
  id: number; anahtar: string; adSoyad: string; kimlikTanimli: boolean; kimlikSon: string | null; kimlikNo?: string; unvan: string | null; kurum: string | null;
  eposta: string | null; telefon: string | null; aktif: boolean; sonGiris: string | null; olusturma: string;
  dosyalar: { id: number; dosyaNo: string; davaciAd: string; hak: string; turAdi: string }[];
}
interface EkipUye { anahtar: string; ad: string; rol: "hukuk" | "okuma"; tur: "panel" | "personel"; olusturma: string }

export default function HukukYetkiler({ ben, dosyaAc }: { ben: Ben; dosyaAc: (id: number) => void }) {
  const { message } = AntdApp.useApp();
  const [danismanlar, setDanismanlar] = useState<Danisman[] | null>(null);
  const [ekip, setEkip] = useState<{ ekip: EkipUye[]; panelKullanicilari: { anahtar: string; ad: string; rol: string }[]; not: string } | null>(null);
  const [form, setForm] = useState<Partial<Danisman> | null>(null);
  const [yeniUye, setYeniUye] = useState<{ tur: "u" | "p"; deger?: string; rol: "hukuk" | "okuma" }>({ tur: "u", rol: "hukuk" });
  const tam = ben.yetki === "tam";

  const yukle = useCallback(() => {
    api.al<{ danismanlar: Danisman[] }>("/api/Hukuk/Danismanlar").then((d) => setDanismanlar(d.danismanlar)).catch(() => setDanismanlar([]));
    api.al<any>("/api/Hukuk/Ekip").then(setEkip).catch(() => setEkip(null));
  }, []);
  useEffect(yukle, [yukle]);

  const kaydet = async () => {
    if (!form) return;
    try {
      await api.gonder(
        form.id ? `/api/Hukuk/Danisman/${form.id}` : "/api/Hukuk/Danisman",
        { kimlikNo: form.kimlikNo ?? "", adSoyad: form.adSoyad, unvan: form.unvan, kurum: form.kurum, eposta: form.eposta, telefon: form.telefon, aktif: form.aktif ?? true },
      );
      setForm(null);
      message.success("Kaydedildi. Danışman kimlik numarası ve telefonuyla giriş yapabilir.");
      yukle();
    } catch (e: any) { message.error(e.message); }
  };
  const ekipYaz = async (anahtar: string, rol: string) => {
    try {
      await api.gonder("/api/Hukuk/Ekip", { anahtar, rol });
      message.success(rol ? "Yetki kaydedildi." : "Yetki kaldırıldı.");
      setYeniUye({ tur: "u", rol: "hukuk" });
      yukle();
    } catch (e: any) { message.error(e.message); }
  };
  const a = (k: keyof Danisman) => (e: any) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));

  return (
    <>
      <div className="hk-ph">
        <div>
          <h1>Yetkiler</h1>
          <p>Dış hukuk danışmanları ve Biçen hukuk ekibi. Dosya erişimi her dosyanın “Erişim” sekmesinden verilir.</p>
        </div>
        {tam && <div className="sag"><button className="hk-btn koyu" onClick={() => setForm({ aktif: true })}><UserPlus /> Danışman ekle</button></div>}
      </div>

      <div className="hk-pk">
        <h3>Dış hukuk danışmanları <small>Mobil uygulamaya ve panele kimlik numarası + telefon + SMS koduyla girerler; yalnız erişim verilen dosyaları görürler</small></h3>
        {danismanlar === null ? <Spin /> : danismanlar.length === 0 ? (
          <div className="hk-bos"><ShieldCheck /><b>Henüz danışman yok</b>“Danışman ekle” ile kimlik numarası ve telefonunu tanımlayın.</div>
        ) : (
          <div className="hk-tablo"><table>
            <thead><tr><th>Danışman</th><th>Kimlik</th><th>Giriş telefonu</th><th>Dosyalar</th><th>Son giriş</th><th>Durum</th><th /></tr></thead>
            <tbody>{danismanlar.map((d) => (
              <tr key={d.id} style={{ cursor: "default", opacity: d.aktif ? 1 : .55 }}>
                <td><div style={{ display: "flex", gap: 10, alignItems: "center" }}><Avatar ad={d.adSoyad} boyut={34} />
                  <div><span className="ad">{d.unvan ? d.unvan + " " : ""}{d.adSoyad}</span><small>{d.kurum ?? ""}</small></div></div></td>
                <td className="mono">{d.kimlikTanimli ? `••••••••• ${d.kimlikSon ?? ""}` : <span className="hk-etiket e-tur">Tanımsız</span>}</td>
                <td className="mono">{d.telefon ? `•••• ••• ${d.telefon.slice(-4, -2)} ${d.telefon.slice(-2)}` : <span className="hk-etiket e-tur">Telefon yok</span>}</td>
                <td style={{ maxWidth: 280 }}>
                  {d.dosyalar.length === 0 ? <small>—</small> : (
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {d.dosyalar.map((x) => (
                        <span key={x.id} className="hk-etiket e-alt" style={{ cursor: "pointer" }} title={`${x.davaciAd} · ${HAKLAR[x.hak]}`} onClick={() => dosyaAc(x.id)}>{x.dosyaNo}</span>
                      ))}
                    </div>)}
                </td>
                <td><small>{d.sonGiris ? dayjs(d.sonGiris).format("DD.MM.YYYY HH:mm") : "Hiç girmedi"}</small></td>
                <td>{d.aktif ? <span className="hk-etiket e-yes">Aktif</span> : <span className="hk-etiket e-gri">Pasif</span>}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {tam && <>
                    <button className="hk-btn kucuk" title="Düzenle" onClick={() => setForm({ ...d, kimlikNo: "" })}><Pencil /></button>
                  </>}
                </td>
              </tr>))}
            </tbody></table></div>
        )}
      </div>

      <div className="hk-iki">
        <div className="hk-pk">
          <h3>Biçen hukuk ekibi <small>{ekip?.not}</small></h3>
          <div className="hk-erisim">
            {(ekip?.ekip ?? []).length === 0 && <small style={{ color: "var(--s)" }}>Ek üye yok.</small>}
            {(ekip?.ekip ?? []).map((u) => (
              <div key={u.anahtar} className="s">
                <Avatar ad={u.ad} boyut={34} />
                <div><b>{u.ad}</b><small>{u.tur === "panel" ? "Panel kullanıcısı" : "Personel · mobil uygulama"}</small></div>
                <Select size="small" value={u.rol} disabled={!tam} style={{ width: 150 }} onChange={(r) => ekipYaz(u.anahtar, r)}
                  options={[{ value: "hukuk", label: "Hukuk (tam)" }, { value: "okuma", label: "Yalnız okuma" }]} />
                {tam && <button className="hk-btn kucuk tehlike" title="Kaldır" onClick={() => ekipYaz(u.anahtar, "")}><Trash2 /></button>}
              </div>
            ))}
          </div>
        </div>
        {tam && (
          <div className="hk-pk">
            <h3>Ekibe ekle</h3>
            <div style={{ display: "grid", gap: 10 }}>
              <div className="hk-seg" style={{ justifySelf: "start" }}>
                <button className={yeniUye.tur === "u" ? "on" : ""} onClick={() => setYeniUye({ ...yeniUye, tur: "u", deger: undefined })}>Panel kullanıcısı</button>
                <button className={yeniUye.tur === "p" ? "on" : ""} onClick={() => setYeniUye({ ...yeniUye, tur: "p", deger: undefined })}>Personel (sicil)</button>
              </div>
              {yeniUye.tur === "u" ? (
                <Select showSearch optionFilterProp="label" placeholder="Kullanıcı seçiniz" value={yeniUye.deger}
                  onChange={(v) => setYeniUye({ ...yeniUye, deger: v })}
                  options={(ekip?.panelKullanicilari ?? []).filter((p) => !ekip?.ekip.some((e) => e.anahtar === p.anahtar)).map((p) => ({ value: p.anahtar, label: p.ad }))} />
              ) : (
                <Input placeholder="Personel sicili" value={yeniUye.deger} onChange={(e) => setYeniUye({ ...yeniUye, deger: e.target.value })} maxLength={30} />
              )}
              <Select value={yeniUye.rol} onChange={(r) => setYeniUye({ ...yeniUye, rol: r })}
                options={[{ value: "hukuk", label: "Hukuk (tam yetki: tüm dosyalar, düzenleme, yazışma)" }, { value: "okuma", label: "Yalnız okuma" }]} />
              <button className="hk-btn koyu" disabled={!yeniUye.deger?.trim()}
                onClick={() => ekipYaz(yeniUye.tur === "u" ? yeniUye.deger! : "p:" + yeniUye.deger!.trim(), yeniUye.rol)}><Check /> Yetki ver</button>
              <small style={{ color: "var(--s)" }}>Personel sicilinden eklenen kişi hukuk masasını mobil uygulamada görür.</small>
            </div>
          </div>
        )}
      </div>

      <Drawer open={!!form} onClose={() => setForm(null)} width={460} title={form?.id ? "Danışmanı düzenle" : "Yeni dış hukuk danışmanı"} destroyOnClose
        extra={<button className="hk-btn" style={{ background: "#14213d", color: "#fff" }} onClick={kaydet}><Check size={16} /> Kaydet</button>}>
        {form && (
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
              <div><small>Unvan</small><Input value={form.unvan ?? ""} onChange={a("unvan")} placeholder="Av." maxLength={60} /></div>
              <div><small>Ad soyad *</small><Input value={form.adSoyad ?? ""} onChange={a("adSoyad")} maxLength={150} /></div>
            </div>
            <div><small>Büro / kurum</small><Input value={form.kurum ?? ""} onChange={a("kurum")} placeholder="Ör. Örnek Hukuk Bürosu" maxLength={200} /></div>
            <div><small>T.C. kimlik numarası {form.id ? "(değiştirmek için yazınız)" : "*"}</small>
              <Input value={form.kimlikNo ?? ""} onChange={(e) => setForm((f) => ({ ...f, kimlikNo: e.target.value.replace(/\D/g, "").slice(0, 11) }))}
                inputMode="numeric" placeholder={form.id && form.kimlikTanimli ? `••••••••• ${form.kimlikSon ?? ""}` : "11 haneli"} maxLength={11} autoComplete="off" /></div>
            <div><small>Cep telefonu * (girişte SMS kodu bu numaraya gider)</small><Input value={form.telefon ?? ""} onChange={a("telefon")} placeholder="5xx xxx xx xx" maxLength={16} inputMode="tel" /></div>
            <div><small>E-posta</small><Input value={form.eposta ?? ""} onChange={a("eposta")} maxLength={150} /></div>
            <label style={{ display: "flex", gap: 10, alignItems: "center" }}><Switch checked={form.aktif ?? true} onChange={a("aktif")} /> Hesap aktif</label>
            <div className="hk-giris-not" style={{ display: "flex", gap: 8 }}><Smartphone size={16} style={{ flex: "none", marginTop: 2 }} />
              <span>Danışman Biçen360 uygulamasının giriş ekranında kimlik numarası ve bu telefonla giriş yapar; SMS kodu gelir. Panel girişinde “Hukuk danışmanı girişi” bağlantısını kullanır. Kimlik numarası sistemde açık olarak saklanmaz.</span></div>
          </div>
        )}
      </Drawer>

    </>
  );
}

/** Yönetim sayfasındaki "Hukuk görünümü" bölümü: aynı ekran, kendi çerçevesiyle */
export function HukukYetkiYonetimi() {
  const [ben, setBen] = useState<Ben | null | false>(null);
  useEffect(() => {
    api.al<Ben>("/api/Hukuk/Ben").then((b) => setBen(b.yetkili ? b : false)).catch(() => setBen(false));
  }, []);
  if (ben === null) return <Spin />;
  if (ben === false) return <div style={{ color: "#6f7484" }}>Hukuk masası yetkiniz yok.</div>;
  return (
    <div className="hk" style={{ minHeight: 0 }}>
      <div className="hk-ana"><HukukYetkiler ben={ben} dosyaAc={() => undefined} /></div>
    </div>
  );
}
