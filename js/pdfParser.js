const PDFParser = {
  async _ensureLib() {
    if (window.pdfjsLib) return;
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      s.onload = () => { pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'; resolve(); };
      s.onerror = reject; document.head.appendChild(s);
    });
  },

  _fixEncoding(text) {
    // Try to decode double-encoded UTF-8
    try {
      const bytes = new Uint8Array([...text].map(c => c.charCodeAt(0) & 0xFF));
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (decoded !== text && /[čćšžđČĆŠŽĐ]/.test(decoded)) return decoded;
    } catch {}
    // Manual fallback
    const m = [['Ä\x87','ć'],['Ä‡','ć'],['Ä\x86','Ć'],['Ä†','Ć'],['Ä\x8D','č'],['ÄŒ','Č'],['Ä\x8C','Č'],['Å¡','š'],['Å ','Š'],['Å¾','ž'],['Å½','Ž'],['Ä\x91','đ'],['Ä\x90','Đ'],['Ä'','đ'],['ÄŤ','č'],['Ĺ¡','š'],['Ĺž','ž'],['Ĺ˝','Ž'],['Ĺ ','Š'],['Ã¡','á'],['Ã©','é'],['Ã³','ó'],['Ãº','ú'],['Ã¼','ü'],['Ã¤','ä'],['Ã¶','ö'],['Â','']];
    let r = text;
    for (const [f, t] of m.sort((a, b) => b[0].length - a[0].length)) while (r.includes(f)) r = r.replace(f, t);
    return r;
  },

  async parsePDF(file) {
    await this._ensureLib();
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const textItems = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      for (const item of content.items) {
        const str = item.str.trim();
        if (str) textItems.push({ text: str, x: Math.round(item.transform[4]), y: Math.round(item.transform[5]), page: p });
      }
    }

    // Group into rows by Y
    const rowMap = new Map();
    for (const item of textItems) {
      let matched = false;
      for (const [yKey, row] of rowMap) {
        if (Math.abs(yKey - item.y) <= 4 && item.page === row[0].page) { row.push(item); matched = true; break; }
      }
      if (!matched) rowMap.set(item.y, [item]);
    }
    const rows = Array.from(rowMap.values()).sort((a, b) => a[0].page !== b[0].page ? a[0].page - b[0].page : b[0].y - a[0].y);
    rows.forEach(r => r.sort((a, b) => a.x - b.x));
    const rowTexts = rows.map(r => r.map(i => i.text).join(' '));

    console.log('PDF rows:'); rowTexts.forEach((r, i) => console.log(`  ${i}: ${r}`));

    // Doc number
    let docNum = '';
    const full = rowTexts.join(' ');
    const dm = full.match(/izlaz br\.\s*([\d\-\/]+)/i);
    if (dm) docNum = dm[1];
    else { for (const rt of rowTexts) { const m = rt.match(/^(\d{3,5}-\d{2,4})$/); if (m) { docNum = m[1]; break; } } }
    if (!docNum) docNum = file.name.replace('.pdf', '');

    // Parse items
    const items = [];
    for (let ri = 0; ri < rowTexts.length; ri++) {
      const row = this._fixEncoding(rowTexts[ri]);
      const bcMatch = row.match(/\b(\d{13})\b/);
      if (!bcMatch) continue;
      const barcode = bcMatch[1];
      const bcIdx = row.indexOf(barcode);

      // Qty
      const afterBC = row.substring(bcIdx);
      const qm = afterBC.match(/kom\s+(\d+(?:,\d+)?)/);
      let qty = qm ? Math.round(parseFloat(qm[1].replace(',', '.'))) : 1;

      // Name: between catalog and barcode
      let name = row.substring(0, bcIdx).trim().replace(/^\d{1,3}\s+/, '').replace(/^[A-Z]{1,3}-?[A-Z0-9]{3,15}\s+/, '');

      // Check next rows for continuation
      for (let nri = ri + 1; nri < Math.min(ri + 3, rowTexts.length); nri++) {
        const nr = this._fixEncoding(rowTexts[nri]);
        if (/\b\d{13}\b/.test(nr) || /Ukupno|Izdao|Stranica/.test(nr)) break;
        if (/^(UE|WW|EU|HR)$/.test(nr.trim()) || nr.length < 3) continue;
        let cleaned = nr.replace(/^[A-Z]{2}-[A-Z0-9]+\s*/g, '').replace(/^(UE|WW|EU|HR)\s+/g, '').trim();
        if (cleaned.length > 2 && /[a-zA-ZčćšžđČĆŠŽĐ]/.test(cleaned)) name += ' ' + cleaned;
      }

      name = this._fixEncoding(name.trim());
      if (!name || name.length < 3) name = 'Artikl ' + barcode;
      if (!items.find(i => i.barkod === barcode)) items.push({ naziv: name, barkod: barcode, ocekivano: qty, skenirano: 0 });
    }

    console.log('Parsed:', items);
    return { dokumentNaziv: this._fixEncoding('Međuskladišni izlaz br. ' + docNum), stavke: items };
  },

  async parseMultiple(files) {
    const results = [];
    for (const f of files) { try { results.push(await this.parsePDF(f)); } catch (e) { results.push({ dokumentNaziv: f.name, stavke: [], error: e.message }); } }
    return results;
  }
};
