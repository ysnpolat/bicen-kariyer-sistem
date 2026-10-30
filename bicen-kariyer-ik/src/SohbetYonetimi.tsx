/**
 * Sohbet depolama (Yönetim, 22.10.2026)
 * ---------------------------------------------------------------------------
 * Mesajlar kullanıcı silmedikçe süresiz saklanır. Sohbetler büyüdükçe yer
 * burada açılır: mesaj metinleri hiç silinmez, yalnızca ekler küçülür.
 *   - Silinen mesajlardan kalan ekler diskten kaldırılır
 *   - PDF / Office / metin belgeleri kayıpsız sıkıştırılır (açılışta aynen gelir)
 *   - İstenirse belirli tarihten eski video / görsel / dosya ekleri kaldırılır
 *     (mesaj yerinde kalır, "ek kaldırıldı" yazar)
 */
import { useCallback, useEffect, useState } from "react";
import { Alert, App as AntdApp, Button, Checkbox, DatePicker, Modal, Space, Table, Tag } from "antd";
import dayjs, { Dayjs } from "dayjs";
import { api } from "./api";

interface Satir {
  id: number; tur: "grup" | "kisi"; ad: string; olusturan: string; olusturma: string; sonMesaj: string | null;
  uye: number; mesaj: number; silinen: number; gorsel: number; video: number; belge: number;
  boyutGorsel: number; boyutVideo: number; boyutBelge: number; boyutSilinen: number;
}

const boyut = (b: number) =>
  b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} GB` : b >= 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`;
const toplam = (s: Satir) => s.boyutGorsel + s.boyutVideo + s.boyutBelge + s.boyutSilinen;

export default function SohbetYonetimi() {
  const { message } = AntdApp.useApp();
  const [liste, setListe] = useState<Satir[]>([]);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [hedef, setHedef] = useState<Satir | "hepsi" | null>(null);
  const [silinen, setSilinen] = useState(true);
  const [belge, setBelge] = useState(true);
  const [eskiAcik, setEskiAcik] = useState(false);
  const [tarih, setTarih] = useState<Dayjs>(dayjs().subtract(6, "month"));
  const [turler, setTurler] = useState<string[]>(["video"]);
  const [isleniyor, setIsleniyor] = useState(false);

  const getir = useCallback(() => {
    setYukleniyor(true);
    api
      .al<Satir[]>("/api/Mesajlasma/Yonetim")
      .then((d) => setListe(d ?? []))
      .catch((h) => message.error(h.message))
      .finally(() => setYukleniyor(false));
  }, [message]);

  useEffect(getir, [getir]);

  const genel = liste.reduce((t, s) => t + toplam(s), 0);

  const sikistir = async () => {
    if (!hedef) return;
    setIsleniyor(true);
    try {
      const id = hedef === "hepsi" ? 0 : hedef.id;
      const d = await api.gonder<{ kaldirilan: number; sikistirilan: number; kazanilan: number }>(
        `/api/Mesajlasma/Yonetim/${id}/Sikistir`,
        {
          silinenleriTemizle: silinen,
          belgeleriSikistir: belge,
          eskiEkTarihi: eskiAcik ? tarih.format("YYYY-MM-DD") : null,
          eskiEkTurleri: turler,
        }
      );
      message.success(
        `${boyut(d.kazanilan)} yer açıldı · ${d.sikistirilan} belge sıkıştırıldı · ${d.kaldirilan} ek kaldırıldı`
      );
      setHedef(null);
      getir();
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setIsleniyor(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Alert
        type="info"
        showIcon
        message="Mesajlar kullanıcı silmedikçe süresiz saklanır."
        description="Sıkıştırma mesaj metinlerine dokunmaz; yalnızca eklerin kapladığı yeri azaltır. Görseller gönderilirken zaten küçültülüyor (uzun kenar 1920 px)."
      />
      <Space wrap>
        <Tag color="green" style={{ fontSize: 13, padding: "4px 10px" }}>Toplam ek boyutu: {boyut(genel)}</Tag>
        <Tag style={{ fontSize: 13, padding: "4px 10px" }}>{liste.length} sohbet</Tag>
        <Button onClick={() => setHedef("hepsi")} disabled={!liste.length}>Tümünü sıkıştır</Button>
        <Button onClick={getir}>Yenile</Button>
      </Space>
      <Table<Satir>
        rowKey="id"
        size="small"
        loading={yukleniyor}
        dataSource={liste}
        pagination={{ pageSize: 20, showSizeChanger: false }}
        scroll={{ x: 900 }}
        columns={[
          {
            title: "Sohbet",
            dataIndex: "ad",
            render: (v, s) => (
              <span>
                <Tag color={s.tur === "grup" ? "blue" : "default"}>{s.tur === "grup" ? "Grup" : "Özel"}</Tag>
                {v}
              </span>
            ),
          },
          { title: "Üye", dataIndex: "uye", width: 60, align: "right" },
          { title: "Mesaj", dataIndex: "mesaj", width: 80, align: "right" },
          { title: "Görsel", width: 130, align: "right", render: (_, s) => `${s.gorsel} · ${boyut(s.boyutGorsel)}` },
          { title: "Video", width: 130, align: "right", render: (_, s) => `${s.video} · ${boyut(s.boyutVideo)}` },
          { title: "Dosya", width: 130, align: "right", render: (_, s) => `${s.belge} · ${boyut(s.boyutBelge)}` },
          {
            title: "Toplam",
            width: 100,
            align: "right",
            sorter: (a, b) => toplam(a) - toplam(b),
            defaultSortOrder: "descend",
            render: (_, s) => <b>{boyut(toplam(s))}</b>,
          },
          {
            title: "Son mesaj",
            dataIndex: "sonMesaj",
            width: 120,
            render: (v) => (v ? dayjs(v).format("DD.MM.YYYY HH:mm") : "—"),
          },
          {
            title: "",
            width: 100,
            render: (_, s) => (
              <Button size="small" onClick={() => setHedef(s)} disabled={toplam(s) === 0}>Sıkıştır</Button>
            ),
          },
        ]}
      />

      <Modal
        open={!!hedef}
        title={hedef === "hepsi" ? "Bütün sohbetleri sıkıştır" : `Sıkıştır: ${hedef?.ad ?? ""}`}
        onCancel={() => setHedef(null)}
        onOk={sikistir}
        confirmLoading={isleniyor}
        okText="Sıkıştır"
        cancelText="Vazgeç"
        okButtonProps={{ danger: eskiAcik }}
      >
        <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
          <Checkbox checked={silinen} onChange={(e) => setSilinen(e.target.checked)}>
            Silinen mesajlardan kalan ekleri temizle
          </Checkbox>
          <Checkbox checked={belge} onChange={(e) => setBelge(e.target.checked)}>
            Belgeleri kayıpsız sıkıştır (PDF, Word, Excel, metin; açılınca aynen gelir)
          </Checkbox>
          <Checkbox checked={eskiAcik} onChange={(e) => setEskiAcik(e.target.checked)}>
            Eski ekleri kaldır (geri alınamaz)
          </Checkbox>
          {eskiAcik && (
            <div style={{ paddingLeft: 24, display: "grid", gap: 8 }}>
              <Space wrap>
                <span>Bu tarihten eski:</span>
                <DatePicker value={tarih} onChange={(d) => d && setTarih(d)} format="DD.MM.YYYY" allowClear={false} />
              </Space>
              <Checkbox.Group
                value={turler}
                onChange={(v) => setTurler(v as string[])}
                options={[
                  { label: "Videolar", value: "video" },
                  { label: "Görseller", value: "gorsel" },
                  { label: "Dosyalar", value: "dosya" },
                ]}
              />
              <Alert type="warning" showIcon message="Mesajlar yerinde kalır; seçilen eklerin yerinde “ek kaldırıldı” yazar." />
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
