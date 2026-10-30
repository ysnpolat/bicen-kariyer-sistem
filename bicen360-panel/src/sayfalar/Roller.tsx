/**
 * Yönetim › Roller (13.10.2026)
 * ---------------------------------------------------------------------------
 * Portal rolü: hangi sayfalar açık (görür / yönetir), hangi departmanların
 * kayıtları görünür, Raporlar'da hangi sekmeler çıkar ve tutarlar görünür
 * mü. Role atanan kullanıcının menüsü ve verisi buna göre süzülür.
 *
 * Atama portal içinde tutuluyor; İK panelindeki rolü değişmez. Kişi bazlı
 * "departman temsilcisi" tanımı da çalışmaya devam eder: kişi hem rolünün
 * hem temsilcisi olduğu departmanların kayıtlarını görür.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Empty, Input, Popconfirm, Select, Spin, Switch, Tag, message } from "antd";
import { Check, Info, Plus, ShieldCheck, Trash2, UserMinus, X } from "lucide-react";

import { api } from "../api";

interface Rol {
  id: number;
  ad: string;
  aciklama?: string | null;
  tumDepartmanlar: boolean;
  maliyet: boolean;
  departmanlar: number[];
  sayfalar: Record<string, number>;
  raporlar: string[];
}

interface Kullanici {
  kullaniciAdi: string;
  adSoyad: string;
  rol: string;
  sicil?: string | null;
  subeKodu?: string | null;
  aktif: boolean;
  portalRolId?: number | null;
}

interface Katalog {
  sayfalar: { kod: string; ad: string; aciklama: string; yonetim: boolean }[];
  raporlar: { kod: string; ad: string; sayfa: string; maliyet: boolean }[];
  departmanlar: { id: number; ad: string }[];
}

const bosRol = (): Rol => ({
  id: 0,
  ad: "Yeni rol",
  aciklama: "",
  tumDepartmanlar: false,
  maliyet: false,
  departmanlar: [],
  sayfalar: { ariza: 1, envanter: 1, rapor: 1 },
  raporlar: ["ariza", "envanter"],
});

const bas = (a: string) =>
  (a || "?")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x[0])
    .join("")
    .toLocaleUpperCase("tr");

export default function Roller() {
  const [roller, setRoller] = useState<Rol[]>([]);
  const [kullanicilar, setKullanicilar] = useState<Kullanici[]>([]);
  const [katalog, setKatalog] = useState<Katalog | null>(null);
  const [secili, setSecili] = useState<number | null>(null);
  const [taslak, setTaslak] = useState<Rol | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [kaydediliyor, setKaydediliyor] = useState(false);

  const getir = useCallback(async (secilecek?: number) => {
    setYukleniyor(true);
    try {
      const c = await api.getir<{ roller: Rol[]; kullanicilar: Kullanici[]; katalog: Katalog }>("Rol");
      setRoller(c.roller);
      setKullanicilar(c.kullanicilar);
      setKatalog(c.katalog);
      const hedef = secilecek ?? secili ?? c.roller[0]?.id ?? null;
      const r = c.roller.find((x) => x.id === hedef) ?? c.roller[0];
      setSecili(r?.id ?? null);
      setTaslak(r ? JSON.parse(JSON.stringify(r)) : null);
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setYukleniyor(false);
    }
  }, [secili]);

  useEffect(() => {
    getir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sec = (r: Rol) => {
    setSecili(r.id);
    setTaslak(JSON.parse(JSON.stringify(r)));
  };

  const degisti = useMemo(() => {
    if (!taslak) return false;
    if (taslak.id === 0) return true;
    const asil = roller.find((r) => r.id === taslak.id);
    return JSON.stringify(asil) !== JSON.stringify(taslak);
  }, [taslak, roller]);

  const guncelle = (f: (t: Rol) => void) =>
    setTaslak((t) => {
      if (!t) return t;
      const y: Rol = JSON.parse(JSON.stringify(t));
      f(y);
      return y;
    });

  const kaydet = async () => {
    if (!taslak) return;
    setKaydediliyor(true);
    try {
      const c = await api.gonder<{ id: number }>("Rol", { ...taslak, id: taslak.id || null });
      message.success(`“${taslak.ad}” rolü kaydedildi.`);
      await getir(c.id);
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setKaydediliyor(false);
    }
  };

  const sil = async () => {
    if (!taslak?.id) return;
    try {
      await api.sil(`Rol/${taslak.id}`);
      message.success("Rol silindi.");
      setSecili(null);
      await getir(roller.find((r) => r.id !== taslak.id)?.id);
    } catch (h: any) {
      message.error(h.message);
    }
  };

  const ata = async (kullaniciAdi: string, rolId: number | null) => {
    try {
      await api.gonder("Rol/Ata", { kullaniciAdi, rolId });
      setKullanicilar((l) => l.map((k) => (k.kullaniciAdi === kullaniciAdi ? { ...k, portalRolId: rolId } : k)));
      message.success(rolId ? "Kullanıcı role eklendi." : "Kullanıcı rolden çıkarıldı.");
    } catch (h: any) {
      message.error(h.message);
    }
  };

  if (yukleniyor && !katalog) return <Spin style={{ display: "block", margin: "40px auto" }} />;
  if (!katalog) return <Empty description="Roller yüklenemedi." />;

  const T = taslak;
  const raporAcik = !!T?.sayfalar.rapor;
  const roldekiler = T ? kullanicilar.filter((k) => T.id && k.portalRolId === T.id) : [];
  const depAdi = (id: number) => katalog.departmanlar.find((d) => d.id === id)?.ad ?? `#${id}`;

  const ozet = T
    ? [
        `Menü: ${katalog.sayfalar
            .filter((s) => T.sayfalar[s.kod])
            .map((s) => s.ad + (s.yonetim && T.sayfalar[s.kod] === 2 ? (s.kod === "ariza" ? " (yönetir)" : " (düzenler)") : ""))
            .join(" · ") || "hiçbir sayfa"}`,
        T.sayfalar.ariza || T.sayfalar.envanter
          ? `Arıza kayıtları ve cihazlar: ${
              T.tumDepartmanlar ? "tüm departmanlar" : T.departmanlar.length ? T.departmanlar.map(depAdi).join(", ") : "departman seçilmedi (yalnızca temsilcisi olduğu departmanlar)"
            }`
          : null,
        T.sayfalar.rapor
          ? `Raporlar: ${katalog.raporlar.filter((r) => T.raporlar.includes(r.kod) && T.sayfalar[r.sayfa] && (!r.maliyet || T.maliyet)).map((r) => r.ad).join(", ") || "hiçbiri"}`
          : null,
        `Tutarlar: ${T.maliyet ? "görür" : "gizli"}`,
      ].filter(Boolean)
    : [];

  return (
    <div className="rol">
      <style>{CSS}</style>

      <Alert
        type="info"
        showIcon
        icon={<Info size={16} />}
        style={{ marginBottom: 14 }}
        message="Rol bir ya da birkaç departmana eşlenir; role atanan kullanıcı yalnızca bu departmanların arıza kayıtlarını, cihazlarını ve raporlarını görür. Kişi bazlı departman temsilciliği de geçerli kalır. Admin rolü her şeyi görür, burada düzenlenmez."
      />

      <div className="rol-izgara">
        <div className="rol-kart rol-liste">
          <div className="rol-liste-ust">
            <b>Roller</b>
            <Button size="small" icon={<Plus size={14} />} onClick={() => { setSecili(0); setTaslak(bosRol()); }}>
              Yeni rol
            </Button>
          </div>
          {roller.length === 0 && !T && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Henüz rol yok" />}
          {roller.map((r) => {
            const n = kullanicilar.filter((k) => k.portalRolId === r.id).length;
            return (
              <div key={r.id} className={`rol-satir ${r.id === secili ? "on" : ""}`} onClick={() => sec(r)}>
                <div className="rol-s1">
                  <ShieldCheck size={15} />
                  <b>{r.ad}</b>
                  <small>{n} kişi</small>
                </div>
                <div className="rol-deps">
                  {r.tumDepartmanlar ? (
                    <Tag>Tüm departmanlar</Tag>
                  ) : r.departmanlar.length ? (
                    r.departmanlar.map((d) => <Tag key={d}>{depAdi(d)}</Tag>)
                  ) : (
                    <span className="rol-ipucu">Departman yok</span>
                  )}
                </div>
              </div>
            );
          })}
          {secili === 0 && T && (
            <div className="rol-satir on">
              <div className="rol-s1"><ShieldCheck size={15} /><b>{T.ad}</b><small>kaydedilmedi</small></div>
            </div>
          )}
        </div>

        {T ? (
          <div className="rol-kart rol-duzen">
            <div className="rol-ust">
              <ShieldCheck size={20} color="#5f8c10" />
              <Input
                value={T.ad}
                onChange={(e) => guncelle((t) => { t.ad = e.target.value; })}
                className="rol-adi"
                maxLength={80}
                aria-label="Rol adı"
              />
              {T.id > 0 && (
                <Popconfirm
                  title="Rol silinsin mi?"
                  description={roldekiler.length ? "Önce kullanıcıları rolden çıkarın." : "Bu işlem geri alınamaz."}
                  okText="Sil"
                  cancelText="Vazgeç"
                  onConfirm={sil}
                >
                  <Button danger icon={<Trash2 size={14} />}>Sil</Button>
                </Popconfirm>
              )}
            </div>
            <div className="rol-blok" style={{ paddingTop: 12 }}>
              <Input
                value={T.aciklama ?? ""}
                placeholder="Açıklama (ör. bilgisayar, yazarkasa ve ağ arızaları)"
                onChange={(e) => guncelle((t) => { t.aciklama = e.target.value; })}
              />
            </div>

            <div className="rol-blok">
              <h3><span className="no">1</span>Departmanlar</h3>
              <p className="rol-ipucu rol-girinti">Rolün kayıtlarını göreceği departmanlar. Arıza kayıtları, cihazlar ve raporlar buna göre süzülür.</p>
              <div className="rol-kapsamlar rol-girinti">
                <div className={`rol-kps ${!T.tumDepartmanlar ? "on" : ""}`} onClick={() => guncelle((t) => { t.tumDepartmanlar = false; })}>
                  <span className="rd" />
                  <span><b>Seçilen departmanlar</b><small>Yalnızca işaretli departmanların kayıtları.</small></span>
                </div>
                <div className={`rol-kps ${T.tumDepartmanlar ? "on" : ""}`} onClick={() => guncelle((t) => { t.tumDepartmanlar = true; })}>
                  <span className="rd" />
                  <span><b>Tüm departmanlar</b><small>Bütün departmanların kayıtları.</small></span>
                </div>
              </div>
              <div className="rol-cipler rol-girinti">
                {katalog.departmanlar.map((d) => {
                  const on = T.tumDepartmanlar || T.departmanlar.includes(d.id);
                  return (
                    <span
                      key={d.id}
                      className={`rol-cip ${on ? "on" : ""} ${T.tumDepartmanlar ? "kapali" : ""}`}
                      onClick={() =>
                        !T.tumDepartmanlar &&
                        guncelle((t) => {
                          t.departmanlar = t.departmanlar.includes(d.id) ? t.departmanlar.filter((x) => x !== d.id) : [...t.departmanlar, d.id];
                        })
                      }
                    >
                      <span className="kt">{on && <Check size={11} strokeWidth={3} />}</span>
                      {d.ad}
                    </span>
                  );
                })}
                {katalog.departmanlar.length === 0 && <span className="rol-ipucu">Önce Departmanlar sekmesinde departman tanımlayın.</span>}
              </div>
            </div>

            <div className="rol-blok">
              <h3><span className="no">2</span>Sayfalar</h3>
              <p className="rol-ipucu rol-girinti">Rol menüde yalnızca açık sayfaları görür. Arıza Kayıtları ve Envanter'de yönetme ayrı açılır.</p>
              <div className="rol-sayfalar rol-girinti">
                <div className="rol-st bas"><span>Sayfa</span><span>Görür</span><span>Yönetir</span></div>
                {katalog.sayfalar.map((s) => {
                  const v = T.sayfalar[s.kod] ?? 0;
                  return (
                    <div key={s.kod} className="rol-st">
                      <span><b>{s.ad}</b><small>{s.aciklama}</small></span>
                      <span>
                        <Switch
                          size="small"
                          checked={v > 0}
                          onChange={(c) => guncelle((t) => { if (c) t.sayfalar[s.kod] = 1; else delete t.sayfalar[s.kod]; })}
                        />
                      </span>
                      <span>
                        {s.yonetim ? (
                          <Switch
                            size="small"
                            checked={v === 2}
                            disabled={v === 0}
                            onChange={(c) => guncelle((t) => { t.sayfalar[s.kod] = c ? 2 : 1; })}
                          />
                        ) : (
                          <span className="rol-ipucu">—</span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rol-blok">
              <h3><span className="no">3</span>Raporlar</h3>
              <p className="rol-ipucu rol-girinti">Raporlar sayfasında görünecek sekmeler. Yalnızca sayfası açık olan raporlar seçilebilir.</p>
              <div className="rol-cipler rol-girinti">
                {katalog.raporlar.map((r) => {
                  const izin = raporAcik && !!T.sayfalar[r.sayfa] && (!r.maliyet || T.maliyet);
                  const on = izin && T.raporlar.includes(r.kod);
                  return (
                    <span
                      key={r.kod}
                      className={`rol-cip ${on ? "on" : ""} ${izin ? "" : "kapali"}`}
                      onClick={() =>
                        izin &&
                        guncelle((t) => {
                          t.raporlar = t.raporlar.includes(r.kod) ? t.raporlar.filter((x) => x !== r.kod) : [...t.raporlar, r.kod];
                        })
                      }
                    >
                      <span className="kt">{on && <Check size={11} strokeWidth={3} />}</span>
                      {r.ad}
                    </span>
                  );
                })}
              </div>
              {!raporAcik && <p className="rol-ipucu rol-girinti" style={{ marginTop: 8 }}>Raporlar sayfası kapalı; önce 2. adımda açın.</p>}
            </div>

            <div className="rol-blok">
              <h3><span className="no">4</span>Maliyet</h3>
              <div className="rol-girinti" style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <Switch checked={T.maliyet} onChange={(c) => guncelle((t) => { t.maliyet = c; if (!c) t.raporlar = t.raporlar.filter((x) => x !== "maliyet"); })} />
                <span>
                  Alış bedeli, tamir ve servis tutarlarını görür{" "}
                  <span className="rol-ipucu">(kapalıysa tutar alanları gizlenir; şube kullanıcıları zaten göremez)</span>
                </span>
              </div>
            </div>

            <div className="rol-blok">
              <h3><span className="no">5</span>Kullanıcılar <span className="rol-ipucu" style={{ fontWeight: 400 }}>· {roldekiler.length} kişi</span></h3>
              {T.id === 0 ? (
                <p className="rol-ipucu rol-girinti">Kullanıcı eklemek için önce rolü kaydedin.</p>
              ) : (
                <div className="rol-kisiler rol-girinti">
                  {roldekiler.map((k) => (
                    <span key={k.kullaniciAdi} className="rol-kisi">
                      <span className="av">{bas(k.adSoyad)}</span>
                      <span>
                        {k.adSoyad}
                        <small>{k.kullaniciAdi}{k.subeKodu ? ` · ${k.subeKodu} şubesi` : ""}</small>
                      </span>
                      <button title="Rolden çıkar" onClick={() => ata(k.kullaniciAdi, null)}><UserMinus size={14} /></button>
                    </span>
                  ))}
                  <Select
                    showSearch
                    value={null}
                    placeholder="Kullanıcı ekle…"
                    style={{ minWidth: 240 }}
                    optionFilterProp="label"
                    onChange={(v: string) => v && ata(v, T.id)}
                    options={kullanicilar
                      .filter((k) => k.aktif && k.rol !== "Admin" && k.portalRolId !== T.id)
                      .map((k) => ({
                        value: k.kullaniciAdi,
                        label: `${k.adSoyad} (${k.kullaniciAdi})${k.portalRolId ? ` · şu an: ${roller.find((r) => r.id === k.portalRolId)?.ad ?? "başka rol"}` : ""}`,
                      }))}
                  />
                </div>
              )}
            </div>

            <div className="rol-blok">
              <h3><Info size={15} color="#5f8c10" />Bu rol ne görür</h3>
              <div className="rol-ozet rol-girinti">
                {ozet.map((x) => (
                  <div key={x as string}><Check size={14} color="#5f8c10" /><span>{x}</span></div>
                ))}
              </div>
            </div>

            <div className="rol-kayit">
              <Button type="primary" icon={<Check size={15} />} loading={kaydediliyor} disabled={!degisti} onClick={kaydet}>
                Kaydet
              </Button>
              <Button
                icon={<X size={14} />}
                disabled={!degisti}
                onClick={() => {
                  const asil = roller.find((r) => r.id === T.id);
                  if (asil) setTaslak(JSON.parse(JSON.stringify(asil)));
                  else { setSecili(roller[0]?.id ?? null); setTaslak(roller[0] ? JSON.parse(JSON.stringify(roller[0])) : null); }
                }}
              >
                Vazgeç
              </Button>
              <span className="rol-ipucu" style={{ marginLeft: "auto" }}>Değişiklik, kullanıcı sayfayı yenileyince geçerli olur.</span>
            </div>
          </div>
        ) : (
          <div className="rol-kart" style={{ padding: 40 }}>
            <Empty description="Bir rol seçin ya da yeni rol ekleyin." />
          </div>
        )}
      </div>
    </div>
  );
}

const CSS = `
.rol-izgara{display:grid;grid-template-columns:300px minmax(0,1fr);gap:16px;align-items:start}
@media (max-width:1100px){.rol-izgara{grid-template-columns:1fr}}
.rol-kart{background:#fff;border:1px solid #e3e6e1;border-radius:12px}
.rol-liste{padding:8px}
.rol-liste-ust{display:flex;align-items:center;justify-content:space-between;padding:6px 8px 10px}
.rol-satir{display:flex;flex-direction:column;gap:6px;padding:10px 12px;border-radius:10px;cursor:pointer;border:1px solid transparent}
.rol-satir:hover{background:#f7f9f5}
.rol-satir.on{background:#f2f9e8;border-color:#d6eab2}
.rol-s1{display:flex;align-items:center;gap:8px}
.rol-s1 small{margin-left:auto;color:#6b7280;font-size:12px}
.rol-deps{display:flex;flex-wrap:wrap;gap:4px}
.rol-deps .ant-tag{margin:0}
.rol-ipucu{font-size:12.5px;color:#6b7280;line-height:1.5}
.rol-duzen{overflow:hidden}
.rol-ust{display:flex;align-items:center;gap:10px;padding:14px 20px;border-bottom:1px solid #e3e6e1}
.rol-adi{font-size:17px;font-weight:700;border-color:transparent;box-shadow:none;flex:1;min-width:0}
.rol-adi:hover,.rol-adi:focus{border-color:#e3e6e1}
.rol-blok{padding:16px 20px;border-bottom:1px solid #e3e6e1}
.rol-blok h3{margin:0 0 4px;font-size:14px;display:flex;align-items:center;gap:8px}
.rol-blok h3 .no{width:20px;height:20px;border-radius:50%;background:#7cb518;color:#fff;font-size:11px;display:grid;place-items:center}
.rol-girinti{margin-left:28px}
@media (max-width:640px){.rol-girinti{margin-left:0}}
p.rol-girinti{margin-top:0;margin-bottom:12px}
.rol-kapsamlar{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-bottom:12px}
.rol-kps{border:1.5px solid #e3e6e1;border-radius:10px;padding:11px 13px;cursor:pointer;display:flex;gap:10px}
.rol-kps .rd{width:16px;height:16px;border-radius:50%;border:1.5px solid #c3c9bf;flex:none;margin-top:2px}
.rol-kps.on{border-color:#7cb518;background:#fbfdf8}
.rol-kps.on .rd{border:5px solid #7cb518}
.rol-kps b{display:block;font-size:13.5px}
.rol-kps small{color:#6b7280;font-size:12px}
.rol-cipler{display:flex;flex-wrap:wrap;gap:8px}
.rol-cip{display:inline-flex;align-items:center;gap:7px;border:1px solid #e3e6e1;background:#fff;border-radius:20px;padding:5px 12px;font-size:13px;font-weight:600;color:#4b5563;user-select:none;cursor:pointer}
.rol-cip .kt{width:16px;height:16px;border-radius:5px;border:1.5px solid #c3c9bf;display:grid;place-items:center}
.rol-cip.on{background:#f2f9e8;border-color:#b7d98a;color:#3f6408}
.rol-cip.on .kt{background:#7cb518;border-color:#7cb518;color:#fff}
.rol-cip.kapali{opacity:.45;cursor:not-allowed}
.rol-sayfalar{border:1px solid #e3e6e1;border-radius:10px;overflow:hidden}
.rol-st{display:grid;grid-template-columns:minmax(0,1fr) 90px 90px;align-items:center;padding:8px 14px;border-bottom:1px solid #f0f2ee;gap:8px}
.rol-st:last-child{border-bottom:0}
.rol-st.bas{background:#fafbf8;font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.4px}
.rol-st b{font-weight:600;display:block}
.rol-st small{color:#6b7280;font-size:12px}
.rol-kisiler{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.rol-kisi{display:flex;align-items:center;gap:8px;border:1px solid #e3e6e1;border-radius:10px;padding:5px 6px 5px 6px;font-size:13px}
.rol-kisi small{display:block;color:#6b7280;font-size:11.5px}
.rol-kisi button{border:0;background:none;color:#9aa1a9;cursor:pointer;padding:4px;border-radius:6px}
.rol-kisi button:hover{background:#fdecea;color:#c92a2a}
.rol-kisi .av{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;font-size:11px;font-weight:800;background:#f2f9e8;color:#3f6408;flex:none}
.rol-ozet{display:flex;flex-direction:column;gap:6px;font-size:13px;background:#fafbf8;border-radius:10px;padding:12px 14px}
.rol-ozet div{display:flex;gap:8px;align-items:flex-start}
.rol-ozet svg{flex:none;margin-top:2px}
.rol-kayit{display:flex;align-items:center;gap:10px;padding:14px 20px;background:#fafbf8;flex-wrap:wrap}
`;
