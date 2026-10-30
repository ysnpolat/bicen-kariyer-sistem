/**
 * Görüşme Takvimi
 * ---------------------------------------------------------------------------
 * İK uzmanlarının oluşturduğu görüşme talepleri gün gün burada görünür.
 * Bir güne tıklandığında o günün görüşmeleri listelenir; her görüşme için
 * not yazılabilir.
 *
 * Notlar ayrı bir yerde tutulmaz: başvurunun kendi not listesine yazılır.
 * Böylece aynı not hem başvuru detayında hem İK performans ekranında görünür
 * ve tek bir kayıt olarak kalır.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  App as AntdApp,
  Badge,
  Button,
  Calendar,
  Card,
  Col,
  DatePicker,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Row,
  Segmented,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { Dayjs } from "dayjs";
import dayjs from "dayjs";
import {
  CalendarDays,
  Clock,
  FileText,
  MapPin,
  UserCheck,
  MessageSquarePlus,
  Bell,
  ChevronLeft,
  ChevronRight,
  Plus,
  StickyNote,
  Trash2,
  Phone,
  Store,
} from "lucide-react";

import { api, durumRengi } from "./api";
import BasvuruDetayModal from "./BasvuruDetayModal";

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

interface Gorusme {
  id: number;
  basvuruNo: string;
  adSoyad: string;
  telefon: string | null;
  subeKodu: string | null;
  subeAdi: string | null;
  bolumler: string | null;
  durum: string;
  gorusmeTarihi: string;
  gorusmeYeri: string | null;
  notSayisi: number;
  olusturan: string | null;
}

export default function GorusmeTakvimi() {
  const { message } = AntdApp.useApp();

  const [yukleniyor, setYukleniyor] = useState(false);
  const [liste, setListe] = useState<Gorusme[]>([]);
  const [ay, setAy] = useState<Dayjs>(dayjs());
  const [secilenGun, setSecilenGun] = useState<Dayjs | null>(null);
  const [gorunum, setGorunum] = useState<"ay" | "hafta" | "liste">("ay");

  /* Hafta görünümünün başlangıcı (pazartesi) */
  const [hafta, setHafta] = useState<Dayjs>(dayjs().startOf("week"));

  /* Ajanda süzgeçleri */
  const [arama, setArama] = useState("");
  const [turSuzgec, setTurSuzgec] = useState<"hepsi" | "basvuru" | "elle" | "not">("hepsi");
  const [uzmanSuzgec, setUzmanSuzgec] = useState<string | undefined>();
  const [zamanSuzgec, setZamanSuzgec] = useState<"yaklasan" | "gecmis" | "hepsi">("yaklasan");

  /* Başvuru detayı: formu görüntülemek ve yazdırmak için. Başvurular ve
     Aday Havuzu ile aynı pencere kullanılır; ayrı bir kopya tutulmaz. */
  const [acikBasvuru, setAcikBasvuru] = useState<number | null>(null);

  /* Not yazma çekmecesi */
  const [notKisi, setNotKisi] = useState<Gorusme | null>(null);
  const [notMetni, setNotMetni] = useState("");
  const [notKaydediliyor, setNotKaydediliyor] = useState(false);

  /* Takvim notları: bir güne yazılan serbest not, istenirse hatırlatmalı.
     Notlar kişiye özeldir; herkes kendi notunu görür. */
  const [notlar, setNotlar] = useState<any[]>([]);
  const [takvimNotu, setTakvimNotu] = useState<any>(null);

  /* Elle oluşturulan görüşmeler: başvurusu olmayan kişilerle */
  const [manuel, setManuel] = useState<any[]>([]);
  const [manuelKayit, setManuelKayit] = useState<any>(null);
  const [manuelForm] = Form.useForm();
  const [notForm] = Form.useForm();

  const getir = useCallback(async () => {
    setYukleniyor(true);
    try {
      /* Görünen ayın bir öncesi ve sonrası da alınır: takvimde komşu
         ayların günleri de gösteriliyor. */
      const merkez = gorunum === "hafta" ? hafta : ay;
      const bas = merkez.startOf("month").subtract(1, "month").format("YYYY-MM-DD");
      const bit = merkez.endOf("month").add(1, "month").format("YYYY-MM-DD");

      const [gorusmeler, gunlukNotlar, elle] = await Promise.all([
        api.al<Gorusme[]>(`/api/Basvuru/GorusmeTakvimi?bas=${bas}&bit=${bit}`),
        api.al<any[]>(`/api/Takvim/Notlar?bas=${bas}&bit=${bit}`).catch(() => []),
        api.al<any[]>(`/api/Takvim/Gorusmeler?bas=${bas}&bit=${bit}`).catch(() => []),
      ]);

      setListe(gorusmeler);
      setNotlar(gunlukNotlar ?? []);
      setManuel(elle ?? []);
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setYukleniyor(false);
    }
  }, [ay, hafta, gorunum, message]);

  useEffect(() => {
    getir();
  }, [getir]);

  /* Notlar ve elle görüşmeler de güne göre gruplanır */
  const notlarGune = useMemo(() => {
    const harita = new Map<string, any[]>();

    notlar.forEach((n) => {
      const anahtar = dayjs(n.gun).format("YYYY-MM-DD");
      if (!harita.has(anahtar)) harita.set(anahtar, []);
      harita.get(anahtar)!.push(n);
    });

    return harita;
  }, [notlar]);

  const manuelGune = useMemo(() => {
    const harita = new Map<string, any[]>();

    manuel.forEach((g) => {
      const anahtar = dayjs(g.gorusmeTarihi).format("YYYY-MM-DD");
      if (!harita.has(anahtar)) harita.set(anahtar, []);
      harita.get(anahtar)!.push(g);
    });

    return harita;
  }, [manuel]);

  /** Takvim notunu kaydeder (adaya yazılan nottan ayrı) */
  const takvimNotuKaydet = async () => {
    const d = await notForm.validateFields();

    try {
      await api.gonder("/api/Takvim/Not", {
        id: takvimNotu?.id ?? 0,
        gun: (takvimNotu?.gun ? dayjs(takvimNotu.gun) : secilenGun ?? dayjs())
          .format("YYYY-MM-DD"),
        baslik: d.baslik,
        metin: d.metin,
        hatirlatma: d.hatirlatma ? d.hatirlatma.toISOString() : null,
      });

      message.success("Not kaydedildi.");
      setTakvimNotu(null);
      notForm.resetFields();
      getir();
    } catch (hata: any) {
      message.error(hata.message);
    }
  };

  /** Takvim notunu siler */
  const notSil = async (id: number) => {
    try {
      await api.sil(`/api/Takvim/Not/${id}`);
      message.success("Not silindi.");
      getir();
    } catch (hata: any) {
      message.error(hata.message);
    }
  };

  /** Elle görüşmeyi kaydeder */
  const manuelKaydet = async () => {
    const d = await manuelForm.validateFields();

    try {
      await api.gonder("/api/Takvim/Gorusme", {
        id: manuelKayit?.id ?? 0,
        adSoyad: d.adSoyad,
        telefon: d.telefon,
        subeAdi: d.subeAdi,
        gorev: d.gorev,
        tur: d.tur ?? "dis",
        gorusmeTarihi: d.gorusmeTarihi.toISOString(),
        gorusmeYeri: d.gorusmeYeri,
        aciklama: d.aciklama,
      });

      message.success("Görüşme kaydedildi.");
      setManuelKayit(null);
      manuelForm.resetFields();
      getir();
    } catch (hata: any) {
      message.error(hata.message);
    }
  };

  /** Elle görüşmeyi siler */
  const manuelSil = async (id: number) => {
    try {
      await api.sil(`/api/Takvim/Gorusme/${id}`);
      message.success("Görüşme silindi.");
      getir();
    } catch (hata: any) {
      message.error(hata.message);
    }
  };

  /* Gün anahtarına göre gruplanır: takvim hücreleri buradan okur */
  const gunlereGore = useMemo(() => {
    const harita = new Map<string, Gorusme[]>();

    liste.forEach((g) => {
      const anahtar = dayjs(g.gorusmeTarihi).format("YYYY-MM-DD");
      if (!harita.has(anahtar)) harita.set(anahtar, []);
      harita.get(anahtar)!.push(g);
    });

    return harita;
  }, [liste]);

  const seciliGunun = secilenGun
    ? gunlereGore.get(secilenGun.format("YYYY-MM-DD")) ?? []
    : [];

  const seciliGununManuel = secilenGun
    ? manuelGune.get(secilenGun.format("YYYY-MM-DD")) ?? []
    : [];

  const seciliGununNotlari = secilenGun
    ? notlarGune.get(secilenGun.format("YYYY-MM-DD")) ?? []
    : [];

  const notKaydet = async () => {
    if (!notKisi) return;

    if (!notMetni.trim()) {
      message.warning("Not metni boş olamaz.");
      return;
    }

    setNotKaydediliyor(true);
    try {
      await api.gonder(`/api/Basvuru/${notKisi.id}/Not`, {
        metin: notMetni.trim(),
      });

      message.success("Not eklendi.");
      setNotKisi(null);
      setNotMetni("");
      getir();
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setNotKaydediliyor(false);
    }
  };

  /* ------------------------------------------------------------------ */
  /* Birleşik ajanda                                                    */
  /* ------------------------------------------------------------------ */

  /* Üç kaynak tek listede: başvuru görüşmeleri, elle oluşturulanlar ve
     hatırlatmalı notlar. Takvim hücresi, hafta görünümü ve ajanda hepsi
     bu listeden okur; kaynak farkı yalnızca renkte görünür. */
  interface AjandaKaydi {
    anahtar: string;
    tur: "basvuru" | "elle" | "not";
    zaman: Dayjs;
    saatli: boolean;
    ad: string;
    alt: string;
    uzman: string | null;
    kaynak: any;
  }

  const ajanda = useMemo<AjandaKaydi[]>(() => {
    const kayitlar: AjandaKaydi[] = [];

    liste.forEach((g) =>
      kayitlar.push({
        anahtar: `b-${g.id}`,
        tur: "basvuru",
        zaman: dayjs(g.gorusmeTarihi),
        saatli: true,
        ad: g.adSoyad,
        alt: [g.bolumler, g.subeAdi].filter(Boolean).join(" · "),
        uzman: g.olusturan,
        kaynak: g,
      })
    );

    manuel.forEach((g: any) =>
      kayitlar.push({
        anahtar: `m-${g.id}`,
        tur: "elle",
        zaman: dayjs(g.gorusmeTarihi),
        saatli: true,
        ad: g.adSoyad,
        alt: [g.tur === "personel" ? "Personel" : "Dışarıdan", g.gorev, g.subeAdi, g.aciklama]
          .filter(Boolean)
          .join(" · "),
        uzman: g.olusturanAd ?? null,
        kaynak: g,
      })
    );

    notlar.forEach((n: any) =>
      kayitlar.push({
        anahtar: `n-${n.id}`,
        tur: "not",
        zaman: n.hatirlatma ? dayjs(n.hatirlatma) : dayjs(n.gun).startOf("day"),
        saatli: !!n.hatirlatma,
        ad: n.baslik,
        alt: n.metin ?? "",
        uzman: null,
        kaynak: n,
      })
    );

    return kayitlar.sort((a, b) => a.zaman.valueOf() - b.zaman.valueOf());
  }, [liste, manuel, notlar]);

  const ajandaGune = useMemo(() => {
    const harita = new Map<string, AjandaKaydi[]>();

    ajanda.forEach((k) => {
      const anahtar = k.zaman.format("YYYY-MM-DD");
      if (!harita.has(anahtar)) harita.set(anahtar, []);
      harita.get(anahtar)!.push(k);
    });

    return harita;
  }, [ajanda]);

  const bugun = dayjs().startOf("day");

  const ozet = useMemo(() => {
    const gorusmeler = ajanda.filter((k) => k.tur !== "not");

    return {
      bugun: gorusmeler.filter((k) => k.zaman.isSame(bugun, "day")).length,
      buHafta: gorusmeler.filter((k) => k.zaman.isSame(bugun, "week")).length,
      yediGun: gorusmeler.filter(
        (k) => k.zaman.isAfter(bugun) && k.zaman.isBefore(bugun.add(7, "day"))
      ).length,
      hatirlatma: ajanda.filter(
        (k) => k.tur === "not" && k.saatli && !k.kaynak.hatirlatildi && k.zaman.isAfter(dayjs())
      ).length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ajanda]);

  const uzmanlar = useMemo(
    () =>
      Array.from(new Set(ajanda.map((k) => k.uzman).filter(Boolean) as string[]))
        .sort((a, b) => a.localeCompare(b, "tr")),
    [ajanda]
  );

  /* Ajanda listesi süzülmüş hâli */
  const suzulmusAjanda = useMemo(() => {
    const q = arama.trim().toLocaleLowerCase("tr");

    return ajanda.filter((k) => {
      if (turSuzgec !== "hepsi" && k.tur !== turSuzgec) return false;
      if (uzmanSuzgec && k.uzman !== uzmanSuzgec) return false;

      if (zamanSuzgec === "yaklasan" && k.zaman.isBefore(bugun)) return false;
      if (zamanSuzgec === "gecmis" && !k.zaman.isBefore(bugun)) return false;

      if (q) {
        const metin = [k.ad, k.alt, k.uzman, k.kaynak?.telefon, k.kaynak?.gorusmeYeri]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase("tr");

        if (!metin.includes(q)) return false;
      }

      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ajanda, arama, turSuzgec, uzmanSuzgec, zamanSuzgec]);

  const turRengi = (tur: AjandaKaydi["tur"]) =>
    tur === "basvuru" ? "#7CB518" : tur === "elle" ? "#1677ff" : "#d48806";

  const turAdi = (tur: AjandaKaydi["tur"]) =>
    tur === "basvuru" ? "Başvuru görüşmesi" : tur === "elle" ? "Elle görüşme" : "Not";

  /** Takvim ve hafta görünümündeki küçük şerit */
  const cip = (k: AjandaKaydi, genis = false) => {
    const gecmis = k.zaman.isBefore(bugun);

    return (
      <Tooltip
        key={k.anahtar}
        title={
          <div style={{ fontSize: 12 }}>
            <div>
              <b>{k.ad}</b>
            </div>
            <div>{turAdi(k.tur)}{k.saatli ? ` · ${k.zaman.format("HH:mm")}` : ""}</div>
            {k.alt && <div>{k.alt}</div>}
            {k.uzman && <div>{k.uzman}</div>}
          </div>
        }
      >
        <div
          className={`gt-cip${gecmis ? " gt-cip-gecmis" : ""}${genis ? " gt-cip-genis" : ""}`}
          style={{ borderLeftColor: turRengi(k.tur) }}
          onClick={(e) => {
            e.stopPropagation();
            setAy(k.zaman);
            setSecilenGun(k.zaman);
          }}
        >
          {k.saatli && <span className="gt-cip-saat">{k.zaman.format("HH:mm")}</span>}
          <span className="gt-cip-ad">{k.ad}</span>
        </div>
      </Tooltip>
    );
  };

  /** Ay görünümü hücresi: ilk üç kayıt şerit, gerisi "+N" */
  const hucre = (tarih: Dayjs) => {
    const gunun = ajandaGune.get(tarih.format("YYYY-MM-DD")) ?? [];

    if (gunun.length === 0) return null;

    return (
      <div className="gt-hucre">
        {gunun.slice(0, 3).map((k) => cip(k))}
        {gunun.length > 3 && (
          <div className="gt-fazla">+{gunun.length - 3} kayıt daha</div>
        )}
      </div>
    );
  };

  /* --------------------------------------------------------- hafta */
  const haftaGorunumu = (() => {
    const gunler = Array.from({ length: 7 }, (_, i) => hafta.add(i, "day"));

    return (
      <Card size="small">
        <Space
          align="center"
          style={{ width: "100%", justifyContent: "space-between", marginBottom: 10 }}
          wrap
        >
          <Space size={6}>
            <Button
              size="small"
              icon={<ChevronLeft size={14} strokeWidth={2} />}
              onClick={() => setHafta((h) => h.subtract(1, "week"))}
            />
            <Button size="small" onClick={() => setHafta(dayjs().startOf("week"))}>
              Bu hafta
            </Button>
            <Button
              size="small"
              icon={<ChevronRight size={14} strokeWidth={2} />}
              onClick={() => setHafta((h) => h.add(1, "week"))}
            />
          </Space>

          <Text strong>
            {gunler[0].format("DD MMM")} – {gunler[6].format("DD MMM YYYY")}
          </Text>

          <Text type="secondary" style={{ fontSize: 12.5 }}>
            {gunler.reduce(
              (t, g) =>
                t + (ajandaGune.get(g.format("YYYY-MM-DD")) ?? []).filter((k) => k.tur !== "not").length,
              0
            )}{" "}
            görüşme
          </Text>
        </Space>

        <div className="gt-hafta">
          {gunler.map((g) => {
            const gunun = ajandaGune.get(g.format("YYYY-MM-DD")) ?? [];
            const buGun = g.isSame(bugun, "day");
            const haftaSonu = g.day() === 0 || g.day() === 6;

            return (
              <div
                key={g.format("YYYY-MM-DD")}
                className={`gt-gun${buGun ? " gt-gun-bugun" : ""}${haftaSonu ? " gt-gun-hs" : ""}`}
                onClick={() => {
                  setAy(g);
                  setSecilenGun(g);
                }}
              >
                <div className="gt-gun-baslik">
                  <span className="gt-gun-ad">{g.format("ddd")}</span>
                  <span className="gt-gun-no">{g.format("D")}</span>
                  {gunun.length > 0 && (
                    <span className="gt-gun-sayi">{gunun.length}</span>
                  )}
                </div>

                <div className="gt-gun-govde">
                  {gunun.length === 0 ? (
                    <div className="gt-bos">—</div>
                  ) : (
                    gunun.map((k) => cip(k, true))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    );
  })();

  /* ---------------------------------------------------------- ajanda */
  const ajandaGorunumu = (
    <Card size="small">
      <Space wrap style={{ marginBottom: 10 }}>
        <Input
          allowClear
          value={arama}
          onChange={(e) => setArama(e.target.value)}
          placeholder="Ad, şube, telefon, yer"
          style={{ width: 220 }}
        />

        <Select
          value={zamanSuzgec}
          onChange={setZamanSuzgec}
          style={{ width: 150 }}
          options={[
            { value: "yaklasan", label: "Yaklaşanlar" },
            { value: "gecmis", label: "Geçmiş" },
            { value: "hepsi", label: "Tümü" },
          ]}
        />

        <Select
          value={turSuzgec}
          onChange={setTurSuzgec}
          style={{ width: 180 }}
          options={[
            { value: "hepsi", label: "Tüm kayıtlar" },
            { value: "basvuru", label: "Başvuru görüşmeleri" },
            { value: "elle", label: "Elle görüşmeler" },
            { value: "not", label: "Notlar" },
          ]}
        />

        {uzmanlar.length > 0 && (
          <Select
            allowClear
            value={uzmanSuzgec}
            onChange={setUzmanSuzgec}
            placeholder="Oluşturan"
            style={{ width: 180 }}
            options={uzmanlar.map((u) => ({ value: u, label: u }))}
          />
        )}

        <Text type="secondary" style={{ fontSize: 12.5 }}>
          {suzulmusAjanda.length} kayıt
        </Text>
      </Space>

      <Table
        size="small"
        rowKey="anahtar"
        dataSource={suzulmusAjanda}
        pagination={{ pageSize: 15, hideOnSinglePage: true, showSizeChanger: false }}
        locale={{
          emptyText: (
            <Empty
              description={
                zamanSuzgec === "yaklasan"
                  ? "Yaklaşan kayıt bulunmuyor. Görünen aylar dışındaki kayıtlar için takvimde ilerleyin."
                  : "Süzgece uyan kayıt yok."
              }
            />
          ),
        }}
        onRow={(k: AjandaKaydi) => ({
          onClick: () => {
            setAy(k.zaman);
            setSecilenGun(k.zaman);
          },
          style: { cursor: "pointer" },
        })}
        rowClassName={(k: AjandaKaydi) =>
          k.zaman.isSame(bugun, "day") ? "gt-satir-bugun" : ""
        }
        columns={[
          {
            title: "Zaman",
            key: "zaman",
            width: 170,
            render: (_: any, k: AjandaKaydi) => {
              const gunFarki = k.zaman.startOf("day").diff(bugun, "day");

              return (
                <div>
                  <Text strong>
                    {k.zaman.format("DD.MM.YYYY")}
                    {k.saatli ? ` ${k.zaman.format("HH:mm")}` : ""}
                  </Text>
                  <div style={{ fontSize: 11.5, color: "#8a8f98" }}>
                    {k.zaman.format("dddd")}
                    {gunFarki === 0
                      ? " · bugün"
                      : gunFarki === 1
                      ? " · yarın"
                      : gunFarki > 1
                      ? ` · ${gunFarki} gün sonra`
                      : ` · ${Math.abs(gunFarki)} gün önce`}
                  </div>
                </div>
              );
            },
          },
          {
            title: "Kayıt",
            key: "ad",
            render: (_: any, k: AjandaKaydi) => (
              <div>
                <Space size={6} wrap>
                  <span className="gt-nokta" style={{ background: turRengi(k.tur) }} />
                  <Text strong>{k.ad}</Text>
                  {k.tur === "basvuru" && (
                    <Tag color={durumRengi(k.kaynak.durum)}>{k.kaynak.durum}</Tag>
                  )}
                  {k.tur === "elle" && (
                    <Tag color={k.kaynak.tur === "personel" ? "blue" : "default"}>
                      {k.kaynak.tur === "personel" ? "Personel" : "Dışarıdan"}
                    </Tag>
                  )}
                  {k.tur === "not" && (
                    <Tag color={k.saatli ? (k.kaynak.hatirlatildi ? "default" : "orange") : "default"}>
                      {k.saatli ? "hatırlatma" : "not"}
                    </Tag>
                  )}
                  {k.tur === "basvuru" && k.kaynak.notSayisi > 0 && (
                    <Tag>{k.kaynak.notSayisi} not</Tag>
                  )}
                </Space>
                {k.alt && (
                  <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>{k.alt}</div>
                )}
              </div>
            ),
          },
          {
            title: "Yer / Telefon",
            key: "yer",
            width: 200,
            render: (_: any, k: AjandaKaydi) => (
              <div style={{ fontSize: 12.5 }}>
                {k.kaynak.gorusmeYeri && <div>{k.kaynak.gorusmeYeri}</div>}
                {k.kaynak.telefon && (
                  <a href={`tel:${k.kaynak.telefon}`} onClick={(e) => e.stopPropagation()}>
                    {k.kaynak.telefon}
                  </a>
                )}
                {!k.kaynak.gorusmeYeri && !k.kaynak.telefon && (
                  <Text type="secondary">—</Text>
                )}
              </div>
            ),
          },
          {
            title: "Oluşturan",
            dataIndex: "uzman",
            width: 150,
            render: (v: string | null) => v || <Text type="secondary">—</Text>,
          },
          {
            title: "",
            key: "islem",
            width: 200,
            align: "right",
            render: (_: any, k: AjandaKaydi) =>
              k.tur === "basvuru" ? (
                <Space size={4} onClick={(e) => e.stopPropagation()}>
                  <Button
                    size="small"
                    icon={<FileText size={13} strokeWidth={2} />}
                    onClick={() => setAcikBasvuru(k.kaynak.id)}
                  >
                    Form
                  </Button>
                  <Button
                    size="small"
                    icon={<MessageSquarePlus size={13} strokeWidth={2} />}
                    onClick={() => {
                      setNotKisi(k.kaynak);
                      setNotMetni("");
                    }}
                  >
                    Not
                  </Button>
                </Space>
              ) : k.tur === "elle" ? (
                <Space size={4} onClick={(e) => e.stopPropagation()}>
                  <Button
                    size="small"
                    onClick={() => {
                      manuelForm.setFieldsValue({
                        ...k.kaynak,
                        gorusmeTarihi: dayjs(k.kaynak.gorusmeTarihi),
                      });
                      setManuelKayit(k.kaynak);
                    }}
                  >
                    Düzenle
                  </Button>
                  <Popconfirm
                    title="Görüşme silinsin mi?"
                    okText="Sil"
                    cancelText="Vazgeç"
                    onConfirm={() => manuelSil(k.kaynak.id)}
                  >
                    <Button size="small" danger type="text" icon={<Trash2 size={13} strokeWidth={2} />} />
                  </Popconfirm>
                </Space>
              ) : (
                <Space size={4} onClick={(e) => e.stopPropagation()}>
                  <Button
                    size="small"
                    onClick={() => {
                      notForm.setFieldsValue({
                        baslik: k.kaynak.baslik,
                        metin: k.kaynak.metin,
                        hatirlatma: k.kaynak.hatirlatma ? dayjs(k.kaynak.hatirlatma) : null,
                      });
                      setTakvimNotu(k.kaynak);
                    }}
                  >
                    Düzenle
                  </Button>
                  <Popconfirm
                    title="Not silinsin mi?"
                    okText="Sil"
                    cancelText="Vazgeç"
                    onConfirm={() => notSil(k.kaynak.id)}
                  >
                    <Button size="small" danger type="text" icon={<Trash2 size={13} strokeWidth={2} />} />
                  </Popconfirm>
                </Space>
              ),
          },
        ]}
      />
    </Card>
  );

  const gorusmeKarti = (g: Gorusme) => (
    <Card
      key={g.id}
      size="small"
      style={{ marginBottom: 10 }}
      styles={{ body: { padding: "12px 14px" } }}
    >
      <Row gutter={[8, 8]} align="middle">
        <Col flex="auto">
          <Space size={8} wrap>
            <Text strong>{g.adSoyad}</Text>
            <Tag color={durumRengi(g.durum)}>{g.durum}</Tag>
            {g.notSayisi > 0 && <Tag>{g.notSayisi} not</Tag>}
          </Space>

          <div style={{ marginTop: 6 }}>
            <Space size={14} wrap>
              <Text type="secondary" style={{ fontSize: 12.5 }}>
                <Clock size={13} strokeWidth={2} />{" "}
                {dayjs(g.gorusmeTarihi).format("DD.MM.YYYY HH:mm")}
              </Text>

              {g.subeAdi && (
                <Text type="secondary" style={{ fontSize: 12.5 }}>
                  <Store size={13} strokeWidth={2} /> {g.subeAdi}
                </Text>
              )}

              {g.telefon && (
                <Text type="secondary" style={{ fontSize: 12.5 }}>
                  <Phone size={13} strokeWidth={2} />{" "}
                  <a href={`tel:${g.telefon}`}>{g.telefon}</a>
                </Text>
              )}
            </Space>
          </div>

          {g.gorusmeYeri && (
            <div style={{ marginTop: 4 }}>
              <Text type="secondary" style={{ fontSize: 12.5 }}>
                <MapPin size={13} strokeWidth={2} /> {g.gorusmeYeri}
              </Text>
            </div>
          )}

          {g.olusturan && (
            <div style={{ marginTop: 4 }}>
              <Text type="secondary" style={{ fontSize: 12.5 }}>
                <UserCheck size={13} strokeWidth={2} /> {g.olusturan}
              </Text>
            </div>
          )}
        </Col>

        <Col>
          <Space size={6} wrap>
            <Button
              size="small"
              icon={<FileText size={14} strokeWidth={2} />}
              onClick={() => setAcikBasvuru(g.id)}
            >
              Başvuru formu
            </Button>

            <Button
              size="small"
              icon={<MessageSquarePlus size={14} strokeWidth={2} />}
              onClick={() => {
                setNotKisi(g);
                setNotMetni("");
              }}
            >
              Not ekle
            </Button>
          </Space>
        </Col>
      </Row>
    </Card>
  );

  /** Üst düğmeler: görüşme ve not ekleme çekmece dışından da yapılabilsin */
  const yeniGorusme = (gun?: Dayjs) => {
    manuelForm.setFieldsValue({
      adSoyad: "",
      telefon: "",
      subeAdi: "",
      gorev: "",
      tur: "dis",
      gorusmeTarihi: (gun ?? secilenGun ?? dayjs()).hour(10).minute(0),
      gorusmeYeri: "",
      aciklama: "",
    });
    setManuelKayit({});
  };

  const yeniNot = () => {
    notForm.setFieldsValue({ baslik: "", metin: "", hatirlatma: null });
    setTakvimNotu({});
  };

  return (
    <div>
      <Row gutter={[12, 12]} align="middle" style={{ marginBottom: 12 }}>
        <Col xs={24} md={12}>
          <Title level={5} style={{ marginTop: 0, marginBottom: 4 }}>
            <Space size={8}>
              <CalendarDays size={18} strokeWidth={2} />
              Görüşme Takvimi
            </Space>
          </Title>
          <Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 0 }}>
            Başvuru görüşmeleri, elle oluşturulan görüşmeler ve notlarınız tek
            takvimde. Bir kayda ya da güne tıklayınca ayrıntı açılır; notlar
            başvurunun kaydına işlenir.
          </Paragraph>
        </Col>

        <Col xs={24} md={12} style={{ textAlign: "right" }}>
          <Space wrap>
            <Segmented
              value={gorunum}
              onChange={(v) => setGorunum(v as "ay" | "hafta" | "liste")}
              options={[
                { label: "Ay", value: "ay" },
                { label: "Hafta", value: "hafta" },
                { label: "Ajanda", value: "liste" },
              ]}
            />
            <Button
              onClick={() => {
                setAy(dayjs());
                setHafta(dayjs().startOf("week"));
              }}
            >
              Bugün
            </Button>
            <Button icon={<StickyNote size={15} strokeWidth={2} />} onClick={yeniNot}>
              Not
            </Button>
            <Button
              type="primary"
              icon={<Plus size={15} strokeWidth={2} />}
              onClick={() => yeniGorusme()}
            >
              Görüşme ekle
            </Button>
            <Button loading={yukleniyor} onClick={getir}>
              Yenile
            </Button>
          </Space>
        </Col>
      </Row>

      {/* -------------------------------------------------- özet şeridi */}
      <Row gutter={[10, 10]} style={{ marginBottom: 12 }}>
        {[
          { et: "Bugün", dg: ozet.bugun, ip: "görüşme", renk: "#7CB518", tik: () => { setAy(dayjs()); setSecilenGun(dayjs()); } },
          { et: "Bu hafta", dg: ozet.buHafta, ip: "görüşme", renk: "#1677ff", tik: () => { setHafta(dayjs().startOf("week")); setGorunum("hafta"); } },
          { et: "Önümüzdeki 7 gün", dg: ozet.yediGun, ip: "görüşme", renk: "#722ed1", tik: () => { setZamanSuzgec("yaklasan"); setTurSuzgec("hepsi"); setGorunum("liste"); } },
          { et: "Bekleyen hatırlatma", dg: ozet.hatirlatma, ip: "notlarım", renk: "#d48806", tik: () => { setZamanSuzgec("yaklasan"); setTurSuzgec("not"); setGorunum("liste"); } },
        ].map((k) => (
          <Col flex="1 1 150px" key={k.et}>
            <div className="gt-kutu" style={{ borderLeftColor: k.renk }} onClick={k.tik}>
              <div className="gt-et">{k.et}</div>
              <div className="gt-dg" style={{ color: k.dg > 0 ? k.renk : undefined }}>{k.dg}</div>
              <div className="gt-ip">{k.ip} · tıklayınca açılır</div>
            </div>
          </Col>
        ))}
      </Row>

      {yukleniyor && liste.length === 0 && manuel.length === 0 ? (
        <div style={{ textAlign: "center", padding: "50px 0" }}>
          <Spin />
        </div>
      ) : gorunum === "ay" ? (
        <Card size="small" className="gt-ay">
          <Calendar
            value={ay}
            onPanelChange={(deger) => setAy(deger)}
            onSelect={(deger, bilgi) => {
              setAy(deger);
              /* Ay değiştirirken de onSelect tetikleniyor; yalnızca güne
                 tıklandığında çekmece açılsın */
              if (bilgi?.source === "date") setSecilenGun(deger);
            }}
            cellRender={(tarih, bilgi) =>
              bilgi.type === "date" ? hucre(tarih) : null
            }
          />

          <Space size={14} wrap style={{ marginTop: 8 }}>
            {(["basvuru", "elle", "not"] as const).map((t) => (
              <Text key={t} type="secondary" style={{ fontSize: 12 }}>
                <span className="gt-nokta" style={{ background: turRengi(t) }} />
                {turAdi(t)}
              </Text>
            ))}
            <Text type="secondary" style={{ fontSize: 12 }}>
              Soluk şerit geçmiş kayıttır.
            </Text>
          </Space>
        </Card>
      ) : gorunum === "hafta" ? (
        haftaGorunumu
      ) : (
        ajandaGorunumu
      )}

      {/* ------------------------------------------------ seçilen gün */}
      <Drawer
        open={!!secilenGun}
        onClose={() => setSecilenGun(null)}
        width="min(640px, 96vw)"
        title={
          secilenGun && (
            <Space size={8}>
              <CalendarDays size={16} strokeWidth={2} />
              <Text strong>{secilenGun.format("DD MMMM YYYY")}</Text>
              {seciliGunun.length > 0 && <Tag>{seciliGunun.length} görüşme</Tag>}
            </Space>
          )
        }
      >
        {/* -------------------------------------------- işlem düğmeleri */}
        <Space wrap style={{ marginBottom: 14 }}>
          <Button
            type="primary"
            icon={<Plus size={15} strokeWidth={2} />}
            onClick={() => yeniGorusme(secilenGun ?? undefined)}
          >
            Görüşme ekle
          </Button>

          <Button icon={<StickyNote size={15} strokeWidth={2} />} onClick={yeniNot}>
            Not ekle
          </Button>
        </Space>

        {/* ----------------------------------------- başvuru görüşmeleri */}
        {seciliGunun.length > 0 && seciliGunun.map(gorusmeKarti)}

        {/* -------------------------------------------- elle görüşmeler */}
        {seciliGununManuel.length > 0 && (
          <>
            <Text strong style={{ fontSize: 13 }}>
              Elle oluşturulan görüşmeler
            </Text>

            {seciliGununManuel.map((g: any) => (
              <Card size="small" key={`m-${g.id}`} style={{ marginTop: 8 }}>
                <Space
                  align="start"
                  style={{ width: "100%", justifyContent: "space-between" }}
                >
                  <div>
                    <Space size={6}>
                      <Text strong>{g.adSoyad}</Text>
                      <Tag color={g.tur === "personel" ? "blue" : "default"}>
                        {g.tur === "personel" ? "Personel" : "Dışarıdan"}
                      </Tag>
                    </Space>

                    <div>
                      <Text type="secondary" style={{ fontSize: 12.5 }}>
                        <Clock size={12} strokeWidth={2} />{" "}
                        {dayjs(g.gorusmeTarihi).format("HH:mm")}
                        {g.telefon ? ` · ${g.telefon}` : ""}
                        {g.subeAdi ? ` · ${g.subeAdi}` : ""}
                      </Text>
                    </div>

                    {g.aciklama && (
                      <div style={{ marginTop: 4 }}>
                        <Text style={{ fontSize: 13 }}>{g.aciklama}</Text>
                      </div>
                    )}

                    <div style={{ marginTop: 4 }}>
                      <Text type="secondary" style={{ fontSize: 11.5 }}>
                        {g.olusturanAd}
                      </Text>
                    </div>
                  </div>

                  <Space size={4}>
                    <Button
                      size="small"
                      onClick={() => {
                        manuelForm.setFieldsValue({
                          ...g,
                          gorusmeTarihi: dayjs(g.gorusmeTarihi),
                        });
                        setManuelKayit(g);
                      }}
                    >
                      Düzenle
                    </Button>

                    <Popconfirm
                      title="Görüşme silinsin mi?"
                      okText="Sil"
                      cancelText="Vazgeç"
                      onConfirm={() => manuelSil(g.id)}
                    >
                      <Button
                        size="small"
                        danger
                        type="text"
                        icon={<Trash2 size={14} strokeWidth={2} />}
                      />
                    </Popconfirm>
                  </Space>
                </Space>
              </Card>
            ))}
          </>
        )}

        {/* ---------------------------------------------------- notlar */}
        {seciliGununNotlari.length > 0 && (
          <>
            <Text strong style={{ fontSize: 13, display: "block", marginTop: 16 }}>
              Notlarım
            </Text>

            {seciliGununNotlari.map((n: any) => (
              <Card size="small" key={`n-${n.id}`} style={{ marginTop: 8 }}>
                <Space
                  align="start"
                  style={{ width: "100%", justifyContent: "space-between" }}
                >
                  <div>
                    <Text strong>{n.baslik}</Text>

                    {n.metin && (
                      <div>
                        <Text style={{ fontSize: 13 }}>{n.metin}</Text>
                      </div>
                    )}

                    {n.hatirlatma && (
                      <div style={{ marginTop: 4 }}>
                        <Tag color={n.hatirlatildi ? "default" : "orange"}>
                          <Bell size={11} strokeWidth={2} />{" "}
                          {dayjs(n.hatirlatma).format("DD.MM.YYYY HH:mm")}
                          {n.hatirlatildi ? " · hatırlatıldı" : ""}
                        </Tag>
                      </div>
                    )}
                  </div>

                  <Space size={4}>
                    <Button
                      size="small"
                      onClick={() => {
                        notForm.setFieldsValue({
                          baslik: n.baslik,
                          metin: n.metin,
                          hatirlatma: n.hatirlatma ? dayjs(n.hatirlatma) : null,
                        });
                        setTakvimNotu(n);
                      }}
                    >
                      Düzenle
                    </Button>

                    <Popconfirm
                      title="Not silinsin mi?"
                      okText="Sil"
                      cancelText="Vazgeç"
                      onConfirm={() => notSil(n.id)}
                    >
                      <Button
                        size="small"
                        danger
                        type="text"
                        icon={<Trash2 size={14} strokeWidth={2} />}
                      />
                    </Popconfirm>
                  </Space>
                </Space>
              </Card>
            ))}
          </>
        )}

        {seciliGunun.length === 0 &&
          seciliGununManuel.length === 0 &&
          seciliGununNotlari.length === 0 && (
            <Empty description="Bu güne ait kayıt bulunmuyor." />
          )}
      </Drawer>

      {/* --------------------------------------------- takvim notu penceresi */}
      <Modal
        open={!!takvimNotu}
        title={takvimNotu?.id ? "Notu düzenle" : "Takvim notu"}
        okText="Kaydet"
        cancelText="Vazgeç"
        onOk={takvimNotuKaydet}
        onCancel={() => setTakvimNotu(null)}
        width={480}
        destroyOnClose
      >
        <Form form={notForm} layout="vertical">
          <Form.Item
            name="baslik"
            label="Başlık"
            rules={[{ required: true, message: "Başlık zorunludur." }]}
          >
            <Input placeholder="Kısaca ne hatırlatılacak" maxLength={200} />
          </Form.Item>

          <Form.Item name="metin" label="Not">
            <Input.TextArea rows={4} placeholder="Ayrıntı" />
          </Form.Item>

          <Form.Item
            name="hatirlatma"
            label="Hatırlat"
            tooltip="Boş bırakılırsa yalnızca not olarak durur, bildirim gönderilmez"
          >
            <DatePicker
              showTime={{ format: "HH:mm" }}
              format="DD.MM.YYYY HH:mm"
              style={{ width: "100%" }}
              placeholder="Tarih ve saat seçiniz"
            />
          </Form.Item>

          <Text type="secondary" style={{ fontSize: 12 }}>
            Hatırlatma zamanı geldiğinde panel zilinize bildirim düşer. Notlar
            yalnızca size görünür.
          </Text>
        </Form>
      </Modal>

      {/* ------------------------------------------ elle görüşme penceresi */}
      <Modal
        open={!!manuelKayit}
        title={manuelKayit?.id ? "Görüşmeyi düzenle" : "Görüşme oluştur"}
        okText="Kaydet"
        cancelText="Vazgeç"
        onOk={manuelKaydet}
        onCancel={() => setManuelKayit(null)}
        width={560}
        destroyOnClose
      >
        <Form form={manuelForm} layout="vertical">
          <Form.Item
            name="tur"
            label="Kişi"
            tooltip="Mağazada çalışan biri mi, dışarıdan biri mi"
          >
            <Select
              options={[
                { value: "personel", label: "Bizde çalışan personel" },
                { value: "dis", label: "Dışarıdan biri" },
              ]}
            />
          </Form.Item>

          <Form.Item
            name="adSoyad"
            label="Ad soyad"
            rules={[{ required: true, message: "Ad soyad zorunludur." }]}
          >
            <Input maxLength={120} />
          </Form.Item>

          <Space size="middle" wrap style={{ width: "100%" }}>
            <Form.Item name="telefon" label="Telefon">
              <Input style={{ width: 200 }} placeholder="5xx xxx xx xx" />
            </Form.Item>

            <Form.Item name="subeAdi" label="Şube">
              <Input style={{ width: 220 }} placeholder="Çalıştığı şube" />
            </Form.Item>
          </Space>

          <Form.Item name="gorev" label="Görev">
            <Input placeholder="Ünvan ya da yapacağı iş" />
          </Form.Item>

          <Space size="middle" wrap style={{ width: "100%" }}>
            <Form.Item
              name="gorusmeTarihi"
              label="Görüşme zamanı"
              rules={[{ required: true, message: "Tarih zorunludur." }]}
            >
              <DatePicker
                showTime={{ format: "HH:mm" }}
                format="DD.MM.YYYY HH:mm"
                style={{ width: 240 }}
              />
            </Form.Item>

            <Form.Item name="gorusmeYeri" label="Yer">
              <Input style={{ width: 240 }} placeholder="Genel Müdürlük" />
            </Form.Item>
          </Space>

          <Form.Item name="aciklama" label="Açıklama">
            <Input.TextArea rows={3} placeholder="Görüşmenin konusu" />
          </Form.Item>
        </Form>
      </Modal>

      {/* ------------------------------------------------------- not ekle */}
      <Drawer
        open={!!notKisi}
        onClose={() => setNotKisi(null)}
        width="min(520px, 96vw)"
        title={
          notKisi && (
            <Space size={8}>
              <MessageSquarePlus size={16} strokeWidth={2} />
              <Text strong>{notKisi.adSoyad} · not</Text>
            </Space>
          )
        }
        footer={
          <Space style={{ float: "right" }}>
            <Button onClick={() => setNotKisi(null)}>Vazgeç</Button>
            <Button
              type="primary"
              loading={notKaydediliyor}
              onClick={notKaydet}
            >
              Kaydet
            </Button>
          </Space>
        }
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 14 }}
          message="Not başvurunun kaydına işlenir"
          description="Yazdığınız not başvuru detayında ve İK performans ekranında görünür. Aday bu notu görmez."
        />

        <TextArea
          rows={6}
          value={notMetni}
          onChange={(e) => setNotMetni(e.target.value)}
          placeholder="Görüşmeye dair gözlemleriniz, aday hakkında notunuz..."
          maxLength={4000}
          showCount
        />
      </Drawer>

      {/* ------------------------------------------------- başvuru detayı */}
      <BasvuruDetayModal
        basvuruId={acikBasvuru}
        kapat={() => {
          setAcikBasvuru(null);
          /* Detayda not eklenmiş olabilir; sayaçlar tazelenir */
          getir();
        }}
      />
    </div>
  );
}
