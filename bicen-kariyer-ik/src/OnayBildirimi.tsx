/**
 * ---------------------------------------------------------------------------
 * İşe Alım Onayları
 * ---------------------------------------------------------------------------
 * Başlıktaki zil simgesinde bekleyen işler görünür: onay bekleyen istekler
 * ve zamanı geçmiş görüşmeler. Tıklandığında ikisi de listelenir.
 *
 * Onaylama yetkisi olmayan kullanıcılar listeyi görür ancak işlem yapamaz;
 * böylece gönderdikleri kaydın durumunu takip edebilirler.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  App as AntdApp,
  Badge,
  Button,
  DatePicker,
  Drawer,
  Empty,
  Input,
  Modal,
  Select,
  Segmented,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import dayjs, { Dayjs } from "dayjs";
import {
  BellRing,
  CalendarClock,
  Check,
  MessageSquare,
  UserCog,
  CheckCheck,
  Clock,
  X,
} from "lucide-react";

import { EKRAN_SEKME, sayfayaGit } from "./gecis";
import PuanOnaylari, { PUAN_DEGISTI } from "./PuanOnaylari";
import { api, islemYetkisi, onayYetkisi, oturumOku,
  yerelZaman,
} from "./api";

const { Text, Title, Paragraph } = Typography;
const { TextArea } = Input;

/** Gecikme süresini okunur yazar */
const gecikmeMetni = (dakika: number): string => {
  if (dakika < 60) return `${dakika} dakika`;
  if (dakika < 1440) return `${Math.floor(dakika / 60)} saat`;
  return `${Math.floor(dakika / 1440)} gün`;
};

/** Onay türüne göre renk */
const turRengi = (tur: string): string => {
  if (tur === "İşe Alım") return "cyan";
  if (tur === "Norm Kadro") return "geekblue";
  if (tur === "Rotasyon") return "purple";
  return "default";
};

/** Onay türüne göre kart şeridi */
const turSinifi = (tur: string): string => {
  if (tur === "İşe Alım") return "isealim";
  if (tur === "Norm Kadro") return "norm";
  if (tur === "Rotasyon") return "rotasyon";
  return "diger";
};

/** Para biçimi */
const para = (deger?: number | null): string =>
  deger ? `${Number(deger).toLocaleString("tr-TR")} TL` : "—";

export default function OnayBildirimi({
  gomulu,
  acikMi,
  kapat,
  sayiDegisti,
  ekBekleyen,
}: {
  /** Bildirim merkezinin "Bekleyen işler" sekmesi: kendi çanı ve çekmecesi yok */
  gomulu?: boolean;
  acikMi?: boolean;
  kapat?: () => void;
  sayiDegisti?: (n: number) => void;
  /** Merkezde bu bölümün dışında bekleyen iş (personel talepleri): varsa "iş yok" yazılmaz */
  ekBekleyen?: number;
} = {}) {
  const { message, modal } = AntdApp.useApp();

  const oturum = oturumOku();
  const yetkim = onayYetkisi(oturum);

  /* Görüşme sonuçlandırma, işlem yetkisi olan herkes tarafından yapılabilir */
  const islemYapabilir = islemYetkisi(oturum);

  const [acik, setAcik] = useState(false);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [islemde, setIslemde] = useState<number | null>(null);
  const [veri, setVeri] = useState<any>({ adet: 0, kayitlar: [] });
  const [gorusmeler, setGorusmeler] = useState<any[]>([]);

  /* Görüşme sonuçlandırma penceresi */
  const [gorusmeKisi, setGorusmeKisi] = useState<any>(null);
  const [gSecim, setGSecim] = useState("olumlu");
  const [gAciklama, setGAciklama] = useState("");
  const [gYeniTarih, setGYeniTarih] = useState<Dayjs | null>(null);
  const [gKaydediliyor, setGKaydediliyor] = useState(false);

  /* Kullanıcıya atanan iş emirleri; bekleyen işlerin bir parçası */
  const [isEmirleri, setIsEmirleri] = useState<any[]>([]);
  const [bitirilen, setBitirilen] = useState<any | null>(null);
  const [sonucMetni, setSonucMetni] = useState("");
  const [isKaydediliyor, setIsKaydediliyor] = useState(false);

  /* Biçen Kart puan yükleme onayları (Admin karar verir) */
  const [puanTalepleri, setPuanTalepleri] = useState<any[]>([]);
  const [puanAdmin, setPuanAdmin] = useState(false);

  const getir = useCallback(async () => {
    /* Oturum yoksa istek atılmaz; çıkış anındaki gereksiz 401'leri önler */
    if (!oturumOku()) return;

    try {
      const [onaylar, takip, emirler, puan] = await Promise.all([
        api.al<any>("/api/Basvuru/OnayBekleyenler"),
        api.al<any>("/api/Basvuru/GorusmeTakibi").catch(() => null),
        api.al<any[]>("/api/IsEmri/Bana").catch(() => []),
        /* Biçen Kart yetkisi olmayan rolde 403 döner: bölüm hiç çıkmaz */
        api.al<any>("/api/BicenKartPuan/Talepler?durum=bekliyor").catch(() => null),
      ]);

      /* Admin hepsini görüp karar verir; diğerleri yalnızca kendi
         gönderdiklerinin durumunu görür. */
      const ben = (oturumOku()?.kullaniciAdi ?? "").toLocaleLowerCase("tr-TR");
      const pAdmin = !!puan?.admin;
      setPuanAdmin(pAdmin);
      setPuanTalepleri(
        (puan?.talepler ?? []).filter(
          (t: any) => pAdmin || String(t.talepEden ?? "").toLocaleLowerCase("tr-TR") === ben
        )
      );

      setVeri(onaylar);
      setGorusmeler(takip?.gecenler ?? []);
      setIsEmirleri(emirler ?? []);
    } catch {
      // Sessizce geçilir; bildirim alanı sayfayı engellememeli
    }
  }, []);

  /* Sayı arka planda tazelenir; Biçen Kart sayfasından yeni puan talebi
     gönderilince de hemen */
  useEffect(() => {
    getir();

    const zaman = window.setInterval(getir, 60_000);
    window.addEventListener(PUAN_DEGISTI, getir);
    return () => {
      window.clearInterval(zaman);
      window.removeEventListener(PUAN_DEGISTI, getir);
    };
  }, [getir]);

  /** İş emrini görüldü işaretler */
  const gordum = async (id: number) => {
    try {
      await api.gonder(`/api/IsEmri/${id}/Gordum`, {});
      await getir();
    } catch (hata: any) {
      message.error(hata.message);
    }
  };

  /** İş emrini bitirir; açıklama zorunlu */
  const isEmriBitir = async () => {
    const metin = sonucMetni.trim();

    if (!metin) {
      message.warning("Yaptığınız işi açıklayınız.");
      return;
    }

    setIsKaydediliyor(true);

    try {
      await api.gonder(`/api/IsEmri/${bitirilen.id}/Bitir`, { sonuc: metin });

      message.success("İş emri tamamlandı.");
      setBitirilen(null);
      setSonucMetni("");
      await getir();
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setIsKaydediliyor(false);
    }
  };

  /** Sonuç bildirimini okundu işaretler */
  const sonucuKapat = async (onayId: number) => {
    try {
      await api.gonder(`/api/Basvuru/Onay/${onayId}/Okundu`, {});
      await getir();
    } catch (hata: any) {
      message.error(hata.message);
    }
  };

  /** Görüşme sonuçlandırma penceresini açar */
  const gorusmeAc = (kisi: any) => {
    setGorusmeKisi(kisi);
    setGSecim("olumlu");
    setGAciklama("");
    setGYeniTarih(null);
  };

  /** Görüşme sonucunu kaydeder */
  const gorusmeKaydet = async () => {
    if (!gorusmeKisi) return;

    if (!gAciklama.trim()) {
      message.error("Açıklama yazmanız gerekiyor.");
      return;
    }

    if (gSecim === "ertele" && !gYeniTarih) {
      message.error("Yeni görüşme tarihini seçiniz.");
      return;
    }

    setGKaydediliyor(true);

    try {
      await api.gonder(`/api/Basvuru/${gorusmeKisi.id}/GorusmeSonuc`, {
        secim: gSecim,
        yeniTarih: yerelZaman(gYeniTarih),
        aciklama: gAciklama.trim(),
      });

      message.success(`${gorusmeKisi.adSoyad} için kayıt güncellendi.`);
      setGorusmeKisi(null);
      await getir();
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setGKaydediliyor(false);
    }
  };

  const ac = async () => {
    setAcik(true);
    setYukleniyor(true);
    await getir();
    setYukleniyor(false);
  };

  /** Onay veya ret işlemi */
  /**
   * İsteği reddetmeden geri gönderir.
   *
   * Ret kesin bir karardır; bu ise "şunu düzelt ve tekrar gönder"
   * demektir. İsteyen uzmana bildirim gider, düzeltip yeniden sunabilir.
   */
  /**
   * Görüşmeyi başka bir uzmana yönlendirir.
   *
   * Planlayan kişi izinliyse ya da o gün gelemeyecekse görüşme sahipsiz
   * kalmasın diye. Yeni sorumluya bildirim düşer.
   */
  const [yonlendirilen, setYonlendirilen] = useState<any | null>(null);
  const [uzmanListesi, setUzmanListesi] = useState<any[]>([]);
  const [yonlendirHedef, setYonlendirHedef] = useState<string | undefined>();
  const [yonlendirNot, setYonlendirNot] = useState("");
  const [yonlendiriliyor, setYonlendiriliyor] = useState(false);

  const yonlendirAc = async (g: any) => {
    setYonlendirilen(g);
    setYonlendirHedef(undefined);
    setYonlendirNot("");

    if (uzmanListesi.length === 0) {
      try {
        const d = await api.al<any[]>("/api/Kullanici/Liste");

        setUzmanListesi(
          (d ?? []).filter(
            (x: any) => x.rol === "IK" || x.rol === "IKYoneticisi"
          )
        );
      } catch {
        setUzmanListesi([]);
      }
    }
  };

  const yonlendir = async () => {
    if (!yonlendirilen || !yonlendirHedef) {
      message.warning("Yönlendirilecek uzmanı seçiniz.");
      return;
    }

    setYonlendiriliyor(true);

    try {
      const d = await api.gonder<any>(
        `/api/Basvuru/${yonlendirilen.id}/GorusmeYonlendir`,
        { kullanici: yonlendirHedef, not: yonlendirNot || null }
      );

      message.success(`Görüşme ${d.adSoyad} adlı uzmana yönlendirildi.`);
      setYonlendirilen(null);
      getir();
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setYonlendiriliyor(false);
    }
  };

  const yanitla = async (kayit: any) => {
    let metin = "";

    const alindi = await new Promise<boolean>((coz) => {
      modal.confirm({
        title: "İsteği yanıtla",
        width: 460,
        content: (
          <div>
            <Paragraph style={{ fontSize: 13.5 }}>
              <b>{kayit.adSoyad ?? kayit.baslik}</b> isteği, açıklamanızla
              birlikte uzmana geri gönderilecek. Reddedilmez; düzeltilip
              yeniden onaya sunulabilir.
            </Paragraph>
            <TextArea
              rows={3}
              placeholder="Neyin düzeltilmesi gerekiyor? (zorunlu)"
              onChange={(e) => (metin = e.target.value)}
            />
          </div>
        ),
        okText: "Gönder",
        cancelText: "Vazgeç",
        onOk: () => {
          if (!metin.trim()) {
            message.error("Açıklama yazınız.");
            return Promise.reject();
          }
          coz(true);
        },
        onCancel: () => coz(false),
      });
    });

    if (!alindi) return;

    setIslemde(kayit.id);

    try {
      await api.gonder(`/api/Basvuru/Onay/${kayit.id}/Yanit`, {
        not: metin.trim(),
      });

      message.success("Yanıtınız uzmana iletildi.");
      getir();
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setIslemde(null);
    }
  };

  const karar = async (kayit: any, onaylandi: boolean) => {
    let not = "";

    if (!onaylandi) {
      /* Ret sebebi zorunlu; onayda isteğe bağlı */
      const alindi = await new Promise<boolean>((coz) => {
        let metin = "";

        modal.confirm({
          title: "İşe alımı reddet",
          width: 460,
          content: (
            <div>
              <Paragraph style={{ fontSize: 13.5 }}>
                <b>{kayit.adSoyad}</b> için girilen işe alım bilgileri
                reddedilecek. Kayıt "Evrak Hazırlanıyor" durumuna döner ve
                bilgiler düzeltilebilir.
              </Paragraph>
              <TextArea
                rows={3}
                placeholder="Reddetme sebebi (zorunlu)"
                onChange={(e) => (metin = e.target.value)}
              />
            </div>
          ),
          okText: "Reddet",
          cancelText: "Vazgeç",
          okButtonProps: { danger: true },
          onOk: () => {
            if (!metin.trim()) {
              message.error("Reddetme sebebini yazınız.");
              return Promise.reject();
            }
            not = metin.trim();
            coz(true);
          },
          onCancel: () => coz(false),
        });
      });

      if (!alindi) return;
    }

    setIslemde(kayit.id);

    try {
      await api.gonder(`/api/Basvuru/Onay/${kayit.id}`, { onaylandi, not });

      message.success(
        onaylandi ? "İşe alım onaylandı." : "İşe alım reddedildi."
      );

      await getir();
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setIslemde(null);
    }
  };

  /* Yanıt bekleyen istekler (21.10.2026): yeniden gönder ya da karar ver */
  const tekrarGonder = async (kayit: any) => {
    /* Yanıt zorunlu (22.10.2026): onaylayan sorusunun cevabını görsün */
    let metin = "";
    const alindi = await new Promise<boolean>((coz) => {
      modal.confirm({
        title: "Yanıtla ve yeniden onaya gönder",
        width: 480,
        content: (
          <div>
            {(kayit.mesajlar ?? []).filter((m: any) => m.tur === "soru").slice(-1).map((m: any, i: number) => (
              <Paragraph key={i} style={{ fontSize: 13, background: "#fff7e6", padding: "6px 10px", borderRadius: 6 }}>
                <b>{m.kim}:</b> {m.metin}
              </Paragraph>
            ))}
            <TextArea rows={3} placeholder="Yanıtınız (zorunlu)" onChange={(e) => (metin = e.target.value)} />
          </div>
        ),
        okText: "Gönder",
        cancelText: "Vazgeç",
        onOk: () => {
          if (metin.trim().length < 3) {
            message.error("Yanıtınızı yazınız.");
            return Promise.reject();
          }
          coz(true);
        },
        onCancel: () => coz(false),
      });
    });
    if (!alindi) return;

    setIslemde(kayit.id);
    try {
      await api.gonder(`/api/Basvuru/Onay/${kayit.id}/TekrarGonder`, { not: metin.trim() });
      message.success("İstek yeniden onaya gönderildi.");
      await getir();
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setIslemde(null);
    }
  };

  const yanitBekleyenler: any[] = veri.yanitBekleyenler ?? [];

  /** Onaylayan ile isteyen arasındaki soru-yanıt yazışması */
  const yazisma = (mesajlar?: any[]) =>
    mesajlar && mesajlar.length > 0 ? (
      <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
        {mesajlar.map((m: any, i: number) => (
          <div
            key={i}
            style={{
              fontSize: 13,
              padding: "6px 10px",
              borderRadius: 8,
              background: m.tur === "yanit" ? "#f2f9e8" : "#fff7e6",
              borderLeft: `3px solid ${m.tur === "yanit" ? "#7cb518" : "#fa8c16"}`,
            }}
          >
            <b>{m.kim ?? (m.tur === "yanit" ? "Yanıt" : "Soru")}</b>
            <Text type="secondary" style={{ fontSize: 11.5 }}>
              {" "}· {m.tur === "yanit" ? "yanıt" : "soru"}
              {m.tarih ? ` · ${dayjs(m.tarih).format("DD.MM.YYYY HH:mm")}` : ""}
            </Text>
            <div>{m.metin}</div>
          </div>
        ))}
      </div>
    ) : null;

  const toplamSayi =
    (veri.adet ?? 0) + gorusmeler.length + (veri.sonuclar?.length ?? 0) + isEmirleri.length + puanTalepleri.length +
    yanitBekleyenler.length;

  useEffect(() => {
    sayiDegisti?.(toplamSayi);
  }, [toplamSayi, sayiDegisti]);

  /* Bildirim merkezinde sekme açılınca tazelenir */
  useEffect(() => {
    if (!gomulu || !acikMi) return;
    setYukleniyor(true);
    getir().finally(() => setYukleniyor(false));
  }, [gomulu, acikMi, getir]);

  function cekmeceyiKapat() {
    if (kapat) kapat();
    else setAcik(false);
  }

  const etiketler = (
    <>
            {veri.turler?.map((t: any) => (
              <Tag key={t.tur} color={turRengi(t.tur)}>
                {t.tur}: {t.adet}
              </Tag>
            ))}
            {gorusmeler.length > 0 && (
              <Tag color="orange">Geciken görüşme: {gorusmeler.length}</Tag>
            )}
            {isEmirleri.length > 0 && (
              <Tag color="purple">İş emri: {isEmirleri.length}</Tag>
            )}
            {puanTalepleri.length > 0 && (
              <Tag color="green">Biçen Kart puan: {puanTalepleri.length}</Tag>
            )}
    </>
  );

  const icerik = (
    <>
        {!yetkim && (!gomulu || (veri.kayitlar?.length ?? 0) > 0) && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="Onaylama yetkiniz bulunmuyor"
            description="Gönderdiğiniz işe alım kayıtlarının durumunu buradan takip edebilirsiniz. Onay işlemini yetkili kullanıcılar yapar."
          />
        )}

        {/* ----------------------------------------- yanıt bekleyen istekler */}
        {yanitBekleyenler.length > 0 && (
          <div style={{ marginBottom: 18 }}>
            <Title level={5} style={{ fontSize: 14, marginTop: 0 }}>
              <Space size={7}>
                <CheckCheck size={15} strokeWidth={2} color="#d46b08" />
                Yanıt bekleyen istekler ({yanitBekleyenler.length})
              </Space>
            </Title>
            <div className="ob-liste">
              {yanitBekleyenler.map((x: any) => (
                <div className="ob-kart" key={x.id} style={{ borderLeft: "3px solid #fa8c16" }}>
                  <div className="ob-ust">
                    <div>
                      <Title level={5} style={{ margin: 0 }}>{x.baslik}</Title>
                      <Text type="secondary" style={{ fontSize: 12.5 }}>
                        {x.tur}{x.ozet ? ` · ${x.ozet}` : ""}
                      </Text>
                    </div>
                    <Tag color="orange">Yanıt bekliyor</Tag>
                  </div>
                  {yazisma(x.mesajlar)}
                  <div className="ob-alt" style={{ marginTop: 8 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {x.isteyenAdSoyad} gönderdi
                      {x.onayTarihi ? ` · yanıt ${dayjs(x.onayTarihi).format("DD.MM.YYYY HH:mm")}` : ""}
                    </Text>
                    <Space size={6}>
                      <Button size="small" loading={islemde === x.id} onClick={() => tekrarGonder(x)}>
                        Yanıtla ve yeniden gönder
                      </Button>
                      {veri.yetkim && (
                        <>
                          <Button size="small" danger onClick={() => karar({ ...x, adSoyad: x.baslik }, false)}>
                            Reddet
                          </Button>
                          <Button size="small" type="primary" loading={islemde === x.id} onClick={() => karar(x, true)}>
                            Onayla
                          </Button>
                        </>
                      )}
                    </Space>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ------------------------------------- isteklerimin sonuçları */}
        {veri.sonuclar?.length > 0 && (
          <div style={{ marginBottom: 18 }}>
            <Title level={5} style={{ fontSize: 14, marginTop: 0 }}>
              <Space size={7}>
                <CheckCheck size={15} strokeWidth={2} color="#52a318" />
                İsteklerinizin Sonucu ({veri.sonuclar.length})
              </Space>
            </Title>

            <div className="ob-liste">
              {veri.sonuclar.map((x: any) => (
                <div
                  className={`ob-kart ob-kart-${
                    x.durum === "Onaylandı" ? "onaylandi" : "reddedildi"
                  }`}
                  key={x.id}
                >
                  <div className="ob-ust">
                    <div>
                      <Title level={5} style={{ margin: 0 }}>
                        {x.baslik}
                      </Title>
                      <Text type="secondary" style={{ fontSize: 12.5 }}>
                        {x.tur}
                        {x.ozet ? ` · ${x.ozet}` : ""}
                      </Text>
                    </div>

                    <Tag color={x.durum === "Onaylandı" ? "green" : "red"}>
                      {x.durum}
                    </Tag>
                  </div>

                  {x.onayNotu && (
                    <Paragraph style={{ fontSize: 13, margin: "8px 0 0" }}>
                      {x.onayNotu}
                    </Paragraph>
                  )}

                  <div className="ob-alt" style={{ marginTop: 8 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {x.onaylayanAdSoyad} ·{" "}
                      {x.onayTarihi
                        ? dayjs(x.onayTarihi).format("DD.MM.YYYY HH:mm")
                        : ""}
                    </Text>

                    <Button size="small" onClick={() => sonucuKapat(x.id)}>
                      Tamam
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ------------------------------------------- geciken görüşmeler */}
        {gorusmeler.length > 0 && (
          <div style={{ marginBottom: 18 }}>
            <Title level={5} style={{ fontSize: 14, marginTop: 0 }}>
              <Space size={7}>
                <Clock size={15} strokeWidth={2} color="#E8481C" />
                Zamanı Geçen Görüşmeler ({gorusmeler.length})
              </Space>
            </Title>

            <Paragraph type="secondary" style={{ fontSize: 12.5 }}>
              Görüşme saati geçtiği hâlde sonuçlandırılmamış başvurular.
              Başvurular ekranından adayı açıp durumunu güncelleyebilirsiniz.
            </Paragraph>

            <div className="ob-liste">
              {gorusmeler.map((g: any) => (
                <div className="ob-kart ob-kart-gorusme" key={g.id}>
                  <div className="ob-ust">
                    <div>
                      <Title level={5} style={{ margin: 0 }}>
                        {g.adSoyad}
                      </Title>
                      <Text type="secondary" style={{ fontSize: 12.5 }}>
                        {g.telefon} · {g.subeAdi}
                      </Text>
                    </div>

                    <Tag color="orange">
                      {gecikmeMetni(g.gecenDakika)} gecikti
                    </Tag>
                  </div>

                  <div className="ob-alt" style={{ marginTop: 8 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {dayjs(g.gorusmeTarihi).format("DD.MM.YYYY HH:mm")}
                      {g.gorusmeYeri ? ` · ${g.gorusmeYeri}` : ""} ·{" "}
                      {g.sorumluAdSoyad} planladı
                    </Text>

                    {islemYapabilir && (
                      <Space size={6}>
                        <Button
                          size="small"
                          icon={<UserCog size={14} strokeWidth={2} />}
                          onClick={() => yonlendirAc(g)}
                        >
                          Yönlendir
                        </Button>

                        <Button
                          size="small"
                          type="primary"
                          icon={<CalendarClock size={14} strokeWidth={2} />}
                          onClick={() => gorusmeAc(g)}
                        >
                          Sonuçlandır
                        </Button>
                      </Space>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ----------------------------- Biçen Kart puan yükleme onayları */}
        <PuanOnaylari talepler={puanTalepleri} admin={puanAdmin} bitti={getir} />

        {/* ------------------------------------------- iş emirlerim */}
        {isEmirleri.length > 0 && (
          <div className="ob-liste" style={{ marginBottom: 18 }}>
            <Title level={5} style={{ fontSize: 14, margin: 0 }}>
              İş Emirlerim ({isEmirleri.length})
            </Title>

            {isEmirleri.map((e: any) => (
              <div className="ob-kart" key={`ie-${e.id}`}>
                <div className="ob-ust">
                  <div>
                    <Title level={5} style={{ margin: 0 }}>
                      {e.baslik}
                    </Title>
                    <Text type="secondary" style={{ fontSize: 12.5 }}>
                      {e.atayanAd}
                      {e.kaynakBaslik ? ` · ${e.kaynakBaslik}` : ""}
                      {e.sonTarih
                        ? ` · son tarih ${dayjs(e.sonTarih).format("DD.MM.YYYY")}`
                        : ""}
                    </Text>
                  </div>

                  <Space size={4}>
                    {e.oncelik === "Acil" && <Tag color="red">Acil</Tag>}
                    <Tag color={e.durum === "Yeni" ? "purple" : "blue"}>
                      {e.durum}
                    </Tag>
                  </Space>
                </div>

                {e.aciklama && (
                  <Paragraph
                    style={{ fontSize: 13, margin: "8px 0 0" }}
                    ellipsis={{ rows: 3, expandable: true, symbol: "devamı" }}
                  >
                    {e.aciklama}
                  </Paragraph>
                )}

                <Space style={{ marginTop: 10 }}>
                  {/* Kaynağı olan emirlerde ilgili kayda atlar */}
                  {e.kaynakEkran && e.kaynakId && EKRAN_SEKME[e.kaynakEkran] ? (
                    <Button
                      size="small"
                      onClick={() => {
                        if (!e.goruldu) gordum(e.id);
                        cekmeceyiKapat();
                        sayfayaGit(EKRAN_SEKME[e.kaynakEkran], e.kaynakId);
                      }}
                    >
                      Gör
                    </Button>
                  ) : null}

                  {/* Kısa kart yetmediğinde tam ayrıntı İş Emirleri
                      sayfasında açılır */}
                  <Button
                    size="small"
                    type="link"
                    onClick={() => {
                      cekmeceyiKapat();
                      sayfayaGit("isemri");
                    }}
                  >
                    Ayrıntı
                  </Button>

                  {!e.goruldu && (
                    <Button size="small" onClick={() => gordum(e.id)}>
                      Gördüm
                    </Button>
                  )}
                  <Button
                    size="small"
                    type="primary"
                    icon={<Check size={14} strokeWidth={2} />}
                    onClick={() => {
                      setBitirilen(e);
                      setSonucMetni("");
                    }}
                  >
                    Bitir
                  </Button>
                </Space>
              </div>
            ))}
          </div>
        )}

        {yukleniyor ? (
          <div style={{ textAlign: "center", padding: "50px 0" }}>
            <Spin />
          </div>
        ) : veri.kayitlar?.length === 0 ? (
          gorusmeler.length === 0 &&
          (veri.sonuclar?.length ?? 0) === 0 &&
          yanitBekleyenler.length === 0 &&
          isEmirleri.length === 0 &&
          puanTalepleri.length === 0 ? (
            ekBekleyen ? null : <Empty description="Bekleyen iş bulunmuyor." />
          ) : null
        ) : (
          <div className="ob-liste">
            {(gorusmeler.length > 0 || puanTalepleri.length > 0) && (
              <Title level={5} style={{ fontSize: 14, margin: 0 }}>
                Onay Bekleyenler ({veri.kayitlar.length})
              </Title>
            )}

            {veri.kayitlar.map((k: any) => {
              /* Adayın talebi ile anlaşılan ücret farkı */
              const talep = Number(k.talepUcret) || 0;
              const anlasilan = Number(k.anlasilanUcret) || 0;
              const fark = talep > 0 && anlasilan > 0 ? anlasilan - talep : null;

              return (
                <div className={`ob-kart ob-kart-${turSinifi(k.tur)}`} key={k.id}>
                  <div className="ob-ust">
                    <div>
                      <Title level={5} style={{ margin: 0 }}>
                        {k.baslik}
                      </Title>
                      <Text type="secondary" style={{ fontSize: 12.5 }}>
                        {k.basvuruNo ? `${k.basvuruNo} · ` : ""}
                        {k.telefon || k.subeAdi}
                      </Text>
                    </div>

                    <Tag color={turRengi(k.tur)}>{k.tur}</Tag>
                  </div>

                  {/* Özet her tür için ortak; ayrıntılar yalnızca işe alımda */}
                  {k.ozet && (
                    <Paragraph
                      style={{ fontSize: 13, margin: "8px 0 0" }}
                      ellipsis={{ rows: 3, expandable: true, symbol: "devamı" }}
                    >
                      {k.ozet}
                    </Paragraph>
                  )}

                  {yazisma(k.mesajlar)}

                  {k.tur === "İşe Alım" && (
                  <div className="ob-alanlar">
                    <div>
                      <span>Birim</span>
                      <b>{k.subeAdi}</b>
                    </div>
                    <div>
                      <span>Pozisyon</span>
                      <b>{k.bolum || "—"}</b>
                    </div>
                    <div>
                      <span>İşe giriş</span>
                      <b>
                        {k.iseGirisTarihi
                          ? dayjs(k.iseGirisTarihi).format("DD.MM.YYYY")
                          : "—"}
                      </b>
                    </div>
                    <div>
                      <span>Adayın talebi</span>
                      <b>{para(talep)}</b>
                    </div>
                    <div>
                      <span>Anlaşılan</span>
                      <b>
                        {para(anlasilan)}
                        {fark !== null && fark !== 0 && (
                          <i
                            className={`ob-fark ${
                              fark > 0 ? "ob-fark-artı" : "ob-fark-eksi"
                            }`}
                          >
                            {fark > 0 ? "+" : "−"}
                            {Math.abs(fark).toLocaleString("tr-TR")}
                          </i>
                        )}
                      </b>
                    </div>
                    <div>
                      <span>Yol ücreti</span>
                      <b>{para(k.yolUcreti)}</b>
                    </div>
                  </div>
                  )}

                  <div className="ob-alt">
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {k.isteyenAdSoyad} gönderdi ·{" "}
                      {k.istekTarihi
                        ? dayjs(k.istekTarihi).format("DD.MM.YYYY HH:mm")
                        : ""}
                    </Text>

                    {yetkim && (
                      <Space size={6}>
                        <Button
                          size="small"
                          danger
                          loading={islemde === k.id}
                          icon={<X size={14} strokeWidth={2.4} />}
                          onClick={() => karar(k, false)}
                        >
                          Reddet
                        </Button>

                        {/* Reddetmeden geri gönderme: uzman düzeltip
                            yeniden sunabilir. */}
                        <Button
                          size="small"
                          loading={islemde === k.id}
                          icon={<MessageSquare size={14} strokeWidth={2.4} />}
                          onClick={() => yanitla(k)}
                        >
                          Yanıtla
                        </Button>
                        <Button
                          size="small"
                          type="primary"
                          loading={islemde === k.id}
                          icon={<Check size={14} strokeWidth={2.4} />}
                          onClick={() => karar(k, true)}
                        >
                          Onayla
                        </Button>
                      </Space>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
    </>
  );

  const pencereler = (
    <>

      {/* ------------------------------------------ iş emri bitirme penceresi */}
      <Modal
        open={!!bitirilen}
        onCancel={() => setBitirilen(null)}
        width={520}
        okText="Bitir"
        cancelText="Vazgeç"
        confirmLoading={isKaydediliyor}
        onOk={isEmriBitir}
        title={
          bitirilen && (
            <Space size={8}>
              <Check size={17} strokeWidth={2} color="#E8481C" />
              <span>{bitirilen.baslik}</span>
            </Space>
          )
        }
      >
        {bitirilen?.aciklama && (
          <Paragraph type="secondary" style={{ fontSize: 13 }}>
            {bitirilen.aciklama}
          </Paragraph>
        )}

        <Text strong style={{ fontSize: 13 }}>
          Yaptığınız işi açıklayınız
        </Text>

        <TextArea
          rows={5}
          value={sonucMetni}
          onChange={(e) => setSonucMetni(e.target.value)}
          placeholder="Ne yapıldı, sonuç ne oldu, varsa dikkat edilmesi gerekenler"
          style={{ marginTop: 8 }}
        />

        <Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 8 }}>
          Bu açıklama işi atayan kişiye bildirim ve e-posta olarak gider.
        </Text>
      </Modal>

      {/* ------------------------------------- görüşme sonuçlandırma penceresi */}
      <Modal
        open={!!gorusmeKisi}
        onCancel={() => setGorusmeKisi(null)}
        width={520}
        title={
          gorusmeKisi && (
            <Space size={8}>
              <CalendarClock size={17} strokeWidth={2} color="#E8481C" />
              <span>{gorusmeKisi.adSoyad} · görüşme sonucu</span>
            </Space>
          )
        }
        okText="Kaydet"
        cancelText="Vazgeç"
        confirmLoading={gKaydediliyor}
        onOk={gorusmeKaydet}
      >
        {gorusmeKisi && (
          <div style={{ marginTop: 12 }}>
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 14 }}
              message={
                <span>
                  Görüşme{" "}
                  <b>
                    {dayjs(gorusmeKisi.gorusmeTarihi).format("DD.MM.YYYY HH:mm")}
                  </b>{" "}
                  tarihinde planlanmıştı, üzerinden{" "}
                  <b>{gecikmeMetni(gorusmeKisi.gecenDakika)}</b> geçti.
                </span>
              }
            />

            <Text strong style={{ fontSize: 13 }}>
              Ne oldu?
            </Text>

            <Segmented
              block
              size="small"
              style={{ margin: "8px 0 14px" }}
              value={gSecim}
              onChange={(v) => setGSecim(v as string)}
              /* "Aday gelmedi" ile "Ertele" ayrı seçimlerdir: gelmedi
                 görüşmeyi kapatıp adayı değerlendirmeye çeker, ertele ise
                 yeni tarih ister ve aday görüşme talebinde kalır. */
              options={[
                { label: "Görüşme yapıldı", value: "olumlu" },
                { label: "Aday gelmedi", value: "gelmedi" },
                { label: "Ertele", value: "ertele" },
                { label: "Değerlendirmede", value: "degerlendirmede" },
                { label: "Olumsuz", value: "olumsuz" },
              ]}
            />

            {gSecim === "ertele" && (
              <div style={{ marginBottom: 14 }}>
                <Text strong style={{ fontSize: 13 }}>
                  Yeni görüşme tarihi
                </Text>
                <DatePicker
                  showTime={{ format: "HH:mm" }}
                  format="DD.MM.YYYY HH:mm"
                  style={{ width: "100%", marginTop: 6 }}
                  placeholder="Tarih ve saat seçiniz"
                  value={gYeniTarih}
                  onChange={setGYeniTarih}
                  disabledDate={(g) => !!g && g < dayjs().startOf("day")}
                />
              </div>
            )}

            <Text strong style={{ fontSize: 13 }}>
              Açıklama <Text type="danger">*</Text>
            </Text>

            <TextArea
              rows={3}
              style={{ marginTop: 6 }}
              value={gAciklama}
              onChange={(e) => setGAciklama(e.target.value)}
              placeholder="Zorunlu alan"
            />
          </div>
        )}
      </Modal>

      {/* --------------------------------------------- görüşme yönlendirme */}
      <Modal
        open={!!yonlendirilen}
        onCancel={() => setYonlendirilen(null)}
        onOk={yonlendir}
        okText="Yönlendir"
        cancelText="Vazgeç"
        confirmLoading={yonlendiriliyor}
        okButtonProps={{ disabled: !yonlendirHedef }}
        title="Görüşmeyi yönlendir"
      >
        {yonlendirilen && (
          <div style={{ marginTop: 12 }}>
            <Paragraph style={{ fontSize: 13.5 }}>
              <b>{yonlendirilen.adSoyad}</b> adayının görüşmesi seçtiğiniz
              uzmana devredilecek ve kendisine bildirim gidecek.
            </Paragraph>

            <Text strong style={{ fontSize: 13 }}>
              Yeni sorumlu <Text type="danger">*</Text>
            </Text>

            <Select
              showSearch
              style={{ width: "100%", marginTop: 6, marginBottom: 14 }}
              placeholder="Uzman seçiniz"
              value={yonlendirHedef}
              onChange={setYonlendirHedef}
              optionFilterProp="label"
              options={uzmanListesi.map((x: any) => ({
                value: x.kullaniciAdi,
                label: `${x.adSoyad ?? x.kullaniciAdi}${
                  x.unvan ? ` · ${x.unvan}` : ""
                }`,
              }))}
            />

            <Text strong style={{ fontSize: 13 }}>
              Açıklama
            </Text>

            <TextArea
              rows={3}
              style={{ marginTop: 6 }}
              value={yonlendirNot}
              onChange={(e) => setYonlendirNot(e.target.value)}
              placeholder="İsteğe bağlı; bildirimde görünür"
            />
          </div>
        )}
      </Modal>
    </>
  );

  if (gomulu)
    return (
      <div className="bm-isler">
        <div className="bm-etiketler">{etiketler}</div>
        {icerik}
        {pencereler}
      </div>
    );

  return (
    <>
      <Tooltip title="Bekleyen işler">
        <Badge
          count={toplamSayi}
          size="small"
          offset={[-2, 2]}
        >
          <Button
            type="text"
            className="ik-zil"
            icon={<BellRing size={18} strokeWidth={2} />}
            onClick={ac}
          />
        </Badge>
      </Tooltip>

      <Drawer
        open={acik}
        onClose={() => setAcik(false)}
        width="min(760px, 96vw)"
        className="rp-cekmece"
        title={
          <Space size={8}>
            <BellRing size={16} strokeWidth={2} />
            <Text strong>Bekleyen İşler</Text>
            {etiketler}
          </Space>
        }
      >
        {icerik}
      </Drawer>
      {pencereler}
    </>
  );
}
