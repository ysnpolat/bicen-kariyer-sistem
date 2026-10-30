/**
 * ---------------------------------------------------------------------------
 * İK Notları
 * ---------------------------------------------------------------------------
 * Başvurulara eklenen tüm dahili notlar tek ekranda. Not metni, notu yazan
 * personel, adayın bilgileri ve başvurunun güncel durumu birlikte gösterilir.
 *
 * Yalnızca yönetici rolündeki kullanıcılar erişebilir.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from "react";
import {
  App as AntdApp,
  Button,
  Card,
  Col,
  DatePicker,
  Empty,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import dayjs, { Dayjs } from "dayjs";
import {
  CalendarRange,
  FileText,
  MessageSquareText,
  Phone,
  RefreshCw,
  Search,
  Store,
  UserCircle2,
} from "lucide-react";

import FormOnizleme from "./FormOnizleme";
import { DURUMLAR, api, durumRengi } from "./api";
import { RENK } from "./sabitler";

const { Title, Text, Paragraph } = Typography;
const { RangePicker } = DatePicker;

interface Not {
  id: number;
  basvuruId: number;
  basvuruNo: string;
  adaySoyad: string;
  telefon: string;
  subeAdi: string;
  bolumler: string;
  durum: string;
  metin: string;
  kullanici: string;
  yazanAdSoyad: string;
  yazanUnvan: string;
  yazanRol: string;
  tarih: string;
}

interface Yazan {
  kullanici: string;
  adSoyad: string;
  adet: number;
}

/** Rol etiketinin rengi */
const rolRengi = (rol: string) =>
  rol === "BolgeMuduru" ? "purple" : rol === "Admin" ? "red" : "green";

const rolAdi = (rol: string) =>
  rol === "BolgeMuduru" ? "Bölge Müdürü" : rol === "Admin" ? "Yönetici" : "İK";

export default function Notlar() {
  const { message } = AntdApp.useApp();

  const [yukleniyor, setYukleniyor] = useState(false);
  const [notlar, setNotlar] = useState<Not[]>([]);
  const [yazanlar, setYazanlar] = useState<Yazan[]>([]);
  const [bolgeler, setBolgeler] = useState<{ ad: string }[]>([]);

  const [aralik, setAralik] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(2, "month").startOf("month"),
    dayjs(),
  ]);
  const [kullanici, setKullanici] = useState<string | undefined>();
  const [bolge, setBolge] = useState<string | undefined>();
  const [durum, setDurum] = useState<string | undefined>();
  const [arama, setArama] = useState("");

  const [form, setForm] = useState<any>(null);
  const [formYukleniyor, setFormYukleniyor] = useState(false);

  const getir = useCallback(async () => {
    setYukleniyor(true);
    try {
      const sorgu = new URLSearchParams({
        bas: aralik[0].format("YYYY-MM-DD"),
        bit: aralik[1].format("YYYY-MM-DD"),
      });

      if (kullanici) sorgu.set("kullanici", kullanici);
      if (bolge) sorgu.set("bolge", bolge);
      if (durum) sorgu.set("durum", durum);
      if (arama.trim()) sorgu.set("arama", arama.trim());

      const sonuc = await api.al<{ notlar: Not[]; yazanlar: Yazan[] }>(
        `/api/Rapor/Notlar?${sorgu.toString()}`
      );

      setNotlar(sonuc.notlar ?? []);
      setYazanlar(sonuc.yazanlar ?? []);
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setYukleniyor(false);
    }
  }, [aralik, kullanici, bolge, durum, arama, message]);

  useEffect(() => {
    getir();
  }, [getir]);

  useEffect(() => {
    api
      .al<any>("/api/Ayar/Form")
      .then((a) => setBolgeler(a.bolgeler ?? []))
      .catch(() => undefined);
  }, []);

  const formuAc = async (id: number) => {
    setFormYukleniyor(true);
    try {
      const kayit = await api.al<any>(`/api/Basvuru/${id}`);
      setForm(JSON.parse(kayit.veriJson || "{}"));
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setFormYukleniyor(false);
    }
  };

  /* Notlar adaya göre gruplanır: aynı adayın notları bir arada görünür */
  const gruplar = notlar.reduce<Record<number, Not[]>>((t, n) => {
    (t[n.basvuruId] ||= []).push(n);
    return t;
  }, {});

  const sirali = Object.values(gruplar).sort(
    (a, b) => dayjs(b[0].tarih).valueOf() - dayjs(a[0].tarih).valueOf()
  );

  return (
    <div className="ik-icerik">
      {/* ------------------------------------------------------------ filtre */}
      <Card size="small" className="rp-filtre">
        <Row gutter={[10, 10]} align="middle">
          <Col xs={24} md={7}>
            <Space size={8}>
              <CalendarRange size={16} strokeWidth={2} color={RENK.metinPasif} />
              <RangePicker
                value={aralik}
                format="DD.MM.YYYY"
                allowClear={false}
                onChange={(d) => d && setAralik(d as [Dayjs, Dayjs])}
              />
            </Space>
          </Col>

          <Col xs={12} md={4}>
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="Notu yazan"
              style={{ width: "100%" }}
              value={kullanici}
              onChange={setKullanici}
              options={yazanlar.map((y) => ({
                value: y.kullanici,
                label: `${y.adSoyad} (${y.adet})`,
              }))}
            />
          </Col>

          <Col xs={12} md={4}>
            <Select
              allowClear
              showSearch
              placeholder="Bölge"
              style={{ width: "100%" }}
              value={bolge}
              onChange={setBolge}
              options={bolgeler.map((b) => ({ value: b.ad, label: b.ad }))}
            />
          </Col>

          <Col xs={12} md={4}>
            <Select
              allowClear
              placeholder="Başvuru durumu"
              style={{ width: "100%" }}
              value={durum}
              onChange={setDurum}
              options={DURUMLAR.map((d) => ({ value: d, label: d }))}
            />
          </Col>

          <Col xs={12} md={4}>
            <Input
              allowClear
              placeholder="Not veya aday ara"
              prefix={<Search size={15} strokeWidth={2} color="#9AA3AF" />}
              value={arama}
              onChange={(e) => setArama(e.target.value)}
            />
          </Col>

          <Col xs={24} md={1}>
            <Button
              block
              loading={yukleniyor}
              icon={<RefreshCw size={15} strokeWidth={2} />}
              onClick={getir}
              title="Yenile"
            />
          </Col>
        </Row>
      </Card>

      {/* -------------------------------------------------------------- özet */}
      <Row gutter={[12, 12]} className="rp-satir">
        <Col xs={12} md={6}>
          <Card size="small" className="rp-ozet">
            <div className="rp-ozet-baslik">Toplam Not</div>
            <div className="rp-ozet-deger">{notlar.length}</div>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small" className="rp-ozet">
            <div className="rp-ozet-baslik">Not Alan Aday</div>
            <div className="rp-ozet-deger">{sirali.length}</div>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small" className="rp-ozet">
            <div className="rp-ozet-baslik">Not Yazan Personel</div>
            <div className="rp-ozet-deger">{yazanlar.length}</div>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small" className="rp-ozet">
            <div className="rp-ozet-baslik">En Çok Not Yazan</div>
            <div className="rp-ozet-deger" style={{ fontSize: 17 }}>
              {yazanlar[0]?.adSoyad ?? "—"}
            </div>
          </Card>
        </Col>
      </Row>

      {/* ------------------------------------------------------------ notlar */}
      <Card
        size="small"
        title={
          <Space size={8}>
            <MessageSquareText size={16} strokeWidth={2} />
            Notlar
          </Space>
        }
      >
        <Paragraph type="secondary" style={{ fontSize: 12.5, marginTop: 0 }}>
          Notlar adaya göre gruplanmıştır. Bir adayın birden fazla notu varsa
          hepsi aynı kartta, en yenisi üstte görünür.
        </Paragraph>

        {yukleniyor ? (
          <div style={{ textAlign: "center", padding: "40px 0" }}>
            <Spin />
          </div>
        ) : sirali.length === 0 ? (
          <Empty description="Seçilen ölçütlere uyan not bulunamadı." />
        ) : (
          <div className="nt-liste">
            {sirali.map((grup) => {
              const ilk = grup[0];

              return (
                <div className="nt-kart" key={ilk.basvuruId}>
                  {/* ------------------------------------------ aday başlığı */}
                  <div className="nt-ust">
                    <div className="nt-aday">
                      <Text strong style={{ fontSize: 15 }}>
                        {ilk.adaySoyad}
                      </Text>
                      <Tag color={durumRengi(ilk.durum)}>{ilk.durum}</Tag>
                      {grup.length > 1 && <Tag>{grup.length} not</Tag>}
                    </div>

                    <Button
                      size="small"
                      icon={<FileText size={14} strokeWidth={2} />}
                      onClick={() => formuAc(ilk.basvuruId)}
                    >
                      Formu gör
                    </Button>
                  </div>

                  <div className="nt-bilgi">
                    <span>{ilk.basvuruNo}</span>
                    {ilk.telefon && (
                      <span>
                        <Phone size={13} strokeWidth={2} /> {ilk.telefon}
                      </span>
                    )}
                    {ilk.subeAdi && (
                      <span>
                        <Store size={13} strokeWidth={2} /> {ilk.subeAdi}
                      </span>
                    )}
                    {ilk.bolumler && <span>{ilk.bolumler}</span>}
                  </div>

                  {/* -------------------------------------------- not listesi */}
                  <div className="nt-notlar">
                    {grup.map((n) => (
                      <div className="nt-not" key={n.id}>
                        <div className="nt-not-ust">
                          <UserCircle2 size={15} strokeWidth={2} />
                          <Text strong style={{ fontSize: 13 }}>
                            {n.yazanAdSoyad || n.kullanici}
                          </Text>

                          {n.yazanRol && (
                            <Tooltip title={n.yazanUnvan || undefined}>
                              <Tag
                                color={rolRengi(n.yazanRol)}
                                style={{ marginInlineEnd: 0 }}
                              >
                                {rolAdi(n.yazanRol)}
                              </Tag>
                            </Tooltip>
                          )}

                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {dayjs(n.tarih).format("DD.MM.YYYY HH:mm")}
                          </Text>
                        </div>

                        <div className="nt-metin">{n.metin}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* ------------------------------------------------------ başvuru formu */}
      <Modal
        open={!!form || formYukleniyor}
        onCancel={() => setForm(null)}
        footer={null}
        width={900}
        className="hv-form-modal"
        loading={formYukleniyor}
        title="Başvuru Formu"
      >
        {form && <FormOnizleme basvuru={form} />}
      </Modal>
    </div>
  );
}
