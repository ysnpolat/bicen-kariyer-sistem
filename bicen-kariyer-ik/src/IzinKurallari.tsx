/**
 * ---------------------------------------------------------------------------
 * Yönetim → İzin Kuralları
 * ---------------------------------------------------------------------------
 * İki kural:
 *
 *  · Cumartesi kuralı: cumartesisi çalışma günü olmayan personelde (genel
 *    merkez gibi pazartesi–cuma çalışanlar) izin o hafta pazartesi, salı ya
 *    da çarşamba başlıyorsa cumartesi izinden düşülür; perşembe ya da cuma
 *    başlıyorsa düşülmez. Pazar ve resmi tatil hiçbir zaman düşülmez.
 *    Mobil önizleme, talep, panel gün hesabı, izin formu ve bakiye aynı
 *    hesabı kullanır.
 *
 *  · Vardiya planı denetimi: personel uygulamadan izin isterken seçtiği
 *    günlerde vardiya planı tanımlı değilse talep açılmaz; uygulama
 *    "Gönderilemedi" uyarısında sebebi gösterir (uygulama güncellemesi
 *    gerekmez).
 * ---------------------------------------------------------------------------
 */

import { useEffect, useState } from "react";
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Divider,
  Input,
  Radio,
  Select,
  Space,
  Spin,
  Switch,
  Tag,
  Typography,
} from "antd";
import dayjs, { Dayjs } from "dayjs";
import { CalendarCheck2, CalendarX2, FlaskConical, ScanBarcode } from "lucide-react";
import { api } from "./api";

const { Text } = Typography;

const GUNLER = [
  { value: 1, label: "Pazartesi" },
  { value: 2, label: "Salı" },
  { value: 3, label: "Çarşamba" },
  { value: 4, label: "Perşembe" },
  { value: 5, label: "Cuma" },
];

export default function IzinKurallari() {
  const { message } = AntdApp.useApp();

  const [veri, setVeri] = useState<any>(null);
  const [ayar, setAyar] = useState<any>(null);
  const [kaydediliyor, setKaydediliyor] = useState(false);

  /* Deneme */
  const [sicil, setSicil] = useState("");
  /* Varsayılan deneme: gelecek pazartesi – cuma */
  const [deneAralik, setDeneAralik] = useState<[Dayjs, Dayjs]>(() => {
    const pzt = dayjs().startOf("day").add((8 - dayjs().day()) % 7 || 7, "day");
    return [pzt, pzt.add(4, "day")];
  });
  const [deneme, setDeneme] = useState<any>(null);
  const [deneniyor, setDeneniyor] = useState(false);

  const getir = async () => {
    try {
      const c = await api.al<any>("/api/IzinKurallari");
      setVeri(c);
      setAyar(c.ayar);
    } catch (h: any) {
      message.error(h.message);
    }
  };

  useEffect(() => {
    getir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!ayar) return <Spin />;

  const cmt = ayar.cumartesi ?? {};
  const vk = ayar.vardiya ?? {};

  const cmtDegis = (d: any) => setAyar({ ...ayar, cumartesi: { ...cmt, ...d } });
  const vkDegis = (d: any) => setAyar({ ...ayar, vardiya: { ...vk, ...d } });

  const kaydet = async () => {
    setKaydediliyor(true);

    try {
      const c = await api.gonder<any>("/api/IzinKurallari", ayar);
      setAyar(c.ayar);
      message.success("İzin kuralları kaydedildi.");
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setKaydediliyor(false);
    }
  };

  const dene = async () => {
    if (!sicil.trim()) {
      message.warning("Sicil giriniz.");
      return;
    }

    setDeneniyor(true);

    try {
      setDeneme(
        await api.al<any>(
          `/api/IzinKurallari/Dene?sicil=${encodeURIComponent(sicil.trim())}` +
            `&ilk=${deneAralik[0].format("YYYY-MM-DD")}&son=${deneAralik[1].format("YYYY-MM-DD")}`
        )
      );
    } catch (h: any) {
      message.error(h.message);
      setDeneme(null);
    } finally {
      setDeneniyor(false);
    }
  };

  const birimSecenek = (veri?.birimler ?? []).map((b: any) => ({ value: b.ad, label: `${b.ad} (${b.kisi})` }));

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%", maxWidth: 980 }}>
      {/* ------------------------------------------------ cumartesi */}
      <Card
        size="small"
        title={
          <Space size={8}>
            <CalendarCheck2 size={16} strokeWidth={2} />
            Yıllık izinde cumartesi kuralı
          </Space>
        }
        extra={<Switch checked={!!cmt.acik} onChange={(v) => cmtDegis({ acik: v })} />}
      >
        <Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
          Cumartesisi çalışma günü olmayan personelde (vardiya planında ya da haftalık izninde cumartesi izinli;
          genellikle pazartesi–cuma çalışan genel merkez) izin o hafta aşağıdaki günlerden birinde başlıyorsa ve
          hafta sonuna kadar sürüyorsa cumartesi izinden düşülür. Perşembe ya da cuma başlayan izinde düşülmez.
          Birden çok haftaya yayılan izinde ara haftalar pazartesi başladığı için cumartesileri düşülür.
          <b> Pazar ve resmi tatil hiçbir zaman düşülmez.</b>
        </Text>

        <div style={{ opacity: cmt.acik ? 1 : 0.5 }}>
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>Cumartesiyi düşüren başlangıç günleri</div>
          <Checkbox.Group
            disabled={!cmt.acik}
            value={cmt.tetikGunleri ?? [1, 2, 3]}
            onChange={(v) => cmtDegis({ tetikGunleri: (v as number[]).slice().sort() })}
            options={GUNLER}
          />

          <Space direction="vertical" size={6} style={{ marginTop: 12 }}>
            <Checkbox
              disabled={!cmt.acik}
              checked={!!cmt.yalnizcaIkiGunIzinli}
              onChange={(e) => cmtDegis({ yalnizcaIkiGunIzinli: e.target.checked })}
            >
              Yalnızca cumartesi <b>ve</b> pazarı izinli olanlara uygula{" "}
              <Text type="secondary">(tek haftalık izni cumartesi olan mağaza personelinin izin günü korunur)</Text>
            </Checkbox>
            <Checkbox
              disabled={!cmt.acik}
              checked={!!cmt.cumaBitenDahil}
              onChange={(e) => cmtDegis({ cumaBitenDahil: e.target.checked })}
            >
              Son izin günü cuma olan izinde de uygula{" "}
              <Text type="secondary">(pazartesi dönen kişi uygulamada son gün olarak cumayı seçer)</Text>
            </Checkbox>
          </Space>

          <Alert
            style={{ marginTop: 12 }}
            type="info"
            showIcon
            message="Örnek: Pazartesi çıkıp bir sonraki pazartesi dönen genel merkez personeli 6 gün kullanır (Pzt–Cmt); perşembe çıkıp pazartesi dönen 2 gün kullanır (Per–Cum)."
            description="Uygulandığı yerler: mobil gün önizlemesi, talep oluşturma (gün sayısı sunucuda yeniden hesaplanır), panel İzin Girişi gün hesabı, izin formu ve bakiye."
          />
        </div>
      </Card>

      {/* ------------------------------- cumartesisi izinli personel */}
      <Card
        size="small"
        title={
          <Space size={8}>
            <CalendarCheck2 size={16} strokeWidth={2} />
            Cumartesisi izinli personel
            {(ayar.cumartesiIzinliler ?? []).length > 0 && <Tag color="green">{ayar.cumartesiIzinliler.length} kişi</Tag>}
          </Space>
        }
      >
        <Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
          Seçilen personelde <b>cumartesi pazar gibi izinli sayılır</b>: izin aralığına giren cumartesiler yıllık
          izinden hiç düşülmez ve gün hesabında "haftalık izin" olarak görünür. Yukarıdaki pazartesi–salı–çarşamba
          cumartesi kuralı bu kişilere uygulanmaz. Mobil önizleme, talep, panel gün hesabı, izin formu ve bakiye
          aynı hesabı kullanır; daha önce kaydedilmiş izinlerin gün sayısı değişmez.
        </Text>
        <Select
          mode="multiple"
          showSearch
          allowClear
          style={{ width: "100%" }}
          placeholder="Ad, sicil ya da birim yazarak personel ekleyin"
          value={ayar.cumartesiIzinliler ?? []}
          onChange={(v) => setAyar({ ...ayar, cumartesiIzinliler: v })}
          optionFilterProp="ara"
          options={[
            ...(veri?.personeller ?? []).map((p: any) => ({
              value: p.sicil,
              label: `${p.ad} · ${p.sicil}`,
              ara: `${p.ad} ${p.sicil} ${p.birim ?? ""} ${p.pozisyon ?? ""}`.toLocaleLowerCase("tr"),
              desc: [p.birim, p.pozisyon].filter(Boolean).join(" · "),
            })),
            /* Listede olmayan (ayrılmış) sicil seçili kalmışsa yine görünsün */
            ...(ayar.cumartesiIzinliler ?? [])
              .filter((s: string) => !(veri?.personeller ?? []).some((p: any) => p.sicil === s))
              .map((s: string) => ({ value: s, label: `${s} (aktif personelde yok)`, ara: s, desc: "" })),
          ]}
          optionRender={(o: any) => (
            <div>
              <div>{o.data.label}</div>
              {o.data.desc && <div style={{ fontSize: 12, color: "#6b7280" }}>{o.data.desc}</div>}
            </div>
          )}
          filterOption={(girdi, o: any) => (o?.ara ?? "").includes(girdi.toLocaleLowerCase("tr"))}
        />
        <Text type="secondary" style={{ display: "block", fontSize: 12, marginTop: 8 }}>
          Kaydetmeyi unutmayın. Etkisini aşağıdaki "Kuralı dene" ile bir sicil ve tarih aralığında görebilirsiniz.
        </Text>
      </Card>

      {/* ------------------------------------------ vardiya denetimi */}
      <Card
        size="small"
        title={
          <Space size={8}>
            <CalendarX2 size={16} strokeWidth={2} />
            Mobil izin talebinde vardiya planı denetimi
          </Space>
        }
        extra={<Switch checked={!!vk.acik} onChange={(v) => vkDegis({ acik: v })} />}
      >
        <Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
          Personel uygulamadan izin isterken seçtiği günlerin her birinde vardiya planında bir kayıt (vardiya ya da
          haftalık izin) yoksa talep açılmaz ve şu uyarıyı görür:
        </Text>
        <Alert
          type="warning"
          showIcon
          message="Gönderilemedi"
          description="İzin talep ettiğiniz tarihlerde vardiya planınız tanımlı değil. Önce yöneticinizin vardiya planınızı tanımlaması gerekiyor."
          style={{ marginBottom: 12 }}
        />
        <Text type="secondary" style={{ display: "block", fontSize: 12, marginBottom: 12 }}>
          “Boş” işaretli gün tanımsız sayılır. Resmi tatiller ve onaylı izinli günler aranmaz. Planın personele
          gönderilmiş olması aranmaz; taslak plan da yeterli. Uyarı yayındaki uygulamada güncelleme gerekmeden görünür.
        </Text>

        <div style={{ opacity: vk.acik ? 1 : 0.5, display: "grid", gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>Denetlenen izin türleri</div>
            <Select
              mode="multiple"
              disabled={!vk.acik}
              style={{ width: "100%" }}
              value={vk.turler ?? ["Yıllık İzin"]}
              onChange={(v) => vkDegis({ turler: v })}
              options={(veri?.turler ?? []).map((t: string) => ({ value: t, label: t }))}
            />
          </div>

          <div>
            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>Kimlere uygulansın</div>
            <Radio.Group disabled={!vk.acik} value={vk.kapsam ?? "hepsi"} onChange={(e) => vkDegis({ kapsam: e.target.value })}>
              <Space direction="vertical">
                <Radio value="hepsi">Tüm personel</Radio>
                <Radio value="planKullanan">
                  Yalnızca vardiya planı kullanan birimler{" "}
                  <Text type="secondary">(biriminde son 60 günde ya da ileriye dönük en az bir plan kaydı olanlar)</Text>
                </Radio>
                <Radio value="secili">Yalnızca seçili birimler</Radio>
              </Space>
            </Radio.Group>
          </div>

          {vk.kapsam === "secili" && (
            <div>
              <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>Denetlenen birimler</div>
              <Select
                mode="multiple"
                disabled={!vk.acik}
                style={{ width: "100%" }}
                value={vk.birimler ?? []}
                onChange={(v) => vkDegis({ birimler: v })}
                options={birimSecenek}
                placeholder="Birim seçin"
              />
            </div>
          )}

          <div className="ik-sube-haftasi" style={{ border: "1px solid #e6e9e3", borderRadius: 10, padding: "10px 12px" }}>
            <Space align="start" size={10}>
              <Switch
                size="small"
                disabled={!vk.acik}
                checked={vk.subeHaftasi !== false}
                onChange={(v) => vkDegis({ subeHaftasi: v })}
                style={{ marginTop: 2 }}
              />
              <div>
                <b style={{ fontSize: 13 }}>Şube haftası: bu haftanın şube planı tam olmalı</b>
                <Text type="secondary" style={{ display: "block", fontSize: 12 }}>
                  Personel yıllık izin isterken (ileri tarihli de olsa) içinde bulunulan haftada şubesindeki herkesin
                  pazartesi–pazar her günü planlı olmalı. Eksik varsa talep açılmaz; personel planı eksik kişileri ve
                  gün sayısını görür. Tatiller, onaylı izinler ve raporlu günler aranmaz. Güncelleme gerekmez.
                </Text>
              </div>
            </Space>
          </div>

          <div>
            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>Muaf birimler (hiç denetlenmez)</div>
            <Select
              mode="multiple"
              disabled={!vk.acik}
              style={{ width: "100%" }}
              value={vk.muafBirimler ?? []}
              onChange={(v) => vkDegis({ muafBirimler: v })}
              options={birimSecenek}
              placeholder="Henüz vardiya planı kullanmayan şubeler"
            />
          </div>
        </div>
      </Card>

      {/* ------------------------------ fiyat kontrol vardiya şartı */}
      <Card
        size="small"
        title={
          <Space size={8}>
            <ScanBarcode size={16} strokeWidth={2} />
            Mobil Fiyat Kontrol'de haftalık vardiya planı şartı
          </Space>
        }
        extra={<Switch checked={vk.fiyatKontrol !== false} onChange={(v) => vkDegis({ fiyatKontrol: v })} />}
      >
        <Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
          Personelin içinde bulunulan haftada (pazartesi–pazar) vardiya planında hiç kaydı yoksa Fiyat Kontrol'de
          barkod sorgulayamaz ve etiket listesi gönderemez; şu uyarıyı görür:
        </Text>
        <Alert
          type="warning"
          showIcon
          message="Bu hafta için vardiya planınız tanımlı olmadığından Fiyat Kontrol'ü kullanamazsınız. Mağaza müdürünüzden bu haftanın vardiya planını oluşturmasını isteyiniz."
          style={{ marginBottom: 12 }}
        />
        <Text type="secondary" style={{ display: "block", fontSize: 12, marginBottom: 12 }}>
          Yukarıdaki "kimlere uygulansın" seçimi burada geçmez: muaf olmayan bütün personel denetlenir. Yukarıdaki muaf
          birimler burada da muaftır. Plan kurulduktan sonra en geç bir dakikada açılır. Yayındaki uygulamada güncelleme
          gerekmez; panel kullanıcıları denetlenmez.
        </Text>
        <div style={{ opacity: vk.fiyatKontrol !== false ? 1 : 0.5 }}>
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>Ayrıca muaf birimler (yalnızca Fiyat Kontrol)</div>
          <Select
            mode="multiple"
            disabled={vk.fiyatKontrol === false}
            style={{ width: "100%" }}
            value={vk.fiyatKontrolMuaf ?? []}
            onChange={(v) => vkDegis({ fiyatKontrolMuaf: v })}
            options={birimSecenek}
            placeholder="Örn. genel merkez birimleri"
          />
        </div>
      </Card>

      <Space>
        <Button type="primary" loading={kaydediliyor} onClick={kaydet}>
          Kaydet
        </Button>
        <Button onClick={getir}>Geri al</Button>
      </Space>

      {/* ------------------------------------------------------ deneme */}
      <Card
        size="small"
        title={
          <Space size={8}>
            <FlaskConical size={16} strokeWidth={2} />
            Kuralı dene
          </Space>
        }
      >
        <Space wrap>
          <Input style={{ width: 160 }} placeholder="Sicil" value={sicil} onChange={(e) => setSicil(e.target.value)} />
          <DatePicker.RangePicker
            format="DD.MM.YYYY"
            allowClear={false}
            value={deneAralik}
            onChange={(v) => v?.[0] && v?.[1] && setDeneAralik([v[0], v[1]])}
          />
          <Text type="secondary">ilk ve son izin günü (kayıtlı ayarla)</Text>
          <Button loading={deneniyor} onClick={dene}>
            Hesapla
          </Button>
        </Space>

        {deneme && (
          <div style={{ marginTop: 12 }}>
            <Space wrap>
              <b>{deneme.adSoyad}</b>
              <Tag>{deneme.pozisyon}</Tag>
              <Tag>{deneme.birim}</Tag>
              {deneme.cumartesiIzinli && <Tag color="green">Cumartesisi izinli</Tag>}
            </Space>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#3a5709", margin: "6px 0" }}>
              {String(deneme.gun).replace(".", ",")} gün{" "}
              <Text type="secondary" style={{ fontSize: 13, fontWeight: 400 }}>
                ({deneme.takvimGunu} takvim günü seçildi)
              </Text>
            </div>
            {(deneme.notlar ?? []).map((n: string) => (
              <div key={n} style={{ color: "#8a5a12" }}>• {n}</div>
            ))}
            {(deneme.dusulmeyenler ?? []).length > 0 && (
              <div style={{ color: "#6b7280", fontSize: 12.5, marginTop: 4 }}>
                Düşülmeyen: {deneme.dusulmeyenler.join(" · ")}
              </div>
            )}
            <Divider style={{ margin: "10px 0" }} />
            {deneme.vardiya?.engel ? (
              <Alert type="warning" showIcon message={deneme.vardiya.mesaj} description={deneme.vardiya.ayrinti} />
            ) : (
              <Text type="success">Vardiya planı denetiminden geçer.</Text>
            )}
          </div>
        )}
      </Card>
    </Space>
  );
}
