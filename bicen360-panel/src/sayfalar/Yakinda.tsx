import { Card, Typography } from "antd";
import { RENK } from "../sabitler";

/**
 * Henüz yazılmamış sayfalar için.
 *
 * Boş bir sayfa yerine ne geleceğini söylemek, iskeleti gezerken neyin
 * eksik neyin bozuk olduğunu ayırt etmeyi kolaylaştırıyor.
 */
export default function Yakinda({
  baslik,
  icerik,
}: {
  baslik: string;
  icerik: string;
}) {
  return (
    <Card>
      <Typography.Title level={4} style={{ marginTop: 0, color: RENK.siyah }}>
        {baslik}
      </Typography.Title>

      <Typography.Paragraph style={{ color: RENK.metinPasif, marginBottom: 0 }}>
        {icerik}
      </Typography.Paragraph>
    </Card>
  );
}
