/**
 * Bekleyen İşler › Biçen Kart puan yükleme onayları
 * ---------------------------------------------------------------------------
 * Puan yükleme talepleri, işe alım ve rotasyon onayları gibi sağ üstteki
 * "Bekleyen işler" çekmecesine düşüyor. Admin buradan onaylıyor ya da
 * sebebini yazarak reddediyor; onayda puanlar kartlara yazılıyor, talep
 * edene bildirim ve ulas.bicen@bicen.com.tr'ye e-posta gidiyor.
 *
 * Admin olmayan kullanıcı yalnızca kendi gönderdiği ve onay bekleyen
 * talepleri görüyor, işlem yapamıyor (sonuç ona bildirim olarak geliyor).
 */

import { useState } from "react";
import { App as AntdApp, Button, Input, Space, Tag, Typography } from "antd";
import dayjs from "dayjs";
import { Check, CreditCard, X } from "lucide-react";

import { api } from "./api";

const { Text, Title, Paragraph } = Typography;
const { TextArea } = Input;

/** Biçen Kart sayfası dinliyor: karar verilince listesini tazeliyor */
export const PUAN_DEGISTI = "bicen-puan-degisti";

const sayi = (d?: number | null) =>
  Number(d ?? 0).toLocaleString("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const no4 = (d?: string | null) => (d ?? "").replace(/(.{4})/g, "$1 ").trim();

export default function PuanOnaylari({
  talepler,
  admin,
  bitti,
}: {
  talepler: any[];
  admin: boolean;
  bitti: () => void;
}) {
  if (talepler.length === 0) return null;

  return (
    <div className="ob-liste" style={{ marginBottom: 18 }}>
      <Title level={5} style={{ fontSize: 14, margin: 0 }}>
        <Space size={7}>
          <CreditCard size={15} strokeWidth={2} color="#5f8c10" />
          Biçen Kart Puan Yüklemeleri ({talepler.length})
        </Space>
      </Title>

      {talepler.map((t) => (
        <PuanTalebi key={t.id} t={t} admin={admin} bitti={bitti} />
      ))}
    </div>
  );
}

function PuanTalebi({ t, admin, bitti }: { t: any; admin: boolean; bitti: () => void }) {
  const { message, modal } = AntdApp.useApp();

  const [satirlar, setSatirlar] = useState<any[] | null>(null);
  const [acik, setAcik] = useState(false);
  const [islemde, setIslemde] = useState(false);

  const tek = Number(t.kartSayisi) === 1;

  const listeAc = async () => {
    setAcik(!acik);
    if (satirlar !== null) return;
    try {
      const c = await api.al<any>(`/api/BicenKartPuan/Talep/${t.id}`);
      setSatirlar(c?.satirlar ?? []);
    } catch (h: any) {
      message.error(h?.message ?? "Liste alınamadı.");
    }
  };

  const gonder = async (onay: boolean, sebep: string) => {
    setIslemde(true);
    try {
      const c = await api.gonder<any>(`/api/BicenKartPuan/Talep/${t.id}/Karar`, { onay, sebep });

      if (onay)
        message.success(
          `Puanlar yüklendi. ${
            String(c?.eposta ?? "").startsWith("gönderildi") ? "E-posta gönderildi." : `E-posta: ${c?.eposta ?? "-"}`
          }`
        );
      else message.success("Talep reddedildi; talep edene bildirildi.");

      window.dispatchEvent(new Event(PUAN_DEGISTI));
      bitti();
    } catch (h: any) {
      message.error(h?.message ?? "İşlem yapılamadı.");
    } finally {
      setIslemde(false);
    }
  };

  const onayla = () =>
    modal.confirm({
      title: "Puanlar kartlara yüklensin mi?",
      width: 460,
      content: (
        <Paragraph style={{ fontSize: 13.5, marginBottom: 0 }}>
          <b>{t.kartSayisi}</b> karta toplam <b>{sayi(t.toplamPuan)}</b> puan yüklenecek. Kart sahiplerine mobil uygulamadan, talep edene
          panelden bildirim; ulas.bicen@bicen.com.tr adresine ayrıntılı e-posta gider. Bu işlem geri alınamaz.
        </Paragraph>
      ),
      okText: "Onayla ve yükle",
      cancelText: "Vazgeç",
      onOk: () => gonder(true, ""),
    });

  const reddet = () => {
    let metin = "";

    modal.confirm({
      title: "Puan yüklemesini reddet",
      width: 460,
      content: (
        <div>
          <Paragraph style={{ fontSize: 13.5 }}>
            <b>{t.aciklama}</b> talebi reddedilecek; puan yatmaz. Talep eden sebebiyle birlikte bildirim alır.
          </Paragraph>
          <TextArea rows={3} placeholder="Reddetme sebebi (zorunlu)" onChange={(e) => (metin = e.target.value)} />
        </div>
      ),
      okText: "Reddet",
      cancelText: "Vazgeç",
      okButtonProps: { danger: true },
      onOk: () => {
        if (metin.trim().length < 3) {
          message.error("Reddetme sebebini yazınız.");
          return Promise.reject();
        }
        return gonder(false, metin.trim());
      },
    });
  };

  return (
    <div className="ob-kart ob-kart-puan">
      <div className="ob-ust">
        <div>
          <Title level={5} style={{ margin: 0 }}>
            {t.aciklama}
          </Title>
          <Text type="secondary" style={{ fontSize: 12.5 }}>
            {tek
              ? `Tek kart · ${t.ilkKisi ?? "sahibi bilinmiyor"} · ${no4(t.ilkKart)}`
              : `Excel ile toplu yükleme${t.dosyaAdi ? ` · ${t.dosyaAdi}` : ""}`}
          </Text>
          {t.hata && (
            <div>
              <Text type="danger" style={{ fontSize: 12 }}>
                Son onay denemesi yazılamadı: {t.hata}
              </Text>
            </div>
          )}
        </div>

        <Tag color="green">Biçen Kart Puan</Tag>
      </div>

      <div className="ob-alanlar">
        <div>
          <span>Kişi / kart</span>
          <b>{t.kartSayisi}</b>
        </div>
        <div>
          <span>Toplam puan</span>
          <b>{sayi(t.toplamPuan)}</b>
        </div>
        <div>
          <span>Kişi başı</span>
          <b>{Number(t.enAz) === Number(t.enCok) ? sayi(t.enAz) : `${sayi(t.enAz)} – ${sayi(t.enCok)}`}</b>
        </div>
        <div>
          <span>Puan türü</span>
          <b>Yükleme (tip 3)</b>
        </div>
        <div>
          <span>Son kullanma</span>
          <b>{t.sonKullanim ? dayjs(t.sonKullanim).format("DD.MM.YYYY") : "—"}</b>
        </div>
      </div>

      <Button type="link" size="small" style={{ padding: 0, marginTop: 6 }} onClick={listeAc}>
        {acik ? "▾" : "▸"} {t.kartSayisi} kartın listesini {acik ? "gizle" : "gör"}
      </Button>

      {acik && (
        <div className="ob-puan-liste">
          {(satirlar ?? []).map((s, i) => (
            <div key={i}>
              <span>
                {s.adSoyad ?? "—"}
                <small>
                  {s.sube ? `${s.sube} · ` : ""}
                  {no4(s.kartNo)}
                </small>
              </span>
              <b>{sayi(s.puan)}</b>
            </div>
          ))}
          {satirlar === null && <Text type="secondary">Yükleniyor…</Text>}
        </div>
      )}

      <div className="ob-alt">
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t.talepEdenAd ?? t.talepEden} gönderdi · {t.olusturma ? dayjs(t.olusturma).format("DD.MM.YYYY HH:mm") : ""}
        </Text>

        {admin ? (
          <Space size={6}>
            <Button size="small" danger loading={islemde} icon={<X size={14} strokeWidth={2.4} />} onClick={reddet}>
              Reddet
            </Button>
            <Button
              size="small"
              type="primary"
              loading={islemde}
              icon={<Check size={14} strokeWidth={2.4} />}
              onClick={onayla}
            >
              Onayla ve yükle
            </Button>
          </Space>
        ) : (
          <Tag color="gold">Admin onayı bekleniyor</Tag>
        )}
      </div>
    </div>
  );
}
