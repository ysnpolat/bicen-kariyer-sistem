/**
 * Geriye dönük fazla mesai girişi (13.10.2026).
 * Yayındaki Biçen360 (1.6 / 1.7) tarih seçiminde yalnızca son 7 günü
 * gösteriyor. İK, daha eski bir günü yöneticinin adına buradan girer;
 * kayıt uygulamadan girilmiş gibi işler: form maile gider, seçilen
 * yöneticinin "imzalı formu yükleyin" kartı açılır, onay sırası aynıdır.
 */

import { useState } from "react";
import { Alert, App as AntdApp, DatePicker, Input, Modal, Select, Spin } from "antd";
import { Search } from "lucide-react";
import dayjs, { Dayjs } from "dayjs";

import { api } from "./api";

interface Kisi {
  sicil: string;
  ad: string;
  gorev?: string | null;
  pozisyon?: string | null;
  sube: string | null;
}

interface Akis {
  kisi: Kisi;
  girebilenler: Kisi[];
  form: { adresler: string[]; aciklama: string };
  geriyeGun?: number;
}

const saatDuzelt = (s: string) => {
  const t = s.trim().replace(".", ":");
  const m = /^(\d{1,2}):?(\d{2})$/.exec(t);
  if (!m) return null;
  const h = Number(m[1]);
  const d = Number(m[2]);
  if (h > 23 || d > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(d).padStart(2, "0")}`;
};

export default function FazlaMesaiGeriyeGir({ acik, kapat, kaydedildi }: { acik: boolean; kapat: () => void; kaydedildi: () => void }) {
  const { message } = AntdApp.useApp();
  const [secenek, setSecenek] = useState<Kisi[]>([]);
  const [akis, setAkis] = useState<Akis | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [giren, setGiren] = useState<string | null>(null);
  const [tarih, setTarih] = useState<Dayjs | null>(null);
  const [bas, setBas] = useState("");
  const [bit, setBit] = useState("");
  const [aciklama, setAciklama] = useState("");
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [hata, setHata] = useState("");

  const sifirla = () => {
    setAkis(null);
    setGiren(null);
    setTarih(null);
    setBas("");
    setBit("");
    setAciklama("");
    setHata("");
  };

  const sec = async (sicil: string) => {
    sifirla();
    setYukleniyor(true);
    try {
      const a = await api.al<Akis>(`/api/FazlaMesai/Akis/${encodeURIComponent(sicil)}`);
      setAkis(a);
      if (a.girebilenler.length === 1) setGiren(a.girebilenler[0].sicil);
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setYukleniyor(false);
    }
  };

  const geriyeGun = akis?.geriyeGun ?? 31;
  const enEski = dayjs().startOf("day").subtract(geriyeGun, "day");

  const gonder = async () => {
    setHata("");
    if (!akis) return setHata("Çalışanı seçiniz.");
    if (!giren) return setHata("Kaydı adına gireceğiniz yöneticiyi seçiniz.");
    if (!tarih) return setHata("Tarihi seçiniz.");
    const b = saatDuzelt(bas);
    const e = saatDuzelt(bit);
    if (!b || !e) return setHata("Başlangıç ve bitiş saatini SS:DD olarak yazınız (ör. 18:00).");
    if (aciklama.trim().length < 3) return setHata("Fazla mesainin nedenini yazınız.");

    setGonderiliyor(true);
    try {
      const c = await api.gonder<{ sure: string; formGitti: boolean; formAdres?: string; formHata?: string }>("/api/FazlaMesai/Panel", {
        sicil: akis.kisi.sicil,
        girenSicil: giren,
        tarih: tarih.format("YYYY-MM-DD"),
        baslangic: b,
        bitis: e,
        aciklama: aciklama.trim(),
      });
      const yonetici = akis.girebilenler.find((x) => x.sicil === giren)?.ad ?? "yönetici";
      message.success(
        `${akis.kisi.ad} · ${tarih.format("DD.MM.YYYY")} · ${c.sure} kaydedildi. ` +
          (c.formGitti ? `Form ${c.formAdres} adresine gitti; ` : "Form maille gidemedi, listeden yeniden gönderin; ") +
          `${yonetici} imzalı formu uygulamadan yükleyip onaylayacak.`,
        8
      );
      sifirla();
      kaydedildi();
      kapat();
    } catch (h: any) {
      setHata(h.message);
    } finally {
      setGonderiliyor(false);
    }
  };

  return (
    <Modal
      open={acik}
      onCancel={kapat}
      onOk={gonder}
      okText="Kaydet ve formu gönder"
      cancelText="Vazgeç"
      confirmLoading={gonderiliyor}
      okButtonProps={{ disabled: !akis || !giren }}
      width="min(620px, 100vw)"
      title="Geriye dönük fazla mesai gir"
      destroyOnHidden
    >
      <p style={{ margin: "0 0 12px", color: "#6b7280", fontSize: 13 }}>
        Uygulamada son 7 gün seçilebiliyor. Daha eski günleri (en fazla {geriyeGun} gün geriye) buradan, yöneticinin adına girin. Kayıt
        uygulamadan girilmiş gibi işler: form maile gider, yöneticinin “imzalı formu yükleyin” kartı açılır, onay sırası aynıdır.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Select
          showSearch
          value={akis?.kisi.sicil ?? null}
          style={{ width: "100%" }}
          placeholder="Çalışanı ara (ad, sicil, şube)"
          filterOption={false}
          suffixIcon={<Search size={14} />}
          onSearch={async (q) => {
            if (q.trim().length < 2) return;
            try {
              setSecenek(await api.al<Kisi[]>(`/api/EkibimKural/KisiAra?q=${encodeURIComponent(q)}`));
            } catch {
              setSecenek([]);
            }
          }}
          onChange={(s) => s && sec(s)}
          options={secenek.map((k) => ({ value: k.sicil, label: [k.ad, k.pozisyon, k.sube].filter(Boolean).join(" · ") }))}
        />

        {yukleniyor && <Spin style={{ display: "block", margin: "12px auto" }} />}

        {akis && (
          <>
            {akis.girebilenler.length === 0 ? (
              <Alert type="error" showIcon message="Bu çalışana fazla mesai girebilecek yönetici yok (onay tablosunda ya da şubede tanımlı değil)." />
            ) : (
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <b style={{ fontSize: 13 }}>Kimin adına (formu yükleyip onaylayacak yönetici)</b>
                <Select
                  value={giren}
                  onChange={setGiren}
                  placeholder="Yönetici seçiniz"
                  options={akis.girebilenler.map((k) => ({
                    value: k.sicil,
                    label: [k.ad, k.gorev ?? k.pozisyon, k.sube].filter(Boolean).join(" · "),
                  }))}
                />
              </label>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                <b style={{ fontSize: 13 }}>Tarih</b>
                <DatePicker
                  value={tarih}
                  onChange={setTarih}
                  format="DD.MM.YYYY ddd"
                  disabledDate={(d) => d.isAfter(dayjs(), "day") || d.isBefore(enEski, "day")}
                  style={{ width: "100%" }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                <b style={{ fontSize: 13 }}>Başlangıç</b>
                <Input value={bas} onChange={(e) => setBas(e.target.value)} placeholder="18:00" inputMode="numeric" />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                <b style={{ fontSize: 13 }}>Bitiş</b>
                <Input value={bit} onChange={(e) => setBit(e.target.value)} placeholder="21:30" inputMode="numeric" />
              </label>
            </div>

            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <b style={{ fontSize: 13 }}>Neden</b>
              <Input.TextArea rows={2} maxLength={500} value={aciklama} onChange={(e) => setAciklama(e.target.value)} placeholder="Ör. kapanış sonrası sayım" />
            </label>

            <p style={{ margin: 0, color: "#6b7280", fontSize: 12.5 }}>
              Form gidecek adres: <b>{akis.form.adresler.join(", ") || "adres yok"}</b> · {akis.form.aciklama}
            </p>
          </>
        )}

        {hata && <Alert type="error" showIcon message={hata} />}
      </div>
    </Modal>
  );
}
