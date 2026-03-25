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
    // Try to fix double-encoded UTF-8
    if (!/[\u00C0-\u00FF]/.test(text)) return text;
    try {
      return decodeURIComponent(escape(text));
    } catch (e) {
      return text;
    }
  },

  _cleanName: function(name) {
    // Remove catalog number patterns from the beginning
    // Patterns: "476547-01", "NB907CP", "SM-A576BDBBE", "EF-PA576CVEG"
    var cleaned = name;
    // Remove leading catalog numbers like "476547-01 " or "NB907CP "
    cleaned = cleaned.replace(/^\d{3,8}-?\d{0,4}\s+/, "");
    // Remove patterns like "SM-A576BDBBE" or "EF-PA576CVEG" at start
    cleaned = cleaned.replace(/^[A-Z]{1,4}-?[A-Z]?[A-Z0-9]{2,15}\s+/g, "");
    // Remove "UE " or "WW " at start
    cleaned = cleaned.replace(/^(UE|WW|EU|HR)\s+/g, "");
    // Remove trailing catalog codes like "EF-PA576CVEGWW"
    cleaned = cleaned.replace(/\s+[A-Z]{2}-[A-Z0-9]{6,}$/g, "");
    return cleaned.trim();
  },

  parsePDF: function(file) {
    var self = this;
    return this._ensureLib().then(function() {
      return file.arrayBuffer();
    }).then(function(arrayBuffer) {
      // Use cMapUrl for proper character encoding
      return pdfjsLib.getDocument({
        data: arrayBuffer,
        cMapUrl: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/",
        cMapPacked: true,
        standardFontDataUrl: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/standard_fonts/"
      }).promise;
    }).then(function(pdf) {
      var textItems = [];
      var pagePromises = [];

      for (var p = 1; p <= pdf.numPages; p++) {
        (function(pageNum) {
          pagePromises.push(
            pdf.getPage(pageNum).then(function(page) {
              return page.getTextContent({ normalizeWhitespace: true }).then(function(content) {
                for (var j = 0; j < content.items.length; j++) {
                  var item = content.items[j];
                  var str = item.str.trim();
                  if (str) {
                    textItems.push({
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
        // Sort by page, then y desc, then x asc
        textItems.sort(function(a, b) {
          if (a.page !== b.page) return a.page - b.page;
          if (Math.abs(a.y - b.y) > 4) return b.y - a.y;
          return a.x - b.x;
        });

        // Group into rows
        var rows = [];
        var currentRow = [];
        var currentY = null;
        var currentPage = null;

        for (var i = 0; i < textItems.length; i++) {
          var ti = textItems[i];
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

        var rowTexts = [];
        for (var r = 0; r < rows.length; r++) {
          var parts = [];
          for (var c = 0; c < rows[r].length; c++) parts.push(rows[r][c].text);
          rowTexts.push(parts.join(" "));
        }

        console.log("PDF rows:");
        for (var i = 0; i < rowTexts.length; i++) console.log("  " + i + ": " + rowTexts[i]);

        // Doc number
        var docNum = "";
        var full = rowTexts.join(" ");
        var dm = full.match(/izlaz br\.\s*([\d\-\/]+)/i);
        if (dm) docNum = dm[1];
        else {
          for (var i = 0; i < rowTexts.length; i++) {
            var m = rowTexts[i].match(/^(\d{3,5}-\d{2,4})$/);
            if (m) { docNum = m[1]; break; }
          }
        }
        if (!docNum) docNum = file.name.replace(".pdf", "");

        // Parse items from rows containing barcodes
        var items = [];
        for (var ri = 0; ri < rowTexts.length; ri++) {
          var row = self._fixText(rowTexts[ri]);
          var bcMatch = row.match(/\b(\d{13})\b/);
          if (!bcMatch) continue;
          var barcode = bcMatch[1];
          var bcIdx = row.indexOf(barcode);

          // Qty: find "kom X,00" after barcode
          var afterBC = row.substring(bcIdx);
          var qm = afterBC.match(/kom\s+(\d+(?:,\d+)?)/);
          var qty = qm ? Math.round(parseFloat(qm[1].replace(",", "."))) : 1;

          // Name: text between catalog number and barcode
          var name = row.substring(0, bcIdx).trim();
          // Remove RB number at start
          name = name.replace(/^\d{1,3}\s+/, "");
          // Clean catalog numbers
          name = self._cleanName(name);

          // Check next rows for name continuation
          for (var nri = ri + 1; nri < Math.min(ri + 3, rowTexts.length); nri++) {
            var nr = self._fixText(rowTexts[nri]);
            if (/\b\d{13}\b/.test(nr)) break;
            if (/Ukupno|Izdao|Stranica/.test(nr)) break;
            var nrt = nr.trim();
            if (nrt === "UE" || nrt === "WW" || nrt === "EU" || nrt === "HR") continue;
            if (nr.length < 3) continue;
            var cleaned = self._cleanName(nr);
            if (cleaned.length > 2 && /[a-zA-Z]/.test(cleaned)) {
              name += " " + cleaned;
            }
          }

          name = self._fixText(name.trim());
          name = self._cleanName(name);
          if (!name || name.length < 3) name = "Artikl " + barcode;

          // Avoid duplicates
          var exists = false;
          for (var k = 0; k < items.length; k++) {
            if (items[k].barkod === barcode) { exists = true; break; }
          }
          if (!exists) {
            items.push({ naziv: name, barkod: barcode, ocekivano: qty, skenirano: 0 });
          }
        }

        console.log("Parsed:", items);
        var docName = self._fixText("Me\u0111uskladi\u0161ni izlaz br. " + docNum);
        return { dokumentNaziv: docName, stavke: items };
      });
    });
  },

  parseMultiple: function(files) {
    var self = this;
    var results = [];
    var chain = Promise.resolve();
    for (var i = 0; i < files.length; i++) {
      (function(f) {
        chain = chain.then(function() {
          return self.parsePDF(f).then(function(r) { results.push(r); })
          .catch(function(e) { results.push({ dokumentNaziv: f.name, stavke: [], error: e.message }); });
        });
      })(files[i]);
    }
    return chain.then(function() { return results; });
  }
};
