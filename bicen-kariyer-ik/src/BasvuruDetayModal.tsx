/**
 * ---------------------------------------------------------------------------
 * Başvuru Detay Penceresi
 * ---------------------------------------------------------------------------
 * Rapor, performans ve havuz ekranlarında bir başvuruya tıklandığında açılır.
 * Başvuru formunun yanı sıra İK'nın eklediği dahili notları ve işlem geçmişini
 * de gösterir; böylece adayla ilgili her şey tek pencerede görünür.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useRef, useState } from "react";
import {
  App as AntdApp,
  Button,
  Empty,
  Modal,
  Space,
  Spin,
  Tabs,
  Tag,
  Timeline,
  Typography,
} from "antd";
import dayjs from "dayjs";
import {
  CalendarClock,
  Download,
  FileText,
  History,
  Megaphone,
  MessageSquareText,
  Phone,
  Store,
  UserCircle2,
} from "lucide-react";

import FormOnizleme from "./FormOnizleme";
import { formuIndir } from "./formIndir";
import { api, durumRengi } from "./api";

const { Text } = Typography;

interface Not {
  id: number;
  metin: string;
  kullanici: string;
  adSoyad: string;
  tarih: string;
}

interface Hareket {
  id: number;
  durum: string;
  aciklama: string;
  kullanici: string;
  tarih: string;
}

export default function BasvuruDetayModal({
  basvuruId,
  kapat,
  ilkSekme,
}: {
  basvuruId: number | null;
  kapat: () => void;
  /** Açılışta seçili sekme (personel kartındaki "Başvuru formu" → "form") */
  ilkSekme?: "notlar" | "form" | "gecmis";
}) {
  const { message } = AntdApp.useApp();

  const [yukleniyor, setYukleniyor] = useState(false);
  const [kayit, setKayit] = useState<any>(null);
  const [form, setForm] = useState<any>(null);
  const [indiriliyor, setIndiriliyor] = useState(false);

  /* Formun yazdırılabilir hâli bu kapsayıcının içinde çizilir;
     indirme işlevi oradan okur. */
  const onizlemeRef = useRef<HTMLDivElement>(null);

  /** Açık başvurunun formunu tek başına açılabilen HTML olarak indirir */
  const formIndir = async () => {
    if (!kayit) return;

    setIndiriliyor(true);
    try {
      const belge = onizlemeRef.current?.querySelector(".on-belge") as HTMLElement;
      await formuIndir(belge, kayit.basvuruNo, kayit.adSoyad);
      message.success("Form indirildi.");
    } catch (hata: any) {
      message.error(hata.message ?? "Form indirilemedi.");
    } finally {
      setIndiriliyor(false);
    }
  };

  useEffect(() => {
    if (!basvuruId) {
      setKayit(null);
      setForm(null);
      return;
    }

    let iptal = false;
    setYukleniyor(true);

    api
      .al<any>(`/api/Basvuru/${basvuruId}`)
      .then((d) => {
        if (iptal) return;
        setKayit(d);
        setForm(JSON.parse(d.veriJson || "{}"));
      })
      .catch((hata: any) => {
        if (!iptal) message.error(hata.message);
      })
      .finally(() => {
        if (!iptal) setYukleniyor(false);
      });

    return () => {
      iptal = true;
    };
  }, [basvuruId, message]);

  const notlar: Not[] = kayit?.notlar ?? [];
  const hareketler: Hareket[] = kayit?.hareketler ?? [];

  return (
    <Modal
      open={!!basvuruId}
      onCancel={kapat}
      /* İndirme düğmesi alt barda durur: sekmenin içindeyken ancak
         "Başvuru Formu" sekmesine tıklanınca görünüyordu ve
         fark edilmiyordu. */
      footer={
        <Space style={{ float: "right" }}>
          <Button
            type="primary"
            icon={<Download size={15} strokeWidth={2} />}
            loading={indiriliyor}
            disabled={!kayit}
            onClick={formIndir}
          >
            Formu indir / yazdır
          </Button>
          <Button onClick={kapat}>Kapat</Button>
        </Space>
      }
      width={940}
      className="hv-form-modal"
      title={
        kayit ? (
          <div>
            <Space wrap size={8}>
              <Text strong style={{ fontSize: 15 }}>
                {kayit.adSoyad}
              </Text>
              <Tag color={durumRengi(kayit.durum)}>{kayit.durum}</Tag>
              <Text type="secondary" style={{ fontSize: 12.5 }}>
                {kayit.basvuruNo}
              </Text>
            </Space>

            <div className="bd-bilgi">
              {kayit.telefon && (
                <span>
                  <Phone size={13} strokeWidth={2} /> {kayit.telefon}
                </span>
              )}
              {kayit.subeAdi && (
                <span>
                  <Store size={13} strokeWidth={2} /> {kayit.subeAdi}
                </span>
              )}
              {/* Adayın bizi nereden duyduğu: hangi kanalın işe yaradığını
                  görmek için formda soruluyor, burada da görünüyor. */}
              {kayit.kaynak && (
                <span>
                  <Megaphone size={13} strokeWidth={2} />{" "}
                  {kayit.kaynak === "Diğer" && kayit.kaynakDetay
                    ? `Diğer · ${kayit.kaynakDetay}`
                    : kayit.kaynak}
                </span>
              )}
              {kayit.gorusmeTarihi && (
                <span>
                  <CalendarClock size={13} strokeWidth={2} />{" "}
                  {dayjs(kayit.gorusmeTarihi).format("DD.MM.YYYY HH:mm")}
                </span>
              )}
              <span>
                Başvuru: {dayjs(kayit.olusturma).format("DD.MM.YYYY")}
                {kayit.bekleyenGun != null && ` · ${kayit.bekleyenGun} gün önce`}
              </span>
              {kayit.guncelleyen && (
                <span className="bd-son-islem">
                  <UserCircle2 size={13} strokeWidth={2} />
                  Son işlem: {kayit.guncelleyen}
                  {kayit.guncelleme &&
                    ` · ${dayjs(kayit.guncelleme).format("DD.MM.YYYY HH:mm")}`}
                </span>
              )}
            </div>
          </div>
        ) : (
          "Başvuru"
        )
      }
    >
      {yukleniyor ? (
        <div style={{ textAlign: "center", padding: "50px 0" }}>
          <Spin />
        </div>
      ) : (
        kayit && (
          <Tabs
            defaultActiveKey={ilkSekme ?? (notlar.length > 0 ? "notlar" : "form")}
            items={[
              {
                key: "notlar",
                label: (
                  <Space size={6}>
                    <MessageSquareText size={15} strokeWidth={2} />
                    İK Notları
                    {notlar.length > 0 && <Tag color="blue">{notlar.length}</Tag>}
                  </Space>
                ),
                children:
                  notlar.length === 0 ? (
                    <Empty description="Bu başvuruya henüz not eklenmemiş." />
                  ) : (
                    <div className="bd-notlar">
                      {notlar.map((n) => (
                        <div className="bd-not" key={n.id}>
                          <div className="bd-not-ust">
                            <UserCircle2 size={15} strokeWidth={2} />
                            <Text strong style={{ fontSize: 13 }}>
                              {n.adSoyad || n.kullanici}
                            </Text>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              {dayjs(n.tarih).format("DD.MM.YYYY HH:mm")}
                            </Text>
                          </div>
                          <div className="bd-not-metin">{n.metin}</div>
                        </div>
                      ))}
                    </div>
                  ),
              },
              {
                key: "form",
                label: (
                  <Space size={6}>
                    <FileText size={15} strokeWidth={2} />
                    Başvuru Formu
                  </Space>
                ),
                children: form ? <FormOnizleme basvuru={form} /> : null,
              },
              {
                key: "gecmis",
                label: (
                  <Space size={6}>
                    <History size={15} strokeWidth={2} />
                    İşlem Geçmişi
                    {hareketler.length > 0 && <Tag>{hareketler.length}</Tag>}
                  </Space>
                ),
                children:
                  hareketler.length === 0 ? (
                    <Empty description="İşlem kaydı bulunmuyor." />
                  ) : (
                    <Timeline
                      style={{ marginTop: 10 }}
                      items={hareketler.map((h) => ({
                        color: durumRengi(h.durum) === "default"
                          ? "gray"
                          : durumRengi(h.durum),
                        children: (
                          <div>
                            <Space size={8} wrap>
                              <Tag color={durumRengi(h.durum)}>{h.durum}</Tag>
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                {dayjs(h.tarih).format("DD.MM.YYYY HH:mm")} ·{" "}
                                {h.kullanici}
                              </Text>
                            </Space>
                            {h.aciklama && (
                              <div className="bd-gecmis-aciklama">{h.aciklama}</div>
                            )}
                          </div>
                        ),
                      }))}
                    />
                  ),
              },
            ]}
          />
        )
      )}

      {/* Yazdırılabilir formun her zaman hazır duran gizli kopyası.
          Sekmelerin içindeki kopya, o sekmeye tıklanmadan oluşturulmaz;
          indirme düğmesi okuyacak belge bulamazdı. */}
      {form && (
        <div
          ref={onizlemeRef}
          aria-hidden
          style={{
            position: "absolute",
            left: -99999,
            top: 0,
            width: 900,
            pointerEvents: "none",
          }}
        >
          <FormOnizleme basvuru={form} />
        </div>
      )}
    </Modal>
  );
}
