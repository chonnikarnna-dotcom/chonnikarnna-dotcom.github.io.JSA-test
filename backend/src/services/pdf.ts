/**
 * Approved-JSA PDF generation (pdfkit). Thai text is rendered with an embedded Thai OpenType font
 * and Thai word boundaries (Intl.Segmenter) are marked with zero-width spaces so lines wrap correctly.
 */
import path from 'path';
import fs from 'fs';
import PDFDocument from 'pdfkit';
import { config } from '../config';
import { formatDateTime, label, Lang, LabelKey, ppeLabel, statusLabel, DECISION_LABELS, STAGE_LABELS } from '../lib/i18n';
import type { getDetail } from './jsa';

type Detail = Awaited<ReturnType<typeof getDetail>>;
type Lookups = { permitTypes: Record<string, { nameEn: string; nameTh: string }> };

const FONT_DIR = path.resolve(__dirname, '../../assets/fonts');
const FONT_REGULAR = config.PDF_FONT_REGULAR || path.join(FONT_DIR, 'Loma.otf');
const FONT_BOLD = config.PDF_FONT_BOLD || path.join(FONT_DIR, 'Loma-Bold.otf');

const thaiSeg = new Intl.Segmenter('th', { granularity: 'word' });
const THAI = /[฀-๿]/;
/** Insert U+200B between Thai words so the line breaker can wrap Thai text (which has no spaces). */
export function thaiWrap(s: string | null | undefined): string {
  if (!s) return '';
  if (!THAI.test(s)) return s;
  let out = '';
  for (const seg of thaiSeg.segment(s)) {
    out += seg.segment;
    if (seg.isWordLike && THAI.test(seg.segment)) out += '​';
  }
  return out;
}

/** Mix a #rrggbb colour with white (amount 0..1 of white) for readable cell tints. */
export function lighten(hex: string, amount: number) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const ch = (v: number) => Math.round(v + (255 - v) * amount).toString(16).padStart(2, '0');
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}

const C = { text: '#111827', muted: '#4b5563', line: '#d1d5db', head: '#f3f4f6', brand: '#0f3d5e', danger: '#b91c1c' };

export function renderJsaPdf(d: Detail, lang: Lang, timeZone: string, lookups: Lookups): PDFKit.PDFDocument {
  if (!fs.existsSync(FONT_REGULAR)) throw new Error(`PDF font not found: ${FONT_REGULAR}`);
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margins: { top: 70, bottom: 45, left: 36, right: 36 }, bufferPages: true, info: { Title: `${d.jsa.referenceNo} v${d.version.versionNo}`, Author: 'JSA System' } });
  doc.registerFont('R', FONT_REGULAR);
  doc.registerFont('B', fs.existsSync(FONT_BOLD) ? FONT_BOLD : FONT_REGULAR);
  const t = (k: LabelKey) => label(k, lang);
  const dt = (x: Date | string | null | undefined) => formatDateTime(x, lang, timeZone);
  const name = (o: { nameEn: string; nameTh: string } | null | undefined) => (o ? (lang === 'th' ? o.nameTh : o.nameEn) : '—');
  const W = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const left = doc.page.margins.left;
  const bottomLimit = () => doc.page.height - doc.page.margins.bottom;
  const ensure = (h: number) => { if (doc.y + h > bottomLimit()) doc.addPage(); };
  const lvl = (code: string | null | undefined) => d.matrix?.levels.find((l) => l.code === code);
  const lvlName = (code: string | null | undefined) => { const l = lvl(code); return l ? (lang === 'th' ? l.nameTh : l.nameEn) : (code ?? '—'); };
  const isCurrentlyValid = d.jsa.status === 'APPROVED' && d.version.isApprovedVersion && (!d.jsa.validUntil || new Date(d.jsa.validUntil) > new Date());

  const section = (k: LabelKey) => {
    ensure(40);
    doc.moveDown(0.6);
    doc.rect(left, doc.y, W, 18).fill(C.brand);
    doc.fillColor('#ffffff').font('B').fontSize(10).text(thaiWrap(t(k)), left + 6, doc.y + 4, { width: W - 12 });
    doc.fillColor(C.text).moveDown(0.5);
  };

  /** Generic table with automatic row heights and header repetition on page break. */
  const table = (cols: { header: string; width: number }[], rows: string[][], opts: { fontSize?: number; colorCell?: (r: number, c: number) => string | null; noHeader?: boolean } = {}) => {
    const fs_ = opts.fontSize ?? 8;
    const pad = 3;
    const drawHeader = () => {
      doc.font('B').fontSize(fs_);
      const h = Math.max(...cols.map((c) => doc.heightOfString(thaiWrap(c.header) || ' ', { width: c.width - pad * 2 }))) + pad * 2;
      const y0 = doc.y;
      let x = left;
      for (const c of cols) {
        doc.rect(x, y0, c.width, h).fillAndStroke(C.head, C.line);
        doc.fillColor(C.text).text(thaiWrap(c.header), x + pad, y0 + pad, { width: c.width - pad * 2 });
        x += c.width;
      }
      doc.y = y0 + h;
    };
    ensure(40);
    if (!opts.noHeader) drawHeader();
    rows.forEach((r, ri) => {
      doc.font('R').fontSize(fs_);
      const h = Math.max(...r.map((cell, ci) => doc.heightOfString(thaiWrap(cell) || ' ', { width: cols[ci].width - pad * 2 }))) + pad * 2;
      if (doc.y + h > bottomLimit()) { doc.addPage(); if (!opts.noHeader) drawHeader(); doc.font('R').fontSize(fs_); }
      const y = doc.y;
      let x = left;
      r.forEach((cell, ci) => {
        const fill = opts.colorCell?.(ri, ci);
        if (fill) doc.rect(x, y, cols[ci].width, h).fillAndStroke(fill, C.line); else doc.rect(x, y, cols[ci].width, h).stroke(C.line);
        doc.fillColor(C.text).text(thaiWrap(cell), x + pad, y + pad, { width: cols[ci].width - pad * 2 });
        x += cols[ci].width;
      });
      doc.y = y + h;
    });
    doc.x = left;
  };

  const kv = (pairs: [LabelKey, string][]) => {
    const half = W / 2;
    const rows: string[][] = [];
    for (let i = 0; i < pairs.length; i += 2) {
      const a = pairs[i]; const b = pairs[i + 1];
      rows.push([t(a[0]), a[1], b ? t(b[0]) : '', b ? b[1] : '']);
    }
    table([{ header: '', width: half * 0.32 }, { header: '', width: half * 0.68 }, { header: '', width: half * 0.32 }, { header: '', width: half * 0.68 }], rows, { fontSize: 8.5, noHeader: true, colorCell: (_r, c) => (c % 2 === 0 ? '#f9fafb' : null) });
  };

  const c = d.content;
  const j = d.jsa;
  // ── General
  section('general');
  kv([
    ['jobTitle', c.jobTitle], ['jobType', name(j.jobType)],
    ['requester', `${d.version.requesterName}`], ['requesterType', d.version.requesterType === 'CONTRACTOR' ? t('contractorType') : t('employee')],
    ['department', name(j.department)], ['contractor', j.contractorCompany?.name ?? '—'],
    ['contact', [c.contactPhone, c.contactEmail].filter(Boolean).join(' / ') || '—'], ['supervisor', [c.supervisorName, c.supervisorPhone].filter(Boolean).join(' / ') || '—'],
    ['site', name(j.site)], ['area', name(j.area)],
    ['location', c.exactLocation ?? '—'], ['workers', String(c.workerCount ?? '—')],
    ['period', `${dt(c.plannedStart)} – ${dt(c.plannedEnd)}`], ['emergency', [c.emergencyContactName, c.emergencyContactPhone].filter(Boolean).join(' / ') || '—'],
  ]);
  ensure(30);
  doc.moveDown(0.3).font('B').fontSize(9).text(thaiWrap(t('scope')), left, doc.y, { width: W });
  doc.font('R').fontSize(9).text(thaiWrap(c.jobDescription), { width: W });
  if (c.ppeRequired.length) {
    doc.moveDown(0.3).font('B').text(thaiWrap(t('ppe')));
    doc.font('R').text(thaiWrap(c.ppeRequired.map((p) => ppeLabel(p, lang)).join(', ')), { width: W });
  }
  // ── Permits
  if (c.permits.length) {
    section('permits');
    table([
      { header: lang === 'th' ? 'ประเภทงาน' : 'Activity', width: W * 0.25 }, { header: t('permitRef'), width: W * 0.2 },
      { header: t('verification'), width: W * 0.25 }, { header: lang === 'th' ? 'หมายเหตุ' : 'Notes', width: W * 0.3 },
    ], c.permits.map((p) => [
      name(lookups.permitTypes[p.permitTypeId]), p.referenceNo ?? '—', p.verified ? t('verified') : t('manual'), p.notes ?? '',
    ]));
  }
  // ── Steps
  section('steps');
  const cols = [
    { header: t('colStep'), width: W * 0.04 }, { header: t('colActivity'), width: W * 0.15 }, { header: t('colHazard'), width: W * 0.18 },
    { header: t('colInitial'), width: W * 0.09 }, { header: t('colControls'), width: W * 0.33 }, { header: t('colOwner'), width: W * 0.11 },
    { header: t('colResidual'), width: W * 0.1 },
  ];
  const rows: string[][] = []; const colors: (string | null)[][] = [];
  for (const s of c.steps) {
    s.hazards.forEach((h, i) => {
      const risk = (r: typeof h.initial) => (r ? `${r.severity}×${r.likelihood}=${r.score}\n${lvlName(r.levelCode)}` : '—');
      rows.push([
        i === 0 ? String(s.stepNo) : '', i === 0 ? s.activity : '', `${h.hazard}\n${lang === 'th' ? 'ผลกระทบ' : 'Consequence'}: ${h.consequence}`, risk(h.initial),
        [h.existingControls && `• ${h.existingControls}`, h.additionalControls && `+ ${h.additionalControls}`].filter(Boolean).join('\n'),
        h.controlOwner ?? '', risk(h.residual),
      ]);
      const tint = (code?: string) => { const l = lvl(code); return l ? lighten(l.color, 0.75) : null; };
      colors.push([null, null, null, tint(h.initial?.levelCode), null, null, tint(h.residual?.levelCode)]);
    });
  }
  table(cols, rows, { colorCell: (r, ci) => colors[r]?.[ci] ?? null });
  if (d.matrix) {
    doc.moveDown(0.3).font('R').fontSize(7.5).fillColor(C.muted).text(thaiWrap(`${t('matrix')}: ${d.matrix.name} (v${d.matrix.versionNo}) — ${d.matrix.levels.map((l) => `${lang === 'th' ? l.nameTh : l.nameEn} ${l.minScore}–${l.maxScore}`).join(', ')}${d.matrix.isValidated ? '' : lang === 'th' ? ' — ยังไม่ได้รับการตรวจรับรอง' : ' — NOT YET VALIDATED'}`), left, doc.y, { width: W });
    doc.fillColor(C.text);
  }
  // ── Attachments
  if (d.attachments.length) {
    section('attachments');
    doc.font('R').fontSize(8.5).text(d.attachments.map((a) => `• ${a.originalName} (${a.category}, ${(a.sizeBytes / 1024).toFixed(0)} KB)`).join('\n'), { width: W });
  }
  // ── Declaration
  if (d.declaration) {
    section('declaration');
    doc.font('R').fontSize(9).text(thaiWrap(`“${d.declaration.textSnapshot}”`), { width: W });
    doc.fillColor(C.muted).fontSize(8).text(`${d.version.requesterName} — ${dt(d.declaration.acceptedAt)} — ${d.declaration.declarationVersion} — v${d.version.versionNo}`).fillColor(C.text);
  }
  // ── Approval history
  section('approvals');
  table([
    { header: lang === 'th' ? 'วันเวลา' : 'Date/time', width: W * 0.16 }, { header: lang === 'th' ? 'ฉบับ' : 'Ver.', width: W * 0.05 },
    { header: lang === 'th' ? 'ขั้นตอน' : 'Stage', width: W * 0.16 }, { header: lang === 'th' ? 'ผลการพิจารณา' : 'Decision', width: W * 0.15 },
    { header: lang === 'th' ? 'ผู้ดำเนินการ' : 'By', width: W * 0.18 }, { header: lang === 'th' ? 'ความเห็น' : 'Comment', width: W * 0.3 },
  ], d.approvalHistory.map((h) => [
    dt(h.createdAt), `v${h.versionNo}`, h.stage ? STAGE_LABELS[h.stage][lang] : (lang === 'th' ? 'ผู้ขอ' : 'Requester'),
    DECISION_LABELS[h.decision]?.[lang] ?? h.decision, h.actorName, h.comment ?? '',
  ]));
  ensure(50);
  doc.moveDown(0.8).font('B').fontSize(8.5).fillColor(C.danger).text(thaiWrap(t('disclaimer')), left, doc.y, { width: W }).fillColor(C.text);

  // ── Header/footer on every page
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0; // allow writing the footer inside the bottom margin without triggering a new page
    const top = 22;
    doc.font('B').fontSize(13).fillColor(C.brand).text(thaiWrap(t('title')), left, top, { width: W * 0.45, lineBreak: false });
    doc.font('R').fontSize(8).fillColor(C.text);
    const meta = [
      `${t('reference')}: ${j.referenceNo}   ${t('version')}: ${d.version.versionNo}   ${t('status')}: ${statusLabel(j.status, lang)}`,
      `${t('approvedAt')}: ${dt(j.approvedAt)}   ${t('validity')}: ${dt(j.validFrom)} – ${dt(j.validUntil)}`,
    ];
    doc.text(thaiWrap(meta.join('\n')), left + W * 0.45, top, { width: W * 0.55, align: 'right' });
    doc.moveTo(left, 58).lineTo(left + W, 58).stroke(C.brand);
    if (!isCurrentlyValid) {
      doc.save().rotate(-20, { origin: [doc.page.width / 2, doc.page.height / 2] }).font('B').fontSize(46).fillColor(C.danger).fillOpacity(0.12)
        .text(thaiWrap(`${t('notCurrent')}\n${statusLabel(j.status, lang)}`), 0, doc.page.height / 2 - 60, { width: doc.page.width, align: 'center' }).restore();
      doc.fillOpacity(1);
    }
    doc.font('R').fontSize(7.5).fillColor(C.muted)
      .text(`${t('generated')}: ${dt(new Date())}   •   ${t('page')} ${i + 1}/${range.count}   •   SHA-256 ${d.version.contentHash?.slice(0, 16) ?? ''}`, left, doc.page.height - 30, { width: W, align: 'center', lineBreak: false });
    doc.fillColor(C.text);
    doc.page.margins.bottom = savedBottom;
  }
  doc.end();
  return doc;
}
