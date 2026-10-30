/**
 * Pozisyon Personeli (09.10.2026)
 * ---------------------------------------------------------------------------
 * Raporlar › Şube norm kadro ve ihtiyaç tablosunda pozisyona tıklanınca o
 * birimde o pozisyonda çalışan personel listelenir (Norm Kadro ekranındaki
 * listeyle aynı uç: /api/Personel/Birim). Ada tıklanınca personel kartı
 * açılır; "Dönemde gelen başvurular" düğmesi önceki başvuru listesini açar.
 */
import { useEffect, useState } from "react";
import { Alert, Button, Drawer, Empty, Segmented, Skeleton, Tag } from "antd";
import dayjs from "dayjs";
import { FileText, UserRound } from "lucide-react";
import { api } from "./api";
import { PersonelAdi } from "./personelKarti";

export interface PozisyonSecimi {
  subeAdi: string;
  subeKodu?: string;
  bolum: string;
  norm?: number;
  mevcut?: number;
}

interface Kisi {
  personelKodu: string;
  ad: string;
  soyad: string;
  pozisyon?: string;
  isGrubu?: string;
  girisTarihi?: string;
  cikisTarihi?: string;
  durum: number;
  ayrilacak?: boolean;
  engelli?: boolean;
  calismaGunu?: number;
}

const sureYaz = (gun?: number) => {
  if (gun == null) return "";
  if (gun < 31) return `${gun} gün`;
  if (gun < 365) return `${Math.floor(gun / 30)} ay`;
  const y = Math.floor(gun / 365);
  const a = Math.floor((gun % 365) / 30);
  return a ? `${y} yıl ${a} ay` : `${y} yıl`;
};

export default function PozisyonPersoneli({
  secim,
  kapat,
  basvurulariAc,
}: {
  secim: PozisyonSecimi | null;
  kapat: () => void;
  basvurulariAc: (s: PozisyonSecimi) => void;
}) {
  const [liste, setListe] = useState<Kisi[]>([]);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  const [eslesmedi, setEslesmedi] = useState(false);
  const [ayrilanlar, setAyrilanlar] = useState(false);

  useEffect(() => {
    if (!secim) return;
    let iptal = false;
    setYukleniyor(true);
    setHata(null);

    const sorgu = new URLSearchParams({ sube: secim.subeAdi, pozisyon: secim.bolum });
    if (ayrilanlar) sorgu.set("ayrilanlar", "true");

    api
      .al<any>(`/api/Personel/Birim?${sorgu.toString()}`)
      .then((c) => {
        if (iptal) return;
        setListe(c?.personeller ?? []);
        setEslesmedi(c?.birimEslesti === false);
      })
      .catch((e: any) => !iptal && setHata(e.message))
      .finally(() => !iptal && setYukleniyor(false));

    return () => {
      iptal = true;
    };
  }, [secim, ayrilanlar]);

  useEffect(() => {
    if (!secim) setAyrilanlar(false);
  }, [secim]);

  const calisan = liste.filter((x) => x.durum === 1).length;

  return (
    <Drawer
      open={!!secim}
      onClose={kapat}
      width={560}
      title={
        secim ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span>
              {secim.subeAdi} · {secim.bolum}
            </span>
            <small style={{ fontWeight: 400, color: "#6b7563" }}>
              {secim.norm != null ? `Norm ${secim.norm} · ` : ""}
              {calisan} çalışan
            </small>
          </div>
        ) : null
      }
      extra={
        secim ? (
          <Button size="small" icon={<FileText size={14} />} onClick={() => basvurulariAc(secim)}>
            Dönemde gelen başvurular
          </Button>
        ) : null
      }
    >
      <Segmented
        size="small"
        value={ayrilanlar ? "hepsi" : "calisan"}
        onChange={(v) => setAyrilanlar(v === "hepsi")}
        options={[
          { label: "Çalışanlar", value: "calisan" },
          { label: "Ayrılanlar dahil", value: "hepsi" },
        ]}
        style={{ marginBottom: 12 }}
      />

      {eslesmedi && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="Bu birim Mikro'daki bir iş grubuyla eşleşmedi"
          description="Personel Eşleştirmeleri'nden iş grubunu birime bağlayın."
        />
      )}

      {hata && <Alert type="error" showIcon message={hata} style={{ marginBottom: 12 }} />}

      {yukleniyor ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : liste.length === 0 ? (
        <Empty description="Bu pozisyonda personel yok." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {liste.map((k) => (
            <div
              key={k.personelKodu}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 4px",
                borderBottom: "1px solid #eef1ea",
                opacity: k.durum === 1 ? 1 : 0.6,
              }}
            >
              <span
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 10,
                  background: "#f1f5ee",
                  color: "#5d7a4c",
                  display: "grid",
                  placeItems: "center",
                  flex: "none",
                }}
              >
                <UserRound size={16} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>
                  <PersonelAdi kod={k.personelKodu}>
                    {`${k.ad ?? ""} ${k.soyad ?? ""}`.trim()}
                  </PersonelAdi>
                </div>
                <div style={{ fontSize: 12, color: "#6b7563" }}>
                  {[k.personelKodu, k.pozisyon, k.girisTarihi ? `giriş ${dayjs(k.girisTarihi).format("DD.MM.YYYY")}` : null, sureYaz(k.calismaGunu)]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
                {k.engelli && <Tag color="purple">engelli</Tag>}
                {k.ayrilacak && <Tag color="volcano">ayrılacak</Tag>}
                {k.durum !== 1 && (
                  <Tag>{k.cikisTarihi ? `ayrıldı ${dayjs(k.cikisTarihi).format("DD.MM.YYYY")}` : "ayrıldı"}</Tag>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Drawer>
  );
}
