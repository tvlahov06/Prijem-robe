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
    if (!/[\u00C0-\u00FF]/.test(text)) return text;
    try { return decodeURIComponent(escape(text)); } catch (e) { return text; }
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

          // Avoid duplicates
          var exists = false;
          for (var k = 0; k < items.length; k++) {
            if (items[k].barkod === barcode) { exists = true; break; }
          }
          if (!exists) {
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

  parseMultiple: function(files) {
    var self = this;
    var results = [];
    var chain = Promise.resolve();
    for (var i = 0; i < files.length; i++) {
      (function(f) {
        chain = chain.then(function() {
          return self.parsePDF(f).then(function(r) {
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
