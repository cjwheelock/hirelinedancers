import { jsPDF } from "jspdf";
import type { Booking } from "./booking";

export type AgreementSection = { heading: string; lines: string[] };

export function agreementSections(text: string): AgreementSection[] {
  const sections: AgreementSection[] = [];
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^\d+\.\s/.test(line)) sections.push({ heading: line, lines: [] });
    else if (sections.length && line.trim()) sections[sections.length - 1].lines.push(line);
  }
  return sections;
}

function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

/** Formats the saved agreement; only persisted signatures are included. */
export function createBookingPdf(booking: Booking, fontBase64: string): ArrayBuffer {
  const pdf = new jsPDF({ unit: "pt", format: "letter", compress: true, putOnlyUsedFonts: true });
  pdf.addFileToVFS("Lato-Regular.ttf", fontBase64);
  pdf.addFont("Lato-Regular.ttf", "Lato", "normal");
  pdf.setProperties({
    title: "Booking agreement",
    author: "Hire Line Dancers",
    subject: `${booking.agreement_version}; SHA-256: ${booking.agreement_sha256}`,
    keywords: booking.id
  });
  const width = 612;
  const margin = 46;
  const bodyWidth = width - margin * 2;
  const bottom = 727;
  let y = 0;
  const sections = agreementSections(booking.agreement_text);
  const ink = () => pdf.setTextColor(28, 42, 68);
  function startPage() {
    ink();
    pdf.setFont("Lato", "normal").setFontSize(9);
    pdf.text("HIRE LINE DANCERS", margin, 36);
    pdf.setDrawColor(28, 42, 68).setLineWidth(1);
    pdf.line(margin, 47, width - margin, 47);
    y = 73;
  }
  function nextPage() { pdf.addPage(); startPage(); }
  function ensure(height: number) { if (y + height > bottom) nextPage(); }
  function paragraph(text: string, size = 10.5, gap = 8) {
    pdf.setFont("Lato", "normal").setFontSize(size);
    const lines = pdf.splitTextToSize(text, bodyWidth) as string[];
    for (const line of lines) {
      ensure(size * 1.5);
      pdf.text(line, margin, y);
      y += size * 1.5;
    }
    y += gap;
  }
  function heading(text: string) {
    ensure(90);
    pdf.setFont("Lato", "normal").setFontSize(12);
    const lines = pdf.splitTextToSize(text, bodyWidth) as string[];
    for (const line of lines) { ensure(17); pdf.text(line, margin, y); y += 17; }
    y += 6;
  }
  function priceRow(label: string, amount: number, total = false) {
    const size = total ? 14 : 11;
    pdf.setFont("Lato", "normal").setFontSize(size);
    const lines = pdf.splitTextToSize(label, bodyWidth - 110) as string[];
    const height = Math.max(34, lines.length * 16 + 14);
    ensure(height);
    lines.forEach((line, i) => pdf.text(line, margin, y + i * 16));
    pdf.text(money(amount), width - margin, y, { align: "right" });
    y += height;
    pdf.setDrawColor(215, 218, 224).setLineWidth(total ? 1 : .5);
    pdf.line(margin, y - 12, width - margin, y - 12);
  }
  function fields(left: [string, string], right: [string, string]) {
    const column = (bodyWidth - 24) / 2;
    let height = 0;
    [left, right].forEach(([label, value], index) => {
      const x = margin + index * (column + 24);
      pdf.setFont("Lato", "normal").setFontSize(9).setTextColor(89, 100, 122);
      pdf.text(label, x, y);
      ink();
      pdf.setFontSize(11);
      const lines = pdf.splitTextToSize(value, column) as string[];
      lines.forEach((line, row) => pdf.text(line, x, y + 18 + row * 16));
      height = Math.max(height, 18 + lines.length * 16);
    });
    y += height + 18;
  }
  startPage();
  pdf.setFont("times", "normal").setFontSize(29);
  pdf.text("Booking", margin, y + 14);
  pdf.text("agreement", margin, y + 47);
  pdf.setFont("Lato", "normal").setFontSize(9).setTextColor(89, 100, 122);
  pdf.text("Total due from the Client", width - margin, y + 14, { align: "right" });
  ink();
  pdf.setFontSize(27).text(money(booking.total_cents), width - margin, y + 47, { align: "right" });
  y += 87;
  const parties = sections.find(section => /^1\./.test(section.heading));
  heading("Parties");
  const instructor = parties?.lines.find(line => line.startsWith("Instructor:"))?.replace(/^Instructor:\s*/, "").replace(/\s+\("Instructor"\)\.$/, "") ?? "";
  const client = parties?.lines.find(line => line.startsWith("Client:"))?.replace(/^Client:\s*/, "").replace(/\s+\("Client"\)\.$/, "") ?? "";
  fields(["Instructor", instructor], ["Client", client]);
  y += 6;
  heading("Event");
  const event = sections.find(section => /^2\./.test(section.heading));
  const eventValue = (label: string) => event?.lines.find(line => line.startsWith(`${label}:`))?.slice(label.length + 1).trim() ?? "";
  fields(["Date", eventValue("Date")], ["Time", eventValue("Time")]);
  paragraph(`Venue: ${eventValue("Venue")}`, 11, 5);
  y += 12;
  heading("Services");
  paragraph(booking.service_description, 11);
  y += 12;
  heading("Price and payment");
  priceRow(booking.pricing_mode === "hourly"
    ? `${money(booking.hourly_rate_cents ?? 0)} per hour for ${booking.hours} hours`
    : "Flat price", booking.price_cents - booking.travel_fee_cents);
  if (booking.travel_fee_cents) priceRow("Travel fee", booking.travel_fee_cents);
  priceRow("Hire Line Dancers service fee", booking.client_fee_cents);
  priceRow("Total due from the Client", booking.total_cents, true);
  paragraph("This agreement takes effect only when the payment succeeds.", 10);

  nextPage();
  pdf.setFont("times", "normal").setFontSize(27);
  pdf.text("Booking terms", margin, y + 8);
  y += 43;
  // Preserve every line of the immutable agreement, including unknown future
  // clauses. Only its repeated title/version are moved to document chrome.
  for (const line of booking.agreement_text.replace(/\r\n?/g, "\n").split("\n")) {
    if (line === "HIRE LINE DANCERS BOOKING AGREEMENT" || line.startsWith("Agreement version:")) continue;
    if (!line.trim()) { y += 7; continue; }
    if (/^\d+\.\s/.test(line)) heading(line);
    else paragraph(line);
  }
  ensure(176);
  y += 15;
  heading("Signatures");
  for (const role of ["instructor", "organizer"] as const) {
    const signature = booking.signatures.find(item => item.party_role === role);
    paragraph(role === "instructor" ? "Instructor" : "Client", 10, 2);
    if (signature) {
      paragraph(signature.typed_name, 15, 3);
      paragraph(new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: booking.time_zone }).format(new Date(signature.signed_at)), 9, 10);
    } else {
      ensure(36);
      pdf.setDrawColor(160, 165, 176).setLineWidth(.5);
      pdf.line(margin, y + 20, margin + 225, y + 20);
      y += 42;
    }
  }
  const count = pdf.getNumberOfPages();
  for (let page = 1; page <= count; page++) {
    pdf.setPage(page).setFont("Lato", "normal").setFontSize(8).setTextColor(89, 100, 122);
    pdf.text(booking.agreement_version, margin, 759);
    pdf.text(`${page} / ${count}`, width - margin, 759, { align: "right" });
  }
  return pdf.output("arraybuffer");
}

let fontPromise: Promise<string> | undefined;
export function loadBookingPdfFont(): Promise<string> {
  if (!fontPromise) {
    fontPromise = fetch("/fonts/Lato-Regular.ttf").then(async response => {
      if (!response.ok) throw new Error("Unable to load the PDF font.");
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return btoa(binary);
    }).catch(error => { fontPromise = undefined; throw error; });
  }
  return fontPromise;
}
