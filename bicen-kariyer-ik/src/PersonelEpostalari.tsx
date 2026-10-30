/**
 * ---------------------------------------------------------------------------
 * Personel e-postaları (Yönetim → İzin formu e-postaları), 13.10.2026
 * ---------------------------------------------------------------------------
 * Genel merkez ve depodaki personel listelenir. E-postası girilen kişinin
 * izin ve fazla mesai formu İK yerine kendi adresine gider; kişi çıktıyı
 * imzalatıp Biçen360'tan yükler, İK ayrıca evrak yüklemez ve aslını
 * istemez. Adresi boş kalanın (temizlik görevlisi gibi bilgisayarı
 * olmayan personel) formu eskisi gibi İK'ya düşer. Şube personeli
 * listede yok: şubelerde akış değişmiyor.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { App as AntdApp, Button, Input, Modal, Segmented, Space, Tag, Typography } from "antd";
import { api } from "./api";
import Tablo from "./Tablo";

const { Text, Paragraph } = Typography;

type Satir = {
  kod: string;
  adSoyad: string;
  birim?: string;
  gorev?: string;
  yer: string;
  eposta?: string | null;
};

const gecerli = (e: string) => /^[^@\s;,]+@[^@\s;,]+\.[^@\s;,]{2,}$/.test(e.trim());

export default function PersonelEpostalari() {
  const { message } = AntdApp.useApp();
  const [liste, setListe] = useState<Satir[]>([]);
  const [taslak, setTaslak] = useState<Record<string, string>>({});
  const [yukleniyor, setYukleniyor] = useState(false);
  const [kaydedilen, setKaydedilen] = useState<string | null>(null);
  const [suzgec, setSuzgec] = useState<"hepsi" | "bos" | "dolu">("hepsi");
  const [ara, setAra] = useState("");
  const [topluAcik, setTopluAcik] = useState(false);
  const [topluMetin, setTopluMetin] = useState("");
  const [topluSonuc, setTopluSonuc] = useState<{ yazilan: number; atlanan: string[] } | null>(null);

  const getir = useCallback(async () => {
    setYukleniyor(true);
    try {
      const c = await api.al<{ personeller: Satir[] }>("/api/PersonelEposta");
      setListe(c.personeller ?? []);
      setTaslak({});
    } catch (h: any) {
      message.error(h?.message ?? "Liste alınamadı.");
    } finally {
      setYukleniyor(false);
    }
  }, [message]);

  useEffect(() => {
    getir();
  }, [getir]);

  const kaydet = async (s: Satir) => {
    const deger = (taslak[s.kod] ?? s.eposta ?? "").trim();
    if (deger === (s.eposta ?? "")) return;
    if (deger && !gecerli(deger)) {
      message.error(`"${deger}" geçerli bir e-posta adresi değil.`);
      return;
    }
    setKaydedilen(s.kod);
    try {
      const c = await api.gonder<{ eposta: string | null }>("/api/PersonelEposta", { kod: s.kod, eposta: deger });
      setListe((l) => l.map((x) => (x.kod === s.kod ? { ...x, eposta: c.eposta } : x)));
      setTaslak((t) => {
        const y = { ...t };
        delete y[s.kod];
        return y;
      });
      message.success(c.eposta ? `${s.adSoyad}: formlar artık ${c.eposta} adresine gidecek.` : `${s.adSoyad}: formlar yeniden İK'ya gidecek.`);
    } catch (h: any) {
      message.error(h?.message ?? "Kaydedilemedi.");
    } finally {
      setKaydedilen(null);
    }
  };

  const topluGonder = async () => {
    const satirlar = topluMetin
      .split(/\r?\n/)
      .map((l) => l.split(/[\t;,]/).map((x) => x.trim()).filter(Boolean))
      .filter((c) => c.length >= 2)
      .map((c) => ({ kod: c[0], eposta: c.find((x) => x.includes("@")) ?? c[1] }));
    if (satirlar.length === 0) {
      message.warning("Okunabilen satır yok. Her satıra sicil ve e-posta yazın.");
      return;
    }
    try {
      const c = await api.gonder<{ yazilan: number; atlanan: string[] }>("/api/PersonelEposta/Toplu", satirlar);
      setTopluSonuc(c);
      message.success(`${c.yazilan} adres kaydedildi.`);
      getir();
    } catch (h: any) {
      message.error(h?.message ?? "Aktarılamadı.");
    }
  };

  const girilen = liste.filter((x) => x.eposta).length;

  const gorunen = useMemo(() => {
    const q = ara.trim().toLocaleLowerCase("tr");
    return liste.filter(
      (x) =>
        (suzgec === "hepsi" || (suzgec === "bos" ? !x.eposta : !!x.eposta)) &&
        (!q || `${x.adSoyad} ${x.kod} ${x.birim ?? ""} ${x.gorev ?? ""}`.toLocaleLowerCase("tr").includes(q))
    );
  }, [liste, suzgec, ara]);

  return (
    <section className="ym-blok">
      <div className="ym-blok-satir">
        <h3 className="ym-blok-bas">Personel e-postaları (genel merkez ve depo)</h3>
        <Tag color="green">{girilen} kişi kendi mailine</Tag>
        <Tag color="blue">{liste.length - girilen} kişi İK'ya</Tag>
        <Button size="small" style={{ marginLeft: "auto" }} onClick={() => { setTopluSonuc(null); setTopluAcik(true); }}>
          Toplu yapıştır
        </Button>
      </div>

      <Paragraph type="secondary" style={{ fontSize: 13 }}>
        E-postası girilen personelin izin ve fazla mesai formu İK yerine <b>kendi adresine</b> gider. Kişi çıktıyı
        alır, imzalatır ve Biçen360'tan yükler; İK son onayda ayrıca evrak yüklemez, aslını da beklemez. Adresi boş
        kalan personelin (bilgisayarı olmayan temizlik görevlisi gibi) formu eskisi gibi İK'ya düşer. Şube personeli
        burada listelenmez; şubelerde akış değişmiyor.
      </Paragraph>

      <Space wrap style={{ marginBottom: 10 }}>
        <Segmented
          value={suzgec}
          onChange={(v) => setSuzgec(v as any)}
          options={[
            { label: `Hepsi · ${liste.length}`, value: "hepsi" },
            { label: `Adresi boş · ${liste.length - girilen}`, value: "bos" },
            { label: `Girilen · ${girilen}`, value: "dolu" },
          ]}
        />
        <Input.Search allowClear placeholder="Ad, sicil, birim ara" style={{ width: 240 }} value={ara} onChange={(e) => setAra(e.target.value)} />
      </Space>

      <Tablo
        rowKey="kod"
        size="small"
        loading={yukleniyor}
        pagination={{ pageSize: 20, showSizeChanger: false }}
        scroll={{ x: 820 }}
        dataSource={gorunen}
        columns={[
          {
            title: "Personel",
            dataIndex: "adSoyad",
            render: (_v: string, k: Satir) => (
              <div>
                <Text strong>{k.adSoyad}</Text>
                <div style={{ fontSize: 11.5, color: "#8a8f98" }}>
                  {k.kod} · {k.gorev || "—"}
                </div>
              </div>
            ),
          },
          {
            title: "Birim",
            dataIndex: "birim",
            width: 190,
            render: (v: string, k: Satir) => (
              <div>
                {v || "—"}
                <div style={{ fontSize: 11.5, color: "#8a8f98" }}>{k.yer}</div>
              </div>
            ),
          },
          {
            title: "E-posta",
            key: "eposta",
            width: 300,
            render: (_: any, k: Satir) => {
              const deger = taslak[k.kod] ?? k.eposta ?? "";
              const hatali = deger.trim().length > 0 && !gecerli(deger);
              return (
                <Input
                  value={deger}
                  status={hatali ? "error" : undefined}
                  placeholder="ad.soyad@bicen.com.tr"
                  disabled={kaydedilen === k.kod}
                  onChange={(e) => setTaslak((t) => ({ ...t, [k.kod]: e.target.value }))}
                  onBlur={() => kaydet(k)}
                  onPressEnter={() => kaydet(k)}
                />
              );
            },
          },
          {
            title: "Form nereye gider",
            key: "hedef",
            width: 170,
            render: (_: any, k: Satir) =>
              k.eposta ? <Tag color="green">Kendi maili</Tag> : <Tag color="blue">İK</Tag>,
          },
        ]}
      />

      <Modal
        open={topluAcik}
        title="Personel e-postalarını toplu yapıştır"
        okText="Kaydet"
        cancelText="Kapat"
        onOk={topluGonder}
        onCancel={() => setTopluAcik(false)}
      >
        <Paragraph type="secondary" style={{ fontSize: 13 }}>
          Excel'den iki sütun kopyalayıp yapıştırın: <b>sicil</b> ve <b>e-posta</b>. Şube personeli ve bulunamayan
          siciller atlanır; sebebi aşağıda yazar.
        </Paragraph>
        <Input.TextArea
          rows={8}
          value={topluMetin}
          onChange={(e) => setTopluMetin(e.target.value)}
          placeholder={"14264\tad.soyad@bicen.com.tr\n10452\tmuhasebe1@bicen.com.tr"}
          style={{ fontFamily: "monospace", fontSize: 13 }}
        />
        {topluSonuc && (
          <div style={{ marginTop: 12 }}>
            <Text strong>{topluSonuc.yazilan} adres kaydedildi.</Text>
            {topluSonuc.atlanan.length > 0 && (
              <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12.5, color: "#a15c00" }}>
                {topluSonuc.atlanan.slice(0, 30).map((a) => (
                  <li key={a}>{a}</li>
                ))}
                {topluSonuc.atlanan.length > 30 && <li>+{topluSonuc.atlanan.length - 30} satır daha</li>}
              </ul>
            )}
          </div>
        )}
      </Modal>
    </section>
  );
}
