/**
 * Fazla mesai akış kontrolü (09.10.2026): personel seçilince, ona fazla
 * mesaiyi kimlerin girebileceği, girince onayın kimlere gideceği, formun
 * hangi adrese gideceği ve forma basılacak adlar. Kayıt açmaz, mail atmaz.
 */

import { useState } from "react";
import { Alert, App as AntdApp, Modal, Select, Spin, Tag } from "antd";
import { ArrowRight, Mail, Search } from "lucide-react";

import { api } from "./api";

interface Kisi {
  sicil: string;
  ad: string;
  gorev?: string | null;
  pozisyon?: string | null;
  sube: string | null;
}

interface Akis {
  kisi: Kisi;
  girebilenler: (Kisi & {
    ustAsamaAtlanir: boolean;
    /** 14.10.2026: Fazla mesai akışı kuralı tutuyorsa */
    kural?: { kural: string; adimlar: { ad: string; kisiler: string[]; atlandi: boolean }[]; eposta: string[] } | null;
  })[];
  birim: Kisi[];
  birimUnvan: string | null;
  ust: Kisi[];
  ustUnvan: string | null;
  form: { adresler: string[]; aciklama: string; birimYonetici: string | null; bolgeMuduru: string | null };
  hata: string | null;
}

const ad = (k: Kisi) => (
  <span key={k.sicil} className="fma-kisi">
    <b>{k.ad}</b>
    <small>{[k.gorev ?? k.pozisyon, k.sube].filter(Boolean).join(" · ")}</small>
  </span>
);

export default function FazlaMesaiAkis({ acik, kapat }: { acik: boolean; kapat: () => void }) {
  const { message } = AntdApp.useApp();
  const [secenek, setSecenek] = useState<Kisi[]>([]);
  const [v, setV] = useState<Akis | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);

  const sec = async (sicil: string) => {
    setYukleniyor(true);
    setV(null);
    try {
      setV(await api.al<Akis>(`/api/FazlaMesai/Akis/${encodeURIComponent(sicil)}`));
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setYukleniyor(false);
    }
  };

  const ustAtlanan = v?.girebilenler.filter((x) => x.ustAsamaAtlanir) ?? [];

  return (
    <Modal open={acik} onCancel={kapat} footer={null} width="min(760px, 100vw)" title="Fazla mesai akışı kontrolü" destroyOnHidden>
      <style>{CSS}</style>
      <Select
        showSearch
        value={v?.kisi.sicil ?? null}
        style={{ width: "100%" }}
        placeholder="Çalışanı ara (ad, sicil, şube)"
        filterOption={false}
        suffixIcon={<Search size={14} />}
        onSearch={async (q) => {
          if (q.trim().length < 2) return;
          try {
            setSecenek(await api.al<Kisi[]>(`/api/EkibimKural/KisiAra?q=${encodeURIComponent(q)}`));
          } catch {
            setSecenek([]);
          }
        }}
        onChange={(s) => s && sec(s)}
        options={secenek.map((k) => ({ value: k.sicil, label: [k.ad, k.pozisyon, k.sube].filter(Boolean).join(" · ") }))}
      />

      {yukleniyor && <Spin style={{ display: "block", margin: "30px auto" }} />}

      {v && (
        <div className="fma">
          {v.hata && <Alert type="warning" showIcon message={v.hata} />}

          <section>
            <h4>1 · Fazla mesaiyi kimler girebilir</h4>
            <p className="fma-not">Biçen360 › Ekibim › {v.kisi.ad} › "Fazla mesai gir" bu kişilerde açık. Giren, imzalı formu yükleyip İzin Onayları'ndan 1. onayı verir.</p>
            {v.girebilenler.length ? (
              <div className="fma-liste">{v.girebilenler.map(ad)}</div>
            ) : (
              <Alert type="error" showIcon message="Kimse giremiyor: onay tablosunda ya da şubede yöneticisi tanımlı değil." />
            )}
          </section>

          {v.girebilenler.some((x) => x.kural) && (
            <section>
              <h4>Kurala göre giden kayıtlar (Yönetim › Fazla mesai akışı)</h4>
              <p className="fma-not">Aşağıdaki kişiler girerse onay sırası kuraldan gelir; diğerleri için alttaki akış geçerli.</p>
              {v.girebilenler
                .filter((x) => x.kural)
                .map((x) => (
                  <div key={x.sicil} className="fma-mail" style={{ alignItems: "flex-start" }}>
                    <ArrowRight size={16} />
                    <div>
                      <b>{x.ad} girerse</b>
                      <small>
                        {x.kural!.kural}: Giren (imzalı form) →{" "}
                        {x.kural!.adimlar
                          .filter((a) => !a.atlandi)
                          .map((a) => `${a.ad}${a.kisiler.length ? ` (${a.kisiler.slice(0, 2).join(", ")})` : ""}`)
                          .concat("İnsan Kaynakları")
                          .join(" → ")}
                        {x.kural!.eposta.length ? ` · form: ${x.kural!.eposta.join(", ")}` : ""}
                      </small>
                    </div>
                  </div>
                ))}
            </section>
          )}

          <section>
            <h4>2 · Onay sırası</h4>
            <div className="fma-akis">
              <div className="fma-adim">
                <Tag color="green">1. aşama</Tag>
                <b>Giren / birim yöneticisi</b>
                <small>İmzalı formu Biçen360'tan yükler, sonra onaylar (form yüklenmeden onay yok).</small>
                {v.birim.length > 0 && <div className="fma-liste">{v.birim.map(ad)}</div>}
              </div>
              <ArrowRight size={18} className="fma-ok" />
              <div className="fma-adim">
                <Tag color="blue">2. aşama</Tag>
                <b>Üst yönetici{v.ustUnvan ? ` · ${v.ustUnvan}` : ""}</b>
                {v.ust.length ? (
                  <>
                    <small>Biçen360 › İzin Onayları'nda yüklenen formu görerek onaylar ya da reddeder.</small>
                    <div className="fma-liste">{v.ust.map(ad)}</div>
                    {ustAtlanan.length > 0 && v.ust.length > 0 && (
                      <small className="fma-uyari">
                        Girenlerden {ustAtlanan.map((x) => x.ad).join(", ")} üst yönetici olduğu için girdiğinde bu aşama onaylı sayılır.
                      </small>
                    )}
                  </>
                ) : (
                  <small className="fma-uyari">Organizasyon şemasında üst yönetici yok: aşama atlanır, kayıt doğrudan İK'ya düşer.</small>
                )}
              </div>
              <ArrowRight size={18} className="fma-ok" />
              <div className="fma-adim">
                <Tag color="purple">Son onay</Tag>
                <b>İnsan Kaynakları</b>
                <small>Islak imzalı aslı gelince imzalayıp Personel Talepleri › Fazla mesai'de yükler ve onaylar.</small>
              </div>
            </div>
          </section>

          <section>
            <h4>3 · Form (İK-FM-01) nereye gider</h4>
            <div className="fma-mail">
              <Mail size={16} />
              <div>
                <b>{v.form.adresler.join(", ") || "Adres yok"}</b>
                <small>{v.form.aciklama}</small>
              </div>
            </div>
            <p className="fma-not">
              Forma basılan adlar · birim yöneticisi: <b>{v.form.birimYonetici || "giren yönetici"}</b> · bölge müdürü:{" "}
              <b>{v.form.bolgeMuduru || "boş (bulunamadı)"}</b>
            </p>
            <p className="fma-not">Adresi değiştirmek için: Yönetim › İzin formu e-postaları (birim bazında).</p>
          </section>
        </div>
      )}
    </Modal>
  );
}

const CSS = `
.fma{display:flex;flex-direction:column;gap:18px;margin-top:16px}
.fma h4{margin:0 0 6px;font-size:14px}
.fma-not{margin:0 0 8px;color:#6b7280;font-size:12.5px}
.fma-liste{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.fma-kisi{display:inline-flex;flex-direction:column;padding:6px 10px;border:1px solid #e6e9e3;border-radius:10px;background:#fff;min-width:0}
.fma-kisi b{font-size:13px}
.fma-kisi small{font-size:11.5px;color:#8a929b}
.fma-akis{display:grid;grid-template-columns:1fr auto 1fr auto 1fr;gap:8px;align-items:start}
@media (max-width:640px){.fma-akis{grid-template-columns:1fr}.fma-ok{transform:rotate(90deg);justify-self:center}}
.fma-adim{display:flex;flex-direction:column;gap:4px;padding:10px;border-radius:12px;background:#f6f8f3;min-width:0}
.fma-adim .ant-tag{align-self:flex-start;margin:0}
.fma-adim small{color:#6b7280;font-size:12px}
.fma-ok{color:#9aa1a9;margin-top:28px}
.fma-uyari{color:#ad4e00!important}
.fma-mail{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1px solid #e6e9e3;border-radius:12px;background:#fff}
.fma-mail div{display:flex;flex-direction:column;min-width:0}
.fma-mail b{overflow-wrap:anywhere}
.fma-mail small{color:#6b7280;font-size:12px}
`;
