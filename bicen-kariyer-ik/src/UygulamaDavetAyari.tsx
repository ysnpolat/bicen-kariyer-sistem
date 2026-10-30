/* ===========================================================================
   Yönetim › Uyum ve çıkış › Biçen360 kurulum daveti (06.10.2026)

   Mikro'da işe girişi yapılıp çalışıyor görünen personele işe giriş günü
   bir kez SMS gider: Biçen360'ın ne işe yaradığı ve indirme bağlantısı
   (kariyer.bicen.com.tr/indir). Uygulamaya zaten giriş yapmış olana gitmez.
   =========================================================================== */

import { useEffect, useState } from "react";
import { App as AntdApp, Button, Input, Space, Switch, Table, Tag, Tooltip, Typography } from "antd";
import dayjs from "dayjs";

import { api } from "./api";

const { Title, Paragraph, Text } = Typography;

export default function UygulamaDavetAyari() {
  const { message } = AntdApp.useApp();

  const [ayar, setAyar] = useState<any>(null);
  const [acik, setAcik] = useState(true);
  const [mesaj, setMesaj] = useState("");
  const [liste, setListe] = useState<any[]>([]);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const [gonderiliyor, setGonderiliyor] = useState<string | null>(null);

  const getir = async () => {
    try {
      const [a, l] = await Promise.all([
        api.al<any>("/api/UygulamaDavet/Ayar"),
        api.al<any>("/api/UygulamaDavet/Liste"),
      ]);
      setAyar(a);
      setAcik(a.acik);
      setMesaj(a.mesaj ?? "");
      setListe(l.kayitlar ?? []);
    } catch (h: any) {
      message.error(h.message);
    }
  };

  useEffect(() => {
    getir();
  }, []);

  const kaydet = async () => {
    setKaydediliyor(true);
    try {
      await api.gonder("/api/UygulamaDavet/Ayar", { acik, mesaj });
      message.success("Kaydedildi.");
      getir();
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setKaydediliyor(false);
    }
  };

  const yenidenGonder = async (sicil: string, ad: string) => {
    setGonderiliyor(sicil);
    try {
      await api.gonder(`/api/UygulamaDavet/Gonder/${encodeURIComponent(sicil)}`, {});
      message.success(`${ad} kişisine SMS gönderildi.`);
      getir();
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setGonderiliyor(null);
    }
  };

  const onizleme = (mesaj.trim() || ayar?.varsayilan || "")
    .replace("{ad}", "Ayşe")
    .replace("{link}", ayar?.link ?? "https://kariyer.bicen.com.tr/indir");

  const turkceVar = /[çğıöşüÇĞİÖŞÜ]/.test(onizleme);
  const parcaBoyu = turkceVar ? 67 : 153;
  const parcaSayisi = onizleme.length <= (turkceVar ? 70 : 160) ? 1 : Math.ceil(onizleme.length / parcaBoyu);

  return (
    <div style={{ maxWidth: 900 }}>
      <Title level={5} style={{ marginTop: 0 }}>
        Biçen360 kurulum daveti
      </Title>

      <Paragraph type="secondary" style={{ fontSize: 12.5 }}>
        Mikro'da işe girişi yapılıp durumu <b>çalışıyor</b> olan personele, işe giriş günü geldiğinde bir kez SMS
        gider. Uygulamaya zaten giriş yapmış olana, cep telefonu geçersiz olana ve işe girişi 7 günden eski olana
        gitmez. SMS'ler 09:00–20:00 arası gönderilir.
        {ayar?.baslangic && <> Otomatik gönderim {dayjs(ayar.baslangic).format("DD.MM.YYYY")} ve sonrasında işe girenler için.</>}
      </Paragraph>

      {ayar && !ayar.smsEtkin && (
        <Paragraph style={{ color: "#ad4e00", fontSize: 12.5 }}>SMS servisi kapalı; ayar açık olsa da SMS gitmez.</Paragraph>
      )}

      <Space style={{ marginBottom: 12 }}>
        <Switch checked={acik} onChange={setAcik} />
        <Text>Otomatik gönderim {acik ? "açık" : "kapalı"}</Text>
      </Space>

      <Paragraph type="secondary" style={{ fontSize: 12.5, marginBottom: 6 }}>
        <b>{"{ad}"}</b> personelin ilk adıyla, <b>{"{link}"}</b> indirme bağlantısıyla (iPhone'u App Store'a,
        Android'i Google Play'e yönlendirir) değişir. Boş bırakırsanız varsayılan metin kullanılır.
      </Paragraph>

      <Input.TextArea
        rows={5}
        value={mesaj}
        onChange={(e) => setMesaj(e.target.value)}
        placeholder={ayar?.varsayilan}
        maxLength={600}
      />

      <div
        style={{
          background: "#fbfcfa",
          border: "1px solid #e3e6e1",
          borderRadius: 8,
          padding: "10px 13px",
          marginTop: 8,
          fontSize: 12.5,
          lineHeight: 1.6,
        }}
      >
        <div style={{ marginBottom: 6 }}>
          <Text type="secondary">Gidecek mesaj:</Text>
        </div>
        <div style={{ marginBottom: 8, whiteSpace: "pre-wrap" }}>{onizleme}</div>
        <Space size={10} wrap>
          <Tag>{onizleme.length} karakter</Tag>
          <Tag color={parcaSayisi > 2 ? "orange" : "green"}>{parcaSayisi} SMS</Tag>
          {turkceVar && (
            <Tooltip title="Türkçe karakterli mesajda tek SMS 70 karakter taşır; uzun mesaj birden çok SMS olarak gider ama telefonda tek mesaj görünür.">
              <Tag color="orange">Türkçe karakter · 70 karakter sınırı</Tag>
            </Tooltip>
          )}
        </Space>
      </div>

      <Button type="primary" style={{ marginTop: 12 }} loading={kaydediliyor} onClick={kaydet}>
        Kaydet
      </Button>

      <Title level={5} style={{ marginTop: 28 }}>
        Son gönderimler
      </Title>

      <Table
        size="small"
        rowKey="id"
        dataSource={liste}
        pagination={{ pageSize: 15, hideOnSinglePage: true }}
        locale={{ emptyText: "Henüz gönderim yok." }}
        columns={[
          {
            title: "Personel",
            key: "ad",
            render: (_: any, r: any) => (
              <div>
                <b>{r.adSoyad}</b>
                <div style={{ fontSize: 12, color: "#6b7280" }}>
                  {r.sicil} · {r.sube}
                  {r.gorev ? ` · ${r.gorev}` : ""}
                </div>
              </div>
            ),
          },
          {
            title: "İşe giriş",
            dataIndex: "girisTarihi",
            width: 100,
            render: (t: string) => (t ? dayjs(t).format("DD.MM.YYYY") : "—"),
          },
          { title: "Telefon", dataIndex: "telefon", width: 120 },
          {
            title: "Gönderim",
            key: "tarih",
            width: 170,
            render: (_: any, r: any) => (
              <div>
                {dayjs(r.tarih).format("DD.MM.YYYY HH:mm")}
                <div style={{ fontSize: 12, color: "#6b7280" }}>{r.gonderen}</div>
              </div>
            ),
          },
          {
            title: "Durum",
            key: "durum",
            width: 150,
            render: (_: any, r: any) =>
              r.durum === "gonderildi" ? (
                <Tag color="green">Gönderildi</Tag>
              ) : (
                <Tooltip title={r.hata}>
                  <Tag color="red">Gitmedi</Tag>
                </Tooltip>
              ),
          },
          {
            title: "",
            key: "islem",
            width: 120,
            render: (_: any, r: any) => (
              <Button size="small" loading={gonderiliyor === r.sicil} onClick={() => yenidenGonder(r.sicil, r.adSoyad)}>
                Tekrar gönder
              </Button>
            ),
          },
        ]}
      />
    </div>
  );
}
