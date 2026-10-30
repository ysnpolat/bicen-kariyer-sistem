/**
 * Uzman Seçici
 * ---------------------------------------------------------------------------
 * Başlık çubuğunda, bölge seçicisinin yanında duran İK uzmanı süzgeci.
 * Seçim yapıldığında Başvurular sayfası yalnızca o uzmana tanımlı
 * şubelerin başvurularını ve sayaçlarını gösterir.
 *
 * Listede yalnızca İK uzmanı ve İK yöneticisi rolleri yer alır; bölge
 * müdürü ya da fotoğraf görevlisi başvuru süzmek için anlamlı değil.
 */

import { useEffect, useState } from "react";
import { Select } from "antd";
import { UserSearch } from "lucide-react";

import { api } from "./api";
import { uzmanOku, uzmanSec } from "./uzmanFiltresi";

interface Aday {
  kod: string;
  ad: string;
  rol?: string;
}

export default function UzmanSecici() {
  const [liste, setListe] = useState<Aday[]>([]);
  const [secili, setSecili] = useState<string[]>(
    (uzmanOku() ?? "").split(",").filter(Boolean)
  );

  useEffect(() => {
    /* İş emri atama ucu yalnızca yönetici rollerine açık; uzmanlar orada
       403 aldığı için süzgeç boş kalıyordu. Bu uç herkese açık ve zaten
       yalnızca İK rollerini döndürüyor. */
    api
      .al<{ uzmanlar: Aday[] }>("/api/Ayar/Uzmanlar")
      .then((d) => setListe(d?.uzmanlar ?? []))
      .catch(() => {
        /* Liste alınamazsa süzgeç boş kalır; sayfa çalışmaya devam eder */
      });
  }, []);

  return (
    <Select
      mode="multiple"
      allowClear
      showSearch
      size="small"
      maxTagCount="responsive"
      value={secili}
      onChange={(v: string[]) => {
        setSecili(v);
        /* Boş seçim: yalnızca kendi kapsamı. Sunucu oturum açan uzmanın
           şubelerini zaten ekliyor. */
        uzmanSec(v.length > 0 ? v.join(",") : undefined);
      }}
      placeholder="Diğer uzmanlar"
      optionFilterProp="label"
      style={{ minWidth: 220, maxWidth: 320 }}
      suffixIcon={<UserSearch size={14} strokeWidth={2} />}
      options={liste.map((x) => ({ value: x.kod, label: x.ad }))}
    />
  );
}
