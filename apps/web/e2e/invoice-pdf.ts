export function invoicePDF(number: string, date: string, total: string) {
  const contents = `BT /F1 26 Tf 45 480 Td (Invoice number: ${number}) Tj 0 -50 Td (Service date: ${date}) Tj 0 -50 Td (Total due: BDT ${total}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 530 550] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Length " + contents.length + " >>\nstream\n" + contents + "\nendstream",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((value, index) => {
    const offset = pdf.length;
    pdf += (index + 1) + " 0 obj\n" + value + "\nendobj\n";
    return offset;
  });
  pdf += "xref\n0 6\n0000000000 65535 f \n" + offsets.map(offset => String(offset).padStart(10, "0") + " 00000 n \n").join("") +
    "trailer << /Size 6 /Root 1 0 R >>\nstartxref\n" + pdf.length + "\n%%EOF\n";
  return new TextEncoder().encode(pdf);
}
