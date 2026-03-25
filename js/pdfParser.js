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
      // Extract all text items with positions across all pages
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
        // Sort items: by page, then Y descending (top to bottom), then X ascending
        allItems.sort(function(a, b) {
          if (a.page !== b.page) return a.page - b.page;
          if (Math.abs(a.y - b.y) > 4) return b.y - a.y;
          return a.x - b.x;
        });

        // Group into rows by Y proximity
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

        // Sort within each row by X
        for (var r = 0; r < rows.length; r++) {
          rows[r].sort(function(a, b) { return a.x - b.x; });
        }

        // Build line texts
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
            var m = lines[i].match(/^(\d{3,5}-\d{2,4})$/);
            if (m) { docNum = m[1]; break; }
          }
        }
        if (!docNum) docNum = file.name.replace(".pdf", "");

        // ========================================
        // PARSE ITEMS USING RB + "kom" PATTERN
        // Structure per item in the text:
        //   Line: RB number (standalone integer 1-999)
        //   Line: "kom"
        //   Line: barcode (12-13 digit number)
        //   Line: MPC price
        //   Line: total price
        //   Line: quantity (like "2,00")
        //   Line: catalog number
        //   Line: [optional Skl.Mj like "UE", "WW", "EU", "EE", or other]
        //   Lines: product name (one or more lines until next RB)
        // ========================================

        var items = [];
        var i = 0;

        while (i < lines.length) {
          var line = lines[i].trim();

          // Check: is this line a standalone RB number (1-999)?
          if (/^\d{1,3}$/.test(line)) {
            var rb = parseInt(line);
            if (rb > 0 && rb < 1000) {
              // Check next line is "kom"
              if (i + 1 < lines.length && lines[i + 1].trim() === "kom") {
                // We found an item start!
                var barcodeLine = (i + 2 < lines.length) ? lines[i + 2].trim() : "";
                var mpcLine = (i + 3 < lines.length) ? lines[i + 3].trim() : "";
                var totalLine = (i + 4 < lines.length) ? lines[i + 4].trim() : "";
                var qtyLine = (i + 5 < lines.length) ? lines[i + 5].trim() : "1";
                var catalogLine = (i + 6 < lines.length) ? lines[i + 6].trim() : "";

                // Parse barcode
                var barcode = "";
                var bcMatch = barcodeLine.match(/^(\d{12,13})$/);
                if (bcMatch) {
                  barcode = bcMatch[1];
                } else {
                  // Barcode might be on the same row with other data
                  var bcSearch = barcodeLine.match(/(\d{12,13})/);
                  if (bcSearch) barcode = bcSearch[1];
                }

                // Parse quantity
                var qty = 1;
                var qtyMatch = qtyLine.match(/^(\d+),(\d+)$/);
                if (qtyMatch) {
                  qty = parseInt(qtyMatch[1]);
                } else {
                  var qtyNum = parseFloat(qtyLine.replace(",", "."));
                  if (!isNaN(qtyNum) && qtyNum > 0) qty = Math.round(qtyNum);
                }

                // Skip catalog number and optional Skl.Mj, collect name lines
                var nameStart = i + 7; // after catalog
                
                // Check if line at i+7 is a Skl.Mj code (UE, WW, EU, EE, HR, or short code)
                if (nameStart < lines.length) {
                  var maybeSklMj = lines[nameStart].trim();
                  if (/^(UE|WW|EU|EE|HR|\d+\.\d+)$/.test(maybeSklMj) || maybeSklMj.length <= 4) {
                    nameStart = i + 8;
                  }
                }

                // Collect name lines until next RB+kom or structural elements
                var nameLines = [];
                var j = nameStart;
                while (j < lines.length) {
                  var nextLine = lines[j].trim();

                  // Stop if we hit next item (number followed by "kom")
                  if (/^\d{1,3}$/.test(nextLine)) {
                    var nextRb = parseInt(nextLine);
                    if (nextRb > 0 && nextRb < 1000 && j + 1 < lines.length && lines[j + 1].trim() === "kom") {
                      break;
                    }
                  }
                  // Stop at structural elements
                  if (/^Ukupno|^Stranica|^Izdao|^Sancta Domenica|^Vrijeme/.test(nextLine)) break;
                  // Stop at page header repeated elements
                  if (/^RB\s+Katalo/.test(nextLine)) break;
                  if (nextLine === "Skl. Mj.") break;

                  // Skip empty or very short lines
                  if (nextLine.length > 1) {
                    nameLines.push(nextLine);
                  }
                  j++;
                }

                var name = nameLines.join(" ").trim();

                // Clean up name: remove trailing catalog codes like "SM-A175B", "EF-QA576CTEGWW", "EP-T2510NWEGEU"
                name = name.replace(/\s+[A-Z]{2,4}-[A-Z0-9]{4,}$/g, "");
                // Remove trailing codes in parentheses that are model numbers
                // But keep useful parenthetical info like "(DJI RC2)"
                
                if (!name || name.length < 2) name = "Artikl " + barcode;

                if (barcode) {
                  // Check for duplicate barcodes
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

                i = j; // Jump to where we stopped
                continue;
              }
            }
          }
          i++;
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
