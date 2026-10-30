/**
 * ---------------------------------------------------------------------------
 * Etik Hat Yönetimi
 * ---------------------------------------------------------------------------
 * Personelin bildirdiği yolsuzluk, mobbing, taciz gibi konular.
 *
 * Anonim bildirimlerde personel kodu, adı ve telefonu veritabanına hiç
 * yazılmıyor — ekranda gizlemek, veritabanına erişimi olan herkes için
 * anonimliği ortadan kaldırırdı. Bu yüzden anonim bir kaydın sahibini bu
 * ekran da göstermiyor; gösterecek bir veri yok.
 *
 * Hangi rollerin bu sayfayı göreceği Yönetim → Rol Yetkileri'nde
 * belirleniyor. Etik bildirimlerin önemli bir kısmı yönetim zinciri
 * hakkında oluyor ve "hangi yönetici görebilir" sorusunun cevabı yazılıma
 * gömülemez.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from "react";
import {
  App as AntdApp,
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Descriptions,
  Empty,
  Input,
  Modal,
  Row,
  Segmented,
  Space,
  Tag,
  Timeline,
  Tooltip,
  Typography,
} from "antd";
import dayjs from "dayjs";
import {
  Download,
  Paperclip,
  RotateCcw,
  Search,
  ShieldAlert,
  UserX,
} from "lucide-react";

import Tablo from "./Tablo";
import { api } from "./api";
import { RENK } from "./sabitler";

const { Text, Title } = Typography;

interface Bildirim {
  id: number;
  numara: string;
  tur: string;
  yer: string | null;
  subeAdi: string | null;
  olayTarihi: string | null;
  anonim: boolean;
  adSoyad: string | null;
  durum: string;
  inceleyen: string | null;
  olusturma: string;
  guncelleme: string;
  ekSayisi: number;
}

const DURUMLAR: Record<string, { ad: string; renk: string }> = {
  alindi: { ad: "Alındı", renk: "gold" },
  inceleniyor: { ad: "İnceleniyor", renk: "blue" },
  ek_bilgi: { ad: "Ek Bilgi Bekleniyor", renk: "orange" },
  sonuclandi: { ad: "Sonuçlandırıldı", renk: "green" },
  kapandi: { ad: "Kapatıldı", renk: "default" },
};

/* ========================================================================== */

export default function EtikHat() {
  const { message } = AntdApp.useApp();

  const [bildirimler, setBildirimler] = useState<Bildirim[]>([]);
  const [sayimlar, setSayimlar] = useState<{ durum: string; adet: number }[]>([]);
  const [durum, setDurum] = useState<string | undefined>();
  const [ara, setAra] = useState("");
  const [yukleniyor, setYukleniyor] = useState(true);
  const [acik, setAcik] = useState<number | null>(null);

  const getir = useCallback(async () => {
    setYukleniyor(true);

    try {
      const c = await api.al<{
        bildirimler: Bildirim[];
        sayimlar: { durum: string; adet: number }[];
      }>(
        `/api/Etik?durum=${durum ?? ""}&ara=${encodeURIComponent(ara.trim())}`
      );

      setBildirimler(c.bildirimler ?? []);
      setSayimlar(c.sayimlar ?? []);
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Bildirimler alınamadı.");
    } finally {
      setYukleniyor(false);
    }
  }, [durum, ara, message]);

  useEffect(() => {
    getir();
  }, [getir]);

  const sayi = (d: string) => sayimlar.find((x) => x.durum === d)?.adet ?? 0;

  return (
    <div className="ik-icerik">
      <Alert
        type="warning"
        showIcon
        icon={<ShieldAlert size={18} strokeWidth={2} />}
        style={{ marginBottom: 14 }}
        message="Gizlilik"
        description="Bu sayfadaki bildirimler gizlidir. Anonim bildirimlerde bildirim sahibinin kimliği sistemde hiç tutulmaz; öğrenilmesi mümkün değildir. Bildirim içeriğini yetkisiz kişilerle paylaşmayınız."
      />

      <Row gutter={[10, 10]} className="rp-satir">
        <Kutu ad="Alındı" deger={sayi("alindi")} renk="#d48806" />
        <Kutu ad="İnceleniyor" deger={sayi("inceleniyor")} renk="#0958d9" />
        <Kutu ad="Ek bilgi" deger={sayi("ek_bilgi")} renk={RENK.turuncu} />
        <Kutu ad="Sonuçlandı" deger={sayi("sonuclandi")} renk={RENK.yesilKoyu} />
        <Kutu ad="Kapandı" deger={sayi("kapandi")} />
      </Row>

      <Card size="small" className="ik-filtre">
        <Space wrap>
          <Segmented
            value={durum ?? "hepsi"}
            onChange={(d) => setDurum(d === "hepsi" ? undefined : String(d))}
            options={[
              { value: "hepsi", label: "Hepsi" },
              ...Object.entries(DURUMLAR).map(([k, v]) => ({
                value: k,
                label: v.ad,
              })),
            ]}
          />

          <Input
            allowClear
            prefix={<Search size={14} strokeWidth={2} />}
            placeholder="Numara, tür, şube ya da içerik"
            style={{ width: 280 }}
            value={ara}
            onChange={(e) => setAra(e.target.value)}
          />

          <Tooltip title="Yenile">
            <Button icon={<RotateCcw size={15} strokeWidth={2} />} onClick={getir} />
          </Tooltip>
        </Space>
      </Card>

      {bildirimler.length === 0 && !yukleniyor ? (
        <Empty description="Bu süzgeçte bildirim yok." />
      ) : (
        <Tablo
          rowKey="id"
          size="small"
          loading={yukleniyor}
          dataSource={bildirimler}
          scroll={{ x: 900 }}
          onRow={(k: Bildirim) => ({
            onClick: () => setAcik(k.id),
            style: { cursor: "pointer" },
          })}
          columns={[
            {
              title: "Bildirim",
              dataIndex: "numara",
              width: 180,
              render: (n: string, k: Bildirim) => (
                <div>
                  <Text strong style={{ fontFamily: "monospace" }}>
                    {n}
                  </Text>

                  <div style={{ fontSize: 12, color: RENK.metinPasif }}>
                    {dayjs(k.olusturma).format("DD.MM.YYYY HH:mm")}
                  </div>
                </div>
              ),
            },
            { title: "Tür", dataIndex: "tur", ellipsis: true },
            {
              title: "Yer",
              dataIndex: "subeAdi",
              width: 170,
              render: (s: string, k: Bildirim) => (
                <div style={{ fontSize: 13 }}>
                  <div>{s || k.yer || "—"}</div>
                  {k.olayTarihi && (
                    <div style={{ fontSize: 12, color: RENK.metinPasif }}>
                      Olay: {dayjs(k.olayTarihi).format("DD.MM.YYYY")}
                    </div>
                  )}
                </div>
              ),
            },
            {
              title: "Bildiren",
              dataIndex: "anonim",
              width: 170,
              render: (a: boolean, k: Bildirim) =>
                a ? (
                  <Tooltip title="Kimlik bilgisi sistemde tutulmuyor.">
                    <Tag icon={<UserX size={12} strokeWidth={2} />}>Anonim</Tag>
                  </Tooltip>
                ) : (
                  <Text>{k.adSoyad ?? "—"}</Text>
                ),
            },
            {
              title: "Durum",
              dataIndex: "durum",
              width: 180,
              render: (d: string, k: Bildirim) => (
                <Space direction="vertical" size={2}>
                  <Tag color={DURUMLAR[d]?.renk ?? "default"}>
                    {DURUMLAR[d]?.ad ?? d}
                  </Tag>

                  {k.inceleyen && (
                    <Text type="secondary" style={{ fontSize: 11.5 }}>
                      {k.inceleyen}
                    </Text>
                  )}
                </Space>
              ),
            },
            {
              title: "Ek",
              dataIndex: "ekSayisi",
              width: 70,
              align: "center",
              render: (e: number) =>
                e > 0 ? (
                  <Space size={3}>
                    <Paperclip size={13} strokeWidth={2} />
                    {e}
                  </Space>
                ) : (
                  <Text type="secondary">—</Text>
                ),
            },
          ]}
        />
      )}

      {acik && (
        <Detay
          id={acik}
          kapat={() => setAcik(null)}
          guncellendi={() => {
            setAcik(null);
            getir();
          }}
        />
      )}
    </div>
  );
}

/* ========================================================================== */

function Kutu({ ad, deger, renk }: { ad: string; deger: number; renk?: string }) {
  return (
    <Col xs={12} md={4}>
      <Card size="small" className="rp-ozet">
        <div className="rp-ozet-baslik">{ad}</div>
        <div className="rp-ozet-deger" style={renk ? { color: renk } : undefined}>
          {deger}
        </div>
      </Card>
    </Col>
  );
}

/* ========================================================================== */

function Detay({
  id,
  kapat,
  guncellendi,
}: {
  id: number;
  kapat: () => void;
  guncellendi: () => void;
}) {
  const { message } = AntdApp.useApp();

  const [veri, setVeri] = useState<any>(null);
  const [yukleniyor, setYukleniyor] = useState(true);

  const [yeniDurum, setYeniDurum] = useState<string>("");
  const [not, setNot] = useState("");
  const [gorunur, setGorunur] = useState(true);
  const [kaydediliyor, setKaydediliyor] = useState(false);

  const getir = useCallback(async () => {
    setYukleniyor(true);

    try {
      const c = await api.al<any>(`/api/Etik/${id}`);

      setVeri(c);
      setYeniDurum(c?.kayit?.durum ?? "alindi");
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Bildirim alınamadı.");
    } finally {
      setYukleniyor(false);
    }
  }, [id, message]);

  useEffect(() => {
    getir();
  }, [getir]);

  const kaydet = async () => {
    setKaydediliyor(true);

    try {
      await api.gonder(`/api/Etik/${id}/Durum`, {
        durum: yeniDurum,
        not: not.trim() || null,
        gorunur,
      });

      message.success("Bildirim güncellendi.");
      guncellendi();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Güncellenemedi.");
    } finally {
      setKaydediliyor(false);
    }
  };

  const k = veri?.kayit;

  return (
    <Modal
      open
      width={760}
      title={
        k ? (
          <Space size={8} wrap>
            <span style={{ fontFamily: "monospace" }}>{k.numara}</span>
            <Tag color={DURUMLAR[k.durum]?.renk ?? "default"}>
              {DURUMLAR[k.durum]?.ad ?? k.durum}
            </Tag>
            {k.anonim && <Tag icon={<UserX size={12} strokeWidth={2} />}>Anonim</Tag>}
          </Space>
        ) : (
          "Bildirim"
        )
      }
      onCancel={kapat}
      footer={null}
      loading={yukleniyor}
    >
      {k && (
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <Descriptions size="small" column={2} bordered>
            <Descriptions.Item label="Tür" span={2}>
              {k.tur}
            </Descriptions.Item>

            <Descriptions.Item label="Olay yeri">
              {k.subeAdi || k.yer || "—"}
            </Descriptions.Item>

            <Descriptions.Item label="Olay tarihi">
              {k.olayTarihi ? dayjs(k.olayTarihi).format("DD.MM.YYYY") : "—"}
            </Descriptions.Item>

            <Descriptions.Item label="Bildiren">
              {k.anonim ? (
                <Text type="secondary">
                  Anonim — kimlik bilgisi sistemde tutulmuyor
                </Text>
              ) : (
                <>
                  {k.adSoyad}
                  {k.telefon ? ` · ${k.telefon}` : ""}
                </>
              )}
            </Descriptions.Item>

            <Descriptions.Item label="Bildirim tarihi">
              {dayjs(k.olusturma).format("DD.MM.YYYY HH:mm")}
            </Descriptions.Item>
          </Descriptions>

          <Card size="small" title="Açıklama">
            <Text style={{ whiteSpace: "pre-wrap" }}>{k.aciklama}</Text>
          </Card>

          {veri.ekler?.length > 0 && (
            <Card size="small" title={`Ekler (${veri.ekler.length})`}>
              <Space direction="vertical" size={4} style={{ width: "100%" }}>
                {veri.ekler.map((e: any) => (
                  <Button
                    key={e.id}
                    type="link"
                    icon={<Download size={14} strokeWidth={2} />}
                    onClick={() =>
                      api.indir(`/api/Etik/Ek/${e.id}`, e.ozgunAd ?? "ek")
                    }
                  >
                    {e.ozgunAd ?? `Ek ${e.id}`}
                  </Button>
                ))}
              </Space>
            </Card>
          )}

          {k.sonuc && (
            <Card size="small" title="Sonuç">
              <Text style={{ whiteSpace: "pre-wrap" }}>{k.sonuc}</Text>
            </Card>
          )}

          <Card size="small" title="İşlem geçmişi">
            <Timeline
              items={(veri.hareketler ?? []).map((h: any) => ({
                color: h.bildiren ? "blue" : "green",
                children: (
                  <div>
                    <Space size={6} wrap>
                      <Text strong style={{ fontSize: 13 }}>
                        {h.bildiren ? "Bildiren" : h.yapan}
                      </Text>

                      {h.durum && (
                        <Tag color={DURUMLAR[h.durum]?.renk ?? "default"}>
                          {DURUMLAR[h.durum]?.ad ?? h.durum}
                        </Tag>
                      )}

                      <Text type="secondary" style={{ fontSize: 11.5 }}>
                        {dayjs(h.olusturma).format("DD.MM.YYYY HH:mm")}
                      </Text>
                    </Space>

                    {h.metin && (
                      <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>
                        {h.metin}
                      </div>
                    )}
                  </div>
                ),
              }))}
            />
          </Card>

          <Card size="small" title="Durum güncelle">
            <Segmented
              block
              value={yeniDurum}
              onChange={(d) => setYeniDurum(String(d))}
              options={Object.entries(DURUMLAR).map(([kod, v]) => ({
                value: kod,
                label: v.ad,
              }))}
            />

            <Input.TextArea
              rows={3}
              style={{ marginTop: 10 }}
              placeholder="Not — sonuçlandırırken buraya yazdığınız metin sonuç olarak kaydedilir"
              value={not}
              onChange={(e) => setNot(e.target.value)}
            />

            {/* Kurulun kendi arasındaki değerlendirme bildirene
                gitmemeli; varsayılan görünür. */}
            <Space style={{ marginTop: 10, width: "100%", justifyContent: "space-between" }} wrap>
              <Checkbox
                checked={gorunur}
                onChange={(e) => setGorunur(e.target.checked)}
              >
                Bildirimi yapan bu notu görsün
              </Checkbox>

              <Button type="primary" loading={kaydediliyor} onClick={kaydet}>
                Kaydet
              </Button>
            </Space>
          </Card>
        </Space>
      )}
    </Modal>
  );
}
