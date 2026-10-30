/**
 * ---------------------------------------------------------------------------
 * Yönetim → Patron Görünümü (03.10.2026)
 * ---------------------------------------------------------------------------
 * Biçen360'ta şirket geneli yönetim ekranlarını (canlı okutma, norm kadro,
 * başvurular, onaylar, Biçen Kart) görecek kişiler buradan seçiliyor.
 *
 * Listeyi Admin ve Genel Müdür Yardımcısı değiştirebiliyor; her ekleme ve
 * kaldırma güvenlik günlüğüne yazılıyor. Kaldırılan kişi silinmiyor, alttaki
 * "Kaldırılanlar" listesinde izi duruyor.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useRef, useState } from "react";
import { Alert, App as AntdApp, Button, Empty, Popconfirm, Select, Spin, Tooltip } from "antd";
import dayjs from "dayjs";
import { Crown, History, Smartphone, SmartphoneNfc, Trash2, UserPlus, UserX } from "lucide-react";

import { api, oturumOku } from "./api";
import "./PatronGorunumu.css";

interface Patron {
  id: number;
  kod: string;
  ad: string;
  sube: string | null;
  pozisyon: string | null;
  calisiyor: boolean;
  uygulamada: boolean;
  ekleyen: string | null;
  ekleme: string;
  aktif: boolean;
  kaldiran: string | null;
  kaldirma: string | null;
  sonGiris: string | null;
}

interface Aday {
  kod: string;
  ad: string;
  sube: string | null;
  pozisyon: string | null;
}

export const patronDuzenleyebilir = () =>
  ["Admin", "GenelMudurYardimcisi"].includes(oturumOku()?.rol ?? "");

const basHarf = (ad: string) =>
  ad
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x[0])
    .join("")
    .toLocaleUpperCase("tr");

const ACILANLAR = [
  "Canlı okutma: şu an mağazada, okutmadı, izinli, raporlu",
  "Norm kadro ve en uzun süredir boş kalan pozisyonlar",
  "Başvurular ve işe alım süreci",
  "Onaylar: işe alım, rotasyon, norm kadro, puan yüklemesi",
  "Biçen Kart, sirkülasyon, performans, etik hat",
];

export default function PatronGorunumu() {
  const { message } = AntdApp.useApp();

  const [patronlar, setPatronlar] = useState<Patron[]>([]);
  const [kaldirilanlar, setKaldirilanlar] = useState<Patron[]>([]);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [gecmisAcik, setGecmisAcik] = useState(false);

  const [adaylar, setAdaylar] = useState<Aday[]>([]);
  const [arar, setArar] = useState(false);
  const [secili, setSecili] = useState<string | undefined>();
  const [ekleniyor, setEkleniyor] = useState(false);
  const zaman = useRef<ReturnType<typeof setTimeout>>();

  const getir = async () => {
    try {
      const c = await api.al<{ patronlar: Patron[]; kaldirilanlar: Patron[] }>("/api/Patron");
      setPatronlar(c.patronlar ?? []);
      setKaldirilanlar(c.kaldirilanlar ?? []);
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

  const ara = (q: string) => {
    clearTimeout(zaman.current);
    if (q.trim().length < 2) {
      setAdaylar([]);
      return;
    }
    zaman.current = setTimeout(async () => {
      setArar(true);
      try {
        const c = await api.al<{ sonuc: Aday[] }>(`/api/Patron/Ara?q=${encodeURIComponent(q.trim())}`);
        setAdaylar(c.sonuc ?? []);
      } catch {
        setAdaylar([]);
      } finally {
        setArar(false);
      }
    }, 300);
  };

  const ekle = async () => {
    if (!secili) return;
    setEkleniyor(true);
    try {
      await api.gonder("/api/Patron", { kod: secili });
      const a = adaylar.find((x) => x.kod === secili);
      message.success(`${a?.ad ?? "Kişi"} patron görünümüne eklendi.`);
      setSecili(undefined);
      setAdaylar([]);
      getir();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Eklenemedi.");
    } finally {
      setEkleniyor(false);
    }
  };

  const kaldir = async (p: Patron) => {
    try {
      await api.sil(`/api/Patron/${p.id}`);
      message.success(`${p.ad} listeden kaldırıldı.`);
      getir();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Kaldırılamadı.");
    }
  };

  if (yukleniyor)
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <Spin />
      </div>
    );

  const mevcut = new Set(patronlar.map((p) => p.kod));

  return (
    <div className="pt">
      <div className="pt-izgara">
        <div>
          <section className="pt-kart">
            <div className="pt-bas">
              <span className="pt-simge">
                <Crown size={18} strokeWidth={2.1} />
              </span>
              <div>
                <h3>Patron görünümü</h3>
                <small>Biçen360'ta yönetim ekranını görecek kişiler</small>
              </div>
              <span className="pt-sayi">{patronlar.length} kişi</span>
            </div>

            <div className="pt-ekle">
              <Select
                showSearch
                allowClear
                value={secili}
                placeholder="Ad, sicil ya da şube yazın…"
                filterOption={false}
                onSearch={ara}
                onChange={(v) => setSecili(v)}
                notFoundContent={arar ? <Spin size="small" /> : "En az 2 harf yazın"}
                style={{ flex: 1, minWidth: 0 }}
                options={adaylar.map((a) => ({
                  value: a.kod,
                  disabled: mevcut.has(a.kod),
                  label: (
                    <span className="pt-secenek">
                      <b>{a.ad}</b>
                      <small>
                        {[a.pozisyon, a.sube, `Sicil ${a.kod}`].filter(Boolean).join(" · ")}
                        {mevcut.has(a.kod) ? " · zaten listede" : ""}
                      </small>
                    </span>
                  ),
                }))}
              />
              <Button
                type="primary"
                icon={<UserPlus size={15} strokeWidth={2} />}
                disabled={!secili}
                loading={ekleniyor}
                onClick={ekle}
              >
                Ekle
              </Button>
            </div>

            {patronlar.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="Henüz kimse seçilmedi. Patron görünümünü kullanacak kişiyi yukarıdan arayıp ekleyin."
              />
            ) : (
              <div className="pt-liste">
                {patronlar.map((p) => (
                  <div className="pt-kisi" key={p.id}>
                    <span className="pt-avatar">{basHarf(p.ad)}</span>
                    <div className="pt-kisi-metin">
                      <b>{p.ad}</b>
                      <small>{[p.pozisyon, p.sube, `Sicil ${p.kod}`].filter(Boolean).join(" · ")}</small>
                      <div className="pt-etiketler">
                        {!p.calisiyor && (
                          <span className="pt-etiket pt-kirmizi">
                            <UserX size={12} strokeWidth={2.2} /> Mikro'da çalışmıyor
                          </span>
                        )}
                        {p.uygulamada ? (
                          <span className="pt-etiket pt-yesil">
                            <SmartphoneNfc size={12} strokeWidth={2.2} /> Biçen360 kullanıyor
                          </span>
                        ) : (
                          <Tooltip title="Patron ekranını görebilmesi için Biçen360'a bir kez giriş yapması gerekiyor.">
                            <span className="pt-etiket pt-turuncu">
                              <Smartphone size={12} strokeWidth={2.2} /> Biçen360'a girmemiş
                            </span>
                          </Tooltip>
                        )}
                        <span className="pt-etiket">
                          {p.sonGiris
                            ? `Son bakış ${dayjs(p.sonGiris).format("DD.MM.YYYY HH:mm")}`
                            : "Henüz açmadı"}
                        </span>
                      </div>
                      <span className="pt-iz">
                        {p.ekleyen ?? "—"} ekledi · {dayjs(p.ekleme).format("DD.MM.YYYY HH:mm")}
                      </span>
                    </div>
                    <Popconfirm
                      title="Patron görünümünden kaldırılsın mı?"
                      description="Biçen360'ta yönetim ekranı kapanır; kaydın izi kalır."
                      okText="Kaldır"
                      okButtonProps={{ danger: true }}
                      cancelText="Vazgeç"
                      onConfirm={() => kaldir(p)}
                    >
                      <Button type="text" danger aria-label="Kaldır" icon={<Trash2 size={16} strokeWidth={2} />} />
                    </Popconfirm>
                  </div>
                ))}
              </div>
            )}

            {kaldirilanlar.length > 0 && (
              <div className="pt-gecmis">
                <button type="button" onClick={() => setGecmisAcik(!gecmisAcik)}>
                  <History size={14} strokeWidth={2} />
                  Kaldırılanlar ({kaldirilanlar.length})
                </button>
                {gecmisAcik &&
                  kaldirilanlar.map((p) => (
                    <div className="pt-gecmis-satir" key={p.id}>
                      <b>{p.ad}</b>
                      <span>
                        {dayjs(p.ekleme).format("DD.MM.YYYY")} – {p.kaldirma ? dayjs(p.kaldirma).format("DD.MM.YYYY") : "—"} ·{" "}
                        {p.kaldiran ?? "—"} kaldırdı
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </section>
        </div>

        <aside className="pt-kart pt-yan">
          <h4>Seçilen kişide açılanlar</h4>
          <ul>
            {ACILANLAR.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
          <Alert
            type="warning"
            showIcon
            message="Şirket geneli veri"
            description="Bu kişiler bütün şubelerin kadro, başvuru, onay ve Biçen Kart bilgilerini görür, onay verebilir. Yalnızca gerçekten gereken kişileri ekleyin."
          />
          <p className="pt-not">
            Listeyi Admin ve Genel Müdür Yardımcısı değiştirebilir. Her ekleme ve kaldırma güvenlik
            günlüğüne yazılır.
          </p>
        </aside>
      </div>
    </div>
  );
}
