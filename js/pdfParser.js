var PDFParser = {

  _ensureLib: function() {
    if (window.pdfjsLib) return Promise.resolve();
    return new Promise(function(resolve, reject) {
      var s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      s.onload = function() {
        pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        resolve();
      };
      s.onerror = reject;
      document.head.appendChild(s);
    });
  },

  _fixText: function(text) {
    var result = text;
    // First try to fix double-encoded UTF-8
    try {
      if (/[\u00C0-\u00FF]/.test(result)) {
        var decoded = decodeURIComponent(escape(result));
        if (decoded !== result) result = decoded;
      }
    } catch(e) {}
    // Replace multi-char mojibake sequences (must come before single-char)
    var multi = [
      ["Ä\u0087","c"],["Ä\u008D","c"],["Ä\u0091","d"],["Ä\u0086","C"],["Ä\u008C","C"],["Ä\u0090","D"],
      ["Å\u00A1","s"],["Å\u00BE","z"],["Å\u00BD","Z"],["Å\u00A0","S"],
      ["Ã¤","d"],["Ã¶","o"],["Ã¼","u"],["Ã©","e"],["Ã¡","a"],["Ã³","o"],["Ãº","u"]
    ];
    for (var m = 0; m < multi.length; m++) {
      while (result.indexOf(multi[m][0]) >= 0) {
        result = result.replace(multi[m][0], multi[m][1]);
      }
    }
    // Replace single characters (proper Unicode + any remaining)
    var out = "";
    for (var i = 0; i < result.length; i++) {
      var ch = result.charAt(i);
      var code = result.charCodeAt(i);
      if (code === 0x10D || code === 0x10C) out += (code === 0x10D) ? "c" : "C";       // č Č
      else if (code === 0x107 || code === 0x106) out += (code === 0x107) ? "c" : "C";   // ć Ć
      else if (code === 0x161 || code === 0x160) out += (code === 0x161) ? "s" : "S";   // š Š
      else if (code === 0x17E || code === 0x17D) out += (code === 0x17E) ? "z" : "Z";   // ž Ž
      else if (code === 0x111 || code === 0x110) out += (code === 0x111) ? "d" : "D";   // đ Đ
      else if (code === 0xC2) out += "";  // stray Â from mojibake
      else out += ch;
    }
    return out;
  },

  parsePDF: function(file) {
    var self = this;
    return this._ensureLib().then(function() {
      return file.arrayBuffer();
    }).then(function(arrayBuffer) {
      return pdfjsLib.getDocument({
        data: arrayBuffer,
        cMapUrl: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/",
        cMapPacked: true
      }).promise;
    }).then(function(pdf) {
      var allItems = [];
      var pagePromises = [];

      for (var p = 1; p <= pdf.numPages; p++) {
        (function(pageNum) {
          pagePromises.push(
            pdf.getPage(pageNum).then(function(page) {
              return page.getTextContent().then(function(content) {
                for (var j = 0; j < content.items.length; j++) {
                  var item = content.items[j];
                  var str = item.str.trim();
                  if (str) {
                    allItems.push({
                      text: str,
                      x: Math.round(item.transform[4]),
                      y: Math.round(item.transform[5]),
                      page: pageNum
                    });
                  }
                }
              });
            })
          );
        })(p);
      }

      return Promise.all(pagePromises).then(function() {
        allItems.sort(function(a, b) {
          if (a.page !== b.page) return a.page - b.page;
          if (Math.abs(a.y - b.y) > 4) return b.y - a.y;
          return a.x - b.x;
        });

        var rows = [];
        var currentRow = [];
        var currentY = null;
        var currentPage = null;

        for (var i = 0; i < allItems.length; i++) {
          var ti = allItems[i];
          if (currentY === null || Math.abs(ti.y - currentY) > 4 || ti.page !== currentPage) {
            if (currentRow.length > 0) rows.push(currentRow);
            currentRow = [ti];
            currentY = ti.y;
            currentPage = ti.page;
          } else {
            currentRow.push(ti);
          }
        }
        if (currentRow.length > 0) rows.push(currentRow);

        for (var r = 0; r < rows.length; r++) {
          rows[r].sort(function(a, b) { return a.x - b.x; });
        }

        var lines = [];
        for (var r = 0; r < rows.length; r++) {
          var parts = [];
          for (var c = 0; c < rows[r].length; c++) parts.push(rows[r][c].text);
          lines.push(self._fixText(parts.join(" ")));
        }

        console.log("PDF lines:");
        for (var i = 0; i < lines.length; i++) console.log("  " + i + ": [" + lines[i] + "]");

        // Find document number
        var docNum = "";
        var fullText = lines.join(" ");
        var dm = fullText.match(/izlaz br\.\s*([\d\-\/]+)/i);
        if (dm) docNum = dm[1];
        else {
          for (var i = 0; i < lines.length; i++) {
            var m = lines[i].match(/(\d{3,5}-\d{2,4})/);
            if (m) { docNum = m[1]; break; }
          }
        }
        if (!docNum) docNum = file.name.replace(".pdf", "");

        // ========================================
        // PARSE ITEMS FROM SINGLE-LINE FORMAT
        // Each item line looks like:
        //   "RB CATALOG NAME... BARCODE kom QTY MPC TOTAL"
        // Where BARCODE is 12-13 digits
        // And the line starts with a number (RB)
        //
        // Some items span 2 lines:
        //   "1 SM-R390NZAAE Sat Samsung Galaxy Fit3 sivi SM-R390NZAAEUE 8806095362175 kom 2,00 39,00 78,00"
        //   "UE"  (continuation - Skl.Mj. or extra name)
        // ========================================

        var items = [];

        for (var i = 0; i < lines.length; i++) {
          var line = lines[i];

          // Match: starts with RB number, contains 12-13 digit barcode, contains "kom" and quantity
          var match = line.match(/^(\d{1,3})\s+\S+\s+(.*?)\s+(\d{12,13})\s+kom\s+(\d+)[,\.]\d+/);

          if (!match) continue;

          var rb = parseInt(match[1]);
          if (rb < 1 || rb > 999) continue;

          var rawName = match[2];
          var barcode = match[3];
          var qty = parseInt(match[4]);

          // Clean name: remove catalog number at the start
          // The raw name includes catalog after RB, like "SM-R390NZAAE Sat Samsung..."
          // We already skipped RB and first token (catalog) in the regex via \S+
          // But rawName still might have trailing model codes

          // Remove trailing model/catalog codes (uppercase letters+numbers pattern at end)
          var name = rawName;
          // Remove trailing codes like "SM-R390NZAAEUE", "EP-T2510NWEGEU", "SM-G556B"
          name = name.replace(/\s+[A-Z]{2,4}-[A-Z0-9]{3,}$/g, "");
          // Remove trailing standalone model like "SM-A175B" but keep meaningful words
          name = name.replace(/\s+SM-[A-Z0-9]+$/g, "");

          // Check next line for continuation (extra name text)
          if (i + 1 < lines.length) {
            var nextLine = lines[i + 1];
            // Continuation lines start with Skl.Mj (UE, WW, EU, EE) or have extra text
            // but DON'T start with a new RB number
            if (!/^\d{1,3}\s+\S+\s+/.test(nextLine) && !/^Ukupno|^Stranica|^Izdao|^Vrijeme|^Sancta|^RB\s/.test(nextLine)) {
              // It's a continuation - extract useful name parts
              var extra = nextLine;
              // Remove Skl.Mj prefix
              extra = extra.replace(/^(UE|WW|EU|EE|HR|\d+\.\d+)\s*/, "");
              // Remove trailing catalog codes
              extra = extra.replace(/\s*[A-Z]{2,4}-[A-Z0-9]{4,}$/g, "");
              extra = extra.replace(/\s*SM-[A-Z0-9]+$/g, "");
              extra = extra.trim();
              if (extra.length > 1 && /[a-zA-Z]/.test(extra)) {
                name = name + " " + extra;
              }
            }
          }

          name = name.trim();
          if (!name || name.length < 2) name = "Artikl " + barcode;

            items.push({
              naziv: name,
              barkod: barcode,
              ocekivano: qty,
              skenirano: 0
            });
          }
        }

        console.log("Parsed " + items.length + " items:", items);

        return {
          dokumentNaziv: "MSI " + docNum,
          stavke: items
        };
      });
    });
  },

  // ===== EXCEL PARSER =====
  _ensureXlsx: function() {
    if (window.XLSX) return Promise.resolve();
    return new Promise(function(resolve, reject) {
      var s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  },

  parseExcel: function(file) {
    var self = this;
    return this._ensureXlsx().then(function() {
      return file.arrayBuffer();
    }).then(function(arrayBuffer) {
      var wb = XLSX.read(arrayBuffer, { type: "array" });
      var sheetName = wb.SheetNames[0];
      var ws = wb.Sheets[sheetName];
      var data = XLSX.utils.sheet_to_json(ws, { header: 1 });

      console.log("Excel rows:", data.length);
      for (var i = 0; i < Math.min(5, data.length); i++) console.log("  " + i + ":", data[i]);

      // Find header row - look for row containing "Barcode" or "barcode" or "Barkod" or "EAN"
      var headerRow = -1;
      var colBarcode = -1, colNaziv = -1, colKol = -1;

      for (var r = 0; r < Math.min(10, data.length); r++) {
        var row = data[r];
        if (!row) continue;
        for (var c = 0; c < row.length; c++) {
          var val = String(row[c] || "").toLowerCase().trim();
          if (val === "barcode" || val === "barkod" || val === "ean" || val === "bar code") colBarcode = c;
          if (val === "naziv" || val === "naziv artikla" || val === "opis" || val === "description" || val === "artikl naziv") colNaziv = c;
          if (val === "kolicina" || val === "količina" || val === "kol" || val === "qty" || val === "kom") colKol = c;
        }
        if (colBarcode >= 0) { headerRow = r; break; }
      }

      // If no header found, try auto-detect: look for column with 13-digit numbers
      if (headerRow < 0) {
        for (var r = 0; r < Math.min(5, data.length); r++) {
          var row = data[r];
          if (!row) continue;
          for (var c = 0; c < row.length; c++) {
            var val = String(row[c] || "");
            if (/^\d{12,13}$/.test(val)) {
              colBarcode = c;
              headerRow = r - 1;
              break;
            }
          }
          if (colBarcode >= 0) break;
        }
        // Guess other columns based on position relative to barcode
        if (colBarcode >= 0) {
          if (colNaziv < 0) colNaziv = colBarcode > 0 ? colBarcode - 1 : colBarcode + 1;
          if (colKol < 0) colKol = colBarcode + 1;
        }
      }

      if (colBarcode < 0) {
        console.warn("Could not find barcode column");
        return { dokumentNaziv: file.name.replace(/\.[^.]+$/, ""), stavke: [] };
      }

      console.log("Header row:", headerRow, "Barcode col:", colBarcode, "Naziv col:", colNaziv, "Kol col:", colKol);

      var items = [];
      var startRow = headerRow + 1;

      for (var r = startRow; r < data.length; r++) {
        var row = data[r];
        if (!row) continue;

        var barcode = String(row[colBarcode] || "").trim();
        // Must be 8-13 digit number
        if (!/^\d{8,13}$/.test(barcode)) continue;

        var naziv = colNaziv >= 0 ? String(row[colNaziv] || "").trim() : "Artikl " + barcode;
        var qty = colKol >= 0 ? parseInt(row[colKol]) : 1;
        if (isNaN(qty) || qty <= 0) qty = 1;

        // Clean naziv
        naziv = self._fixText(naziv);
        if (!naziv || naziv.length < 2) naziv = "Artikl " + barcode;

        // Avoid duplicates
        var exists = false;
        for (var k = 0; k < items.length; k++) {
          if (items[k].barkod === barcode) { exists = true; break; }
        }
        if (!exists) {
          items.push({ naziv: naziv, barkod: barcode, ocekivano: qty, skenirano: 0 });
        }
      }

      console.log("Parsed " + items.length + " items from Excel:", items);

      var docName = file.name.replace(/\.[^.]+$/, "");
      return { dokumentNaziv: docName, stavke: items };
    });
  },

  // ===== PARSE MULTIPLE (PDF + EXCEL) =====
  parseMultiple: function(files) {
    var self = this;
    var results = [];
    var chain = Promise.resolve();
    for (var i = 0; i < files.length; i++) {
      (function(f) {
        chain = chain.then(function() {
          var ext = f.name.toLowerCase().split(".").pop();
          var parser;
          if (ext === "pdf") {
            parser = self.parsePDF(f);
          } else if (ext === "xlsx" || ext === "xls" || ext === "csv") {
            parser = self.parseExcel(f);
          } else {
            parser = Promise.resolve({ dokumentNaziv: f.name, stavke: [], error: "Nepodrzani format" });
          }
          return parser.then(function(r) {
            results.push(r);
          }).catch(function(e) {
            console.error("Parse error:", e);
            results.push({ dokumentNaziv: f.name, stavke: [], error: e.message });
          });
        });
      })(files[i]);
    }
    return chain.then(function() { return results; });
  }
};
